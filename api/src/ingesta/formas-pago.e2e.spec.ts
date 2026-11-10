import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';

// MVP: `/ventas/formas-pago` está cerrada a los clientes (auth/mvp.ts); aquí se prueba la ruta
// en sí con un visor, así que se apaga el interruptor (como en catalogos.e2e.spec.ts).
jest.mock('../auth/mvp', () => ({
  ...jest.requireActual('../auth/mvp'),
  OCULTAR_A_CLIENTES: false,
}));

// E2E del catálogo de formas de pago que manda el agente (PAG-01) sobre la app REAL contra
// Postgres REAL, con las fixtures sintéticas de F1-011 (A1 y A2 de la empresa A, B1 de la B).
// Los textos son los nombres DE FÁBRICA de SR (docs/esquema-sr.md §4), no de un cliente.
//
// Es una línea de tiempo: los `it` comparten estado y van en orden. Córrelo completo.

const KEYS = {
  a1: 'msr_sintetica-formas-pago-PAG-01-sucursal-a1-0000000001',
  a2: 'msr_sintetica-formas-pago-PAG-01-sucursal-a2-0000000002',
  b1: 'msr_sintetica-formas-pago-PAG-01-sucursal-b1-0000000003',
} as const;

const T0 = '2026-11-01T10:00:00.000Z';
const sinc = (n: number) => `0a601000-0000-4000-8000-${String(n).padStart(12, '0')}`;

type Registro = Record<string, unknown>;

/** El catálogo de fábrica de SR 10 (§4), como lo manda el agente. */
const CATALOGO_SR: Registro[] = [
  { origenSrId: 'EF', nombre: 'EFECTIVO', tipo: 1 },
  { origenSrId: 'VISA', nombre: 'VISA', tipo: 2 },
  { origenSrId: 'MC', nombre: 'MASTERCARD', tipo: 2 },
  { origenSrId: 'AMEX', nombre: 'AMERICAN EXPRESS', tipo: 2 },
  { origenSrId: 'DLL', nombre: 'DOLARES', tipo: 1 },
  { origenSrId: 'VAL', nombre: 'VALES', tipo: 3 },
  { origenSrId: 'CR', nombre: 'CREDITO', tipo: 4 },
  { origenSrId: 'TPY', nombre: 'TOKENCASH PAYMENTS', tipo: 4 },
];

describe('Catálogo de formas de pago desde SR (e2e, PAG-01)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const pagina = (key: string, registros: Registro[], n = 1) =>
    request(url)
      .post('/ingesta/catalogos')
      .set('X-Api-Key', key)
      .send({ catalogo: 'formas_pago', sincronizacionId: sinc(n), capturadoAt: T0, registros });
  const cierre = (key: string, total: number, n = 1) =>
    request(url)
      .post('/ingesta/catalogos/cierre')
      .set('X-Api-Key', key)
      .send({
        catalogo: 'formas_pago',
        sincronizacionId: sinc(n),
        capturadoAt: T0,
        total,
        rechazados: 0,
      });

  /** TODO el catálogo de una empresa, todas las columnas, como JSON. */
  async function foto(empresaId: string) {
    return JSON.parse(
      JSON.stringify(
        await prisma.formaPagoCatalogo.findMany({
          where: { empresaId },
          orderBy: { formaRaw: 'asc' },
        }),
      ),
    ) as Array<Record<string, unknown>>;
  }
  const formas = async (empresaId: string) =>
    Object.fromEntries(
      (await foto(empresaId)).map((f) => [f.formaRaw, [f.forma, f.origen, f.tipoSr]]),
    );

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    for (const [id, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalA2, KEYS.a2],
      [FX.sucursalB1, KEYS.b1],
    ]) {
      await prisma.sucursal.update({ where: { id }, data: { apiKeyHash: hashApiKey(key) } });
    }
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('validación: el tipo es entero 1-4 o nulo; lo demás es 400 y no escribe', () => {
    it.each([
      ['cero', 0],
      ['cinco', 5],
      ['decimal', 2.5],
      ['texto', '2'],
      ['booleano', true],
    ])('tipo %s → 400', async (_, tipo) => {
      const r = await pagina(KEYS.a1, [
        { origenSrId: 'EF', nombre: 'EFECTIVO', tipo: 1 },
        { origenSrId: 'VISA', nombre: 'VISA', tipo },
      ]);
      expect(r.status).toBe(400);
      expect(String(r.body.message)).toContain('registros.1.tipo');
      expect(await foto(FX.empresaA)).toEqual([]);
    });

    it('sin X-Api-Key → 401 y no escribe', async () => {
      const r = await request(url)
        .post('/ingesta/catalogos')
        .send({
          catalogo: 'formas_pago',
          sincronizacionId: sinc(1),
          capturadoAt: T0,
          registros: CATALOGO_SR,
        });
      expect(r.status).toBe(401);
      expect(await foto(FX.empresaA)).toEqual([]);
    });
  });

  describe('venta con pagos de antes del catálogo: el histórico se reclasifica solo al leer', () => {
    const RANGO = { empresaId: FX.empresaA, desde: '2026-09-20', hasta: '2026-09-20' };
    const token = () =>
      app.get(TokensService).firmarAccess({
        id: USUARIOS.visorA.id,
        rol: USUARIOS.visorA.rol,
        empresaId: USUARIOS.visorA.empresaId,
      });
    const leer = async (extra: Record<string, string>) =>
      request(url)
        .get('/ventas/formas-pago')
        .query({ ...RANGO, ...extra })
        .set('Authorization', `Bearer ${await token()}`);
    const monto = (body: { formas: Array<{ forma: string; monto: string }> }, forma: string) =>
      body.formas.find((f) => f.forma === forma)?.monto;

    it('sin catálogo, EFECTIVO $4,485 y VISA $2,262 caen en «otro» y salen en sinCatalogo', async () => {
      const ev = await request(url)
        .post('/ingesta/eventos')
        .set('X-Api-Key', KEYS.a1)
        .send({
          eventos: [
            {
              id: '0a601000-0000-4000-8000-0000000000e1',
              tipo: 'cheque',
              datos: {
                folioSr: 'PAG01-1',
                folio: 'PAG01-1',
                abiertoAt: '2026-09-20T19:00:00.000-06:00',
                cerradoAt: '2026-09-20T20:00:00.000-06:00',
                subtotal: '5816.38',
                impuestos: '930.62',
                descuentos: '0',
                propina: '0',
                total: '6747.00',
                cancelado: false,
                partidas: [
                  { producto: 'Sintético', cantidad: '1', precioUnit: '6747.00', total: '6747.00' },
                ],
                pagos: [
                  { formaRaw: 'EFECTIVO', monto: '4485.00' },
                  { formaRaw: 'VISA', monto: '2262.00' },
                ],
              },
            },
          ],
        });
      expect(ev.status).toBe(200);
      expect(ev.body.rechazados).toEqual([]);

      const r = await leer({});
      expect(r.status).toBe(200);
      expect(monto(r.body, 'otro')).toBe('6747.00');
      expect(monto(r.body, 'efectivo')).toBe('0.00');
      expect(r.body.sinCatalogo.map((s: { formaRaw: string }) => s.formaRaw).sort()).toEqual([
        'EFECTIVO',
        'VISA',
      ]);
    });

    it('A1 manda el catálogo de SR: se crean las filas pos con la forma de su tipo', async () => {
      const r = await pagina(KEYS.a1, CATALOGO_SR);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        catalogo: 'formas_pago',
        recibidos: 8,
        creados: 8,
        actualizados: 0,
        sinCambios: 0,
        obsoletos: 0,
        vistos: 0,
        rechazadosSinFila: 0,
        rechazados: [],
        manuales: 0,
        conflictos: 0,
        sinTipo: 0,
      });
      expect(await formas(FX.empresaA)).toEqual({
        'AMERICAN EXPRESS': ['tarjeta', 'pos', 2],
        CREDITO: ['otro', 'pos', 4],
        DOLARES: ['efectivo', 'pos', 1],
        EFECTIVO: ['efectivo', 'pos', 1],
        MASTERCARD: ['tarjeta', 'pos', 2],
        'TOKENCASH PAYMENTS': ['otro', 'pos', 4],
        VALES: ['otro', 'pos', 3],
        VISA: ['tarjeta', 'pos', 2],
      });
      expect((await foto(FX.empresaA)).every((f) => f.sucursalOrigenId === FX.sucursalA1)).toBe(
        true,
      );
    });

    it('la misma cuenta de antes ya sale como efectivo y tarjeta, sin reingerir nada', async () => {
      // Otro filtro (por sucursal) = otra llave del cache de 15 s.
      const r = await leer({ sucursalId: FX.sucursalA1 });
      expect(r.status).toBe(200);
      expect(monto(r.body, 'efectivo')).toBe('4485.00');
      expect(monto(r.body, 'tarjeta')).toBe('2262.00');
      expect(monto(r.body, 'otro')).toBe('0.00');
      expect(r.body.sinCatalogo).toEqual([]);
    });
  });

  describe('idempotencia', () => {
    it('el mismo catálogo tres veces (y su cierre) deja exactamente lo mismo', async () => {
      const antes = await foto(FX.empresaA);
      for (let i = 0; i < 3; i++) {
        const r = await pagina(KEYS.a1, CATALOGO_SR, 2);
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ creados: 0, actualizados: 0, sinCambios: 8 });
        const c = await cierre(KEYS.a1, 8, 2);
        expect(c.status).toBe(200);
        expect(c.body).toEqual({ aplicado: true, desactivados: 0, activos: 8 });
      }
      expect(await foto(FX.empresaA)).toEqual(antes);
    });

    it('tres envíos en paralelo de A1 y A2 a la vez no duplican filas', async () => {
      const antes = await foto(FX.empresaA);
      const rs = await Promise.all(
        [KEYS.a1, KEYS.a2, KEYS.a1, KEYS.a2, KEYS.a1, KEYS.a2].map((k) => pagina(k, CATALOGO_SR)),
      );
      expect(rs.map((r) => r.status)).toEqual([200, 200, 200, 200, 200, 200]);
      expect(await foto(FX.empresaA)).toEqual(antes);
    });
  });

  describe('una fila manual nunca la pisa la sincronización', () => {
    it('una persona clasifica TRANSFER como transferencia y VISA a mano', async () => {
      await prisma.formaPagoCatalogo.create({
        data: { empresaId: FX.empresaA, formaRaw: 'TRANSFER', forma: 'transferencia' },
      });
      // El default de `origen` es `manual`: toda alta que no hace la sincronización.
      await prisma.formaPagoCatalogo.updateMany({
        where: { empresaId: FX.empresaA, formaRaw: 'VISA' },
        data: { origen: 'manual', forma: 'efectivo', tipoSr: null, sucursalOrigenId: null },
      });
      const fila = await prisma.formaPagoCatalogo.findFirstOrThrow({
        where: { empresaId: FX.empresaA, formaRaw: 'TRANSFER' },
      });
      expect(fila.origen).toBe('manual');
    });

    it('el POS dice otra cosa de esos textos → no se tocan (ni updatedAt)', async () => {
      const antes = await foto(FX.empresaA);
      const r = await pagina(KEYS.a1, [
        ...CATALOGO_SR,
        { origenSrId: 'TR', nombre: 'TRANSFER', tipo: 4 },
      ]);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ creados: 0, actualizados: 0, manuales: 2, sinCambios: 9 });
      expect(await foto(FX.empresaA)).toEqual(antes);
    });
  });

  describe('dos sucursales de la misma empresa', () => {
    it('A2 manda VISA como efectivo y EFECTIVO como tarjeta: conflicto, se deja como está', async () => {
      const antes = await foto(FX.empresaA);
      const r = await pagina(KEYS.a2, [
        { origenSrId: 'EF', nombre: 'EFECTIVO', tipo: 2 },
        { origenSrId: 'MC', nombre: 'MASTERCARD', tipo: 2 },
      ]);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ creados: 0, actualizados: 0, conflictos: 1, sinCambios: 1 });
      expect(await foto(FX.empresaA)).toEqual(antes);
    });

    it('A2 trae un texto nuevo: lo crea con A2 de origen', async () => {
      const r = await pagina(KEYS.a2, [{ origenSrId: 'RAP', nombre: 'RAPPI', tipo: 4 }]);
      expect(r.body).toMatchObject({ creados: 1 });
      const fila = await prisma.formaPagoCatalogo.findFirstOrThrow({
        where: { empresaId: FX.empresaA, formaRaw: 'RAPPI' },
      });
      expect([fila.forma, fila.origen, fila.sucursalOrigenId]).toEqual([
        'otro',
        'pos',
        FX.sucursalA2,
      ]);
    });

    it('el POS de A1 reclasifica una forma suya (CREDITO de otros a efectivo) → se actualiza', async () => {
      const r = await pagina(KEYS.a1, [{ origenSrId: 'CR', nombre: 'CREDITO', tipo: 1 }]);
      expect(r.body).toMatchObject({ actualizados: 1 });
      expect((await formas(FX.empresaA)).CREDITO).toEqual(['efectivo', 'pos', 1]);
    });

    it('sin tipo (la columna no existe en esa instalación) no clasifica ni toca nada', async () => {
      const antes = await foto(FX.empresaA);
      const r = await pagina(KEYS.a1, [
        { origenSrId: 'EF', nombre: 'EFECTIVO', tipo: null },
        { origenSrId: 'NV', nombre: 'NUEVA' },
      ]);
      expect(r.body).toMatchObject({ creados: 0, actualizados: 0, sinTipo: 2 });
      expect(await foto(FX.empresaA)).toEqual(antes);
    });
  });

  describe('scope por empresa', () => {
    it('B1 manda el mismo catálogo: llena el de la empresa B, sin tocar el de A', async () => {
      const deA = await foto(FX.empresaA);
      const r = await pagina(KEYS.b1, CATALOGO_SR.slice(0, 2));
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ creados: 2, conflictos: 0 });
      expect(await formas(FX.empresaB)).toEqual({
        EFECTIVO: ['efectivo', 'pos', 1],
        VISA: ['tarjeta', 'pos', 2],
      });
      expect(await foto(FX.empresaA)).toEqual(deA);
      const c = await cierre(KEYS.b1, 2);
      expect(c.body).toEqual({ aplicado: true, desactivados: 0, activos: 2 });
    });

    it('el cuerpo no puede mover la empresa: un campo de más se rechaza solo', async () => {
      const r = await pagina(KEYS.b1, [
        { origenSrId: 'X', nombre: 'INTRUSA', tipo: 1, empresaId: FX.empresaA },
      ]);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ creados: 0, rechazadosSinFila: 1 });
      expect(await prisma.formaPagoCatalogo.count({ where: { formaRaw: 'INTRUSA' } })).toBe(0);
    });
  });

  it('el forzado manual sigue contando los once catálogos espejo, no formas_pago', async () => {
    const r = await request(url).get('/ingesta/catalogos/solicitud').set('X-Api-Key', KEYS.a1);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ solicitadaAt: null, pendiente: false });
  });
});
