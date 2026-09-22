import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';

// E2E de Meseros (F2-231) sobre la app REAL contra Postgres REAL, con las fixtures sintéticas
// de F1-011 (A1 y A2 de la empresa A, B1 de la B; zona CDMX). Cuentas y catálogo van ESCRITOS A
// MANO: las cifras esperadas se calcularon aquí, no con otra consulta. Lo que sólo existe aquí
// (no en el seed): cuentas sin mesero, un mesero con sólo cancelaciones, un texto del POS con
// otra capitalización y una duración negativa.

const KEYS = {
  a1: 'msr_sintetica-meseros-F2-231-sucursal-a1-00000000001',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

const DIA = '2026-09-10';
const RANGO = { desde: DIA, hasta: DIA };
/** 12:00 de CDMX del 10-sep. */
const MEDIODIA = Date.parse('2026-09-10T18:00:00Z');
const HORA = 3_600_000;
const sinc = (n: number) => `f2231000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Fila {
  sucursalId: string;
  mesero: string | null;
  textosPos: string[];
  cruce: string;
  catalogo: { id: string; clave: string | null; activo: boolean; activoPos: boolean | null } | null;
  venta: string;
  cuentas: number;
  ticketPromedio: string | null;
  comensales: number;
  propina: string;
  descuentos: { monto: string; cuentas: number };
  cancelados: { cuentas: number; monto: string };
  minutosPromedio: string | null;
  cuentasConDuracion: number;
  posicion: number | null;
}
interface Respuesta {
  venta: string;
  cuentas: number;
  descuentos: { monto: string; cuentas: number };
  cancelados: { cuentas: number; monto: string };
  catalogoTruncado: boolean;
  sucursales: Array<{
    sucursalId: string;
    catalogoSincronizado: boolean;
    meserosEnRanking: number;
    venta: string;
    cuentas: number;
    promedio: Record<string, string | null>;
  }>;
  filas: Fila[];
  sinVentas: Array<{ id: string; sucursalId: string; clave: string | null; nombre: string }>;
}

describe('Meseros (e2e, F2-231)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const get = async (ruta: string, u: Usuario, query: Record<string, string> = {}) =>
    request(url)
      .get(ruta)
      .query(query)
      .set('Authorization', `Bearer ${await token(u)}`);
  const rendimiento = async (u: Usuario, query: Record<string, string>) => {
    const r = await get('/catalogos/meseros/rendimiento', u, query);
    expect(r.status).toBe(200);
    return r.body as Respuesta;
  };

  /** Una sincronización completa de meseros de A1 (una página + cierre). */
  async function sincronizarA1(n: number, capturadoAt: string, registros: object[]) {
    const p = await request(url)
      .post('/ingesta/catalogos')
      .set('X-Api-Key', KEYS.a1)
      .send({ catalogo: 'meseros', sincronizacionId: sinc(n), capturadoAt, registros });
    expect(p.status).toBe(200);
    expect(p.body.rechazados).toEqual([]);
    const c = await request(url)
      .post('/ingesta/catalogos/cierre')
      .set('X-Api-Key', KEYS.a1)
      .send({
        catalogo: 'meseros',
        sincronizacionId: sinc(n),
        capturadoAt,
        total: registros.length,
        rechazados: 0,
      });
    expect(c.status).toBe(200);
    expect(c.body.aplicado).toBe(true);
  }

  let folio = 0;
  async function cuenta(
    sucursalId: string,
    empresaId: string,
    mesero: string | null,
    total: string,
    extra: {
      cancelado?: boolean;
      descuentos?: string;
      propina?: string;
      comensales?: number | null;
      cerradoAt?: number;
      /** Minutos que estuvo abierta (negativo = el POS trae el cierre antes que la apertura). */
      minutos?: number;
    } = {},
  ) {
    folio++;
    const cerrado = extra.cerradoAt ?? MEDIODIA;
    await prisma.cheque.create({
      data: {
        sucursalId,
        empresaId,
        folio: `W${folio}`,
        folioSr: `W${folio}`,
        mesero,
        comensales: extra.comensales === undefined ? 2 : extra.comensales,
        abiertoAt: new Date(cerrado - (extra.minutos ?? 60) * 60_000),
        cerradoAt: new Date(cerrado),
        subtotal: total,
        impuestos: '0.00',
        descuentos: extra.descuentos ?? '0.00',
        propina: extra.propina ?? '0.00',
        total,
        cancelado: extra.cancelado ?? false,
      },
    });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({
      where: { id: FX.sucursalA1 },
      data: { apiKeyHash: hashApiKey(KEYS.a1) },
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    // Catálogo de A1: dos sincronizaciones completas. En la segunda Rita ya no viene
    // (desaparece del POS: activo=false) y Pedro viene dado de baja en el POS.
    const ana = { origenSrId: 'M1', clave: 'M1', nombre: 'Ana López' };
    const pedro = { origenSrId: 'M2', clave: 'M2', nombre: 'Pedro Baja' };
    const rita = { origenSrId: 'M3', clave: 'M3', nombre: 'Rita Ida' };
    const nadie = { origenSrId: 'M4', clave: 'M4', nombre: 'Sin Ventas' };
    await sincronizarA1(1, '2026-09-01T10:00:00.000Z', [ana, pedro, rita, nadie]);
    await sincronizarA1(2, '2026-09-12T10:00:00.000Z', [
      ana,
      { ...pedro, activoPos: false },
      nadie,
    ]);

    // A1, el 10-sep.
    await cuenta(FX.sucursalA1, FX.empresaA, 'Ana López', '100.00', {
      descuentos: '10.00',
      propina: '5.00',
    });
    await cuenta(FX.sucursalA1, FX.empresaA, 'ANA LÓPEZ', '50.50', { minutos: -30 });
    await cuenta(FX.sucursalA1, FX.empresaA, 'Pedro Baja', '200.00', { comensales: null });
    await cuenta(FX.sucursalA1, FX.empresaA, 'Pedro Baja', '80.00', { cancelado: true });
    await cuenta(FX.sucursalA1, FX.empresaA, 'Rita Ida', '30.00');
    await cuenta(FX.sucursalA1, FX.empresaA, null, '20.00');
    await cuenta(FX.sucursalA1, FX.empresaA, 'Solo Cancela', '15.00', { cancelado: true });
    // Fuera del periodo: el 11-sep a mediodía CDMX.
    await cuenta(FX.sucursalA1, FX.empresaA, 'Ana López', '999.00', {
      cerradoAt: MEDIODIA + 24 * HORA,
    });
    // A2 (sin catálogo sincronizado) y B1 (otra empresa).
    await cuenta(FX.sucursalA2, FX.empresaA, 'Ana López', '40.00');
    await cuenta(FX.sucursalB1, FX.empresaB, 'Ana López', '500.00');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  const deA = { empresaId: FX.empresaA, ...RANGO };
  const filaDe = (r: Respuesta, sucursalId: string, mesero: string | null) =>
    r.filas.find((f) => f.sucursalId === sucursalId && f.mesero === mesero)!;

  it('AC: Σ venta de los meseros = venta total del periodo (a mano y = /ventas/resumen)', async () => {
    const r = await rendimiento(USUARIOS.visorA, deA);
    // 100 + 50.50 + 200 + 30 + 20 (sin mesero) en A1, + 40 en A2. Nada de B, del 11-sep ni
    // de los cancelados.
    expect(r.venta).toBe('440.50');
    const suma = r.filas.reduce((s, f) => s.plus(f.venta), new Prisma.Decimal(0));
    expect(suma.toFixed(2)).toBe('440.50');
    const resumen = await get('/ventas/resumen', USUARIOS.visorA, deA);
    expect(resumen.status).toBe(200);
    expect(resumen.body.venta).toBe('440.50');
    expect(r.cuentas).toBe(6);
  });

  it('AC: cancelaciones y descuentos van aparte, con conteo e importe, fuera de la venta', async () => {
    const r = await rendimiento(USUARIOS.visorA, deA);
    expect(r.cancelados).toEqual({ cuentas: 2, monto: '95.00' });
    expect(r.descuentos).toEqual({ monto: '10.00', cuentas: 1 });
    const pedro = filaDe(r, FX.sucursalA1, 'Pedro Baja');
    // Su cancelado de 80 NO está en su venta.
    expect(pedro).toMatchObject({
      venta: '200.00',
      cuentas: 1,
      cancelados: { cuentas: 1, monto: '80.00' },
    });
    const solo = filaDe(r, FX.sucursalA1, 'Solo Cancela');
    expect(solo).toMatchObject({
      venta: '0.00',
      cuentas: 0,
      posicion: null,
      cruce: 'sin-catalogo',
      cancelados: { cuentas: 1, monto: '15.00' },
    });
  });

  it('liga con el espejo y consolida dos textos del mismo mesero; tiempo de mesa sin negativas', async () => {
    const r = await rendimiento(USUARIOS.visorA, deA);
    const ana = filaDe(r, FX.sucursalA1, 'Ana López');
    expect(ana).toMatchObject({
      textosPos: ['ANA LÓPEZ', 'Ana López'],
      cruce: 'catalogo',
      // Sin `activoPos` en la ingesta = el POS no lo reporta (null), nunca "activo".
      catalogo: { clave: 'M1', activo: true, activoPos: null },
      venta: '150.50',
      cuentas: 2,
      ticketPromedio: '75.25',
      comensales: 4,
      propina: '5.00',
      descuentos: { monto: '10.00', cuentas: 1 },
      // Sólo la de 60 min: la de −30 no entra.
      minutosPromedio: '60.0',
      cuentasConDuracion: 1,
      posicion: 2,
    });
    expect(r.filas.filter((f) => f.catalogo?.clave === 'M1')).toHaveLength(1);
    // Y /ventas/por-mesero (Análisis) trae el tiempo de mesa por texto del POS.
    const pm = await get('/ventas/por-mesero', USUARIOS.visorA, deA);
    expect(pm.status).toBe(200);
    const mayus = (pm.body as Array<Record<string, unknown>>).find((f) => f.mesero === 'ANA LÓPEZ');
    expect(mayus).toMatchObject({ minutosPromedio: null, cuentasConDuracion: 0 });
    expect(mayus).not.toHaveProperty('segundos');
  });

  it('AC: el dado de baja (en el POS o desaparecido) sale en su periodo con sus cifras', async () => {
    const r = await rendimiento(USUARIOS.visorA, deA);
    expect(filaDe(r, FX.sucursalA1, 'Pedro Baja')).toMatchObject({
      posicion: 1,
      catalogo: { clave: 'M2', activo: true, activoPos: false },
    });
    expect(filaDe(r, FX.sucursalA1, 'Rita Ida')).toMatchObject({
      venta: '30.00',
      posicion: 3,
      catalogo: { clave: 'M3', activo: false },
    });
  });

  it('ranking y promedio por sucursal; A2 sin catálogo dice "sin sincronizar"', async () => {
    const r = await rendimiento(USUARIOS.visorA, deA);
    expect(
      r.filas.filter((f) => f.sucursalId === FX.sucursalA1).map((f) => [f.mesero, f.posicion]),
    ).toEqual([
      ['Pedro Baja', 1],
      ['Ana López', 2],
      ['Rita Ida', 3],
      ['Solo Cancela', null],
      [null, null],
    ]);
    const a1 = r.sucursales.find((s) => s.sucursalId === FX.sucursalA1)!;
    expect(a1).toMatchObject({ catalogoSincronizado: true, meserosEnRanking: 3, venta: '400.50' });
    expect(a1.promedio).toEqual({
      ventaPorMesero: '126.83', // 380.50 / 3
      cuentasPorMesero: '1.3', // 4 / 3
      propinaPorMesero: '1.67', // 5 / 3
      comensalesPorMesero: '2.0', // (4 + 0 + 2) / 3
      ticketPromedio: '80.10', // 400.50 / 5, con la sin mesero
      minutosPromedio: '60.0', // 4 cuentas de 60 min; la de −30 fuera
    });
    const a2 = r.sucursales.find((s) => s.sucursalId === FX.sucursalA2)!;
    expect(a2.catalogoSincronizado).toBe(false);
    expect(filaDe(r, FX.sucursalA2, 'Ana López').cruce).toBe('sin-sincronizar');
    // Del espejo sin ventas en el periodo, sólo M4.
    expect(r.sinVentas.map((m) => m.clave)).toEqual(['M4']);
    expect(r.catalogoTruncado).toBe(false);
  });

  it('un periodo sin cuentas del dado de baja lo deja fuera del ranking y en "sin ventas"', async () => {
    const r = await rendimiento(USUARIOS.visorA, {
      empresaId: FX.empresaA,
      sucursalId: FX.sucursalA1,
      desde: '2026-09-11',
      hasta: '2026-09-11',
    });
    expect(r.filas.map((f) => f.mesero)).toEqual(['Ana López']);
    expect(r.sinVentas.map((m) => m.clave)).toEqual(['M2', 'M3', 'M4']);
  });

  describe('scope', () => {
    it('empresa ajena = 404 (nunca 403), también con sucursal ajena', async () => {
      for (const [u, query] of [
        [USUARIOS.visorA, { empresaId: FX.empresaB, ...RANGO }],
        [USUARIOS.visorB, deA],
        [USUARIOS.visorA, { ...deA, sucursalId: FX.sucursalB1 }],
        [USUARIOS.adminGlobal, { ...deA, sucursalId: FX.sucursalB1 }],
        [USUARIOS.visorA, { empresaId: FX.inexistente, ...RANGO }],
      ] as const) {
        const r = await get('/catalogos/meseros/rendimiento', u, query);
        expect(r.status).toBe(404);
      }
    });

    it('con sucursal, nada de otra sucursal: ni filas, ni espejo, ni sincronización', async () => {
      const r = await rendimiento(USUARIOS.visorA, { ...deA, sucursalId: FX.sucursalA2 });
      expect(r.venta).toBe('40.00');
      expect(r.filas.map((f) => [f.sucursalId, f.mesero])).toEqual([[FX.sucursalA2, 'Ana López']]);
      expect(r.sinVentas).toEqual([]);
      expect(r.sucursales.map((s) => s.sucursalId)).toEqual([FX.sucursalA2]);
    });

    it('la empresa B sólo ve lo suyo; sin token = 401; rango inválido = 400', async () => {
      const b = await rendimiento(USUARIOS.visorB, { empresaId: FX.empresaB, ...RANGO });
      expect(b.venta).toBe('500.00');
      expect(b.filas.every((f) => f.sucursalId === FX.sucursalB1)).toBe(true);
      expect(b.sinVentas).toEqual([]);
      const sin = await request(url).get('/catalogos/meseros/rendimiento').query(deA);
      expect(sin.status).toBe(401);
      const mal = await get('/catalogos/meseros/rendimiento', USUARIOS.visorA, {
        empresaId: FX.empresaA,
        desde: '10-09-2026',
        hasta: DIA,
      });
      expect(mal.status).toBe(400);
    });
  });
});
