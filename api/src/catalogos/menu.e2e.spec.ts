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
import { hashContenido } from '../ingesta/catalogos';

// E2E del orquestador de menú (F2-145) sobre la app REAL contra Postgres REAL, con las
// fixtures sintéticas de F1-011 (A1 y A2 de la empresa A, B1 de la B; zona CDMX). Precios,
// nombres y cuentas van escritos a mano: esto prueba la detección, no el seed.
//
// Es una línea de tiempo: los `it` comparten estado y van en orden. Córrelo completo.

const KEYS = {
  a1: 'msr_sintetica-menu-F2-145-sucursal-a1-000000000000001',
  a2: 'msr_sintetica-menu-F2-145-sucursal-a2-000000000000002',
  b1: 'msr_sintetica-menu-F2-145-sucursal-b1-000000000000003',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];
type Registro = Record<string, unknown>;

const T = (n: number) => new Date(Date.UTC(2026, 8, 1, 3, 0, 0) + n * 86_400_000).toISOString();
const sinc = (n: number) => `f2145000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const A1: Registro[] = [
  {
    origenSrId: 'P009',
    clave: 'P009',
    nombre: 'Tacos al pastor (orden)',
    grupoOrigenSrId: 'G03',
    precio: '89',
  },
  {
    origenSrId: 'P021',
    clave: 'P021',
    nombre: 'Cerveza nacional',
    grupoOrigenSrId: 'G05',
    precio: '55.00',
  },
  {
    origenSrId: 'P050',
    clave: 'P050',
    nombre: 'Solo en A1',
    grupoOrigenSrId: 'G05',
    precio: '10.00',
  },
  {
    origenSrId: 'P060',
    clave: 'P060',
    nombre: 'Baja en A1',
    grupoOrigenSrId: 'G05',
    precio: '999.00',
    activoPos: false,
  },
];
const GRUPOS = [
  { origenSrId: 'G03', clave: 'G03', nombre: 'Platos fuertes' },
  { origenSrId: 'G05', clave: 'G05', nombre: 'Bebidas' },
];
const A2: Registro[] = [
  {
    origenSrId: 'P009',
    clave: 'P009',
    nombre: 'Tacos al pastor (orden)',
    grupoOrigenSrId: 'G03',
    precio: '95.00',
  },
  {
    origenSrId: 'P021',
    clave: 'P021',
    nombre: 'Cerveza nacional',
    grupoOrigenSrId: 'G05',
    precio: '55',
  },
  {
    origenSrId: 'P060',
    clave: 'P060',
    nombre: 'Baja en A1',
    grupoOrigenSrId: 'G05',
    precio: '20.00',
  },
];

describe('Orquestador de menú (e2e, F2-145)', () => {
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

  const pagina = (key: string, catalogo: string, n: number, t: string, registros: Registro[]) =>
    request(url)
      .post('/ingesta/catalogos')
      .set('X-Api-Key', key)
      .send({ catalogo, sincronizacionId: sinc(n), capturadoAt: t, registros });
  const cierre = (key: string, catalogo: string, n: number, t: string, total: number) =>
    request(url)
      .post('/ingesta/catalogos/cierre')
      .set('X-Api-Key', key)
      .send({ catalogo, sincronizacionId: sinc(n), capturadoAt: t, total, rechazados: 0 });
  /** Una sincronización completa (una página + cierre). */
  async function completa(key: string, catalogo: string, n: number, t: string, regs: Registro[]) {
    const p = await pagina(key, catalogo, n, t, regs);
    expect(p.status).toBe(200);
    expect(p.body.rechazados).toEqual([]);
    const c = await cierre(key, catalogo, n, t, regs.length);
    expect(c.status).toBe(200);
    expect(c.body.aplicado).toBe(true);
  }

  const producto = (sucursalId: string, origenSrId: string) =>
    prisma.producto.findFirstOrThrow({ where: { sucursalId, origenSrId } });

  let folio = 0;
  /** Una cuenta cerrada (o cancelada) con sus partidas, directo en la base. */
  async function cuenta(
    sucursalId: string,
    empresaId: string,
    cerradoAt: string,
    partidas: Array<[string, string, string]>,
    cancelado = false,
  ) {
    folio++;
    const total = partidas.reduce((s, [, , t]) => s + Number(t), 0).toFixed(2);
    await prisma.cheque.create({
      data: {
        sucursalId,
        empresaId,
        folio: `M${folio}`,
        folioSr: `M${folio}`,
        abiertoAt: new Date(Date.parse(cerradoAt) - 3_600_000),
        cerradoAt: new Date(cerradoAt),
        subtotal: total,
        impuestos: '0.00',
        descuentos: '0.00',
        propina: '0.00',
        total,
        cancelado,
        partidas: {
          create: partidas.map(([producto, cantidad, t], orden) => ({
            orden,
            producto,
            cantidad,
            precioUnit: t,
            total: t,
          })),
        },
      },
    });
  }

  const menuDe = async (u: Usuario, query: Record<string, string>) => {
    const r = await get('/catalogos/menu', u, query);
    expect(r.status).toBe(200);
    return r.body as {
      sucursales: Array<{ sucursalId: string; sincronizadoAt: string | null; productos: number }>;
      categorias: Array<{
        grupo: string | null;
        productos: Array<{
          clave: string | null;
          nombre: string;
          discrepancia: boolean;
          precioMin: string | null;
          precioMax: string | null;
          precios: Array<{ sucursalId: string; precio: string | null; vigente: boolean }>;
        }>;
      }>;
      discrepancias: number;
      truncado: boolean;
    };
  };
  const productoMenu = (m: Awaited<ReturnType<typeof menuDe>>, clave: string) =>
    m.categorias.flatMap((c) => c.productos).find((p) => p.clave === clave);

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

  describe('el precio en la ingesta', () => {
    it('A1 sincroniza grupos y productos con precio; se guarda normalizado a 2 decimales', async () => {
      await completa(KEYS.a1, 'grupos', 1, T(0), GRUPOS);
      await completa(KEYS.a1, 'productos', 2, T(0), A1);
      expect((await producto(FX.sucursalA1, 'P009')).precio?.toFixed(2)).toBe('89.00');
      expect((await producto(FX.sucursalA1, 'P021')).precio?.toFixed(2)).toBe('55.00');
    });

    it('la misma página tres veces (con el precio escrito distinto) deja las mismas filas', async () => {
      const antes = await prisma.producto.findMany({
        where: { sucursalId: FX.sucursalA1 },
        orderBy: { id: 'asc' },
      });
      const variante = A1.map((r) => (r.origenSrId === 'P009' ? { ...r, precio: '89.0000' } : r));
      for (const regs of [A1, variante, A1]) {
        const r = await pagina(KEYS.a1, 'productos', 2, T(0), regs);
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ creados: 0, actualizados: 0, sinCambios: A1.length });
      }
      const despues = await prisma.producto.findMany({
        where: { sucursalId: FX.sucursalA1 },
        orderBy: { id: 'asc' },
      });
      expect(JSON.parse(JSON.stringify(despues))).toEqual(JSON.parse(JSON.stringify(antes)));
    });

    it('un precio que no cabe se rechaza solo; los demás registros de la página entran', async () => {
      const r = await pagina(KEYS.a1, 'productos', 3, T(1), [
        { origenSrId: 'P900', nombre: 'Enorme', precio: '9999999999.9999' },
        { origenSrId: 'P901', nombre: 'Normal', precio: '1.00' },
      ]);
      expect(r.status).toBe(200);
      expect(r.body.creados).toBe(1);
      expect(r.body.rechazados).toEqual([
        {
          indice: 0,
          origenSrId: 'P900',
          motivo: 'registros.0.precio: no cabe en NUMERIC(12,2) al redondear',
          reintentable: false,
        },
      ]);
      // Deja A1 como estaba para lo que sigue: una completa POSTERIOR sin P901 lo da de baja.
      await completa(KEYS.a1, 'productos', 4, T(2), A1);
      expect((await producto(FX.sucursalA1, 'P901')).activo).toBe(false);
    });

    it('una fila con el hash de ANTES de F2-145 (sin la llave precio) se reescribe UNA vez', async () => {
      const f = await producto(FX.sucursalA1, 'P021');
      const hashViejo = hashContenido({
        clave: 'P021',
        nombre: 'Cerveza nacional',
        activoPos: null,
        grupoOrigenSrId: 'G05',
      });
      const viejo = new Date('2026-08-01T00:00:00.000Z');
      await prisma.producto.update({
        where: { id: f.id },
        data: { hash: hashViejo, precio: null, updatedAt: viejo },
      });
      const r1 = await pagina(KEYS.a1, 'productos', 5, T(2), [A1[1]]);
      expect(r1.body.actualizados).toBe(1);
      const tras1 = await producto(FX.sucursalA1, 'P021');
      expect(tras1.updatedAt.getTime()).not.toBe(viejo.getTime());
      expect(tras1.precio?.toFixed(2)).toBe('55.00');
      const r2 = await pagina(KEYS.a1, 'productos', 5, T(2), [A1[1]]);
      expect(r2.body).toMatchObject({ actualizados: 0, sinCambios: 1 });
      expect((await producto(FX.sucursalA1, 'P021')).updatedAt).toEqual(tras1.updatedAt);
      await completa(KEYS.a1, 'productos', 6, T(2), A1);
    });
  });

  describe('vendidos sin catálogo', () => {
    const q = { empresaId: FX.empresaA, desde: '2026-09-10', hasta: '2026-09-10' };

    beforeAll(async () => {
      // A2 sólo tiene una página INCREMENTAL (sin cierre): catálogo parcial.
      const r = await pagina(KEYS.a2, 'productos', 20, T(2), [A2[0]]);
      expect(r.status).toBe(200);
      // A1: 10-sep hora de CDMX (UTC-6).
      await cuenta(FX.sucursalA1, FX.empresaA, '2026-09-10T20:00:00Z', [
        ['TACOS  al pastor (orden) ', '2.000', '178.00'],
        ['Especial del día', '1.000', '150.00'],
      ]);
      await cuenta(FX.sucursalA1, FX.empresaA, '2026-09-10T21:00:00Z', [
        ['especial del  día', '1.500', '0.10'],
        ['Baja en A1', '1.000', '999.00'],
      ]);
      // Cancelada: no entra.
      await cuenta(
        FX.sucursalA1,
        FX.empresaA,
        '2026-09-10T22:00:00Z',
        [['Cancelado', '1.000', '5.00']],
        true,
      );
      // 23:30 del 10 en CDMX = 05:30Z del 11: entra.
      await cuenta(FX.sucursalA1, FX.empresaA, '2026-09-11T05:30:00Z', [
        ['Nocturno', '1.000', '0.20'],
      ]);
      // 00:30 del 11 en CDMX: fuera del rango.
      await cuenta(FX.sucursalA1, FX.empresaA, '2026-09-11T06:30:00Z', [
        ['Fuera de rango', '1.000', '7.00'],
      ]);
      // A2 vende algo que SÍ está en el catálogo de A1 pero no en el suyo.
      await cuenta(FX.sucursalA2, FX.empresaA, '2026-09-10T20:00:00Z', [
        ['Solo en A1', '1.000', '10.00'],
      ]);
      // Empresa B: su catálogo tiene "Otro de B"; vende "Especial del día".
      await completa(KEYS.b1, 'productos', 30, T(2), [
        { origenSrId: 'X1', clave: 'X1', nombre: 'Especial del día', precio: '1.00' },
      ]);
      await cuenta(FX.sucursalB1, FX.empresaB, '2026-09-10T20:00:00Z', [['De B', '1.000', '3.00']]);
    });

    it('lista lo vendido fuera del catálogo de su sucursal, junto por nombre normalizado', async () => {
      const r = await get('/catalogos/sin-catalogo', USUARIOS.visorA, q);
      expect(r.status).toBe(200);
      expect(r.body.filas).toEqual([
        {
          sucursalId: FX.sucursalA1,
          sucursal: 'A1',
          producto: 'Especial del día',
          variantes: 2,
          partidas: 2,
          cantidad: '2.500',
          importe: '150.10',
        },
        {
          sucursalId: FX.sucursalA1,
          sucursal: 'A1',
          producto: 'Nocturno',
          variantes: 1,
          partidas: 1,
          cantidad: '1.000',
          importe: '0.20',
        },
      ]);
      expect(r.body).toMatchObject({ total: 2, truncado: false });
    });

    it('una sucursal con catálogo PARCIAL (sin sincronización completa) no se cruza: va aparte', async () => {
      const r = await get('/catalogos/sin-catalogo', USUARIOS.visorA, q);
      expect(r.body.sucursalesSinCatalogo).toEqual([{ sucursalId: FX.sucursalA2, sucursal: 'A2' }]);
      expect(r.body.filas.some((f: { sucursalId: string }) => f.sucursalId === FX.sucursalA2)).toBe(
        false,
      );
    });

    it('con su catálogo completo, A2 sí se cruza (contra el SUYO, no el de A1)', async () => {
      await completa(KEYS.a2, 'grupos', 21, T(3), GRUPOS);
      await completa(KEYS.a2, 'productos', 22, T(3), A2);
      const r = await get('/catalogos/sin-catalogo', USUARIOS.visorA, {
        ...q,
        sucursalId: FX.sucursalA2,
      });
      expect(r.status).toBe(200);
      expect(r.body.sucursalesSinCatalogo).toEqual([]);
      expect(r.body.filas).toEqual([
        expect.objectContaining({ sucursalId: FX.sucursalA2, producto: 'Solo en A1' }),
      ]);
    });

    it('el catálogo de otra empresa no cubre nada, y su venta no aparece', async () => {
      const r = await get('/catalogos/sin-catalogo', USUARIOS.visorA, q);
      const nombres = r.body.filas.map((f: { producto: string }) => f.producto);
      expect(nombres).toContain('Especial del día');
      expect(nombres).not.toContain('De B');
      const b = await get('/catalogos/sin-catalogo', USUARIOS.visorB, {
        ...q,
        empresaId: FX.empresaB,
      });
      expect(b.body.filas.map((f: { producto: string }) => f.producto)).toEqual(['De B']);
    });

    it.each([
      ['visor de B pidiendo la empresa A', USUARIOS.visorB, { empresaId: FX.empresaA }],
      ['sucursal de otra empresa', USUARIOS.visorA, { sucursalId: FX.sucursalB1 }],
      ['empresa inexistente', USUARIOS.adminGlobal, { empresaId: FX.inexistente }],
    ])('%s → 404 (nunca 403)', async (_n, u, cambio) => {
      const r = await get('/catalogos/sin-catalogo', u, { ...q, ...cambio });
      expect(r.status).toBe(404);
    });

    it.each([
      ['sin periodo', { desde: undefined }],
      ['rango al revés', { desde: '2026-09-11', hasta: '2026-09-10' }],
      ['alturaAl (no aplica aquí)', { alturaAl: '2026-09-10T20:00:00Z' }],
    ])('%s → 400', async (_n, cambio) => {
      const query = Object.fromEntries(
        Object.entries({ ...q, ...cambio }).filter(([, v]) => v !== undefined),
      ) as Record<string, string>;
      const r = await get('/catalogos/sin-catalogo', USUARIOS.visorA, query);
      expect(r.status).toBe(400);
    });
  });

  describe('el menú', () => {
    it('AC: el mismo producto con precio distinto entre dos sucursales aparece señalado', async () => {
      const m = await menuDe(USUARIOS.visorA, { empresaId: FX.empresaA });
      expect(m.sucursales.map((s) => s.sucursalId)).toEqual([FX.sucursalA1, FX.sucursalA2]);
      expect(m.sucursales.every((s) => s.sincronizadoAt !== null)).toBe(true);
      const tacos = productoMenu(m, 'P009')!;
      expect(tacos).toMatchObject({ discrepancia: true, precioMin: '89.00', precioMax: '95.00' });
      expect(tacos.precios.map((p) => [p.sucursalId, p.precio])).toEqual([
        [FX.sucursalA1, '89.00'],
        [FX.sucursalA2, '95.00'],
      ]);
      // "55.00" y "55": el mismo precio.
      expect(productoMenu(m, 'P021')!.discrepancia).toBe(false);
      // Baja en el POS de A1 a 999: se muestra, no dispara.
      const baja = productoMenu(m, 'P060')!;
      expect(baja.discrepancia).toBe(false);
      expect(baja.precios.find((p) => p.sucursalId === FX.sucursalA1)?.vigente).toBe(false);
      expect(m.discrepancias).toBe(1);
      expect(m.categorias.map((c) => c.grupo)).toEqual(['Bebidas', 'Platos fuertes']);
      expect(m.truncado).toBe(false);
    });

    it('con una sola sucursal no hay nada que comparar', async () => {
      const m = await menuDe(USUARIOS.visorA, {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
      });
      expect(m.sucursales).toHaveLength(1);
      expect(m.discrepancias).toBe(0);
    });

    it('el listado de productos trae el precio de cada sucursal', async () => {
      const r = await get('/catalogos/productos', USUARIOS.visorA, {
        empresaId: FX.empresaA,
        q: 'P009',
      });
      expect(r.status).toBe(200);
      expect(
        r.body.filas.map((f: { sucursal: string; precio: string }) => [f.sucursal, f.precio]),
      ).toEqual(
        expect.arrayContaining([
          ['A1', '89.00'],
          ['A2', '95.00'],
        ]),
      );
    });

    it.each([
      ['visor de B pidiendo la empresa A', USUARIOS.visorB, { empresaId: FX.empresaA }],
      [
        'sucursal de otra empresa',
        USUARIOS.visorA,
        { empresaId: FX.empresaA, sucursalId: FX.sucursalB1 },
      ],
      ['admin de A pidiendo la B', USUARIOS.adminEmpresaA, { empresaId: FX.empresaB }],
    ])('%s → 404 (nunca 403)', async (_n, u, query) => {
      const r = await get('/catalogos/menu', u, query);
      expect(r.status).toBe(404);
    });
  });

  describe('AC: la metadata propia sobrevive un re-sync', () => {
    let id: string;
    const metadata = {
      empresaId: FX.empresaA,
      descripcion: 'Con piña y cebolla',
      fotoUrl: 'https://ejemplo.test/tacos.jpg',
      etiquetas: ['picante', 'favorito'],
      minimo: null,
      maximo: null,
    };

    it('un admin guarda la metadata del producto de A1', async () => {
      id = (await producto(FX.sucursalA1, 'P009')).id;
      const r = await put(`/catalogos/productos/${id}/metadata`, USUARIOS.adminEmpresaA, metadata);
      expect(r.status).toBe(200);
    });

    const detalle = async () => {
      const r = await get(`/catalogos/productos/${id}`, USUARIOS.visorA, {
        empresaId: FX.empresaA,
      });
      expect(r.status).toBe(200);
      return r.body;
    };
    const esperada = {
      descripcion: metadata.descripcion,
      fotoUrl: metadata.fotoUrl,
      etiquetas: metadata.etiquetas,
    };

    it('una sincronización completa que cambia nombre y precio no la toca', async () => {
      await completa(KEYS.a1, 'productos', 40, T(4), [
        { ...A1[0], nombre: 'Tacos al pastor (5 piezas)', precio: '92.50' },
        ...A1.slice(1),
      ]);
      const d = await detalle();
      expect(d).toMatchObject({ id, nombre: 'Tacos al pastor (5 piezas)', precio: '92.50' });
      expect(d.metadata).toMatchObject(esperada);
      expect(
        await prisma.producto.count({ where: { sucursalId: FX.sucursalA1, origenSrId: 'P009' } }),
      ).toBe(1);
      const tacos = productoMenu(
        await menuDe(USUARIOS.visorA, { empresaId: FX.empresaA }),
        'P009',
      )!;
      expect(tacos.precios.find((p) => p.sucursalId === FX.sucursalA1)?.precio).toBe('92.50');
    });

    it('desaparecer del POS y reaparecer tampoco: vuelve la MISMA fila con su metadata', async () => {
      await completa(KEYS.a1, 'productos', 41, T(5), A1.slice(1));
      const fuera = await detalle();
      expect(fuera.activo).toBe(false);
      expect(fuera.metadata).toMatchObject(esperada);
      // Fuera del menú: en A1 ya no está; sólo queda A2.
      const tacos = productoMenu(
        await menuDe(USUARIOS.visorA, { empresaId: FX.empresaA }),
        'P009',
      )!;
      expect(tacos.precios.map((p) => p.sucursalId)).toEqual([FX.sucursalA2]);
      expect(tacos.discrepancia).toBe(false);

      await completa(KEYS.a1, 'productos', 42, T(6), A1);
      const vuelta = await detalle();
      expect(vuelta).toMatchObject({ id, activo: true, precio: '89.00' });
      expect(vuelta.metadata).toMatchObject(esperada);
    });

    it('omitir el precio en una página (aunque sea incremental) lo guarda nulo', async () => {
      const { precio: _p, ...sinPrecio } = A2[1];
      void _p;
      const r = await pagina(KEYS.a2, 'productos', 43, T(7), [sinPrecio]);
      expect(r.body.actualizados).toBe(1);
      expect((await producto(FX.sucursalA2, 'P021')).precio).toBeNull();
      const cerveza = productoMenu(
        await menuDe(USUARIOS.visorA, { empresaId: FX.empresaA }),
        'P021',
      )!;
      expect(cerveza.discrepancia).toBe(false);
      expect(cerveza.precios.find((p) => p.sucursalId === FX.sucursalA2)?.precio).toBeNull();
    });
  });
});
