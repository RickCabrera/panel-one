import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, TipoAlerta } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AlertasService } from '../alertas/alertas.service';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';

// E2E de la vista de Existencias (F2-121) sobre la app REAL contra Postgres REAL, con las
// fixtures sintéticas de F1-011. Los importes esperados están ESCRITOS A MANO: no se recalculan
// con la fórmula del API (si la fórmula cambia, esto falla).
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const KEYS = {
  a1: 'msr_sintetica-existencias-panel-F2-121-sucursal-a1-000001',
  a2: 'msr_sintetica-existencias-panel-F2-121-sucursal-a2-000002',
  b1: 'msr_sintetica-existencias-panel-F2-121-sucursal-b1-000003',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];
type Registro = Record<string, unknown>;

/** Instantes de captura en el pasado reciente (la lectura no debe salir atrasada). */
const BASE = Date.now() - 60 * 60_000;
const T = (n: number) => new Date(BASE + n * 60_000).toISOString();
const sinc = (n: number) => `f2121000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/**
 * A1 · ALM1: I1 0.125 × 1.00 = 0.13 (mitad lejos de cero) · I2 −2 × 10.50 = −21.00 ·
 * I3 3.5 × 2.3333→2.33 = 8.155 → 8.16. A1 · ALM2: I1 10 × 12.345→12.35 = 123.50.
 * Total A1 = 0.13 − 21.00 + 8.16 + 123.50 = 110.79. A2 · ALM9: I1 5 × 1 = 5.00.
 */
const ALM1: Registro[] = [
  { insumoOrigenSrId: 'I1', cantidad: '0.125', costoPromedio: '1.00' },
  { insumoOrigenSrId: 'I2', cantidad: '-2', costoPromedio: '10.50' },
  { insumoOrigenSrId: 'I3', cantidad: '3.5', costoPromedio: '2.3333' },
];
const ALM2: Registro[] = [{ insumoOrigenSrId: 'I1', cantidad: '10', costoPromedio: '12.345' }];
const TOTAL_A1 = '110.79';
const TOTAL_A = '115.79';

describe('Existencias (e2e, F2-121)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const get = async (u: Usuario, query: Record<string, string>) =>
    request(url)
      .get('/inventario/existencias')
      .query(query)
      .set('Authorization', `Bearer ${await token(u)}`);
  const put = async (u: Usuario, body: Registro) =>
    request(url)
      .put('/inventario/existencias/limites')
      .set('Authorization', `Bearer ${await token(u)}`)
      .send(body);
  const foto = (key: string, almacen: string, t: string, registros: Registro[]) =>
    request(url)
      .post('/ingesta/existencias')
      .set('X-Api-Key', key)
      .send({ almacenOrigenSrId: almacen, capturadoAt: t, registros });
  const catalogo = (key: string, cat: string, n: number, registros: Registro[]) =>
    request(url)
      .post('/ingesta/catalogos')
      .set('X-Api-Key', key)
      .send({ catalogo: cat, sincronizacionId: sinc(n), capturadoAt: T(0), registros });
  const limite = (
    insumo: string,
    minimo: string | null,
    maximo: string | null,
    almacen = 'ALM1',
  ) => ({
    empresaId: FX.empresaA,
    sucursalId: FX.sucursalA1,
    almacenOrigenSrId: almacen,
    insumoOrigenSrId: insumo,
    minimo,
    maximo,
  });
  const deA1 = { empresaId: FX.empresaA, sucursalId: FX.sucursalA1 };
  const filaDe = (
    body: { filas: Array<Record<string, unknown>> },
    almacen: string,
    insumo: string,
  ) => body.filas.find((f) => f.almacenOrigenSrId === almacen && f.insumoOrigenSrId === insumo);

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

    // Catálogos de A1 (nombres) y fotos de A1, A2 y B1.
    expect(
      (await catalogo(KEYS.a1, 'unidades', 1, [{ origenSrId: 'KG', nombre: 'Kilogramo' }])).status,
    ).toBe(200);
    await catalogo(KEYS.a1, 'insumos', 2, [
      { origenSrId: 'I1', clave: 'LEC', nombre: 'Leche entera', unidadOrigenSrId: 'KG' },
      { origenSrId: 'I2', clave: 'AZU', nombre: 'Azúcar' },
      { origenSrId: 'I3', clave: 'TOM', nombre: 'Tomate' },
    ]);
    await catalogo(KEYS.a1, 'almacenes', 3, [
      { origenSrId: 'ALM1', nombre: 'General' },
      { origenSrId: 'ALM2', nombre: 'Barra' },
      { origenSrId: 'ALM3', nombre: 'Bodega sin lectura' },
    ]);
    // Un insumo I1 de OTRA sucursal con otro nombre: no debe resolverse en A1.
    await catalogo(KEYS.a2, 'insumos', 4, [{ origenSrId: 'I1', nombre: 'Otro nombre en A2' }]);
    expect((await foto(KEYS.a1, 'ALM1', T(1), ALM1)).body.rechazados).toEqual([]);
    expect((await foto(KEYS.a1, 'ALM2', T(1), ALM2)).body.rechazados).toEqual([]);
    await foto(KEYS.a2, 'ALM9', T(1), [
      { insumoOrigenSrId: 'I1', cantidad: '5', costoPromedio: '1' },
    ]);
    await foto(KEYS.b1, 'ALM1', T(1), [
      { insumoOrigenSrId: 'I1', cantidad: '7', costoPromedio: '7' },
    ]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('lectura', () => {
    it('valor total cuadra con los literales calculados a mano (sucursal y empresa)', async () => {
      const r = await get(USUARIOS.visorA, deA1);
      expect(r.status).toBe(200);
      expect(r.body.kpis).toEqual({
        articulos: 4,
        valor: TOTAL_A1,
        atencion: 0,
        sinExistencia: 1,
        sobreMaximo: 0,
        sinLectura: 0,
      });
      const toda = await get(USUARIOS.visorA, { empresaId: FX.empresaA });
      expect(toda.body.kpis.valor).toBe(TOTAL_A);
      expect(toda.body.kpis.articulos).toBe(5);
      // Nada de B1.
      expect(
        toda.body.filas.every((f: { sucursalId: string }) => f.sucursalId !== FX.sucursalB1),
      ).toBe(true);
    });

    it('fila completa: nombres de SU sucursal, unidad, dinero como texto', async () => {
      const r = await get(USUARIOS.visorA, { empresaId: FX.empresaA });
      expect(filaDe(r.body, 'ALM2', 'I1')).toEqual({
        sucursalId: FX.sucursalA1,
        sucursal: expect.any(String),
        almacenOrigenSrId: 'ALM2',
        almacen: 'Barra',
        insumoOrigenSrId: 'I1',
        insumo: 'Leche entera',
        clave: 'LEC',
        unidad: 'Kilogramo',
        cantidad: '10.000',
        costoPromedio: '12.35',
        valor: '123.50',
        minimo: null,
        maximo: null,
        estado: 'sin_limites',
      });
      const a2 = r.body.filas.find((f: { sucursalId: string }) => f.sucursalId === FX.sucursalA2);
      expect(a2).toMatchObject({ insumo: 'Otro nombre en A2', almacen: null, valor: '5.00' });
      expect(filaDe(r.body, 'ALM1', 'I2')).toMatchObject({
        valor: '-21.00',
        estado: 'sin_existencia',
      });
    });

    it('almacenes con su lectura (y los del catálogo sin lectura); sucursales con almacenes leídos', async () => {
      const r = await get(USUARIOS.visorA, { empresaId: FX.empresaA });
      const alm = (s: string, a: string) =>
        r.body.almacenes.find(
          (x: { sucursalId: string; almacenOrigenSrId: string }) =>
            x.sucursalId === s && x.almacenOrigenSrId === a,
        );
      expect(alm(FX.sucursalA1, 'ALM1')).toMatchObject({
        almacen: 'General',
        capturadoAt: T(1),
        atrasada: false,
      });
      expect(alm(FX.sucursalA1, 'ALM3')).toMatchObject({
        capturadoAt: null,
        recibidaAt: null,
        atrasada: false,
      });
      const s = (id: string) =>
        r.body.sucursales.find((x: { sucursalId: string }) => x.sucursalId === id);
      expect(s(FX.sucursalA1)).toMatchObject({
        almacenesLeidos: 2,
        zonaHoraria: expect.any(String),
      });
      expect(s(FX.sucursalA2).almacenesLeidos).toBe(1);
    });

    it('filtro por almacén (exige sucursal) y búsqueda por nombre, clave u origen', async () => {
      const r = await get(USUARIOS.visorA, { ...deA1, almacenOrigenSrId: 'ALM2' });
      expect(r.body.kpis.valor).toBe('123.50');
      expect(
        (await get(USUARIOS.visorA, { empresaId: FX.empresaA, almacenOrigenSrId: 'ALM2' })).status,
      ).toBe(400);
      const q = await get(USUARIOS.visorA, { ...deA1, q: 'TOMA' });
      expect(q.body.filas.map((f: { insumoOrigenSrId: string }) => f.insumoOrigenSrId)).toEqual([
        'I3',
      ]);
      const c = await get(USUARIOS.visorA, { ...deA1, q: 'azu' });
      expect(c.body.filas).toHaveLength(1);
    });

    it('lectura recibida hace más de 90 min = atrasada', async () => {
      await prisma.lecturaExistencias.updateMany({
        where: { sucursalId: FX.sucursalA1, almacenOrigenSrId: 'ALM2' },
        data: { recibidaAt: new Date(Date.now() - 91 * 60_000) },
      });
      const r = await get(USUARIOS.visorA, deA1);
      const alm2 = r.body.almacenes.find(
        (x: { almacenOrigenSrId: string }) => x.almacenOrigenSrId === 'ALM2',
      );
      expect(alm2.atrasada).toBe(true);
    });
  });

  describe('límites y "atención requerida"', () => {
    it('AC: artículo bajo mínimo aparece en atención requerida', async () => {
      const r = await put(USUARIOS.adminEmpresaA, limite('I3', '5', '20'));
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        insumoOrigenSrId: 'I3',
        minimo: '5.000',
        maximo: '20.000',
        estado: 'bajo_minimo',
      });
      expect((await put(USUARIOS.adminGlobal, limite('I1', null, '5', 'ALM2'))).status).toBe(200);
      const l = await get(USUARIOS.visorA, deA1);
      expect(l.body.kpis).toMatchObject({ atencion: 1, sobreMaximo: 1, sinExistencia: 1 });
      expect(filaDe(l.body, 'ALM2', 'I1')).toMatchObject({ estado: 'sobre_maximo' });
    });

    it('la alerta bajo_minimo se abre y se cierra al subir la existencia', async () => {
      const servicio = app.get(AlertasService);
      await servicio.evaluarEmpresa(FX.empresaA);
      const abierta = await prisma.alerta.findFirstOrThrow({
        where: { empresaId: FX.empresaA, tipo: TipoAlerta.bajo_minimo, cerradaAt: null },
      });
      expect(abierta).toMatchObject({
        sucursalId: FX.sucursalA1,
        llave: '["ALM1","I3"]',
        umbral: 100,
      });
      expect(abierta.detalle).toMatchObject({
        nombre: 'Tomate',
        cantidad: '3.500',
        minimo: '5.000',
      });
      await foto(KEYS.a1, 'ALM1', T(2), [ALM1[0], ALM1[1], { ...ALM1[2], cantidad: '6' }]);
      await servicio.evaluarEmpresa(FX.empresaA);
      const cerrada = await prisma.alerta.findUniqueOrThrow({ where: { id: abierta.id } });
      expect(cerrada.cerradaAt).not.toBeNull();
      expect(cerrada.motivoCierre).toBe('condicion');
      // Vuelve a bajar para lo que sigue.
      await foto(KEYS.a1, 'ALM1', T(3), ALM1);
    });

    it('los límites sobreviven a una foto nueva (la ingesta no los toca)', async () => {
      await foto(KEYS.a1, 'ALM1', T(4), ALM1);
      const r = await get(USUARIOS.visorA, deA1);
      expect(filaDe(r.body, 'ALM1', 'I3')).toMatchObject({ minimo: '5.000', maximo: '20.000' });
    });

    it('el artículo sale de la foto: sigue visible "sin lectura" y su alerta no se cierra', async () => {
      const servicio = app.get(AlertasService);
      await servicio.evaluarEmpresa(FX.empresaA);
      const abierta = await prisma.alerta.findFirstOrThrow({
        where: { empresaId: FX.empresaA, tipo: TipoAlerta.bajo_minimo, cerradaAt: null },
      });
      await foto(KEYS.a1, 'ALM1', T(5), [ALM1[0], ALM1[1]]);
      const r = await get(USUARIOS.visorA, deA1);
      expect(filaDe(r.body, 'ALM1', 'I3')).toMatchObject({
        cantidad: null,
        valor: null,
        minimo: '5.000',
        estado: 'sin_lectura',
      });
      expect(r.body.kpis).toMatchObject({ sinLectura: 1, atencion: 0, valor: '102.63' });
      await servicio.evaluarEmpresa(FX.empresaA);
      expect(
        (await prisma.alerta.findUniqueOrThrow({ where: { id: abierta.id } })).cerradaAt,
      ).toBeNull();
    });

    it('un límite "sin lectura" se edita (200) y se borra (200); luego ya no hay artículo = 404', async () => {
      const e = await put(USUARIOS.adminEmpresaA, limite('I3', '2', null));
      expect(e.status).toBe(200);
      expect(e.body).toMatchObject({ minimo: '2.000', maximo: null, estado: 'sin_lectura' });
      const b = await put(USUARIOS.adminEmpresaA, limite('I3', null, null));
      expect(b.status).toBe(200);
      expect(
        await prisma.limiteExistencia.count({
          where: { sucursalId: FX.sucursalA1, insumoOrigenSrId: 'I3' },
        }),
      ).toBe(0);
      expect(filaDe((await get(USUARIOS.visorA, deA1)).body, 'ALM1', 'I3')).toBeUndefined();
      expect((await put(USUARIOS.adminEmpresaA, limite('I3', '1', null))).status).toBe(404);
    });

    it('mínimo mayor que máximo, o cantidad con signo = 400', async () => {
      expect((await put(USUARIOS.adminEmpresaA, limite('I1', '5', '4'))).status).toBe(400);
      expect((await put(USUARIOS.adminEmpresaA, limite('I1', '-1', null))).status).toBe(400);
    });
  });

  describe('scope y roles', () => {
    it('visor no edita: 403 por rol, sin escribir', async () => {
      const antes = await prisma.limiteExistencia.count({ where: { empresaId: FX.empresaA } });
      expect((await put(USUARIOS.visorA, limite('I1', '1', null))).status).toBe(403);
      expect(await prisma.limiteExistencia.count({ where: { empresaId: FX.empresaA } })).toBe(
        antes,
      );
    });

    it('fuera de alcance = el MISMO 404 (empresa ajena, inexistente, sucursal de otra empresa)', async () => {
      const respuestas = [
        await get(USUARIOS.visorB, { empresaId: FX.empresaA }),
        await get(USUARIOS.visorA, { empresaId: FX.inexistente }),
        await get(USUARIOS.adminEmpresaA, { empresaId: FX.empresaA, sucursalId: FX.sucursalB1 }),
        await get(USUARIOS.adminEmpresaA, { empresaId: FX.empresaB }),
      ];
      for (const r of respuestas) {
        expect(r.status).toBe(404);
        expect(r.body).toEqual(respuestas[0].body);
      }
    });

    it('PUT de otra empresa, sucursal ajena o artículo inexistente = el mismo 404, sin escribir', async () => {
      const antes = await prisma.limiteExistencia.count();
      const respuestas = [
        await put(USUARIOS.adminEmpresaA, {
          ...limite('I1', '1', null),
          empresaId: FX.empresaB,
          sucursalId: FX.sucursalB1,
        }),
        await put(USUARIOS.adminEmpresaA, {
          ...limite('I1', '1', null),
          sucursalId: FX.sucursalB1,
        }),
        await put(USUARIOS.adminEmpresaA, limite('NO-EXISTE', '1', null)),
        await put(USUARIOS.adminEmpresaA, limite('I1', '1', null, 'ALM-NO-EXISTE')),
      ];
      for (const r of respuestas) {
        expect(r.status).toBe(404);
        expect(r.body).toEqual(respuestas[0].body);
      }
      expect(await prisma.limiteExistencia.count()).toBe(antes);
      // admin_global sí puede con la empresa B.
      expect(
        (
          await put(USUARIOS.adminGlobal, {
            ...limite('I1', '1', null),
            empresaId: FX.empresaB,
            sucursalId: FX.sucursalB1,
          })
        ).status,
      ).toBe(200);
    });

    it('sin token = 401', async () => {
      expect((await request(url).get('/inventario/existencias').query(deA1)).status).toBe(401);
    });
  });
});
