import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { configurarApp } from '../configurar-app';

// E2E de la ingesta de movimientos (F2-122) sobre la app REAL contra Postgres REAL, con las
// fixtures sintéticas de F1-011 (A1 y A2 de la empresa A, B1 de la B). Keys sintéticas.
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const KEYS = {
  a1: 'msr_sintetica-movimientos-F2-122-sucursal-a1-00000000001',
  a2: 'msr_sintetica-movimientos-F2-122-sucursal-a2-00000000002',
  b1: 'msr_sintetica-movimientos-F2-122-sucursal-b1-00000000003',
} as const;

/** Instantes en el pasado y en orden. */
const T = (n: number) => new Date(Date.UTC(2026, 8, 1, 3, 0, 0) + n * 3_600_000).toISOString();

type Registro = Record<string, unknown>;

const P1: Registro = {
  origenSrId: 'P1',
  folio: 'POL-1',
  tipo: 'compra',
  tipoSr: 'E',
  almacenOrigenSrId: 'ALM1',
  fecha: T(0),
  referencia: 'OC-1',
  cancelada: false,
  partidas: [
    { insumoOrigenSrId: 'I1', cantidad: '10', costoUnitario: '20.00' },
    { insumoOrigenSrId: 'I2', cantidad: '5.5', costoUnitario: '3.333' },
    { insumoOrigenSrId: 'I3', cantidad: '1', costoUnitario: '1' },
  ],
};
const P2: Registro = {
  origenSrId: 'P2',
  folio: 'POL-2',
  tipo: 'consumo',
  almacenOrigenSrId: 'ALM1',
  fecha: T(1),
  referencia: null,
  cancelada: false,
  partidas: [{ insumoOrigenSrId: 'I1', cantidad: '-2.5', costoUnitario: '20' }],
};

describe('Ingesta de movimientos (e2e, F2-122)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const lote = (key: string, leidoAt: string, polizas: unknown[], extra = {}) =>
    request(url)
      .post('/ingesta/movimientos')
      .set('X-Api-Key', key)
      .send({ leidoAt, polizas, ...extra });

  /** Todas las pólizas y partidas de una sucursal, todas las columnas, como JSON. */
  async function base(sucursalId: string) {
    const w = { where: { sucursalId }, orderBy: { id: 'asc' as const } };
    return JSON.parse(
      JSON.stringify(
        await Promise.all([
          prisma.polizaInventario.findMany(w),
          prisma.movimientoInventario.findMany(w),
        ]),
      ),
    );
  }
  const poliza = (origen: string, sucursalId: string = FX.sucursalA1) =>
    prisma.polizaInventario.findFirstOrThrow({
      where: { sucursalId, origenSrId: origen },
      include: { movimientos: { orderBy: { renglon: 'asc' } } },
    });
  const partidas = async (origen: string, sucursalId: string = FX.sucursalA1) =>
    (await poliza(origen, sucursalId)).movimientos.map((m) => [
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

  it('el primer lote crea las pólizas con sus partidas e importes calculados por el API', async () => {
    const r = await lote(KEYS.a1, T(2), [P1, P2]);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      recibidas: 2,
      creadas: 2,
      actualizadas: 0,
      sinCambios: 0,
      obsoletas: 0,
      rechazadas: [],
    });
    const p1 = await poliza('P1');
    expect(p1).toMatchObject({
      empresaId: FX.empresaA,
      sucursalId: FX.sucursalA1,
      folio: 'POL-1',
      tipo: 'compra',
      tipoSr: 'E',
      almacenOrigenSrId: 'ALM1',
      referencia: 'OC-1',
      cancelada: false,
      partidas: 3,
    });
    expect(p1.leidaAt.toISOString()).toBe(T(2));
    // 3.333 → 3.33; 5.5 × 3.33 = 18.315 → 18.32 (mitad lejos de cero).
    expect(await partidas('P1')).toEqual([
      [0, 'I1', '10.000', '20.00', '200.00'],
      [1, 'I2', '5.500', '3.33', '18.32'],
      [2, 'I3', '1.000', '1.00', '1.00'],
    ]);
    // La partida copia almacén y fecha de su póliza, y el tenant de la key.
    expect(p1.movimientos.every((m) => m.almacenOrigenSrId === 'ALM1')).toBe(true);
    expect(p1.movimientos.every((m) => m.fecha.toISOString() === T(0))).toBe(true);
    expect(p1.movimientos.every((m) => m.empresaId === FX.empresaA)).toBe(true);
  });

  it('idempotencia: el mismo lote tres veces deja la base EXACTAMENTE igual', async () => {
    const antes = await base(FX.sucursalA1);
    for (let i = 0; i < 3; i++) {
      const r = await lote(KEYS.a1, T(2), [P1, P2]);
      expect(r.body).toMatchObject({ creadas: 0, actualizadas: 0, sinCambios: 2, obsoletas: 0 });
    }
    expect(await base(FX.sucursalA1)).toEqual(antes);
  });

  it('una corrección con MENOS partidas las reemplaza: ni duplica ni deja renglones viejos', async () => {
    const corregida = {
      ...P1,
      partidas: [
        { insumoOrigenSrId: 'I1', cantidad: '9', costoUnitario: '20' },
        { insumoOrigenSrId: 'I2', cantidad: '5.5', costoUnitario: '3.33' },
      ],
    };
    const antes = await poliza('P1');
    const r = await lote(KEYS.a1, T(3), [corregida]);
    expect(r.body).toMatchObject({ actualizadas: 1, creadas: 0 });
    const despues = await poliza('P1');
    expect(despues.id).toBe(antes.id);
    expect(despues.partidas).toBe(2);
    expect(await partidas('P1')).toEqual([
      [0, 'I1', '9.000', '20.00', '180.00'],
      [1, 'I2', '5.500', '3.33', '18.32'],
    ]);
    expect(await prisma.movimientoInventario.count({ where: { polizaId: antes.id } })).toBe(2);
    expect(despues.leidaAt.toISOString()).toBe(T(3));
  });

  it('un lote VIEJO que llega después no revierte la corrección (obsoleta, sin error)', async () => {
    const antes = await base(FX.sucursalA1);
    const r = await lote(KEYS.a1, T(2), [P1]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ obsoletas: 1, actualizadas: 0, creadas: 0, sinCambios: 0 });
    expect(await base(FX.sucursalA1)).toEqual(antes);
  });

  it('la misma póliza leída más tarde sin cambios sólo avanza leida_at', async () => {
    const antes = await poliza('P2');
    const r = await lote(KEYS.a1, T(4), [P2]);
    expect(r.body).toMatchObject({ sinCambios: 1 });
    const despues = await poliza('P2');
    expect(despues.leidaAt.toISOString()).toBe(T(4));
    expect(despues.updatedAt.toISOString()).toBe(antes.updatedAt.toISOString());
    expect(despues.recibidaAt.toISOString()).toBe(antes.recibidaAt.toISOString());
  });

  it('cancelarla la marca, conserva sus partidas y no la borra', async () => {
    const r = await lote(KEYS.a1, T(5), [{ ...P2, cancelada: true }]);
    expect(r.body).toMatchObject({ actualizadas: 1 });
    const p2 = await poliza('P2');
    expect([p2.cancelada, p2.movimientos.length]).toEqual([true, 1]);
  });

  it('la misma origenSrId en otra sucursal es otra póliza; nada cruza de sucursal', async () => {
    const r = await lote(KEYS.a2, T(2), [P1]);
    expect(r.body).toMatchObject({ creadas: 1 });
    const a2 = await poliza('P1', FX.sucursalA2);
    expect(a2.empresaId).toBe(FX.empresaA);
    expect(await partidas('P1', FX.sucursalA2)).toHaveLength(3);
    // La de A1 sigue corregida con 2.
    expect(await partidas('P1')).toHaveLength(2);
    const b = await lote(KEYS.b1, T(2), [P1]);
    expect(b.body).toMatchObject({ creadas: 1 });
    expect((await poliza('P1', FX.sucursalB1)).empresaId).toBe(FX.empresaB);
  });

  it('una póliza inválida entre N se rechaza sola, sin el valor; las demás entran', async () => {
    const mala = {
      ...P2,
      origenSrId: 'P9',
      partidas: [{ insumoOrigenSrId: 'I1', cantidad: 'secreto-123', costoUnitario: '1' }],
    };
    const conTenant = { ...P2, origenSrId: 'P8', sucursalId: FX.sucursalB1 };
    const buena = { ...P2, origenSrId: 'P7', folio: 'POL-7' };
    const r = await lote(KEYS.a1, T(6), [mala, buena, conTenant]);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ recibidas: 3, creadas: 1 });
    expect(r.body.rechazadas.map((x: Registro) => [x.indice, x.origenSrId])).toEqual([
      [0, 'P9'],
      [2, 'P8'],
    ]);
    expect(JSON.stringify(r.body)).not.toContain('secreto-123');
    expect(
      await prisma.polizaInventario.count({
        where: { sucursalId: FX.sucursalA1, origenSrId: { in: ['P8', 'P9'] } },
      }),
    ).toBe(0);
    expect(await prisma.polizaInventario.count({ where: { sucursalId: FX.sucursalB1 } })).toBe(1);
  });

  it('sobre inválido = 400 sin escribir (vacío, sin zona, futuro, campo de más, > 5000 partidas)', async () => {
    const antes = await base(FX.sucursalA1);
    const futuro = new Date(Date.now() + 10 * 60_000).toISOString();
    const muchas = {
      ...P2,
      origenSrId: 'GRANDE',
      partidas: Array.from({ length: 5001 }, () => ({
        insumoOrigenSrId: 'I1',
        cantidad: '1',
        costoUnitario: '1',
      })),
    };
    const mitad = (origen: string) => ({
      ...muchas,
      origenSrId: origen,
      partidas: muchas.partidas.slice(0, 2501),
    });
    for (const [leido, polizas, extra] of [
      [T(7), [], {}],
      ['2026-09-01T03:00:00', [P1], {}],
      [futuro, [P1], {}],
      [T(7), [P1], { sucursalId: FX.sucursalB1 }],
      [T(7), [muchas], {}],
      // 2 × 2501: cada póliza cabe sola, el LOTE no (el tope es de la suma).
      [T(7), [mitad('M1'), mitad('M2')], {}],
      [T(7), ['no-objeto'], {}],
    ] as const) {
      const r = await lote(KEYS.a1, leido, [...polizas], extra);
      expect(r.status).toBe(400);
    }
    expect(await base(FX.sucursalA1)).toEqual(antes);
  });

  it('sin API key = 401', async () => {
    const r = await request(url)
      .post('/ingesta/movimientos')
      .send({ leidoAt: T(0), polizas: [P1] });
    expect(r.status).toBe(401);
  });
});
