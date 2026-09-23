import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { configurarApp } from '../configurar-app';

// E2E de la ingesta de compras (F2-126) sobre la app REAL contra Postgres REAL, con las fixtures
// sintéticas de F1-011 (A1 y A2 de la empresa A, B1 de la B). Keys sintéticas.
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const KEYS = {
  a1: 'msr_sintetica-compras-F2-126-sucursal-a1-000000000000001',
  a2: 'msr_sintetica-compras-F2-126-sucursal-a2-000000000000002',
  b1: 'msr_sintetica-compras-F2-126-sucursal-b1-000000000000003',
} as const;

/** Instantes en el pasado y en orden. */
const T = (n: number) => new Date(Date.UTC(2026, 8, 1, 3, 0, 0) + n * 3_600_000).toISOString();

type Registro = Record<string, unknown>;

const C1: Registro = {
  origenSrId: 'C1',
  folio: 'OC-1',
  proveedorOrigenSrId: 'PR1',
  almacenOrigenSrId: 'ALM1',
  fecha: T(0),
  cancelada: false,
  partidas: [
    { insumoOrigenSrId: 'I1', cantidad: '10', costoUnitario: '20.00' },
    { insumoOrigenSrId: 'I2', cantidad: '5.5', costoUnitario: '3.333' },
    { insumoOrigenSrId: 'I3', cantidad: '1', costoUnitario: '1' },
  ],
};
const C2: Registro = {
  origenSrId: 'C2',
  folio: 'OC-2',
  proveedorOrigenSrId: null,
  almacenOrigenSrId: null,
  fecha: T(1),
  cancelada: false,
  partidas: [{ insumoOrigenSrId: 'I1', cantidad: '2.5', costoUnitario: '20' }],
};

describe('Ingesta de compras (e2e, F2-126)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const lote = (key: string, leidoAt: string, compras: unknown[], extra = {}) =>
    request(url)
      .post('/ingesta/compras')
      .set('X-Api-Key', key)
      .send({ leidoAt, compras, ...extra });

  /** Todas las compras y partidas de una sucursal, todas las columnas, como JSON. */
  async function base(sucursalId: string) {
    const w = { where: { sucursalId }, orderBy: { id: 'asc' as const } };
    return JSON.parse(
      JSON.stringify(
        await Promise.all([prisma.compra.findMany(w), prisma.partidaCompra.findMany(w)]),
      ),
    );
  }
  const compra = (origen: string, sucursalId: string = FX.sucursalA1) =>
    prisma.compra.findFirstOrThrow({
      where: { sucursalId, origenSrId: origen },
      include: { detalle: { orderBy: { renglon: 'asc' } } },
    });
  const partidas = async (origen: string, sucursalId: string = FX.sucursalA1) =>
    (await compra(origen, sucursalId)).detalle.map((m) => [
      m.renglon,
      m.insumoOrigenSrId,
      m.cantidad.toFixed(3),
      m.costoUnitario.toFixed(2),
      m.importe.toFixed(2),
    ]);

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

  it('el primer lote crea las compras con importes y total calculados por el API', async () => {
    const r = await lote(KEYS.a1, T(2), [C1, C2]);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      recibidas: 2,
      creadas: 2,
      actualizadas: 0,
      sinCambios: 0,
      obsoletas: 0,
      rechazadas: [],
    });
    const c1 = await compra('C1');
    expect(c1).toMatchObject({
      empresaId: FX.empresaA,
      sucursalId: FX.sucursalA1,
      folio: 'OC-1',
      proveedorOrigenSrId: 'PR1',
      almacenOrigenSrId: 'ALM1',
      cancelada: false,
      partidas: 3,
    });
    expect(c1.fecha.toISOString()).toBe(T(0));
    expect(c1.leidaAt.toISOString()).toBe(T(2));
    // 3.333 → 3.33; 5.5 × 3.33 = 18.315 → 18.32 (mitad lejos de cero). Total 200 + 18.32 + 1.
    expect(await partidas('C1')).toEqual([
      [0, 'I1', '10.000', '20.00', '200.00'],
      [1, 'I2', '5.500', '3.33', '18.32'],
      [2, 'I3', '1.000', '1.00', '1.00'],
    ]);
    expect(c1.total.toFixed(2)).toBe('219.32');
    expect(c1.detalle.every((m) => m.empresaId === FX.empresaA)).toBe(true);
    const c2 = await compra('C2');
    expect([c2.proveedorOrigenSrId, c2.almacenOrigenSrId, c2.total.toFixed(2)]).toEqual([
      null,
      null,
      '50.00',
    ]);
  });

  it('idempotencia: el mismo lote tres veces deja la base EXACTAMENTE igual', async () => {
    const antes = await base(FX.sucursalA1);
    for (let i = 0; i < 3; i++) {
      const r = await lote(KEYS.a1, T(2), [C1, C2]);
      expect(r.body).toMatchObject({ creadas: 0, actualizadas: 0, sinCambios: 2, obsoletas: 0 });
    }
    // Y en otro orden dentro del lote, tampoco cambia nada.
    const r = await lote(KEYS.a1, T(2), [C2, C1]);
    expect(r.body).toMatchObject({ sinCambios: 2 });
    expect(await base(FX.sucursalA1)).toEqual(antes);
  });

  it('dos lotes EN PARALELO con la misma compra nueva dejan UNA sola compra', async () => {
    const nueva = { ...C2, origenSrId: 'PAR', folio: 'OC-PAR' };
    const rs = await Promise.all([lote(KEYS.a1, T(2), [nueva]), lote(KEYS.a1, T(2), [nueva])]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(rs.map((r) => r.body.creadas).sort()).toEqual([0, 1]);
    expect(
      await prisma.compra.count({ where: { sucursalId: FX.sucursalA1, origenSrId: 'PAR' } }),
    ).toBe(1);
  });

  it('una corrección con MENOS partidas las reemplaza y recalcula el total', async () => {
    const corregida = {
      ...C1,
      partidas: [
        { insumoOrigenSrId: 'I1', cantidad: '9', costoUnitario: '20' },
        { insumoOrigenSrId: 'I2', cantidad: '5.5', costoUnitario: '3.33' },
      ],
    };
    const antes = await compra('C1');
    const r = await lote(KEYS.a1, T(3), [corregida]);
    expect(r.body).toMatchObject({ actualizadas: 1, creadas: 0 });
    const despues = await compra('C1');
    expect(despues.id).toBe(antes.id);
    expect(despues.partidas).toBe(2);
    expect(despues.total.toFixed(2)).toBe('198.32');
    expect(await partidas('C1')).toEqual([
      [0, 'I1', '9.000', '20.00', '180.00'],
      [1, 'I2', '5.500', '3.33', '18.32'],
    ]);
    expect(await prisma.partidaCompra.count({ where: { compraId: antes.id } })).toBe(2);
  });

  it('un lote VIEJO que llega después no revierte la corrección (obsoleta, sin error)', async () => {
    const antes = await base(FX.sucursalA1);
    const r = await lote(KEYS.a1, T(2), [C1]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ obsoletas: 1, actualizadas: 0, creadas: 0, sinCambios: 0 });
    expect(await base(FX.sucursalA1)).toEqual(antes);
  });

  it('la misma compra leída más tarde sin cambios sólo avanza leida_at', async () => {
    const antes = await compra('C2');
    const r = await lote(KEYS.a1, T(4), [C2]);
    expect(r.body).toMatchObject({ sinCambios: 1 });
    const despues = await compra('C2');
    expect(despues.leidaAt.toISOString()).toBe(T(4));
    expect(despues.updatedAt.toISOString()).toBe(antes.updatedAt.toISOString());
    expect(despues.recibidaAt.toISOString()).toBe(antes.recibidaAt.toISOString());
  });

  it('cancelarla la marca, conserva sus partidas y no la borra', async () => {
    const r = await lote(KEYS.a1, T(5), [{ ...C2, cancelada: true }]);
    expect(r.body).toMatchObject({ actualizadas: 1 });
    const c2 = await compra('C2');
    expect([c2.cancelada, c2.detalle.length, c2.total.toFixed(2)]).toEqual([true, 1, '50.00']);
  });

  it('la misma origenSrId en otra sucursal es otra compra; nada cruza de sucursal ni de empresa', async () => {
    const r = await lote(KEYS.a2, T(2), [C1]);
    expect(r.body).toMatchObject({ creadas: 1 });
    expect((await compra('C1', FX.sucursalA2)).empresaId).toBe(FX.empresaA);
    expect(await partidas('C1', FX.sucursalA2)).toHaveLength(3);
    expect(await partidas('C1')).toHaveLength(2);
    const b = await lote(KEYS.b1, T(2), [C1]);
    expect(b.body).toMatchObject({ creadas: 1 });
    expect((await compra('C1', FX.sucursalB1)).empresaId).toBe(FX.empresaB);
  });

  it('una compra inválida entre N se rechaza sola, sin el valor; las demás entran', async () => {
    const base0 = { ...C2, cancelada: false };
    const malas = [
      {
        ...base0,
        origenSrId: 'M1',
        partidas: [{ insumoOrigenSrId: 'I1', cantidad: 'secreto-123', costoUnitario: '1' }],
      },
      {
        ...base0,
        origenSrId: 'M2',
        partidas: [{ insumoOrigenSrId: 'I1', cantidad: '0', costoUnitario: '1' }],
      },
      {
        ...base0,
        origenSrId: 'M3',
        partidas: [{ insumoOrigenSrId: 'I1', cantidad: '-1', costoUnitario: '1' }],
      },
      {
        ...base0,
        origenSrId: 'M4',
        partidas: [{ insumoOrigenSrId: 'I1', cantidad: '1', costoUnitario: '-5' }],
      },
      { ...base0, origenSrId: 'M5', sucursalId: FX.sucursalB1 },
      { ...base0, origenSrId: 'M6', fecha: new Date(Date.now() + 3_600_000).toISOString() },
      {
        ...base0,
        origenSrId: 'M7',
        partidas: [
          { insumoOrigenSrId: 'I1', cantidad: '999999999', costoUnitario: '9999999' },
          { insumoOrigenSrId: 'I1', cantidad: '999999999', costoUnitario: '9999999' },
        ],
      },
    ];
    const buena = { ...base0, origenSrId: 'OK1', folio: 'OC-OK1' };
    const r = await lote(KEYS.a1, T(6), [...malas, buena, { ...buena }]);
    expect(r.status).toBe(200);
    // La buena va DOS veces: repetida en el lote, se rechazan las dos apariciones.
    expect(r.body).toMatchObject({ recibidas: 9, creadas: 0 });
    expect(r.body.rechazadas.map((x: Registro) => x.origenSrId)).toEqual([
      'M1',
      'M2',
      'M3',
      'M4',
      'M5',
      'M6',
      'M7',
      'OK1',
      'OK1',
    ]);
    expect(JSON.stringify(r.body)).not.toContain('secreto-123');
    const r2 = await lote(KEYS.a1, T(6), [buena]);
    expect(r2.body).toMatchObject({ creadas: 1 });
  });

  it('sobre inválido = 400 sin escribir (vacío, sin zona, futuro, campo de más, > 5000 partidas)', async () => {
    const antes = await base(FX.sucursalA1);
    const futuro = new Date(Date.now() + 10 * 60_000).toISOString();
    const mitad = (origen: string) => ({
      ...C2,
      origenSrId: origen,
      partidas: Array.from({ length: 2501 }, () => ({
        insumoOrigenSrId: 'I1',
        cantidad: '1',
        costoUnitario: '1',
      })),
    });
    for (const [leido, compras, extra] of [
      [T(7), [], {}],
      ['2026-09-01T03:00:00', [C1], {}],
      [futuro, [C1], {}],
      [T(7), [C1], { sucursalId: FX.sucursalB1 }],
      [T(7), [mitad('M1'), mitad('M2')], {}],
      [T(7), ['no-objeto'], {}],
    ] as const) {
      const r = await lote(KEYS.a1, leido, [...compras], extra);
      expect(r.status).toBe(400);
    }
    expect(await base(FX.sucursalA1)).toEqual(antes);
  });

  it('la base rechaza una partida colgada de una compra de otra sucursal y una cantidad ≤ 0', async () => {
    const c = await compra('C1');
    await expect(
      prisma.$executeRaw`INSERT INTO partidas_compra (id, empresa_id, sucursal_id, compra_id, renglon, insumo_origen_sr_id, cantidad, costo_unitario, importe)
        VALUES (gen_random_uuid(), ${FX.empresaA}::uuid, ${FX.sucursalA2}::uuid, ${c.id}::uuid, 99, 'I1', 1, 1, 1)`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`INSERT INTO partidas_compra (id, empresa_id, sucursal_id, compra_id, renglon, insumo_origen_sr_id, cantidad, costo_unitario, importe)
        VALUES (gen_random_uuid(), ${FX.empresaA}::uuid, ${FX.sucursalA1}::uuid, ${c.id}::uuid, 99, 'I1', 0, 1, 0)`,
    ).rejects.toThrow();
  });

  it('sin API key = 401', async () => {
    const r = await request(url)
      .post('/ingesta/compras')
      .send({ leidoAt: T(0), compras: [C1] });
    expect(r.status).toBe(401);
  });
});
