import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { configurarApp } from '../configurar-app';

// E2E de la ingesta de recetas (F2-125) sobre la app REAL contra Postgres REAL, con las fixtures
// sintéticas de F1-011 (A1 y A2 de la empresa A, B1 de la B). Keys sintéticas.
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const KEYS = {
  a1: 'msr_sintetica-recetas-F2-125-sucursal-a1-000000000000001',
  a2: 'msr_sintetica-recetas-F2-125-sucursal-a2-000000000000002',
  b1: 'msr_sintetica-recetas-F2-125-sucursal-b1-000000000000003',
} as const;

/** Instantes en el pasado y en orden. */
const T = (n: number) => new Date(Date.UTC(2026, 8, 1, 3, 0, 0) + n * 3_600_000).toISOString();

type Registro = Record<string, unknown>;

const R1: Registro = {
  productoOrigenSrId: 'P1',
  renglones: [
    { insumoOrigenSrId: 'I2', cantidad: '3' },
    { insumoOrigenSrId: 'I1', cantidad: '0.15' },
    { insumoOrigenSrId: 'I3', cantidad: '0.0200' },
  ],
};
const R2: Registro = {
  productoOrigenSrId: 'P2',
  renglones: [{ insumoOrigenSrId: 'I1', cantidad: '1.05' }],
};

describe('Ingesta de recetas (e2e, F2-125)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const lote = (key: string, leidoAt: string, recetas: unknown[], extra = {}) =>
    request(url)
      .post('/ingesta/recetas')
      .set('X-Api-Key', key)
      .send({ leidoAt, recetas, ...extra });

  /** Todas las recetas y renglones de una sucursal, todas las columnas, como JSON. */
  async function base(sucursalId: string) {
    const w = { where: { sucursalId }, orderBy: { id: 'asc' as const } };
    return JSON.parse(
      JSON.stringify(
        await Promise.all([prisma.receta.findMany(w), prisma.renglonReceta.findMany(w)]),
      ),
    );
  }
  const receta = (producto: string, sucursalId: string = FX.sucursalA1) =>
    prisma.receta.findFirstOrThrow({
      where: { sucursalId, productoOrigenSrId: producto },
      include: { detalle: { orderBy: { renglon: 'asc' } } },
    });
  const renglones = async (producto: string, sucursalId: string = FX.sucursalA1) =>
    (await receta(producto, sucursalId)).detalle.map((r) => [
      r.renglon,
      r.insumoOrigenSrId,
      r.cantidad.toFixed(4),
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

  it('sin API key = 401 y no escribe nada', async () => {
    const r = await request(url)
      .post('/ingesta/recetas')
      .send({ leidoAt: T(1), recetas: [R1] });
    expect(r.status).toBe(401);
    expect(await prisma.receta.count({ where: { empresaId: FX.empresaA } })).toBe(0);
  });

  it('el primer lote crea las recetas con sus renglones ORDENADOS, clavadas a la sucursal', async () => {
    const r = await lote(KEYS.a1, T(1), [R1, R2]);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      recibidas: 2,
      creadas: 2,
      actualizadas: 0,
      sinCambios: 0,
      obsoletas: 0,
      rechazadas: [],
    });
    expect(await receta('P1')).toMatchObject({
      empresaId: FX.empresaA,
      sucursalId: FX.sucursalA1,
      renglones: 3,
      leidaAt: new Date(T(1)),
    });
    expect(await renglones('P1')).toEqual([
      [0, 'I1', '0.1500'],
      [1, 'I2', '3.0000'],
      [2, 'I3', '0.0200'],
    ]);
    const detalle = (await receta('P1')).detalle;
    expect(
      detalle.every((d) => d.empresaId === FX.empresaA && d.sucursalId === FX.sucursalA1),
    ).toBe(true);
  });

  it('el mismo lote tres veces (con los renglones en otro orden) deja la base EXACTAMENTE igual', async () => {
    const antes = await base(FX.sucursalA1);
    const reordenada = {
      ...R1,
      renglones: [...(R1.renglones as Registro[])].reverse().map((x) => ({
        ...x,
        cantidad: x.cantidad === '3' ? '3.0000' : x.cantidad,
      })),
    };
    for (const lista of [
      [R1, R2],
      [reordenada, R2],
      [R2, R1],
    ]) {
      const r = await lote(KEYS.a1, T(1), lista);
      expect(r.body).toMatchObject({ creadas: 0, actualizadas: 0, sinCambios: 2 });
    }
    expect(await base(FX.sucursalA1)).toEqual(antes);
  });

  it('el mismo contenido leído más tarde sólo avanza leida_at (ni updated_at ni renglones)', async () => {
    const antes = await receta('P1');
    const r = await lote(KEYS.a1, T(2), [R1]);
    expect(r.body).toMatchObject({ sinCambios: 1, actualizadas: 0 });
    const despues = await receta('P1');
    expect(despues.leidaAt).toEqual(new Date(T(2)));
    expect(despues.updatedAt).toEqual(antes.updatedAt);
    expect(despues.detalle.map((d) => d.id)).toEqual(antes.detalle.map((d) => d.id));
  });

  it('una corrección con menos renglones REEMPLAZA (no quedan renglones viejos)', async () => {
    const r = await lote(KEYS.a1, T(3), [
      { productoOrigenSrId: 'P1', renglones: [{ insumoOrigenSrId: 'I1', cantidad: '0.18' }] },
    ]);
    expect(r.body).toMatchObject({ actualizadas: 1 });
    expect(await renglones('P1')).toEqual([[0, 'I1', '0.1800']]);
    expect((await receta('P1')).renglones).toBe(1);
  });

  it('un lote más viejo que lo guardado no revierte nada (obsoletas)', async () => {
    const antes = await base(FX.sucursalA1);
    const r = await lote(KEYS.a1, T(2), [R1]);
    expect(r.body).toMatchObject({ obsoletas: 1, actualizadas: 0 });
    expect(await base(FX.sucursalA1)).toEqual(antes);
  });

  it('una receta vacía = el producto ya no tiene receta: se guarda con 0 renglones', async () => {
    const r = await lote(KEYS.a1, T(4), [{ productoOrigenSrId: 'P2', renglones: [] }]);
    expect(r.body).toMatchObject({ actualizadas: 1 });
    expect(await receta('P2')).toMatchObject({ renglones: 0, detalle: [] });
  });

  it('una receta inválida se rechaza sola, sin el valor; las válidas del lote sí entran', async () => {
    const r = await lote(KEYS.a1, T(5), [
      { productoOrigenSrId: 'P3', renglones: [{ insumoOrigenSrId: 'I1', cantidad: '0.5' }] },
      {
        productoOrigenSrId: 'P4',
        renglones: [
          { insumoOrigenSrId: 'I1', cantidad: '0.5' },
          { insumoOrigenSrId: 'I2', cantidad: '-7.25' },
        ],
      },
      { productoOrigenSrId: 'P5', renglones: [], empresaId: FX.empresaB },
    ]);
    expect(r.status).toBe(200);
    expect(r.body.creadas).toBe(1);
    expect(r.body.rechazadas.map((x: Registro) => [x.indice, x.productoOrigenSrId])).toEqual([
      [1, 'P4'],
      [2, 'P5'],
    ]);
    expect(JSON.stringify(r.body.rechazadas)).not.toContain('-7.25');
    expect(await prisma.receta.count({ where: { productoOrigenSrId: { in: ['P4', 'P5'] } } })).toBe(
      0,
    );
  });

  it('sobre inválido = 400 sin escribir nada', async () => {
    const antes = await base(FX.sucursalA1);
    const muchos = Array.from({ length: 11 }, (_, i) => ({
      productoOrigenSrId: `M${i}`,
      renglones: Array.from({ length: 500 }, (_, j) => ({
        insumoOrigenSrId: `I${j}`,
        cantidad: '1',
      })),
    }));
    const casos = [
      await lote(KEYS.a1, T(6), []),
      await lote(KEYS.a1, T(6), [R1], { sucursalId: FX.sucursalA2 }),
      await lote(KEYS.a1, '2026-09-01T03:00:00', [R1]),
      await lote(KEYS.a1, new Date(Date.now() + 3_600_000).toISOString(), [R1]),
      await lote(KEYS.a1, T(6), muchos),
      await lote(KEYS.a1, T(6), ['no-objeto']),
    ];
    expect(casos.map((c) => c.status)).toEqual([400, 400, 400, 400, 400, 400]);
    expect(await base(FX.sucursalA1)).toEqual(antes);
  });

  it('el mismo producto en otra sucursal u otra empresa es otra receta; nada se mezcla', async () => {
    const antes = await base(FX.sucursalA1);
    expect((await lote(KEYS.a2, T(1), [R2])).body).toMatchObject({ creadas: 1 });
    expect((await lote(KEYS.b1, T(1), [R2])).body).toMatchObject({ creadas: 1 });
    expect(await base(FX.sucursalA1)).toEqual(antes);
    expect(await receta('P2', FX.sucursalB1)).toMatchObject({
      empresaId: FX.empresaB,
      renglones: 1,
    });
    expect(await renglones('P2', FX.sucursalA2)).toEqual([[0, 'I1', '1.0500']]);
    // P2 de A1 sigue vacía.
    expect((await receta('P2')).renglones).toBe(0);
  });

  it('la FK compuesta impide colgar un renglón de una receta de otra sucursal (SQL crudo)', async () => {
    const deA1 = await receta('P1');
    await expect(
      prisma.$executeRaw`INSERT INTO renglones_receta (id, empresa_id, sucursal_id, receta_id, renglon, insumo_origen_sr_id, cantidad)
        VALUES (gen_random_uuid(), ${FX.empresaA}::uuid, ${FX.sucursalA2}::uuid, ${deA1.id}::uuid, 9, 'I1', 1)`,
    ).rejects.toThrow();
    await expect(
      prisma.$executeRaw`INSERT INTO renglones_receta (id, empresa_id, sucursal_id, receta_id, renglon, insumo_origen_sr_id, cantidad)
        VALUES (gen_random_uuid(), ${FX.empresaA}::uuid, ${FX.sucursalA1}::uuid, ${deA1.id}::uuid, 9, 'I1', -1)`,
    ).rejects.toThrow();
  });
});
