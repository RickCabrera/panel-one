import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { configurarApp } from '../configurar-app';

// E2E de la ingesta de existencias (F2-121) sobre la app REAL contra Postgres REAL, con las
// fixtures sintéticas de F1-011 (A1 y A2 de la empresa A, B1 de la B). Keys sintéticas.
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const KEYS = {
  a1: 'msr_sintetica-existencias-F2-121-sucursal-a1-00000000001',
  a2: 'msr_sintetica-existencias-F2-121-sucursal-a2-00000000002',
  b1: 'msr_sintetica-existencias-F2-121-sucursal-b1-00000000003',
} as const;

/** Instantes de captura, todos en el pasado y en orden. */
const T = (n: number) => new Date(Date.UTC(2026, 8, 1, 3, 0, 0) + n * 3_600_000).toISOString();

type Registro = Record<string, unknown>;

describe('Ingesta de existencias (e2e, F2-121)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const foto = (key: string, almacen: string, t: string, registros: Registro[], extra = {}) =>
    request(url)
      .post('/ingesta/existencias')
      .set('X-Api-Key', key)
      .send({ almacenOrigenSrId: almacen, capturadoAt: t, registros, ...extra });

  /** Todas las filas y la lectura de una sucursal, todas las columnas, como JSON. */
  async function base(sucursalId: string) {
    const w = { where: { sucursalId }, orderBy: { id: 'asc' as const } };
    return JSON.parse(
      JSON.stringify(
        await Promise.all([prisma.existencia.findMany(w), prisma.lecturaExistencias.findMany(w)]),
      ),
    );
  }
  const fila = (almacen: string, insumo: string, sucursalId: string = FX.sucursalA1) =>
    prisma.existencia.findFirst({
      where: { sucursalId, almacenOrigenSrId: almacen, insumoOrigenSrId: insumo },
    });
  const lectura = (almacen: string) =>
    prisma.lecturaExistencias.findFirstOrThrow({
      where: { sucursalId: FX.sucursalA1, almacenOrigenSrId: almacen },
    });

  const INICIAL: Registro[] = [
    { insumoOrigenSrId: 'I1', cantidad: '10.000', costoPromedio: '20.00' },
    // 3.333 → 3.33; 5.5 × 3.33 = 18.315 → 18.32 (mitad lejos de cero).
    { insumoOrigenSrId: 'I2', cantidad: '5.5', costoPromedio: '3.333' },
    { insumoOrigenSrId: 'I3', cantidad: '0', costoPromedio: '1' },
  ];

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

  describe('línea de tiempo del almacén ALM1 de A1', () => {
    it('la primera foto crea las filas con el valor calculado por el API', async () => {
      const r = await foto(KEYS.a1, 'ALM1', T(1), INICIAL);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        aplicado: true,
        recibidos: 3,
        creados: 3,
        actualizados: 0,
        sinCambios: 0,
        borrados: 0,
        conservados: 0,
        ausentesConservados: false,
        rechazados: [],
      });
      const i2 = await fila('ALM1', 'I2');
      expect(i2).toMatchObject({ empresaId: FX.empresaA, sucursalId: FX.sucursalA1 });
      expect(i2!.cantidad.toFixed(3)).toBe('5.500');
      expect(i2!.costoPromedio.toFixed(2)).toBe('3.33');
      expect(i2!.valor.toFixed(2)).toBe('18.32');
      expect((await lectura('ALM1')).filas).toBe(3);
    });

    it('idempotencia: la misma foto tres veces deja la base EXACTAMENTE igual', async () => {
      const antes = await base(FX.sucursalA1);
      for (let i = 0; i < 3; i++) {
        const r = await foto(KEYS.a1, 'ALM1', T(1), INICIAL);
        expect(r.body).toMatchObject({
          aplicado: true,
          creados: 0,
          actualizados: 0,
          sinCambios: 3,
        });
      }
      expect(await base(FX.sucursalA1)).toEqual(antes);
    });

    it('mismo capturadoAt con otro contenido: gana la que llega después', async () => {
      const i1 = await fila('ALM1', 'I1');
      const i2 = await fila('ALM1', 'I2');
      const l = await lectura('ALM1');
      const r = await foto(KEYS.a1, 'ALM1', T(1), [
        { insumoOrigenSrId: 'I1', cantidad: '8', costoPromedio: '20' },
        INICIAL[1],
        INICIAL[2],
      ]);
      expect(r.body).toMatchObject({ aplicado: true, actualizados: 1, sinCambios: 2 });
      const nuevo = await fila('ALM1', 'I1');
      expect(nuevo!.id).toBe(i1!.id);
      expect(nuevo!.cantidad.toFixed(3)).toBe('8.000');
      expect(nuevo!.valor.toFixed(2)).toBe('160.00');
      expect(nuevo!.updatedAt.getTime()).toBeGreaterThan(i1!.updatedAt.getTime());
      expect(await fila('ALM1', 'I2')).toEqual(i2);
      expect((await lectura('ALM1')).recibidaAt.getTime()).toBeGreaterThan(l.recibidaAt.getTime());
    });

    it('una foto más vieja que la última aplicada no escribe nada', async () => {
      const antes = await base(FX.sucursalA1);
      const r = await foto(KEYS.a1, 'ALM1', T(0), [
        { insumoOrigenSrId: 'I1', cantidad: '999', costoPromedio: '1' },
      ]);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ aplicado: false, creados: 0, borrados: 0 });
      expect(await base(FX.sucursalA1)).toEqual(antes);
    });

    it('lo que ya no viene en la foto se borra; lo demás queda con su id', async () => {
      const i1 = await fila('ALM1', 'I1');
      const r = await foto(KEYS.a1, 'ALM1', T(2), [
        { insumoOrigenSrId: 'I1', cantidad: '8.000', costoPromedio: '20.00' },
        INICIAL[1],
      ]);
      expect(r.body).toMatchObject({ aplicado: true, sinCambios: 2, borrados: 1 });
      expect(await fila('ALM1', 'I3')).toBeNull();
      expect(await fila('ALM1', 'I1')).toEqual(i1);
      const l = await lectura('ALM1');
      expect(l.capturadoAt.toISOString()).toBe(T(2));
      expect(l.filas).toBe(2);
    });

    it('1 inválido entre N: el resto se aplica y la fila previa del inválido sigue igual', async () => {
      const i1 = await fila('ALM1', 'I1');
      const r = await foto(KEYS.a1, 'ALM1', T(3), [
        { insumoOrigenSrId: 'I1', cantidad: 'abc-secreto', costoPromedio: '20' },
        { insumoOrigenSrId: 'I2', cantidad: '4', costoPromedio: '3.33' },
        { insumoOrigenSrId: 'I4', cantidad: '1.25', costoPromedio: '100' },
      ]);
      expect(r.body).toMatchObject({
        aplicado: true,
        creados: 1,
        actualizados: 1,
        borrados: 0,
        conservados: 1,
        ausentesConservados: false,
      });
      expect(r.body.rechazados).toHaveLength(1);
      expect(r.body.rechazados[0]).toMatchObject({
        indice: 0,
        insumoOrigenSrId: 'I1',
        reintentable: false,
      });
      expect(r.body.rechazados[0].motivo).toContain('registros.0.cantidad');
      expect(r.body.rechazados[0].motivo).not.toContain('abc-secreto');
      expect(await fila('ALM1', 'I1')).toEqual(i1);
      expect((await fila('ALM1', 'I2'))!.valor.toFixed(2)).toBe('13.32');
      expect((await fila('ALM1', 'I4'))!.valor.toFixed(2)).toBe('125.00');
    });

    it('un rechazo sin insumo identificable: no se borra ningún ausente', async () => {
      const antes = await base(FX.sucursalA1);
      const r = await foto(KEYS.a1, 'ALM1', T(4), [
        { cantidad: '1', costoPromedio: '1' },
        { insumoOrigenSrId: 'I1', cantidad: '8.000', costoPromedio: '20.00' },
      ]);
      expect(r.body).toMatchObject({
        aplicado: true,
        sinCambios: 1,
        borrados: 0,
        ausentesConservados: true,
      });
      expect(r.body.rechazados[0]).toMatchObject({ indice: 0, insumoOrigenSrId: null });
      // I2 e I4 no vinieron y siguen ahí; sólo se movió la lectura.
      const [filas] = await base(FX.sucursalA1);
      expect(filas).toEqual(antes[0]);
      expect((await lectura('ALM1')).capturadoAt.toISOString()).toBe(T(4));
    });

    it('un registro con empresaId/sucursalId se rechaza solo; la fila y su tenant no cambian', async () => {
      const i2 = await fila('ALM1', 'I2');
      const r = await foto(KEYS.a1, 'ALM1', T(5), [
        {
          insumoOrigenSrId: 'I2',
          cantidad: '1',
          costoPromedio: '1',
          empresaId: FX.empresaB,
          sucursalId: FX.sucursalB1,
        },
        { insumoOrigenSrId: 'I1', cantidad: '8.000', costoPromedio: '20.00' },
        { insumoOrigenSrId: 'I4', cantidad: '1.25', costoPromedio: '100' },
      ]);
      expect(r.status).toBe(200);
      expect(r.body.rechazados).toHaveLength(1);
      expect(r.body.rechazados[0]).toMatchObject({ indice: 0, insumoOrigenSrId: 'I2' });
      expect(r.body.rechazados[0].motivo).toContain('empresaId');
      expect(r.body.rechazados[0].motivo).toContain('sucursalId');
      expect(r.body).toMatchObject({ conservados: 1, borrados: 0 });
      expect(await fila('ALM1', 'I2')).toEqual(i2);
      expect(await prisma.existencia.count({ where: { sucursalId: FX.sucursalB1 } })).toBe(0);
    });

    it('valor que no cabe en NUMERIC(12,2) y un insumo repetido: rechazados, sin 500', async () => {
      const r = await foto(KEYS.a1, 'ALM1', T(6), [
        { insumoOrigenSrId: 'I1', cantidad: '999999999.000', costoPromedio: '9999999.00' },
        { insumoOrigenSrId: 'I2', cantidad: '1', costoPromedio: '1' },
        { insumoOrigenSrId: 'I2', cantidad: '2', costoPromedio: '1' },
        { insumoOrigenSrId: 'I4', cantidad: '1.25', costoPromedio: '100' },
      ]);
      expect(r.status).toBe(200);
      expect(r.body.rechazados.map((x: { indice: number }) => x.indice)).toEqual([0, 1, 2]);
      expect(r.body.rechazados[0].motivo).toContain('no cabe en NUMERIC(12,2)');
      expect(r.body.rechazados[1].motivo).toContain('repetido');
      expect(r.body).toMatchObject({ conservados: 2, borrados: 0, sinCambios: 1 });
    });

    it('0 registros: el almacén queda vacío', async () => {
      const r = await foto(KEYS.a1, 'ALM1', T(7), []);
      expect(r.body).toMatchObject({ aplicado: true, borrados: 3 });
      expect(
        await prisma.existencia.count({
          where: { sucursalId: FX.sucursalA1, almacenOrigenSrId: 'ALM1' },
        }),
      ).toBe(0);
      expect((await lectura('ALM1')).filas).toBe(0);
    });
  });

  describe('aislamiento y sobre', () => {
    it('otra sucursal con el mismo almacén no toca a A1; cada almacén es independiente', async () => {
      await foto(KEYS.a1, 'ALM2', T(1), [INICIAL[0]]);
      const antes = await base(FX.sucursalA1);
      const r = await foto(KEYS.a2, 'ALM2', T(9), [
        { insumoOrigenSrId: 'I1', cantidad: '1', costoPromedio: '1' },
      ]);
      expect(r.body).toMatchObject({ aplicado: true, creados: 1 });
      expect(await base(FX.sucursalA1)).toEqual(antes);
      expect(await fila('ALM2', 'I1', FX.sucursalA2)).toMatchObject({ empresaId: FX.empresaA });
      await foto(KEYS.b1, 'ALM2', T(9), [INICIAL[0]]);
      expect(await fila('ALM2', 'I1', FX.sucursalB1)).toMatchObject({ empresaId: FX.empresaB });
      expect(await base(FX.sucursalA1)).toEqual(antes);
    });

    it('sobre inválido = 400 sin escribir nada', async () => {
      const antes = await base(FX.sucursalA1);
      const futuro = new Date(Date.now() + 10 * 60_000).toISOString();
      const casos = [
        foto(KEYS.a1, 'ALM3', T(1), [INICIAL[0]], { sucursalId: FX.sucursalB1 }),
        foto(KEYS.a1, 'ALM3', T(1), [INICIAL[0]], { empresaId: FX.empresaB }),
        foto(KEYS.a1, 'ALM3', futuro, [INICIAL[0]]),
        foto(KEYS.a1, 'ALM3', '2026-09-01T03:00:00', [INICIAL[0]]),
        foto(KEYS.a1, '', T(1), [INICIAL[0]]),
        foto(KEYS.a1, 'x'.repeat(65), T(1), [INICIAL[0]]),
        foto(KEYS.a1, 'ALM3', T(1), ['no-objeto'] as unknown as Registro[]),
        foto(
          KEYS.a1,
          'ALM3',
          T(1),
          Array.from({ length: 5001 }, (_, i) => ({
            insumoOrigenSrId: `X${i}`,
            cantidad: '1',
            costoPromedio: '1',
          })),
        ),
      ];
      for (const c of casos) {
        expect((await c).status).toBe(400);
      }
      expect(await base(FX.sucursalA1)).toEqual(antes);
    });

    it('sin API key = 401', async () => {
      const r = await request(url)
        .post('/ingesta/existencias')
        .send({ almacenOrigenSrId: 'ALM1', capturadoAt: T(1), registros: [] });
      expect(r.status).toBe(401);
    });
  });
});
