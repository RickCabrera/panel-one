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

// E2E de Áreas y canales (F2-233) sobre la app REAL contra Postgres REAL, con las fixtures
// sintéticas de F1-011 (A1 y A2 de la empresa A, B1 de la B; zona CDMX). Catálogo, mapeo y
// cuentas van ESCRITOS A MANO; las cifras esperadas se calcularon aquí, NO con otra consulta:
//
// Espejo de áreas de A1 (id del POS ≠ clave a propósito: "Terraza" tiene la CLAVE "AR-3", que es
// el id de "Mostrador"; un cruce por clave movería su venta):
//   AR-1 Comedor → comedor · AR-2 Terraza → comedor · AR-3 Mostrador → mostrador
//   AR-4 Barra → (sin canal) · AR-5 Ventanilla → mostrador (sólo tiene ventas el 15-ago)
// A2: nunca sincronizó áreas. B1 (empresa B): AR-1 "Salón B" → domicilio.
//
// Cuentas del 10-sep (día local CDMX):
//   A1 AR-1 100.00 · A1 AR-1 50.01 (23:30 local = 05:30Z del 11: DENTRO)
//   A1 AR-2 33.33 · A1 AR-3 20.00 · A1 AR-4 45.00 · A1 AR-9 12.50 (no está en el espejo)
//   A1 sin área 70.00 · A2 AR-1 40.00 (sin sincronizar) · A2 sin área 10.00
//   FUERA: A1 AR-1 80.00 cancelada · A1 AR-1 999.00 a las 00:30 del 11 · B1 AR-1 500.00
// Empresa A: venta 380.84 en 9 cuentas.
//   comedor 100 + 50.01 + 33.33 = 183.34 (3) · mostrador 20.00 (1)
//   sin canal 45 + 12.50 + 40 = 97.50 (3) · sin clasificar 70 + 10 = 80.00 (2)
//   183.34 + 20.00 + 97.50 + 80.00 = 380.84
// 15-ago: A1 AR-5 300.00 (el periodo PASADO en que se cambia el mapeo).

const KEYS = {
  a1: 'msr_sintetica-areas-F2-233-sucursal-a1-000000000000001',
  a2: 'msr_sintetica-areas-F2-233-sucursal-a2-000000000000002',
  b1: 'msr_sintetica-areas-F2-233-sucursal-b1-000000000000003',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

const DIA = '2026-09-10';
const RANGO = { desde: DIA, hasta: DIA };
const AGOSTO = { desde: '2026-08-15', hasta: '2026-08-15' };
/** 12:00 de CDMX del 10-sep. */
const MEDIODIA = Date.parse('2026-09-10T18:00:00Z');
const HORA = 3_600_000;
const NO_EXISTE = '00000000-0000-4000-8000-000000000999';
const sinc = (n: number) => `f2233000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const COMEDOR = { origenSrId: 'AR-1', clave: 'C', nombre: 'Comedor' };
const TERRAZA = { origenSrId: 'AR-2', clave: 'AR-3', nombre: 'Terraza' };
const MOSTRADOR = { origenSrId: 'AR-3', clave: 'M', nombre: 'Mostrador' };
const BARRA = { origenSrId: 'AR-4', clave: 'B', nombre: 'Barra' };
const VENTANILLA = { origenSrId: 'AR-5', clave: 'V', nombre: 'Ventanilla' };
const SALON_B = { origenSrId: 'AR-1', clave: 'S', nombre: 'Salón B' };

interface Monto {
  venta: string;
  cuentas: number;
}
interface FilaArea extends Monto {
  sucursalId: string;
  sucursal: string;
  areaOrigenSrId: string;
  areaId: string | null;
  clave: string | null;
  nombre: string | null;
  cruce: string;
  activo: boolean | null;
  canal: string | null;
}
interface PorArea extends Monto {
  areas: FilaArea[];
  sinArea: Monto;
  canales: Array<Monto & { canal: string }>;
  sinCanal: Monto;
  catalogo: Array<{ sucursalId: string; sucursal: string; sincronizado: boolean }>;
}
interface FilaMapeo {
  id: string;
  sucursalId: string;
  origenSrId: string;
  nombre: string;
  activo: boolean;
  canal: string | null;
  canalActualizadoAt: string | null;
}
interface Mapeo {
  sucursales: Array<{ sucursalId: string; ultimaCompletaAt: string | null }>;
  areas: FilaMapeo[];
  truncado: boolean;
}

describe('Áreas y canales (e2e, F2-233)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;
  const ids: Record<string, string> = {};

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const get = async (ruta: string, u: Usuario, query: Record<string, string> = {}) =>
    request(url)
      .get(ruta)
      .query(query)
      .set('Authorization', `Bearer ${await token(u)}`);
  const put = async (areaId: string, u: Usuario, body: Record<string, unknown>) =>
    request(url)
      .put(`/catalogos/areas/${areaId}/canal`)
      .send(body)
      .set('Authorization', `Bearer ${await token(u)}`);
  const porArea = async (u: Usuario, query: Record<string, string>) => {
    const r = await get('/ventas/por-area', u, query);
    expect(r.status).toBe(200);
    return r.body as PorArea;
  };
  const asignar = async (areaId: string, empresaId: string, canal: string | null, u: Usuario) => {
    const r = await put(areaId, u, { empresaId, canal });
    expect(r.status).toBe(200);
    return r.body as FilaMapeo;
  };

  async function sincronizar(key: string, n: number, registros: object[], capturadoAt: string) {
    const p = await request(url)
      .post('/ingesta/catalogos')
      .set('X-Api-Key', key)
      .send({ catalogo: 'areas', sincronizacionId: sinc(n), capturadoAt, registros });
    expect(p.status).toBe(200);
    expect(p.body.rechazados).toEqual([]);
    const c = await request(url).post('/ingesta/catalogos/cierre').set('X-Api-Key', key).send({
      catalogo: 'areas',
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
    area: string | null,
    total: string,
    extra: { cancelado?: boolean; cerradoAt?: number } = {},
  ) {
    folio++;
    const cerrado = extra.cerradoAt ?? MEDIODIA;
    await prisma.cheque.create({
      data: {
        sucursalId,
        empresaId,
        folio: `R${folio}`,
        folioSr: `R${folio}`,
        areaOrigenSrId: area,
        abiertoAt: new Date(cerrado - HORA),
        cerradoAt: new Date(cerrado),
        subtotal: total,
        impuestos: '0.00',
        descuentos: '0.00',
        propina: '0.00',
        total,
        cancelado: extra.cancelado ?? false,
      },
    });
  }

  const idArea = async (sucursalId: string, origenSrId: string) =>
    (await prisma.areaCatalogo.findFirstOrThrow({ where: { sucursalId, origenSrId } })).id;

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    for (const [id, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalA2, KEYS.a2],
      [FX.sucursalB1, KEYS.b1],
    ] as const) {
      await prisma.sucursal.update({ where: { id }, data: { apiKeyHash: hashApiKey(key) } });
    }
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    await sincronizar(
      KEYS.a1,
      1,
      [COMEDOR, TERRAZA, MOSTRADOR, BARRA, VENTANILLA],
      '2026-09-01T10:00:00.000Z',
    );
    await sincronizar(KEYS.b1, 2, [SALON_B], '2026-09-01T10:00:00.000Z');
    for (const a of [COMEDOR, TERRAZA, MOSTRADOR, BARRA, VENTANILLA]) {
      ids[a.origenSrId] = await idArea(FX.sucursalA1, a.origenSrId);
    }
    ids.b1 = await idArea(FX.sucursalB1, 'AR-1');
    // El mapeo, por el endpoint (admin de A; admin global para B).
    await asignar(ids['AR-1'], FX.empresaA, 'comedor', USUARIOS.adminEmpresaA);
    await asignar(ids['AR-2'], FX.empresaA, 'comedor', USUARIOS.adminEmpresaA);
    await asignar(ids['AR-3'], FX.empresaA, 'mostrador', USUARIOS.adminEmpresaA);
    await asignar(ids['AR-5'], FX.empresaA, 'mostrador', USUARIOS.adminEmpresaA);
    await asignar(ids.b1, FX.empresaB, 'domicilio', USUARIOS.adminGlobal);

    await cuenta(FX.sucursalA1, FX.empresaA, 'AR-1', '100.00');
    await cuenta(FX.sucursalA1, FX.empresaA, 'AR-1', '50.01', {
      cerradoAt: Date.parse('2026-09-11T05:30:00Z'),
    });
    await cuenta(FX.sucursalA1, FX.empresaA, 'AR-2', '33.33');
    await cuenta(FX.sucursalA1, FX.empresaA, 'AR-3', '20.00');
    await cuenta(FX.sucursalA1, FX.empresaA, 'AR-4', '45.00');
    await cuenta(FX.sucursalA1, FX.empresaA, 'AR-9', '12.50');
    await cuenta(FX.sucursalA1, FX.empresaA, null, '70.00');
    await cuenta(FX.sucursalA1, FX.empresaA, 'AR-1', '80.00', { cancelado: true });
    await cuenta(FX.sucursalA1, FX.empresaA, 'AR-1', '999.00', {
      cerradoAt: Date.parse('2026-09-11T06:30:00Z'),
    });
    await cuenta(FX.sucursalA2, FX.empresaA, 'AR-1', '40.00');
    await cuenta(FX.sucursalA2, FX.empresaA, null, '10.00');
    await cuenta(FX.sucursalB1, FX.empresaB, 'AR-1', '500.00');
    await cuenta(FX.sucursalA1, FX.empresaA, 'AR-5', '300.00', {
      cerradoAt: Date.parse('2026-08-15T18:00:00Z'),
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  const deA = { empresaId: FX.empresaA, ...RANGO };

  describe('Listo cuando', () => {
    it('AC1: Σ canal + sin canal + sin clasificar = la venta de /ventas/resumen, sin repartir nada', async () => {
      const r = await porArea(USUARIOS.visorA, deA);
      const resumen = await get('/ventas/resumen', USUARIOS.visorA, deA);
      expect(resumen.status).toBe(200);
      // La cifra de Inicio, de OTRO endpoint, y la calculada a mano arriba.
      expect(resumen.body.venta).toBe('380.84');
      expect(r.venta).toBe(resumen.body.venta);
      expect(r.cuentas).toBe(resumen.body.cuentas);
      expect(r.canales).toEqual([
        { canal: 'comedor', venta: '183.34', cuentas: 3 },
        { canal: 'mostrador', venta: '20.00', cuentas: 1 },
      ]);
      expect(r.sinCanal).toEqual({ venta: '97.50', cuentas: 3 });
      // La fila explícita "sin clasificar": exactamente las dos cuentas sin área.
      expect(r.sinArea).toEqual({ venta: '80.00', cuentas: 2 });
    });

    it('AC1: una fila por (sucursal, área), cruzada por el id EXACTO del POS', async () => {
      const r = await porArea(USUARIOS.visorA, deA);
      const fila = (sucursalId: string, origen: string) =>
        r.areas.find((a) => a.sucursalId === sucursalId && a.areaOrigenSrId === origen);
      expect(r.areas.map((a) => [a.sucursal, a.areaOrigenSrId, a.venta, a.cuentas])).toEqual([
        ['A1', 'AR-1', '150.01', 2],
        ['A1', 'AR-4', '45.00', 1],
        ['A2', 'AR-1', '40.00', 1],
        ['A1', 'AR-2', '33.33', 1],
        ['A1', 'AR-3', '20.00', 1],
        ['A1', 'AR-9', '12.50', 1],
      ]);
      // Terraza tiene la CLAVE "AR-3": la cuenta con el id "AR-3" es de Mostrador.
      expect(fila(FX.sucursalA1, 'AR-3')).toMatchObject({
        nombre: 'Mostrador',
        areaId: ids['AR-3'],
        cruce: 'catalogo',
        canal: 'mostrador',
      });
      expect(fila(FX.sucursalA1, 'AR-2')).toMatchObject({ nombre: 'Terraza', clave: 'AR-3' });
      expect(fila(FX.sucursalA1, 'AR-4')).toMatchObject({ nombre: 'Barra', canal: null });
      expect(fila(FX.sucursalA1, 'AR-9')).toMatchObject({
        areaId: null,
        nombre: null,
        cruce: 'sin-catalogo',
        canal: null,
      });
      // A2 no sincronizó áreas: su "AR-1" NO es el Comedor de A1.
      expect(fila(FX.sucursalA2, 'AR-1')).toMatchObject({
        areaId: null,
        cruce: 'sin-sincronizar',
        canal: null,
      });
      expect(r.catalogo).toEqual([
        { sucursalId: FX.sucursalA1, sucursal: 'A1', sincronizado: true },
        { sucursalId: FX.sucursalA2, sucursal: 'A2', sincronizado: false },
      ]);
    });

    it('AC1: con una sucursal, sólo la suya (y cuadra con su resumen)', async () => {
      const q = { ...deA, sucursalId: FX.sucursalA2 };
      const r = await porArea(USUARIOS.visorA, q);
      expect(r.venta).toBe((await get('/ventas/resumen', USUARIOS.visorA, q)).body.venta);
      expect(r.venta).toBe('50.00');
      expect(r.canales).toEqual([]);
      expect(r.sinCanal).toEqual({ venta: '40.00', cuentas: 1 });
      expect(r.sinArea).toEqual({ venta: '10.00', cuentas: 1 });
      expect(r.catalogo).toEqual([{ sucursalId: FX.sucursalA2, sucursal: 'A2', sincronizado: false }]);
    });

    it('AC2: cambiar el mapeo recalcula un periodo PASADO sin re-ingerir nada', async () => {
      const q = { empresaId: FX.empresaA, ...AGOSTO };
      const cheques = () =>
        prisma.cheque.findMany({ where: { empresaId: FX.empresaA }, orderBy: { id: 'asc' } });
      const antes = await cheques();
      expect((await porArea(USUARIOS.visorA, q)).canales).toEqual([
        { canal: 'mostrador', venta: '300.00', cuentas: 1 },
      ]);

      const fila = await asignar(ids['AR-5'], FX.empresaA, 'domicilio', USUARIOS.adminEmpresaA);
      expect(fila).toMatchObject({ id: ids['AR-5'], nombre: 'Ventanilla', canal: 'domicilio' });
      const despues = await porArea(USUARIOS.visorA, q);
      expect(despues.canales).toEqual([{ canal: 'domicilio', venta: '300.00', cuentas: 1 }]);
      expect(despues.venta).toBe('300.00');

      // Quitarlo: la venta pasa a "sin canal", nunca desaparece.
      await asignar(ids['AR-5'], FX.empresaA, null, USUARIOS.adminEmpresaA);
      const sin = await porArea(USUARIOS.visorA, q);
      expect(sin.canales).toEqual([]);
      expect(sin.sinCanal).toEqual({ venta: '300.00', cuentas: 1 });
      await asignar(ids['AR-5'], FX.empresaA, 'mostrador', USUARIOS.adminEmpresaA);

      // Ni una fila de cheques se tocó (updated_at incluido).
      expect(await cheques()).toEqual(antes);
    });

    it('AC3: el mapeo sobrevive un re-sync completo (renombrar, desaparecer y reaparecer)', async () => {
      const mapeoDeA = () =>
        prisma.areaCanal.findMany({ where: { empresaId: FX.empresaA }, orderBy: { areaId: 'asc' } });
      const antes = await mapeoDeA();
      expect(antes).toHaveLength(4);

      // Comedor se renombra y Terraza desaparece del POS.
      await sincronizar(
        KEYS.a1,
        3,
        [{ ...COMEDOR, nombre: 'Comedor principal' }, MOSTRADOR, BARRA, VENTANILLA],
        '2026-09-02T10:00:00.000Z',
      );
      expect(await mapeoDeA()).toEqual(antes);
      const r = await porArea(USUARIOS.visorA, deA);
      const de = (origen: string) =>
        r.areas.find((a) => a.sucursalId === FX.sucursalA1 && a.areaOrigenSrId === origen)!;
      expect(de('AR-1')).toMatchObject({
        areaId: ids['AR-1'],
        nombre: 'Comedor principal',
        canal: 'comedor',
        activo: true,
      });
      // Terraza ya no está en el POS: sigue en su periodo, con su nombre y su canal.
      expect(de('AR-2')).toMatchObject({
        areaId: ids['AR-2'],
        nombre: 'Terraza',
        cruce: 'catalogo',
        activo: false,
        canal: 'comedor',
      });
      expect(r.canales[0]).toEqual({ canal: 'comedor', venta: '183.34', cuentas: 3 });

      // Terraza reaparece: la MISMA fila, con el mismo mapeo.
      await sincronizar(
        KEYS.a1,
        4,
        [COMEDOR, TERRAZA, MOSTRADOR, BARRA, VENTANILLA],
        '2026-09-03T10:00:00.000Z',
      );
      expect(await idArea(FX.sucursalA1, 'AR-2')).toBe(ids['AR-2']);
      expect(await mapeoDeA()).toEqual(antes);
      const m = await get('/catalogos/areas/mapeo', USUARIOS.visorA, { empresaId: FX.empresaA });
      expect((m.body as Mapeo).areas.find((a) => a.id === ids['AR-2'])).toMatchObject({
        activo: true,
        canal: 'comedor',
      });
    });
  });

  // OJO: depende del orden del archivo. Corre DESPUÉS de AC3 (la última sincronización completa
  // es la del 3-sep y los nombres son los que dejó). Suelto con `-t` falla; no es un test roto.
  describe('GET /catalogos/areas/mapeo', () => {
    it('todas las áreas de la empresa con su canal, y la sincronización por sucursal', async () => {
      const r = await get('/catalogos/areas/mapeo', USUARIOS.visorA, { empresaId: FX.empresaA });
      expect(r.status).toBe(200);
      const m = r.body as Mapeo;
      expect(m.truncado).toBe(false);
      expect(m.areas.map((a) => [a.origenSrId, a.canal])).toEqual([
        ['AR-4', null],
        ['AR-1', 'comedor'],
        ['AR-3', 'mostrador'],
        ['AR-2', 'comedor'],
        ['AR-5', 'mostrador'],
      ]);
      expect(m.areas.every((a) => a.sucursalId === FX.sucursalA1)).toBe(true);
      expect(m.areas.find((a) => a.origenSrId === 'AR-4')!.canalActualizadoAt).toBeNull();
      expect(m.sucursales).toEqual([
        { sucursalId: FX.sucursalA1, sucursal: 'A1', ultimaCompletaAt: '2026-09-03T10:00:00.000Z' },
        { sucursalId: FX.sucursalA2, sucursal: 'A2', ultimaCompletaAt: null },
      ]);
    });
  });

  describe('ingesta del área de la cuenta (POST /ingesta/eventos)', () => {
    const evento = (id: string, folioSr: string, cambios: Record<string, unknown> = {}) => ({
      id,
      tipo: 'cheque',
      datos: {
        folioSr,
        folio: folioSr,
        abiertoAt: '2026-07-01T12:00:00.000-06:00',
        cerradoAt: '2026-07-01T13:00:00.000-06:00',
        subtotal: '10.00',
        impuestos: '0',
        descuentos: '0',
        propina: '0',
        total: '10.00',
        cancelado: false,
        partidas: [],
        pagos: [],
        ...cambios,
      },
    });
    const lote = async (eventos: object[]) => {
      const r = await request(url).post('/ingesta/eventos').set('X-Api-Key', KEYS.a1).send({ eventos });
      expect(r.status).toBe(200);
      return r.body as { procesados: string[]; rechazados: Array<{ indice: number; motivo: string }> };
    };
    const leer = (folioSr: string) =>
      prisma.cheque.findFirstOrThrow({ where: { sucursalId: FX.sucursalA1, folioSr } });

    it('se guarda tal cual, y el mismo lote 3 veces deja la misma fila (updated_at incluido)', async () => {
      const eventos = [evento('e1', 'ING-1', { areaOrigenSrId: 'AR-1' })];
      expect((await lote(eventos)).rechazados).toEqual([]);
      const primera = await leer('ING-1');
      expect(primera.areaOrigenSrId).toBe('AR-1');
      for (let i = 0; i < 2; i++) await lote(eventos);
      expect(await leer('ING-1')).toEqual(primera);
      // Y entra al desglose de su día, en su canal.
      const r = await porArea(USUARIOS.visorA, {
        empresaId: FX.empresaA,
        desde: '2026-07-01',
        hasta: '2026-07-01',
      });
      expect(r.canales).toEqual([{ canal: 'comedor', venta: '10.00', cuentas: 1 }]);
    });

    it('cambiarla la reescribe; omitirla o mandar sólo espacios la deja nula (sin 500)', async () => {
      await lote([evento('e2', 'ING-2', { areaOrigenSrId: 'AR-1' })]);
      await lote([evento('e2', 'ING-2', { areaOrigenSrId: 'AR-3' })]);
      expect((await leer('ING-2')).areaOrigenSrId).toBe('AR-3');
      await lote([evento('e2', 'ING-2')]);
      expect((await leer('ING-2')).areaOrigenSrId).toBeNull();
      const r = await lote([evento('e3', 'ING-3', { areaOrigenSrId: '   ' })]);
      expect(r.rechazados).toEqual([]);
      expect((await leer('ING-3')).areaOrigenSrId).toBeNull();
    });

    it('una de más de 64 se rechaza SOLA (sin repetir el valor) y las demás del lote entran', async () => {
      const larga = `AREA-${'x'.repeat(60)}`;
      const r = await lote([
        evento('ok', 'ING-4', { areaOrigenSrId: 'AR-4' }),
        evento('larga', 'ING-5', { areaOrigenSrId: larga }),
      ]);
      expect(r.procesados).toEqual(['ok']);
      expect(r.rechazados.map((x) => x.indice)).toEqual([1]);
      expect(r.rechazados[0].motivo).toContain('areaOrigenSrId');
      expect(r.rechazados[0].motivo).not.toContain(larga);
      expect((await leer('ING-4')).areaOrigenSrId).toBe('AR-4');
      expect(await prisma.cheque.count({ where: { folioSr: 'ING-5' } })).toBe(0);
    });
  });

  describe('scope por rol (404, nunca 403 por datos ajenos)', () => {
    /** Status y cuerpo: un recurso ajeno no se distingue de uno que no existe. */
    const igual = (a: request.Response, b: request.Response, status = 404) => {
      expect(a.status).toBe(status);
      expect({ status: a.status, body: a.body }).toEqual({ status: b.status, body: b.body });
    };

    it('por-area: visor y admin de A ven A; admin global ve B; nadie ve B desde A', async () => {
      for (const u of [USUARIOS.visorA, USUARIOS.adminEmpresaA, USUARIOS.adminGlobal]) {
        const r = await porArea(u, deA);
        expect(r.venta).toBe('380.84');
        expect(r.areas.every((a) => a.sucursalId !== FX.sucursalB1)).toBe(true);
      }
      const b = await porArea(USUARIOS.adminGlobal, { ...RANGO, empresaId: FX.empresaB });
      expect(b.canales).toEqual([{ canal: 'domicilio', venta: '500.00', cuentas: 1 }]);
      expect(b.areas.map((a) => a.nombre)).toEqual(['Salón B']);
    });

    it('por-area y mapeo: empresa o sucursal ajena = el mismo 404 que una inexistente', async () => {
      // El mapeo no lleva periodo (el ValidationPipe rechaza parámetros de más).
      for (const [ruta, periodo] of [
        ['/ventas/por-area', RANGO],
        ['/catalogos/areas/mapeo', {}],
      ] as const) {
        const de = (empresaId: string, sucursalId?: string) => ({
          ...periodo,
          empresaId,
          ...(sucursalId ? { sucursalId } : {}),
        });
        igual(
          await get(ruta, USUARIOS.visorB, de(FX.empresaA)),
          await get(ruta, USUARIOS.visorB, de(NO_EXISTE)),
        );
        igual(
          await get(ruta, USUARIOS.adminEmpresaA, de(FX.empresaA, FX.sucursalB1)),
          await get(ruta, USUARIOS.adminEmpresaA, de(FX.empresaA, NO_EXISTE)),
        );
        igual(
          await get(ruta, USUARIOS.adminGlobal, de(FX.empresaA, FX.sucursalB1)),
          await get(ruta, USUARIOS.adminGlobal, de(FX.empresaA, NO_EXISTE)),
        );
      }
    });

    it('PUT: un área ajena = el mismo 404 que una inexistente, y no la toca', async () => {
      const antes = await prisma.areaCanal.findUniqueOrThrow({ where: { areaId: ids.b1 } });
      igual(
        await put(ids.b1, USUARIOS.adminEmpresaA, { empresaId: FX.empresaA, canal: 'comedor' }),
        await put(NO_EXISTE, USUARIOS.adminEmpresaA, { empresaId: FX.empresaA, canal: 'comedor' }),
      );
      igual(
        await put(ids.b1, USUARIOS.adminEmpresaA, { empresaId: FX.empresaB, canal: 'comedor' }),
        await put(NO_EXISTE, USUARIOS.adminEmpresaA, { empresaId: NO_EXISTE, canal: 'comedor' }),
      );
      // El admin global con la empresa equivocada tampoco la alcanza.
      igual(
        await put(ids.b1, USUARIOS.adminGlobal, { empresaId: FX.empresaA, canal: 'comedor' }),
        await put(NO_EXISTE, USUARIOS.adminGlobal, { empresaId: FX.empresaA, canal: 'comedor' }),
      );
      expect(await prisma.areaCanal.findUniqueOrThrow({ where: { areaId: ids.b1 } })).toEqual(antes);
    });

    it('PUT del visor: 403 por ROL, idéntico para un área propia, una ajena y una inexistente', async () => {
      const cuerpo = { empresaId: FX.empresaA, canal: 'plataformas' };
      const propia = await put(ids['AR-4'], USUARIOS.visorA, cuerpo);
      igual(propia, await put(ids.b1, USUARIOS.visorA, cuerpo), 403);
      igual(propia, await put(NO_EXISTE, USUARIOS.visorA, cuerpo), 403);
      expect(await prisma.areaCanal.count({ where: { areaId: ids['AR-4'] } })).toBe(0);
    });

    it('400 y 401', async () => {
      const a = ids['AR-4'];
      expect((await put(a, USUARIOS.adminEmpresaA, { empresaId: FX.empresaA, canal: 'delivery' })).status).toBe(400);
      // Sin la llave `canal` no se borra nada por un cuerpo incompleto.
      expect((await put(a, USUARIOS.adminEmpresaA, { empresaId: FX.empresaA })).status).toBe(400);
      expect((await put('no-es-uuid', USUARIOS.adminEmpresaA, { empresaId: FX.empresaA, canal: null })).status).toBe(400);
      expect((await get('/ventas/por-area', USUARIOS.visorA, { empresaId: FX.empresaA })).status).toBe(400);
      expect((await request(url).get('/ventas/por-area').query(deA)).status).toBe(401);
      expect((await request(url).get('/catalogos/areas/mapeo').query(deA)).status).toBe(401);
      expect(
        (await request(url).put(`/catalogos/areas/${a}/canal`).send({ empresaId: FX.empresaA, canal: null })).status,
      ).toBe(401);
    });
  });
});
