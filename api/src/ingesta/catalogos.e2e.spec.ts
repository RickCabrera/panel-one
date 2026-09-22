import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, type CatalogoSr } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';

// E2E de los catálogos espejo (F2-230) sobre la app REAL contra Postgres REAL, con las
// fixtures sintéticas de F1-011 (A1 y A2 de la empresa A, B1 de la B). Keys sintéticas.
//
// Es una línea de tiempo por catálogo y sucursal: los `it` de un mismo `describe`
// comparten estado y van en orden. Córrelo completo.
//
// RATE LIMIT de agente: 120/min por sucursal y por app. A1 manda unas cuantas decenas.

const KEYS = {
  a1: 'msr_sintetica-catalogos-F2-230-sucursal-a1-00000000001',
  a2: 'msr_sintetica-catalogos-F2-230-sucursal-a2-00000000002',
  b1: 'msr_sintetica-catalogos-F2-230-sucursal-b1-00000000003',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];
type Registro = Record<string, unknown>;

/** Instantes de sincronización, todos en el pasado y en orden. */
const T = (n: number) => new Date(Date.UTC(2026, 8, 1, 3, 0, 0) + n * 86_400_000).toISOString();

/** Un uuid de sincronización legible: `sinc(1)` = …0001. */
const sinc = (n: number) => `f2230000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const PRODUCTOS: Registro[] = [
  { origenSrId: 'P1', clave: 'P1', nombre: 'Chilaquiles verdes', grupoOrigenSrId: 'G1' },
  {
    origenSrId: 'P2',
    clave: 'P2',
    nombre: 'Café de "olla"',
    grupoOrigenSrId: 'G2',
    activoPos: true,
  },
  { origenSrId: 'P3', clave: null, nombre: 'Pan de muerto (temporada)', grupoOrigenSrId: null },
];

describe('Catálogos espejo (e2e, F2-230)', () => {
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
  const put = async (ruta: string, u: Usuario, body: object) =>
    request(url)
      .put(ruta)
      .set('Authorization', `Bearer ${await token(u)}`)
      .send(body);
  const post = async (ruta: string, u: Usuario, body: object) =>
    request(url)
      .post(ruta)
      .set('Authorization', `Bearer ${await token(u)}`)
      .send(body);

  const pagina = (
    key: string,
    catalogo: CatalogoSr | string,
    n: number,
    t: string,
    registros: Registro[],
  ) =>
    request(url)
      .post('/ingesta/catalogos')
      .set('X-Api-Key', key)
      .send({ catalogo, sincronizacionId: sinc(n), capturadoAt: t, registros });
  const cierre = (
    key: string,
    catalogo: CatalogoSr | string,
    n: number,
    t: string,
    total: number,
    rechazados = 0,
  ) =>
    request(url)
      .post('/ingesta/catalogos/cierre')
      .set('X-Api-Key', key)
      .send({ catalogo, sincronizacionId: sinc(n), capturadoAt: t, total, rechazados });
  const solicitud = (key: string) =>
    request(url).get('/ingesta/catalogos/solicitud').set('X-Api-Key', key);

  /** TODO lo que los catálogos escriben de una sucursal, todas las columnas, como JSON. */
  async function foto(sucursalId: string) {
    const w = { where: { sucursalId }, orderBy: { id: 'asc' as const } };
    const [grupos, productos, meseros, clientes, areas, canales, estado, solicitudes] =
      await Promise.all([
        prisma.grupoProducto.findMany(w),
        prisma.producto.findMany({ ...w, include: { metadata: true } }),
        prisma.meseroCatalogo.findMany(w),
        prisma.clienteCatalogo.findMany(w),
        prisma.areaCatalogo.findMany(w),
        prisma.canalVentaCatalogo.findMany(w),
        prisma.sincronizacionCatalogo.findMany({
          where: { sucursalId },
          orderBy: { catalogo: 'asc' },
        }),
        prisma.solicitudSincronizacion.findMany({ where: { sucursalId } }),
      ]);
    return JSON.parse(
      JSON.stringify({ grupos, productos, meseros, clientes, areas, canales, estado, solicitudes }),
    );
  }

  const producto = (sucursalId: string, origenSrId: string) =>
    prisma.producto.findFirstOrThrow({ where: { sucursalId, origenSrId } });

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
    // Las fallas esperadas se loguean; aquí no ensucian la salida.
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

  describe('autenticación', () => {
    it('sin X-Api-Key → 401 y no escribe', async () => {
      const r = await request(url)
        .post('/ingesta/catalogos')
        .send({
          catalogo: 'productos',
          sincronizacionId: sinc(99),
          capturadoAt: T(0),
          registros: PRODUCTOS,
        });
      expect(r.status).toBe(401);
      expect(
        await prisma.producto.count({ where: { empresaId: { in: [FX.empresaA, FX.empresaB] } } }),
      ).toBe(0);
    });

    it('un Bearer de usuario (aunque sea admin_global) no abre la ruta de agente', async () => {
      const r = await post('/ingesta/catalogos/cierre', USUARIOS.adminGlobal, {
        catalogo: 'productos',
        sincronizacionId: sinc(99),
        capturadoAt: T(0),
        total: 0,
        rechazados: 0,
      });
      expect(r.status).toBe(401);
    });
  });

  describe('sobre inválido → 400 sin escribir', () => {
    it.each([
      ['catálogo desconocido', { catalogo: 'recetas' }],
      ['sincronización que no es uuid', { sincronizacionId: 'abc' }],
      ['fecha sin zona', { capturadoAt: '2026-09-01T03:00:00' }],
      [
        'fecha a más de 5 min en el futuro',
        { capturadoAt: new Date(Date.now() + 10 * 60_000).toISOString() },
      ],
      ['registros vacío', { registros: [] }],
      [
        'más de 1000 registros',
        {
          registros: Array.from({ length: 1001 }, (_, i) => ({ origenSrId: `X${i}`, nombre: 'x' })),
        },
      ],
      ['un registro que no es objeto', { registros: ['P1'] }],
      ['un campo de tenant en el sobre', { sucursalId: FX.sucursalB1 }],
    ])('%s', async (_n, cambio) => {
      const r = await request(url)
        .post('/ingesta/catalogos')
        .set('X-Api-Key', KEYS.a2)
        .send({
          catalogo: 'grupos',
          sincronizacionId: sinc(98),
          capturadoAt: T(0),
          registros: [{ origenSrId: 'G', nombre: 'g' }],
          ...cambio,
        });
      expect(r.status).toBe(400);
      expect(await prisma.grupoProducto.count({ where: { sucursalId: FX.sucursalA2 } })).toBe(0);
    });

    it('cierre con rechazados > total → 400', async () => {
      const r = await cierre(KEYS.a2, 'grupos', 98, T(0), 1, 2);
      expect(r.status).toBe(400);
    });
  });

  describe('productos de A1: idempotencia, renombre, baja, reactivación y metadata', () => {
    it('AC1: la misma página tres veces deja exactamente los mismos datos', async () => {
      const r1 = await pagina(KEYS.a1, 'productos', 1, T(1), PRODUCTOS);
      expect(r1.status).toBe(200);
      expect(r1.body).toMatchObject({
        recibidos: 3,
        creados: 3,
        actualizados: 0,
        sinCambios: 0,
        rechazados: [],
      });
      const antes = await foto(FX.sucursalA1);
      for (let i = 0; i < 2; i++) {
        const r = await pagina(KEYS.a1, 'productos', 1, T(1), PRODUCTOS);
        expect(r.body).toMatchObject({ creados: 0, actualizados: 0, sinCambios: 3 });
      }
      expect(await foto(FX.sucursalA1)).toEqual(antes);
      const p1 = await producto(FX.sucursalA1, 'P1');
      expect(p1).toMatchObject({
        empresaId: FX.empresaA,
        nombre: 'Chilaquiles verdes',
        clave: 'P1',
        grupoOrigenSrId: 'G1',
        activoPos: null,
        activo: true,
        vistoAt: new Date(T(1)),
        sincronizacionId: sinc(1),
      });
    });

    it('cierre, página otra vez y cierre otra vez: nada cambia', async () => {
      const c = await cierre(KEYS.a1, 'productos', 1, T(1), 3);
      expect(c.status).toBe(200);
      expect(c.body).toEqual({ aplicado: true, desactivados: 0, activos: 3 });
      const antes = await foto(FX.sucursalA1);
      expect((await pagina(KEYS.a1, 'productos', 1, T(1), PRODUCTOS)).body).toMatchObject({
        sinCambios: 3,
        obsoletos: 0,
      });
      expect((await cierre(KEYS.a1, 'productos', 1, T(1), 3)).body).toEqual({
        aplicado: true,
        desactivados: 0,
        activos: 3,
      });
      expect(await foto(FX.sucursalA1)).toEqual(antes);
    });

    it('AC2: renombrar actualiza la misma fila y no duplica; las demás conservan su updated_at', async () => {
      const antes = await prisma.producto.findMany({
        where: { sucursalId: FX.sucursalA1 },
        orderBy: { origenSrId: 'asc' },
      });
      const renombrados = [
        { ...PRODUCTOS[0], nombre: 'Chilaquiles rojos' },
        PRODUCTOS[1],
        PRODUCTOS[2],
      ];
      const r = await pagina(KEYS.a1, 'productos', 2, T(2), renombrados);
      expect(r.body).toMatchObject({ creados: 0, actualizados: 1, sinCambios: 2 });
      expect((await cierre(KEYS.a1, 'productos', 2, T(2), 3)).body).toMatchObject({
        aplicado: true,
        desactivados: 0,
      });
      const despues = await prisma.producto.findMany({
        where: { sucursalId: FX.sucursalA1 },
        orderBy: { origenSrId: 'asc' },
      });
      expect(despues).toHaveLength(3);
      expect(despues.map((p) => p.id)).toEqual(antes.map((p) => p.id));
      expect(despues[0].nombre).toBe('Chilaquiles rojos');
      expect(despues[0].updatedAt.getTime()).toBeGreaterThan(antes[0].updatedAt.getTime());
      expect(despues[0].hash).not.toBe(antes[0].hash);
      for (const i of [1, 2]) {
        expect(despues[i].updatedAt).toEqual(antes[i].updatedAt);
        expect(despues[i].hash).toBe(antes[i].hash);
        expect(despues[i].vistoAt).toEqual(new Date(T(2)));
      }
    });

    it('AC3: lo que desaparece de una sincronización completa queda inactivo con su visto_at, sin borrarse', async () => {
      const p3 = await producto(FX.sucursalA1, 'P3');
      const presentes = [{ ...PRODUCTOS[0], nombre: 'Chilaquiles rojos' }, PRODUCTOS[1]];
      expect((await pagina(KEYS.a1, 'productos', 3, T(3), presentes)).body).toMatchObject({
        sinCambios: 2,
      });
      const c = await cierre(KEYS.a1, 'productos', 3, T(3), 2);
      expect(c.body).toEqual({ aplicado: true, desactivados: 1, activos: 2 });
      const despues = await producto(FX.sucursalA1, 'P3');
      expect(despues).toMatchObject({
        id: p3.id,
        activo: false,
        vistoAt: new Date(T(2)),
        nombre: p3.nombre,
      });
      expect(despues.updatedAt.getTime()).toBeGreaterThan(p3.updatedAt.getTime());
      expect(await prisma.producto.count({ where: { sucursalId: FX.sucursalA1 } })).toBe(3);
    });

    it('lo que reaparece se reactiva en la misma fila', async () => {
      const todos = [{ ...PRODUCTOS[0], nombre: 'Chilaquiles rojos' }, PRODUCTOS[1], PRODUCTOS[2]];
      expect((await pagina(KEYS.a1, 'productos', 4, T(4), todos)).body).toMatchObject({
        actualizados: 1,
        sinCambios: 2,
      });
      expect((await cierre(KEYS.a1, 'productos', 4, T(4), 3)).body).toEqual({
        aplicado: true,
        desactivados: 0,
        activos: 3,
      });
      expect(await producto(FX.sucursalA1, 'P3')).toMatchObject({
        activo: true,
        vistoAt: new Date(T(4)),
      });
    });

    it('una página anterior a la última sincronización completa es obsoleta y no revierte nada', async () => {
      const antes = await foto(FX.sucursalA1);
      const r = await pagina(KEYS.a1, 'productos', 50, T(3), [
        { ...PRODUCTOS[0], nombre: 'Viejo' },
      ]);
      expect(r.body).toMatchObject({ obsoletos: 1, actualizados: 0, creados: 0 });
      expect((await cierre(KEYS.a1, 'productos', 50, T(3), 1)).body).toEqual({
        aplicado: false,
        desactivados: 0,
        activos: 3,
      });
      expect(await foto(FX.sucursalA1)).toEqual(antes);
    });

    it('AC4: la metadata propia sobrevive un re-sync completo con cambios y bajas', async () => {
      const p1 = await producto(FX.sucursalA1, 'P1');
      const meta = {
        empresaId: FX.empresaA,
        descripcion: 'Con salsa roja, crema y queso fresco.',
        fotoUrl: 'https://cdn.ejemplo.test/p1.jpg',
        etiquetas: ['desayuno', 'picante'],
        minimo: '2.5',
        maximo: '10',
      };
      const r = await put(`/catalogos/productos/${p1.id}/metadata`, USUARIOS.adminEmpresaA, meta);
      expect(r.status).toBe(200);
      expect(r.body.metadata).toMatchObject({
        descripcion: meta.descripcion,
        minimo: '2.500',
        maximo: '10.000',
      });
      const guardada = await prisma.productoMetadata.findUniqueOrThrow({
        where: { productoId: p1.id },
      });

      const cambiados = [
        { ...PRODUCTOS[0], nombre: 'Chilaquiles divorciados', activoPos: false },
        PRODUCTOS[2],
      ];
      expect((await pagina(KEYS.a1, 'productos', 5, T(5), cambiados)).body).toMatchObject({
        actualizados: 1,
      });
      expect((await cierre(KEYS.a1, 'productos', 5, T(5), 2)).body).toMatchObject({
        aplicado: true,
        desactivados: 1,
      });

      expect(
        await prisma.productoMetadata.findUniqueOrThrow({ where: { productoId: p1.id } }),
      ).toEqual(guardada);
      const detalle = await get(`/catalogos/productos/${p1.id}`, USUARIOS.visorA, {
        empresaId: FX.empresaA,
      });
      expect(detalle.status).toBe(200);
      expect(detalle.body).toMatchObject({
        nombre: 'Chilaquiles divorciados',
        activoPos: false,
        activo: true,
        tieneMetadata: true,
        metadata: { etiquetas: ['desayuno', 'picante'], fotoUrl: meta.fotoUrl },
      });
    });

    it('la metadata se valida: mínimo > máximo, URL sin https y 21 etiquetas → 400', async () => {
      const p1 = await producto(FX.sucursalA1, 'P1');
      const base = {
        empresaId: FX.empresaA,
        descripcion: null,
        fotoUrl: null,
        etiquetas: [],
        minimo: null,
        maximo: null,
      };
      for (const malo of [
        { minimo: '5', maximo: '1' },
        { fotoUrl: 'http://inseguro.test/x.jpg' },
        { etiquetas: Array.from({ length: 21 }, (_, i) => `e${i}`) },
        { minimo: '-1' },
      ]) {
        const r = await put(`/catalogos/productos/${p1.id}/metadata`, USUARIOS.adminEmpresaA, {
          ...base,
          ...malo,
        });
        expect(r.status).toBe(400);
      }
    });

    it('la lista de productos resuelve el grupo en SU sucursal y filtra por estado y texto', async () => {
      await pagina(KEYS.a1, 'grupos', 6, T(6), [
        { origenSrId: 'G1', clave: 'G1', nombre: 'Desayunos' },
      ]);
      const r = await get('/catalogos/productos', USUARIOS.visorA, {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
      });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ total: 3, pagina: 1, porPagina: 50 });
      const porOrigen = Object.fromEntries(
        (r.body.filas as Array<{ origenSrId: string }>).map((f) => [f.origenSrId, f]),
      );
      expect(porOrigen.P1).toMatchObject({
        grupo: 'Desayunos',
        tieneMetadata: true,
        sucursal: 'A1',
      });
      expect(porOrigen.P2).toMatchObject({ grupo: null, grupoOrigenSrId: 'G2', activo: false });
      const inactivos = await get('/catalogos/productos', USUARIOS.visorA, {
        empresaId: FX.empresaA,
        estado: 'inactivos',
      });
      expect(inactivos.body.filas.map((f: { origenSrId: string }) => f.origenSrId)).toEqual(['P2']);
      const busqueda = await get('/catalogos/productos', USUARIOS.visorA, {
        empresaId: FX.empresaA,
        q: 'MUERTO',
      });
      expect(busqueda.body.filas.map((f: { origenSrId: string }) => f.origenSrId)).toEqual(['P3']);
    });
  });

  describe('meseros de A2: un registro inválido no tumba la página ni traba el cierre', () => {
    it('primera sincronización completa', async () => {
      const r = await pagina(KEYS.a2, 'meseros', 10, T(1), [
        { origenSrId: 'M1', nombre: 'Ana López' },
        { origenSrId: 'M2', nombre: 'Luis Flores' },
      ]);
      expect(r.body).toMatchObject({ creados: 2 });
      expect((await cierre(KEYS.a2, 'meseros', 10, T(1), 2)).body).toMatchObject({
        aplicado: true,
      });
    });

    it('B1: 1 inválido con fila + 1 inválido nuevo entre N → el resto se guarda y el cierre se aplica', async () => {
      const r = await pagina(KEYS.a2, 'meseros', 11, T(2), [
        { origenSrId: 'M1', nombre: 'Ana López' },
        { origenSrId: 'M2', nombre: '' },
        { origenSrId: 'M3', nombre: 'Sofía García' },
        { origenSrId: 'M9', nombre: 'x'.repeat(201) },
        { origenSrId: 'M4', nombre: 'Jorge', sucursalId: FX.sucursalB1 },
      ]);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        recibidos: 5,
        creados: 1,
        sinCambios: 1,
        vistos: 1,
        rechazadosSinFila: 2,
      });
      expect(
        r.body.rechazados.map((x: { indice: number; origenSrId: string }) => [
          x.indice,
          x.origenSrId,
        ]),
      ).toEqual([
        [1, 'M2'],
        [3, 'M9'],
        [4, 'M4'],
      ]);
      expect(JSON.stringify(r.body)).not.toContain('xxxxxxxxxx');
      // Sin contar los rechazados, no cuadra: 409 y nada se da de baja.
      expect((await cierre(KEYS.a2, 'meseros', 11, T(2), 5, 0)).status).toBe(409);
      const c = await cierre(KEYS.a2, 'meseros', 11, T(2), 5, 2);
      expect(c.body).toEqual({ aplicado: true, desactivados: 0, activos: 3 });
      const m2 = await prisma.meseroCatalogo.findFirstOrThrow({
        where: { sucursalId: FX.sucursalA2, origenSrId: 'M2' },
      });
      expect(m2).toMatchObject({ nombre: 'Luis Flores', activo: true, vistoAt: new Date(T(2)) });
      expect(await prisma.meseroCatalogo.count({ where: { origenSrId: 'M4' } })).toBe(0);
      expect(await prisma.meseroCatalogo.count({ where: { sucursalId: FX.sucursalB1 } })).toBe(0);
    });

    it('un origenSrId repetido rechaza todas sus apariciones', async () => {
      const r = await pagina(KEYS.a2, 'meseros', 12, T(3), [
        { origenSrId: 'M1', nombre: 'Ana López' },
        { origenSrId: 'M1', nombre: 'Ana L.' },
      ]);
      expect(r.body).toMatchObject({
        creados: 0,
        actualizados: 0,
        vistos: 1,
        rechazadosSinFila: 1,
      });
      expect(
        await prisma.meseroCatalogo.findFirstOrThrow({
          where: { sucursalId: FX.sucursalA2, origenSrId: 'M1' },
        }),
      ).toMatchObject({
        nombre: 'Ana López',
      });
    });
  });

  describe('grupos de A2: la guardia del cierre', () => {
    it('una página perdida → 409 y no se da de baja nada; completarla lo deja pasar', async () => {
      await pagina(KEYS.a2, 'grupos', 20, T(1), [
        { origenSrId: 'G1', nombre: 'Entradas' },
        { origenSrId: 'G2', nombre: 'Bebidas' },
      ]);
      expect((await cierre(KEYS.a2, 'grupos', 20, T(1), 2)).status).toBe(200);
      await pagina(KEYS.a2, 'grupos', 21, T(2), [{ origenSrId: 'G1', nombre: 'Entradas' }]);
      const r = await cierre(KEYS.a2, 'grupos', 21, T(2), 2);
      expect(r.status).toBe(409);
      expect(
        await prisma.grupoProducto.count({ where: { sucursalId: FX.sucursalA2, activo: true } }),
      ).toBe(2);
      await pagina(KEYS.a2, 'grupos', 21, T(2), [{ origenSrId: 'G2', nombre: 'Bebidas' }]);
      expect((await cierre(KEYS.a2, 'grupos', 21, T(2), 2)).body).toEqual({
        aplicado: true,
        desactivados: 0,
        activos: 2,
      });
    });
  });

  describe('canales de A2: total = 0', () => {
    it('un cierre con total 0 da de baja todo (sin borrar) y la siguiente sincronización lo revierte', async () => {
      await pagina(KEYS.a2, 'canales', 30, T(1), [
        { origenSrId: 'C1', nombre: 'Comedor' },
        { origenSrId: 'C2', nombre: 'Domicilio' },
      ]);
      await cierre(KEYS.a2, 'canales', 30, T(1), 2);
      expect((await cierre(KEYS.a2, 'canales', 31, T(2), 0)).body).toEqual({
        aplicado: true,
        desactivados: 2,
        activos: 0,
      });
      expect(await prisma.canalVentaCatalogo.count({ where: { sucursalId: FX.sucursalA2 } })).toBe(
        2,
      );
      await pagina(KEYS.a2, 'canales', 32, T(3), [
        { origenSrId: 'C1', nombre: 'Comedor' },
        { origenSrId: 'C2', nombre: 'Domicilio' },
      ]);
      expect((await cierre(KEYS.a2, 'canales', 32, T(3), 2)).body).toEqual({
        aplicado: true,
        desactivados: 0,
        activos: 2,
      });
    });
  });

  describe('áreas de A2: concurrencia', () => {
    const AREAS = [
      { origenSrId: 'A1', nombre: 'Comedor' },
      { origenSrId: 'A2', nombre: 'Terraza' },
      { origenSrId: 'A3', nombre: 'Barra' },
    ];

    it('la misma página dos veces en paralelo deja lo mismo que en serie', async () => {
      const rs = await Promise.all([
        pagina(KEYS.a2, 'areas', 40, T(1), AREAS),
        pagina(KEYS.a2, 'areas', 40, T(1), AREAS),
      ]);
      expect(rs.map((r) => r.status)).toEqual([200, 200]);
      expect(rs.map((r) => r.body.creados).sort()).toEqual([0, 3]);
      expect(await prisma.areaCatalogo.count({ where: { sucursalId: FX.sucursalA2 } })).toBe(3);
      expect((await cierre(KEYS.a2, 'areas', 40, T(1), 3)).status).toBe(200);
    });

    it('página y cierre a la vez: nunca da de baja de más; reenviando el cierre queda como en serie', async () => {
      const sinTerraza = AREAS.filter((a) => a.origenSrId !== 'A2');
      const [p, c] = await Promise.all([
        pagina(KEYS.a2, 'areas', 41, T(2), sinTerraza),
        cierre(KEYS.a2, 'areas', 41, T(2), 2),
      ]);
      expect(p.status).toBe(200);
      expect([200, 409]).toContain(c.status);
      const final = await cierre(KEYS.a2, 'areas', 41, T(2), 2);
      expect(final.body).toMatchObject({ aplicado: true, activos: 2 });
      const filas = await prisma.areaCatalogo.findMany({
        where: { sucursalId: FX.sucursalA2 },
        orderBy: { origenSrId: 'asc' },
      });
      expect(filas.map((f) => [f.origenSrId, f.activo])).toEqual([
        ['A1', true],
        ['A2', false],
        ['A3', true],
      ]);
    });
  });

  describe('scope multiempresa', () => {
    beforeAll(async () => {
      // B1 manda un producto con el MISMO origenSrId que A1, y clientes.
      await pagina(KEYS.b1, 'productos', 60, T(1), [{ origenSrId: 'P1', nombre: 'Tacos de B' }]);
      await cierre(KEYS.b1, 'productos', 60, T(1), 1);
      await pagina(KEYS.b1, 'clientes', 61, T(1), [
        {
          origenSrId: 'C1',
          nombre: 'Cliente Sintético B',
          telefono: '555-010-0001',
          correo: 'b@ejemplo.test',
          rfc: 'XIA190128J61',
        },
      ]);
    });

    it('el mismo origenSrId en dos sucursales son dos filas, y el cierre de B1 no toca A1', async () => {
      const [a, b] = await Promise.all([
        producto(FX.sucursalA1, 'P1'),
        producto(FX.sucursalB1, 'P1'),
      ]);
      expect(a.id).not.toBe(b.id);
      expect(b).toMatchObject({ empresaId: FX.empresaB, nombre: 'Tacos de B' });
      expect(a).toMatchObject({ empresaId: FX.empresaA, activo: true });
      expect(
        await prisma.producto.count({ where: { sucursalId: FX.sucursalA1, activo: true } }),
      ).toBe(2);
    });

    it.each(['grupos', 'productos', 'meseros', 'clientes', 'areas', 'canales'])(
      'AC5: visor de A pide %s de la empresa B → 404 (no 403); el visor de B sí los ve',
      async (catalogo) => {
        const ajeno = await get(`/catalogos/${catalogo}`, USUARIOS.visorA, {
          empresaId: FX.empresaB,
        });
        expect(ajeno.status).toBe(404);
        const conSucursalAjena = await get(`/catalogos/${catalogo}`, USUARIOS.visorA, {
          empresaId: FX.empresaA,
          sucursalId: FX.sucursalB1,
        });
        expect(conSucursalAjena.status).toBe(404);
        const propio = await get(`/catalogos/${catalogo}`, USUARIOS.visorB, {
          empresaId: FX.empresaB,
        });
        expect(propio.status).toBe(200);
        expect(JSON.stringify(propio.body)).not.toContain(FX.sucursalA1);
      },
    );

    it('la lista de clientes trae sus datos para la empresa propia y nada de otra', async () => {
      const r = await get('/catalogos/clientes', USUARIOS.visorB, { empresaId: FX.empresaB });
      expect(r.body.filas).toEqual([
        expect.objectContaining({
          origenSrId: 'C1',
          telefono: '555-010-0001',
          rfc: 'XIA190128J61',
          activo: true,
        }),
      ]);
      const a = await get('/catalogos/clientes', USUARIOS.visorA, { empresaId: FX.empresaA });
      expect(a.body.filas).toEqual([]);
    });

    it('detalle y sincronización de B para el visor de A → 404', async () => {
      const b = await producto(FX.sucursalB1, 'P1');
      expect(
        (await get(`/catalogos/productos/${b.id}`, USUARIOS.visorA, { empresaId: FX.empresaB }))
          .status,
      ).toBe(404);
      expect(
        (await get(`/catalogos/productos/${b.id}`, USUARIOS.visorA, { empresaId: FX.empresaA }))
          .status,
      ).toBe(404);
      expect(
        (await get('/catalogos/sincronizacion', USUARIOS.visorA, { empresaId: FX.empresaB }))
          .status,
      ).toBe(404);
    });

    it('admin_empresa de A: 404 al escribir metadata de un producto de B o forzar una sucursal ajena', async () => {
      const b = await producto(FX.sucursalB1, 'P1');
      const meta = { descripcion: 'x', fotoUrl: null, etiquetas: [], minimo: null, maximo: null };
      for (const empresaId of [FX.empresaB, FX.empresaA]) {
        const r = await put(`/catalogos/productos/${b.id}/metadata`, USUARIOS.adminEmpresaA, {
          ...meta,
          empresaId,
        });
        expect(r.status).toBe(404);
      }
      expect(await prisma.productoMetadata.count({ where: { productoId: b.id } })).toBe(0);
      for (const cuerpo of [
        { empresaId: FX.empresaB, sucursalId: FX.sucursalB1 },
        { empresaId: FX.empresaA, sucursalId: FX.sucursalB1 },
        { empresaId: FX.empresaB, sucursalId: FX.sucursalA1 },
      ]) {
        expect(
          (await post('/catalogos/sincronizacion/forzar', USUARIOS.adminEmpresaA, cuerpo)).status,
        ).toBe(404);
      }
      expect(
        await prisma.solicitudSincronizacion.count({ where: { sucursalId: FX.sucursalB1 } }),
      ).toBe(0);
    });

    it('el visor no escribe: 403 en metadata y en forzar', async () => {
      const a = await producto(FX.sucursalA1, 'P1');
      const r = await put(`/catalogos/productos/${a.id}/metadata`, USUARIOS.visorA, {
        empresaId: FX.empresaA,
        descripcion: null,
        fotoUrl: null,
        etiquetas: [],
        minimo: null,
        maximo: null,
      });
      expect(r.status).toBe(403);
      const f = await post('/catalogos/sincronizacion/forzar', USUARIOS.visorA, {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
      });
      expect(f.status).toBe(403);
    });

    it('admin_global sí escribe en cualquier empresa', async () => {
      const b = await producto(FX.sucursalB1, 'P1');
      const r = await put(`/catalogos/productos/${b.id}/metadata`, USUARIOS.adminGlobal, {
        empresaId: FX.empresaB,
        descripcion: 'De B',
        fotoUrl: null,
        etiquetas: ['b'],
        minimo: null,
        maximo: null,
      });
      expect(r.status).toBe(200);
      expect(r.body.metadata.descripcion).toBe('De B');
      expect(
        (await get('/catalogos/sincronizacion', USUARIOS.adminGlobal, { empresaId: FX.empresaB }))
          .status,
      ).toBe(200);
    });
  });

  describe('forzado manual de la sincronización', () => {
    it('la solicitud en A1 sólo la ve el agente de A1, y queda pendiente hasta cerrar los once', async () => {
      expect((await solicitud(KEYS.a1)).body).toEqual({ solicitadaAt: null, pendiente: false });
      const f = await post('/catalogos/sincronizacion/forzar', USUARIOS.adminEmpresaA, {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
      });
      expect(f.status).toBe(202);
      expect(f.body).toMatchObject({ sucursalId: FX.sucursalA1, solicitud: { pendiente: true } });
      expect(f.body.catalogos).toHaveLength(11);

      const a1 = await solicitud(KEYS.a1);
      expect(a1.body.pendiente).toBe(true);
      expect(a1.body.solicitadaAt).toBe(f.body.solicitud.solicitadaAt);
      expect((await solicitud(KEYS.a2)).body).toEqual({ solicitadaAt: null, pendiente: false });
      expect((await solicitud(KEYS.b1)).body).toEqual({ solicitadaAt: null, pendiente: false });

      const t = new Date().toISOString();
      const catalogos: CatalogoSr[] = ['grupos', 'productos', 'meseros', 'clientes', 'areas'];
      for (const [i, c] of catalogos.entries()) {
        const actuales = await get(`/catalogos/${c}`, USUARIOS.adminEmpresaA, {
          empresaId: FX.empresaA,
          sucursalId: FX.sucursalA1,
          estado: 'activos',
        });
        const registros = (actuales.body.filas as Array<Record<string, unknown>>).map((f) => ({
          origenSrId: f.origenSrId,
          nombre: f.nombre,
          clave: f.clave,
          activoPos: f.activoPos,
          ...(c === 'productos' ? { grupoOrigenSrId: f.grupoOrigenSrId } : {}),
        }));
        if (registros.length > 0) {
          expect((await pagina(KEYS.a1, c, 70 + i, t, registros)).status).toBe(200);
        }
        expect((await cierre(KEYS.a1, c, 70 + i, t, registros.length)).status).toBe(200);
      }
      expect((await solicitud(KEYS.a1)).body.pendiente).toBe(true);
      expect((await cierre(KEYS.a1, 'canales', 79, t, 0)).status).toBe(200);
      // F2-120: los seis de F2-230 ya no bastan; faltan los cinco de inventario (vacíos en A1).
      const inventario: CatalogoSr[] = [
        'unidades',
        'grupos_insumo',
        'insumos',
        'almacenes',
        'proveedores',
      ];
      for (const [i, c] of inventario.entries()) {
        expect((await solicitud(KEYS.a1)).body.pendiente).toBe(true);
        expect((await cierre(KEYS.a1, c, 80 + i, t, 0)).status).toBe(200);
      }
      expect((await solicitud(KEYS.a1)).body.pendiente).toBe(false);

      const estado = await get('/catalogos/sincronizacion', USUARIOS.visorA, {
        empresaId: FX.empresaA,
      });
      const deA1 = estado.body.find((s: { sucursalId: string }) => s.sucursalId === FX.sucursalA1);
      expect(deA1.solicitud.pendiente).toBe(false);
      expect(deA1.catalogos.map((c: { catalogo: string }) => c.catalogo)).toEqual([
        'grupos',
        'productos',
        'meseros',
        'clientes',
        'areas',
        'canales',
        'unidades',
        'grupos_insumo',
        'insumos',
        'almacenes',
        'proveedores',
      ]);
      expect(
        deA1.catalogos.every((c: { ultimaCompletaAt: string | null }) => c.ultimaCompletaAt === t),
      ).toBe(true);
    });
  });
});
