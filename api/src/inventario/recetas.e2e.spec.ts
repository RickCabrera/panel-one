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

// E2E de Recetas y consumo teórico (F2-125) sobre la app REAL contra Postgres REAL, con las
// fixtures sintéticas de F1-011. Todo entra por las ingestas del agente (catálogos, cheques,
// recetas, pólizas, existencias) y se lee por el panel. Los valores esperados están ESCRITOS A
// MANO (ver el bloque de abajo): no se recalculan con la fórmula del API. Ésta es la prueba
// independiente; la de conservación contra el seed es `prisma/seed-recetas.spec.ts`.
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const KEYS = {
  a1: 'msr_sintetica-recetas-panel-F2-125-sucursal-a1-000000001',
  a2: 'msr_sintetica-recetas-panel-F2-125-sucursal-a2-000000002',
  b1: 'msr_sintetica-recetas-panel-F2-125-sucursal-b1-000000003',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];
type Registro = Record<string, unknown>;

const sinc = (n: number) => `f2125000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-09-04T00:00:00.000Z';

/*
 * A1 (America/Mexico_City, UTC−6). Rango: el día local 2026-09-02.
 *
 * Recetas: P1 Taco al pastor = I1 0.15 + I2 3 + I3 0.02 · P6 Arrachera (por kg) = I1 1.05 ·
 * P3 Agua = vacía · P2 Refresco = sin cabecera · P99 = receta de un producto que no está en el
 * espejo. P4 "Café" y P5 "café " (de baja) se llaman igual → ambiguo.
 *
 * Cheques:
 * - C1 cerrado 09-02 13:00 local: 10 Taco al pastor, 2 Refresco ($50.00)
 * - C2 cerrado 09-02 23:30 local (= 09-03 05:30Z, SIGUE siendo 09-02 local): 2 "taco al pastor "
 *   y 1.250 kg de Arrachera
 * - C3 CANCELADO el 09-02: 100 tacos → no cuenta
 * - C4 cerrado 09-03 00:30 local (= 09-03 06:30Z): 5 tacos → es de 09-03, no cuenta
 * - C5 cerrado 09-02 15:00: 3 Agua ($45.00), 1 Pozole (sin catálogo), 2 Café (ambiguo)
 *
 * Teórico 09-02 (12 tacos, 1.25 kg de arrachera):
 * - I1 = 12 × 0.15 + 1.25 × 1.05 = 1.8 + 1.3125 = 3.1125 → 3.113 (a 3, mitad lejos de cero)
 * - I2 = 12 × 3 = 36
 * - I3 = 12 × 0.02 = 0.24
 *
 * Pólizas de A1 (hora local → UTC):
 * - K consumo 09-02 22:00 (09-03 04:00Z): I1 −3 @200 · I2 −36 @1.50 · I3 −0.3 @30 · I9 −4 @2
 * - M merma   09-02 12:00 (18:00Z):       I1 −0.2 @200
 * - J ajuste  09-02 23:00 (09-03 05:00Z): I2 +2 @1.50 (a favor) · I3 −0.01 @30
 * - X merma CANCELADA 09-02: I1 −50 · C compra 09-02: I1 +10 · S traspaso_salida 09-02: I3 −1
 *   · K2 consumo 09-03 10:00 (otro día): I1 −9 → ninguna cuenta
 *
 * Real, variación, %, costo (Σ importe / Σ cantidad de las salidas) e importe:
 * - I1: 3 + 0.2 = 3.2 · 3.2 − 3.113 = 0.087 · 0.087 / 3.113 = 2.79 % → 2.8 · costo 640 / 3.2 =
 *   200.00 · importe 17.40 · teórico $622.60
 * - I2: 36 − 2 = 34 · 34 − 36 = −2 · −2 / 36 = −5.56 % → −5.6 · costo 54 / 36 = 1.50 · −3.00
 * - I3: 0.3 + 0.01 = 0.31 · 0.31 − 0.24 = 0.07 · 29.17 % → 29.2 · costo 9.30 / 0.31 = 30.00 · 2.10
 * - I9 (desechable): teórico 0, real 4 → sin teórico, sin % · costo 2.00 · 8.00
 * Ranking por importe: I1 (17.40), I9 (8.00), I3 (2.10), I2 (−3.00).
 *
 * Foto de existencias de A1 (almacén ALM1): I1 10 @200 = 2000.00 · I2 100 @1.50 = 150.00 (I3 no
 * viene: sin costo de existencias).
 *
 * B1 (empresa B): catálogo, receta de P1 = I1 9 y un cheque de 1 taco, SIN pólizas → real nulo.
 * A2: tiene catálogo y ventas, pero ninguna receta → no se calcula.
 */

const PRODUCTOS_A1 = [
  { origenSrId: 'P1', clave: 'P1', nombre: 'Taco al pastor', precio: '25' },
  { origenSrId: 'P2', clave: 'P2', nombre: 'Refresco', precio: '25' },
  { origenSrId: 'P3', clave: 'P3', nombre: 'Agua', precio: '15' },
  { origenSrId: 'P4', clave: 'P4', nombre: 'Café', precio: '30' },
  { origenSrId: 'P5', clave: 'P5', nombre: 'café ', precio: '30', activoPos: false },
  { origenSrId: 'P6', clave: 'P6', nombre: 'Arrachera', precio: '350' },
];

const partida = (producto: string, cantidad: string, precio: string) => ({
  producto,
  cantidad,
  precioUnit: precio,
  total: (Number(cantidad) * Number(precio)).toFixed(2),
});
const cheque = (
  folio: string,
  cerradoAt: string,
  partidas: Registro[],
  cancelado = false,
): Registro => ({
  id: folio,
  tipo: 'cheque',
  datos: {
    folioSr: folio,
    folio,
    abiertoAt: '2026-09-02T12:00:00.000-06:00',
    cerradoAt,
    subtotal: '0',
    impuestos: '0',
    descuentos: '0',
    propina: '0',
    total: '100.00',
    cancelado,
    partidas,
    pagos: [],
  },
});

const mov = (insumo: string, cantidad: string, costo: string) => ({
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

describe('Recetas y consumo teórico (e2e, F2-125)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const get = async (u: Usuario, ruta: string, query: Record<string, string>) =>
    request(url)
      .get(ruta)
      .query(query)
      .set('Authorization', `Bearer ${await token(u)}`);
  const consumo = (u: Usuario, query: Record<string, string> = {}) =>
    get(u, '/inventario/consumo-teorico', {
      empresaId: FX.empresaA,
      desde: '2026-09-02',
      hasta: '2026-09-02',
      ...query,
    });

  const post = async (key: string, ruta: string, body: Registro) => {
    const r = await request(url).post(ruta).set('X-Api-Key', key).send(body);
    expect(r.status).toBe(200);
    return r.body as Registro;
  };
  let n = 0;
  const catalogo = async (key: string, cat: string, registros: Registro[]) => {
    n++;
    const base = { catalogo: cat, sincronizacionId: sinc(n), capturadoAt: T };
    expect(
      ((await post(key, '/ingesta/catalogos', { ...base, registros })) as { rechazados: [] })
        .rechazados,
    ).toEqual([]);
    await post(key, '/ingesta/catalogos/cierre', {
      ...base,
      total: registros.length,
      rechazados: 0,
    });
  };
  const recetas = async (key: string, lista: Registro[]) => {
    const r = await post(key, '/ingesta/recetas', { leidoAt: T, recetas: lista });
    expect(r.rechazadas).toEqual([]);
  };
  const cheques = async (key: string, eventos: Registro[]) => {
    const r = (await post(key, '/ingesta/eventos', { eventos })) as {
      rechazados?: unknown[];
    };
    expect(r.rechazados ?? []).toEqual([]);
  };

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

    // A1: catálogos, recetas, ventas, pólizas y foto de existencias.
    await catalogo(KEYS.a1, 'productos', PRODUCTOS_A1);
    await catalogo(KEYS.a1, 'unidades', [
      { origenSrId: 'KG', nombre: 'Kilogramo' },
      { origenSrId: 'PZ', nombre: 'Pieza' },
    ]);
    await catalogo(KEYS.a1, 'insumos', [
      { origenSrId: 'I1', nombre: 'Carne al pastor', unidadOrigenSrId: 'KG' },
      { origenSrId: 'I2', nombre: 'Tortilla', unidadOrigenSrId: 'PZ' },
      { origenSrId: 'I3', nombre: 'Cebolla', unidadOrigenSrId: 'KG' },
      { origenSrId: 'I9', nombre: 'Contenedor', unidadOrigenSrId: 'PZ' },
    ]);
    await recetas(KEYS.a1, [
      {
        productoOrigenSrId: 'P1',
        renglones: [
          { insumoOrigenSrId: 'I3', cantidad: '0.02' },
          { insumoOrigenSrId: 'I1', cantidad: '0.15' },
          { insumoOrigenSrId: 'I2', cantidad: '3' },
        ],
      },
      { productoOrigenSrId: 'P6', renglones: [{ insumoOrigenSrId: 'I1', cantidad: '1.05' }] },
      { productoOrigenSrId: 'P3', renglones: [] },
      { productoOrigenSrId: 'P99', renglones: [{ insumoOrigenSrId: 'I1', cantidad: '1' }] },
    ]);
    await cheques(KEYS.a1, [
      cheque('C1', '2026-09-02T13:00:00.000-06:00', [
        partida('Taco al pastor', '10', '25'),
        partida('Refresco', '2', '25'),
      ]),
      cheque('C2', '2026-09-02T23:30:00.000-06:00', [
        partida('taco al pastor ', '2', '25'),
        partida('Arrachera', '1.250', '350'),
      ]),
      cheque('C3', '2026-09-02T14:00:00.000-06:00', [partida('Taco al pastor', '100', '25')], true),
      cheque('C4', '2026-09-03T00:30:00.000-06:00', [partida('Taco al pastor', '5', '25')]),
      cheque('C5', '2026-09-02T15:00:00.000-06:00', [
        partida('Agua', '3', '15'),
        partida('Pozole', '1', '120'),
        partida('Café', '2', '30'),
      ]),
    ]);
    const lote = await post(KEYS.a1, '/ingesta/movimientos', {
      leidoAt: T,
      polizas: [
        pol('K', 'consumo', '2026-09-03T04:00:00.000Z', [
          mov('I1', '-3', '200'),
          mov('I2', '-36', '1.50'),
          mov('I3', '-0.3', '30'),
          mov('I9', '-4', '2'),
        ]),
        pol('M', 'merma', '2026-09-02T18:00:00.000Z', [mov('I1', '-0.2', '200')]),
        pol('J', 'ajuste', '2026-09-03T05:00:00.000Z', [
          mov('I2', '2', '1.50'),
          mov('I3', '-0.01', '30'),
        ]),
        pol('X', 'merma', '2026-09-02T19:00:00.000Z', [mov('I1', '-50', '200')], {
          cancelada: true,
        }),
        pol('C', 'compra', '2026-09-02T16:00:00.000Z', [mov('I1', '10', '190')]),
        pol('S', 'traspaso_salida', '2026-09-02T17:00:00.000Z', [mov('I3', '-1', '30')]),
        pol('K2', 'consumo', '2026-09-03T16:00:00.000Z', [mov('I1', '-9', '200')]),
      ],
    });
    expect(lote.rechazadas).toEqual([]);
    await post(KEYS.a1, '/ingesta/existencias', {
      almacenOrigenSrId: 'ALM1',
      capturadoAt: T,
      registros: [
        { insumoOrigenSrId: 'I1', cantidad: '10', costoPromedio: '200' },
        { insumoOrigenSrId: 'I2', cantidad: '100', costoPromedio: '1.50' },
      ],
    });

    // A2: catálogo y ventas, sin recetas.
    await catalogo(KEYS.a2, 'productos', [{ origenSrId: 'P1', nombre: 'Taco al pastor' }]);
    await cheques(KEYS.a2, [
      cheque('A2-1', '2026-09-02T13:00:00.000-07:00', [partida('Taco al pastor', '7', '25')]),
    ]);

    // B1 (otra empresa): catálogo, receta y una venta, sin pólizas.
    await catalogo(KEYS.b1, 'productos', [{ origenSrId: 'P1', nombre: 'Taco al pastor' }]);
    await recetas(KEYS.b1, [
      { productoOrigenSrId: 'P1', renglones: [{ insumoOrigenSrId: 'I1', cantidad: '9' }] },
    ]);
    await cheques(KEYS.b1, [
      cheque('B-1', '2026-09-02T13:00:00.000-06:00', [partida('Taco al pastor', '1', '25')]),
    ]);
  }, 60_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('GET /inventario/consumo-teorico', () => {
    it('los 3 insumos de control (I1, I2, I3) cuadran con el cálculo a mano', async () => {
      const r = await consumo(USUARIOS.visorA, { sucursalId: FX.sucursalA1 });
      expect(r.status).toBe(200);
      const fila = (i: string) => r.body.filas.find((f: Registro) => f.insumoOrigenSrId === i);
      expect(fila('I1')).toEqual({
        sucursalId: FX.sucursalA1,
        insumoOrigenSrId: 'I1',
        insumo: 'Carne al pastor',
        unidad: 'Kilogramo',
        teorico: '3.113',
        real: '3.200',
        consumo: '3.000',
        merma: '0.200',
        ajuste: '0.000',
        variacion: '0.087',
        porcentaje: '2.8',
        sinTeorico: false,
        costo: '200.00',
        importeTeorico: '622.60',
        importeVariacion: '17.40',
      });
      expect(fila('I2')).toMatchObject({
        unidad: 'Pieza',
        teorico: '36.000',
        real: '34.000',
        consumo: '36.000',
        merma: '0.000',
        ajuste: '-2.000',
        variacion: '-2.000',
        porcentaje: '-5.6',
        costo: '1.50',
        importeVariacion: '-3.00',
      });
      expect(fila('I3')).toMatchObject({
        teorico: '0.240',
        real: '0.310',
        consumo: '0.300',
        ajuste: '0.010',
        variacion: '0.070',
        porcentaje: '29.2',
        costo: '30.00',
        importeVariacion: '2.10',
      });
      expect(fila('I9')).toMatchObject({
        teorico: '0.000',
        real: '4.000',
        sinTeorico: true,
        porcentaje: null,
        costo: '2.00',
        importeVariacion: '8.00',
      });
      // El ranking: importe de la variación, de mayor a menor.
      expect(r.body.filas.map((f: Registro) => f.insumoOrigenSrId)).toEqual([
        'I1',
        'I9',
        'I3',
        'I2',
      ]);
    });

    it('los productos sin receta, sin catálogo y ambiguos van aparte y no truenan el cálculo', async () => {
      const r = await consumo(USUARIOS.visorA, { sucursalId: FX.sucursalA1 });
      expect(
        r.body.aparte.map((a: Registro) => [
          a.motivo,
          a.producto,
          a.productoOrigenSrId,
          a.cantidad,
          a.importe,
        ]),
      ).toEqual([
        ['sin_receta', 'Refresco', 'P2', '2.000', '50.00'],
        ['sin_receta', 'Agua', 'P3', '3.000', '45.00'],
        ['sin_catalogo', 'Pozole', null, '1.000', '120.00'],
        ['ambiguo', 'Café', null, '2.000', '60.00'],
      ]);
      expect(r.body.sucursales).toEqual([
        {
          sucursalId: FX.sucursalA1,
          sucursal: 'A1',
          recetasRecibidas: 4,
          catalogoProductos: true,
          polizasRecibidas: 7,
          calculada: true,
          productosExplotados: 2,
        },
      ]);
    });

    it('sin sucursal: A2 (sin recetas) no se calcula y no mezcla filas; B no aparece', async () => {
      const r = await consumo(USUARIOS.adminEmpresaA);
      expect(r.status).toBe(200);
      const a2 = r.body.sucursales.find((s: Registro) => s.sucursalId === FX.sucursalA2);
      expect(a2).toMatchObject({ recetasRecibidas: 0, catalogoProductos: true, calculada: false });
      expect(r.body.sucursales).toHaveLength(2);
      expect(r.body.filas.every((f: Registro) => f.sucursalId === FX.sucursalA1)).toBe(true);
      expect(r.body.aparte.every((a: Registro) => a.sucursalId === FX.sucursalA1)).toBe(true);
    });

    it('B1 sin pólizas: el real es NULO (no cero) y el teórico sí sale', async () => {
      const r = await consumo(USUARIOS.visorB, { empresaId: FX.empresaB });
      expect(r.status).toBe(200);
      expect(r.body.sucursales[0]).toMatchObject({ polizasRecibidas: 0, calculada: true });
      expect(r.body.filas).toEqual([
        expect.objectContaining({
          insumoOrigenSrId: 'I1',
          teorico: '9.000',
          real: null,
          consumo: null,
          variacion: null,
          porcentaje: null,
          costo: null,
          importeVariacion: null,
        }),
      ]);
    });

    it('un periodo sin ventas ni salidas deja filas vacías, con la sucursal calculada', async () => {
      const r = await consumo(USUARIOS.visorA, {
        sucursalId: FX.sucursalA1,
        desde: '2026-08-01',
        hasta: '2026-08-02',
      });
      expect(r.status).toBe(200);
      expect(r.body.filas).toEqual([]);
      expect(r.body.aparte).toEqual([]);
      expect(r.body.sucursales[0].calculada).toBe(true);
    });

    it('otra empresa o una sucursal de otra empresa = 404 (nunca 403)', async () => {
      expect((await consumo(USUARIOS.visorB)).status).toBe(404);
      expect((await consumo(USUARIOS.visorA, { sucursalId: FX.sucursalB1 })).status).toBe(404);
      expect((await consumo(USUARIOS.visorA, { empresaId: FX.inexistente })).status).toBe(404);
    });

    it('rango inválido o de más de 366 días = 400; sin token = 401', async () => {
      expect(
        (await consumo(USUARIOS.visorA, { desde: '2025-01-01', hasta: '2026-09-02' })).status,
      ).toBe(400);
      expect(
        (await consumo(USUARIOS.visorA, { desde: '2026-09-03', hasta: '2026-09-02' })).status,
      ).toBe(400);
      expect((await consumo(USUARIOS.visorA, { desde: '2026-9-2' })).status).toBe(400);
      const r = await request(url)
        .get('/inventario/consumo-teorico')
        .query({ empresaId: FX.empresaA, desde: '2026-09-02', hasta: '2026-09-02' });
      expect(r.status).toBe(401);
    });
  });

  describe('GET /inventario/recetas', () => {
    it('cada producto con su receta, costo e insumos; sin receta y fuera de espejo, marcados', async () => {
      const r = await get(USUARIOS.visorA, '/inventario/recetas', {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
      });
      expect(r.status).toBe(200);
      const p = (id: string) => r.body.productos.find((x: Registro) => x.productoOrigenSrId === id);
      expect(p('P1')).toEqual({
        sucursalId: FX.sucursalA1,
        productoOrigenSrId: 'P1',
        clave: 'P1',
        nombre: 'Taco al pastor',
        vigente: true,
        enCatalogo: true,
        precio: '25.00',
        conReceta: true,
        // Ordenados por insumo; I3 sin existencia leída → sin costo → incompleto.
        renglones: [
          {
            insumoOrigenSrId: 'I1',
            insumo: 'Carne al pastor',
            unidad: 'Kilogramo',
            cantidad: '0.1500',
            costo: '200.00',
            importe: '30.00',
          },
          {
            insumoOrigenSrId: 'I2',
            insumo: 'Tortilla',
            unidad: 'Pieza',
            cantidad: '3.0000',
            costo: '1.50',
            importe: '4.50',
          },
          {
            insumoOrigenSrId: 'I3',
            insumo: 'Cebolla',
            unidad: 'Kilogramo',
            cantidad: '0.0200',
            costo: null,
            importe: null,
          },
        ],
        costo: '34.50',
        costoIncompleto: true,
        porcentajePrecio: null,
      });
      // 1.05 × 200 = 210.00 sobre $350 = 60.0 %.
      expect(p('P6')).toMatchObject({
        costo: '210.00',
        costoIncompleto: false,
        porcentajePrecio: '60.0',
      });
      expect(p('P3')).toMatchObject({ conReceta: false, renglones: [], costo: null });
      expect(p('P2')).toMatchObject({ conReceta: false, costo: null });
      expect(p('P5')).toMatchObject({ vigente: false, enCatalogo: true });
      expect(p('P99')).toMatchObject({
        nombre: null,
        enCatalogo: false,
        vigente: false,
        conReceta: true,
      });
      // Con receta primero, luego sin receta; la de fuera del espejo al final de las con receta.
      expect(r.body.productos.map((x: Registro) => x.productoOrigenSrId)).toEqual([
        'P6',
        'P1',
        'P99',
        'P3',
        'P4',
        'P5',
        'P2',
      ]);
      expect(r.body).toMatchObject({ total: 7, truncado: false });
      expect(r.body.sucursales).toEqual([
        { sucursalId: FX.sucursalA1, sucursal: 'A1', recetasRecibidas: 4, catalogoProductos: true },
      ]);
    });

    it('otra empresa = 404; B sólo ve lo suyo', async () => {
      expect(
        (await get(USUARIOS.visorB, '/inventario/recetas', { empresaId: FX.empresaA })).status,
      ).toBe(404);
      const r = await get(USUARIOS.visorB, '/inventario/recetas', { empresaId: FX.empresaB });
      expect(r.status).toBe(200);
      expect(r.body.productos.map((x: Registro) => [x.sucursalId, x.productoOrigenSrId])).toEqual([
        [FX.sucursalB1, 'P1'],
      ]);
    });
  });
});
