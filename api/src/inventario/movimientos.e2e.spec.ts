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

// E2E de Movimientos, pólizas y kardex (F2-122) sobre la app REAL contra Postgres REAL, con las
// fixtures sintéticas de F1-011. Los saldos esperados están ESCRITOS A MANO: no se recalculan con
// la fórmula del API. Ésta es la prueba independiente del kardex (el seed prueba conservación).
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const KEYS = {
  a1: 'msr_sintetica-movimientos-panel-F2-122-sucursal-a1-00001',
  a2: 'msr_sintetica-movimientos-panel-F2-122-sucursal-a2-00002',
  b1: 'msr_sintetica-movimientos-panel-F2-122-sucursal-b1-00003',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];
type Registro = Record<string, unknown>;

const sinc = (n: number) => `f2122000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const partida = (insumo: string, cantidad: string, costo: string) => ({
  insumoOrigenSrId: insumo,
  cantidad,
  costoUnitario: costo,
});
const pol = (origen: string, tipo: string, fecha: string, partidas: Registro[], extra = {}) => ({
  origenSrId: origen,
  folio: `POL-${origen}`,
  tipo,
  almacenOrigenSrId: 'ALM1',
  fecha,
  referencia: null,
  cancelada: false,
  partidas,
  ...extra,
});

/**
 * A1 (America/Mexico_City, UTC−6), ALM1. Horas locales → UTC:
 * - A  inicial 09-01 07:00 → 13:00Z: I1 +10 @ 20.00 = 200.00 · I2 +4 @ 5.00 = 20.00
 * - B  consumo 09-01 23:30 → 09-02 05:30Z (¡día local 09-01!): I1 −2.5 @ 20.00 = −50.00
 * - C  compra  09-02 10:00 → 16:00Z: I1 +5 @ 22.00 = 110.00 (ref OC-7)
 * - X  merma   09-02 12:00 → 18:00Z, CANCELADA: I1 −100 @ 20.00
 * - D  ajuste  09-03 09:00 → 15:00Z: I1 −0.5 @ 21.00 = −10.50
 * Foto de existencias de ALM1 a las 09-03 12:00Z (ANTES de D): I1 12.5 (= 10 − 2.5 + 5), I2 3
 * (el saldo de I2 es 4: diferencia −1).
 * Kardex de I1 del 09-02 al 09-03: inicial 7.5 (A y B) → C 12.5 → X 12.5 (cancelada) → D 12.0.
 */
const POLIZAS = [
  pol('A', 'inicial', '2026-09-01T13:00:00.000Z', [
    partida('I1', '10', '20'),
    partida('I2', '4', '5'),
  ]),
  pol('B', 'consumo', '2026-09-02T05:30:00.000Z', [partida('I1', '-2.5', '20')]),
  pol('C', 'compra', '2026-09-02T16:00:00.000Z', [partida('I1', '5', '22')], {
    referencia: 'OC-7',
    tipoSr: 'E',
  }),
  pol('X', 'merma', '2026-09-02T18:00:00.000Z', [partida('I1', '-100', '20')], {
    cancelada: true,
  }),
  pol('D', 'ajuste', '2026-09-03T15:00:00.000Z', [partida('I1', '-0.5', '21')]),
];
const CORTE = '2026-09-03T12:00:00.000Z';

describe('Movimientos y kardex (e2e, F2-122)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const get = async (u: Usuario, ruta: string, query: Record<string, string | number>) =>
    request(url)
      .get(ruta)
      .query(query)
      .set('Authorization', `Bearer ${await token(u)}`);
  const movimientos = (u: Usuario, query: Record<string, string | number>) =>
    get(u, '/inventario/movimientos', { desde: '2026-09-01', hasta: '2026-09-03', ...query });
  const kardex = (u: Usuario, query: Record<string, string>) =>
    get(u, '/inventario/kardex', {
      empresaId: FX.empresaA,
      sucursalId: FX.sucursalA1,
      almacenOrigenSrId: 'ALM1',
      desde: '2026-09-02',
      hasta: '2026-09-03',
      ...query,
    });
  const catalogo = (key: string, cat: string, n: number, registros: Registro[]) =>
    request(url)
      .post('/ingesta/catalogos')
      .set('X-Api-Key', key)
      .send({ catalogo: cat, sincronizacionId: sinc(n), capturadoAt: CORTE, registros });
  const foto = (key: string, almacen: string, registros: Registro[]) =>
    request(url)
      .post('/ingesta/existencias')
      .set('X-Api-Key', key)
      .send({ almacenOrigenSrId: almacen, capturadoAt: CORTE, registros });
  const lote = (key: string, polizas: Registro[]) =>
    request(url)
      .post('/ingesta/movimientos')
      .set('X-Api-Key', key)
      .send({ leidoAt: '2026-09-04T00:00:00.000Z', polizas });
  const deA1 = { empresaId: FX.empresaA, sucursalId: FX.sucursalA1 };
  const folios = (body: { movimientos: Array<{ poliza: { folio: string }; renglon: number }> }) =>
    body.movimientos.map((m) => `${m.poliza.folio}#${m.renglon}`);

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
    await prisma.sucursal.update({
      where: { id: FX.sucursalA2 },
      data: { zonaHoraria: 'America/Tijuana' },
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    await catalogo(KEYS.a1, 'unidades', 1, [{ origenSrId: 'KG', nombre: 'Kilogramo' }]);
    await catalogo(KEYS.a1, 'insumos', 2, [
      { origenSrId: 'I1', clave: 'HAR', nombre: 'Harina', unidadOrigenSrId: 'KG' },
      { origenSrId: 'I2', clave: 'AZU', nombre: 'Azúcar' },
    ]);
    await catalogo(KEYS.a1, 'almacenes', 3, [
      { origenSrId: 'ALM1', nombre: 'General' },
      { origenSrId: 'ALM2', nombre: 'Barra' },
    ]);
    // El mismo I1 en A2 con otro nombre: no debe resolverse en A1.
    await catalogo(KEYS.a2, 'insumos', 4, [{ origenSrId: 'I1', nombre: 'Otro nombre en A2' }]);
    expect((await lote(KEYS.a1, POLIZAS)).body).toMatchObject({ creadas: 5, rechazadas: [] });
    // A2 (Tijuana, UTC−7): 09-01 23:30 local = 09-02 06:30Z → cae en el día 09-01 de A2.
    await lote(KEYS.a2, [
      pol('T', 'compra', '2026-09-02T06:30:00.000Z', [partida('I1', '1', '1')]),
    ]);
    // B1: una póliza de la otra empresa.
    await lote(KEYS.b1, [
      pol('B1', 'compra', '2026-09-02T12:00:00.000Z', [partida('I1', '1', '1')]),
    ]);
    await foto(KEYS.a1, 'ALM1', [
      { insumoOrigenSrId: 'I1', cantidad: '12.5', costoPromedio: '21' },
      { insumoOrigenSrId: 'I2', cantidad: '3', costoPromedio: '5' },
    ]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('línea de tiempo', () => {
    it('más reciente primero, con nombres de SU sucursal y la cancelada marcada', async () => {
      const r = await movimientos(USUARIOS.visorA, deA1);
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(6);
      expect(folios(r.body)).toEqual([
        'POL-D#0',
        'POL-X#0',
        'POL-C#0',
        'POL-B#0',
        'POL-A#0',
        'POL-A#1',
      ]);
      const c = r.body.movimientos[2];
      expect(c).toMatchObject({
        fecha: '2026-09-02T16:00:00.000Z',
        sucursal: 'A1',
        almacen: 'General',
        insumo: 'Harina',
        clave: 'HAR',
        unidad: 'Kilogramo',
        cantidad: '5.000',
        costoUnitario: '22.00',
        importe: '110.00',
        poliza: { folio: 'POL-C', tipo: 'compra', cancelada: false, referencia: 'OC-7' },
      });
      expect(r.body.movimientos[1].poliza.cancelada).toBe(true);
      expect(r.body.movimientos[4].importe).toBe('200.00');
      expect(r.body.sucursales).toEqual([
        {
          sucursalId: FX.sucursalA1,
          sucursal: 'A1',
          zonaHoraria: 'America/Mexico_City',
          polizasRecibidas: 5,
        },
      ]);
      expect(r.body.almacenes.map((a: Registro) => a.almacen)).toEqual(['Barra', 'General']);
    });

    it('el día se corta en la zona de CADA sucursal (medianoche local, no UTC)', async () => {
      // B (09-02 05:30Z) es del 09-01 en A1: no sale en el 09-02.
      const r = await movimientos(USUARIOS.visorA, {
        ...deA1,
        desde: '2026-09-02',
        hasta: '2026-09-02',
      });
      expect(folios(r.body)).toEqual(['POL-X#0', 'POL-C#0']);
      const b = await movimientos(USUARIOS.visorA, {
        ...deA1,
        desde: '2026-09-01',
        hasta: '2026-09-01',
      });
      expect(folios(b.body)).toEqual(['POL-B#0', 'POL-A#0', 'POL-A#1']);
      // Toda la empresa: T de A2 (06:30Z) es del 09-01 en Tijuana.
      const e = await movimientos(USUARIOS.visorA, {
        empresaId: FX.empresaA,
        desde: '2026-09-01',
        hasta: '2026-09-01',
      });
      expect(folios(e.body).sort()).toEqual(['POL-A#0', 'POL-A#1', 'POL-B#0', 'POL-T#0']);
      const t = e.body.movimientos.find(
        (m: { poliza: { folio: string } }) => m.poliza.folio === 'POL-T',
      );
      expect(t.insumo).toBe('Otro nombre en A2');
    });

    it('filtra por tipo, insumo y almacén, y pagina', async () => {
      const tipo = await movimientos(USUARIOS.visorA, { ...deA1, tipo: 'compra' });
      expect(folios(tipo.body)).toEqual(['POL-C#0']);
      const insumo = await movimientos(USUARIOS.visorA, { ...deA1, insumoOrigenSrId: 'I2' });
      expect(folios(insumo.body)).toEqual(['POL-A#1']);
      const almacen = await movimientos(USUARIOS.visorA, { ...deA1, almacenOrigenSrId: 'ALM2' });
      expect([almacen.body.total, almacen.body.movimientos]).toEqual([0, []]);
      const p2 = await movimientos(USUARIOS.visorA, { ...deA1, porPagina: 2, pagina: 2 });
      expect([p2.body.total, folios(p2.body)]).toEqual([6, ['POL-C#0', 'POL-B#0']]);
    });

    it('parámetros inválidos = 400', async () => {
      const invalidos: Array<Record<string, string | number>> = [
        { empresaId: FX.empresaA, almacenOrigenSrId: 'ALM1' },
        { empresaId: FX.empresaA, insumoOrigenSrId: 'I1' },
        { ...deA1, desde: '2026-09-05' },
        { ...deA1, desde: '2025-01-01', hasta: '2026-09-03' },
        { ...deA1, desde: '2026-02-30' },
        { ...deA1, tipo: 'salida' },
        { ...deA1, porPagina: 201 },
      ];
      for (const q of invalidos) {
        expect((await movimientos(USUARIOS.visorA, q)).status).toBe(400);
      }
    });
  });

  describe('detalle de póliza', () => {
    it('cabecera y partidas en orden de renglón, con su total', async () => {
      const lista = await movimientos(USUARIOS.visorA, { ...deA1, tipo: 'inicial' });
      const id = lista.body.movimientos[0].poliza.id as string;
      const r = await get(USUARIOS.visorA, `/inventario/polizas/${id}`, { empresaId: FX.empresaA });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        id,
        origenSrId: 'A',
        folio: 'POL-A',
        tipo: 'inicial',
        tipoSr: null,
        fecha: '2026-09-01T13:00:00.000Z',
        cancelada: false,
        sucursal: 'A1',
        zonaHoraria: 'America/Mexico_City',
        almacen: 'General',
        importeTotal: '220.00',
      });
      expect(
        r.body.partidas.map((p: Registro) => [p.renglon, p.insumo, p.cantidad, p.importe]),
      ).toEqual([
        [0, 'Harina', '10.000', '200.00'],
        [1, 'Azúcar', '4.000', '20.00'],
      ]);
    });
  });

  describe('kardex', () => {
    it('saldo inicial + movimientos del rango = saldo final; la cancelada se ve y no suma', async () => {
      const r = await kardex(USUARIOS.visorA, { insumoOrigenSrId: 'I1' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        insumo: 'Harina',
        unidad: 'Kilogramo',
        almacen: 'General',
        polizasRecibidas: 5,
        saldoInicial: '7.500',
        saldoFinal: '12.000',
        entradas: '5.000',
        salidas: '0.500',
      });
      expect(
        r.body.movimientos.map(
          (m: { poliza: { folio: string; cancelada: boolean }; saldo: string }) => [
            m.poliza.folio,
            m.poliza.cancelada,
            m.saldo,
          ],
        ),
      ).toEqual([
        ['POL-C', false, '12.500'],
        ['POL-X', true, '12.500'],
        ['POL-D', false, '12.000'],
      ]);
    });

    it('cuadra contra la existencia AL CORTE de la foto (lo posterior no cuenta como diferencia)', async () => {
      const r = await kardex(USUARIOS.visorA, { insumoOrigenSrId: 'I1' });
      expect(r.body).toMatchObject({
        corteExistencia: CORTE,
        existencia: '12.500',
        saldoAlCorte: '12.500',
        diferencia: '0.000',
        cuadra: true,
      });
    });

    it('si la existencia no es el saldo al corte, dice la diferencia', async () => {
      const r = await kardex(USUARIOS.visorA, { insumoOrigenSrId: 'I2' });
      expect(r.body).toMatchObject({
        saldoInicial: '4.000',
        movimientos: [],
        saldoFinal: '4.000',
        existencia: '3.000',
        saldoAlCorte: '4.000',
        diferencia: '-1.000',
        cuadra: false,
      });
    });

    it('sin existencia leída del artículo, o sin movimientos de la sucursal: cuadra nulo', async () => {
      const sinFoto = await kardex(USUARIOS.visorA, { insumoOrigenSrId: 'I9' });
      expect(sinFoto.body).toMatchObject({
        existencia: null,
        cuadra: null,
        diferencia: null,
        insumo: null,
      });
      await prisma.polizaInventario.deleteMany({ where: { sucursalId: FX.sucursalA2 } });
      await foto(KEYS.a2, 'ALM1', [{ insumoOrigenSrId: 'I1', cantidad: '7', costoPromedio: '1' }]);
      const sinMovs = await kardex(USUARIOS.visorA, {
        sucursalId: FX.sucursalA2,
        insumoOrigenSrId: 'I1',
      });
      expect(sinMovs.body).toMatchObject({
        polizasRecibidas: 0,
        existencia: '7.000',
        saldoInicial: '0.000',
        cuadra: null,
        diferencia: null,
      });
    });
  });

  describe('alcance', () => {
    it('admin_empresa ve lo suyo; admin_global ve la empresa B', async () => {
      expect((await movimientos(USUARIOS.adminEmpresaA, deA1)).body.total).toBe(6);
      const g = await movimientos(USUARIOS.adminGlobal, { empresaId: FX.empresaB });
      expect([g.status, g.body.total]).toEqual([200, 1]);
    });

    it('fuera de alcance = el MISMO 404 (listado, kardex y póliza ajena o inexistente)', async () => {
      const deB = await prisma.polizaInventario.findFirstOrThrow({
        where: { sucursalId: FX.sucursalB1 },
      });
      const respuestas = [
        await movimientos(USUARIOS.visorB, { empresaId: FX.empresaA }),
        await movimientos(USUARIOS.visorA, { empresaId: FX.inexistente }),
        await movimientos(USUARIOS.adminEmpresaA, {
          empresaId: FX.empresaA,
          sucursalId: FX.sucursalB1,
          almacenOrigenSrId: 'ALM1',
        }),
        await kardex(USUARIOS.visorA, { sucursalId: FX.sucursalB1, insumoOrigenSrId: 'I1' }),
        await kardex(USUARIOS.visorB, { insumoOrigenSrId: 'I1' }),
        await get(USUARIOS.visorA, `/inventario/polizas/${deB.id}`, { empresaId: FX.empresaA }),
        await get(USUARIOS.visorA, `/inventario/polizas/${deB.id}`, { empresaId: FX.empresaB }),
        await get(USUARIOS.adminEmpresaA, `/inventario/polizas/${FX.inexistente}`, {
          empresaId: FX.empresaA,
        }),
      ];
      for (const r of respuestas) {
        expect(r.status).toBe(404);
        expect(r.body).toEqual(respuestas[0].body);
      }
    });

    it('sin token = 401', async () => {
      const r = await request(url)
        .get('/inventario/movimientos')
        .query({ empresaId: FX.empresaA, desde: '2026-09-01', hasta: '2026-09-03' });
      expect(r.status).toBe(401);
    });
  });
});
