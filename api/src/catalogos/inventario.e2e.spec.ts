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

// E2E de los catálogos de inventario (F2-120) sobre la app REAL contra Postgres REAL, con
// las fixtures sintéticas de F1-011 (A1 y A2 de la empresa A, B1 de la B). Keys sintéticas.
//
// Los `it` de un mismo `describe` comparten estado y van en orden: córrelo completo y con
// `--runInBand` (las suites e2e comparten fixtures).

const KEYS = {
  a1: 'msr_sintetica-inventario-F2-120-sucursal-a1-000000000001',
  a2: 'msr_sintetica-inventario-F2-120-sucursal-a2-000000000002',
  b1: 'msr_sintetica-inventario-F2-120-sucursal-b1-000000000003',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];
type Registro = Record<string, unknown>;

/** Instantes de sincronización, todos en el pasado y en orden. */
const T = (n: number) => new Date(Date.UTC(2026, 8, 1, 3, 0, 0) + n * 86_400_000).toISOString();
const sinc = (n: number) => `f2120000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const INVENTARIO: readonly CatalogoSr[] = [
  'unidades',
  'grupos_insumo',
  'insumos',
  'almacenes',
  'proveedores',
];
const RUTA: Record<string, string> = {
  unidades: '/catalogos/unidades',
  grupos_insumo: '/catalogos/grupos-insumo',
  insumos: '/catalogos/insumos',
  almacenes: '/catalogos/almacenes',
  proveedores: '/catalogos/proveedores',
};

/** Un lote de prueba por catálogo, con acentos, comillas y nulos. */
const LOTES: Record<string, Registro[]> = {
  unidades: [
    { origenSrId: 'KG', clave: 'KG', nombre: 'Kilogramo' },
    { origenSrId: 'LT', clave: 'LT', nombre: 'Litro' },
  ],
  grupos_insumo: [
    { origenSrId: 'GI1', clave: 'GI1', nombre: 'Lácteos y huevo' },
    { origenSrId: 'GI2', clave: null, nombre: 'Abarrotes "secos"' },
  ],
  insumos: [
    {
      origenSrId: 'I1',
      clave: 'I1',
      nombre: 'Leche entera',
      grupoOrigenSrId: 'GI1',
      unidadOrigenSrId: 'LT',
    },
    {
      origenSrId: 'I2',
      clave: 'I2',
      nombre: 'Azúcar morena',
      grupoOrigenSrId: 'GI2',
      unidadOrigenSrId: 'KG',
      activoPos: true,
    },
    { origenSrId: 'I3', clave: null, nombre: 'Piloncillo', grupoOrigenSrId: null },
  ],
  almacenes: [
    { origenSrId: 'ALM1', clave: 'ALM1', nombre: 'Almacén general' },
    { origenSrId: 'ALM2', clave: 'ALM2', nombre: 'Barra' },
  ],
  proveedores: [
    { origenSrId: 'PR1', clave: 'PR1', nombre: 'Lácteos del Valle (ficticio)' },
    { origenSrId: 'PR2', clave: 'PR2', nombre: 'Abarrotes "Mayoreo" Demo' },
  ],
};

describe('Catálogos de inventario (e2e, F2-120)', () => {
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
  const post = async (ruta: string, u: Usuario, body: object) =>
    request(url)
      .post(ruta)
      .set('Authorization', `Bearer ${await token(u)}`)
      .send(body);
  const pagina = (key: string, catalogo: CatalogoSr, n: number, t: string, registros: Registro[]) =>
    request(url)
      .post('/ingesta/catalogos')
      .set('X-Api-Key', key)
      .send({ catalogo, sincronizacionId: sinc(n), capturadoAt: t, registros });
  const cierre = (key: string, catalogo: CatalogoSr, n: number, t: string, total: number) =>
    request(url)
      .post('/ingesta/catalogos/cierre')
      .set('X-Api-Key', key)
      .send({ catalogo, sincronizacionId: sinc(n), capturadoAt: t, total, rechazados: 0 });
  const solicitud = (key: string) =>
    request(url).get('/ingesta/catalogos/solicitud').set('X-Api-Key', key);

  const delegados = () =>
    ({
      unidades: prisma.unidadCatalogo,
      grupos_insumo: prisma.grupoInsumo,
      insumos: prisma.insumo,
      almacenes: prisma.almacenCatalogo,
      proveedores: prisma.proveedorCatalogo,
    }) as unknown as Record<
      string,
      { findMany(a: object): Promise<Array<Record<string, unknown>>> }
    >;

  /** Todas las filas de inventario de una sucursal, todas las columnas, como JSON. */
  async function foto(sucursalId: string) {
    const w = { where: { sucursalId }, orderBy: { id: 'asc' as const } };
    const d = delegados();
    const filas = await Promise.all(INVENTARIO.map((c) => d[c].findMany(w)));
    return JSON.parse(JSON.stringify(filas));
  }

  const insumo = (sucursalId: string, origenSrId: string) =>
    prisma.insumo.findFirstOrThrow({ where: { sucursalId, origenSrId } });

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

  describe('ingesta en A1 (línea de tiempo)', () => {
    it('primera sincronización completa de los cinco catálogos', async () => {
      for (const [i, c] of INVENTARIO.entries()) {
        const r = await pagina(KEYS.a1, c, 1 + i, T(1), LOTES[c]);
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ catalogo: c, creados: LOTES[c].length, rechazados: [] });
        expect((await cierre(KEYS.a1, c, 1 + i, T(1), LOTES[c].length)).status).toBe(200);
      }
    });

    it('AC alta: un insumo nuevo aparece en el panel con su grupo y su unidad de la misma sucursal', async () => {
      const r = await pagina(KEYS.a1, 'insumos', 20, T(2), [
        {
          origenSrId: 'I9',
          clave: 'I9',
          nombre: 'Crema ácida',
          grupoOrigenSrId: 'GI1',
          unidadOrigenSrId: 'LT',
        },
      ]);
      expect(r.body).toMatchObject({ creados: 1, rechazados: [] });
      const lista = await get('/catalogos/insumos', USUARIOS.visorA, {
        empresaId: FX.empresaA,
        q: 'crema',
      });
      expect(lista.status).toBe(200);
      expect(lista.body.total).toBe(1);
      expect(lista.body.filas[0]).toMatchObject({
        sucursalId: FX.sucursalA1,
        origenSrId: 'I9',
        nombre: 'Crema ácida',
        grupoOrigenSrId: 'GI1',
        grupo: 'Lácteos y huevo',
        unidadOrigenSrId: 'LT',
        unidad: 'Litro',
        activo: true,
      });
    });

    it.each(INVENTARIO)(
      'idempotencia (%s): el mismo lote tres veces deja exactamente los mismos datos',
      async (c) => {
        const antes = await foto(FX.sucursalA1);
        for (let k = 0; k < 3; k++) {
          const r = await pagina(KEYS.a1, c, 1 + INVENTARIO.indexOf(c), T(1), LOTES[c]);
          expect(r.status).toBe(200);
          expect(r.body).toMatchObject({ creados: 0, actualizados: 0 });
        }
        expect(await foto(FX.sucursalA1)).toEqual(antes);
      },
    );

    it('AC renombrar: misma fila, una sola, con updated_at movido; las demás no se tocan', async () => {
      const antes = await insumo(FX.sucursalA1, 'I1');
      const otro = await insumo(FX.sucursalA1, 'I2');
      const r = await pagina(KEYS.a1, 'insumos', 21, T(3), [
        {
          origenSrId: 'I1',
          clave: 'I1',
          nombre: 'Leche entera (galón)',
          grupoOrigenSrId: 'GI1',
          unidadOrigenSrId: 'LT',
        },
      ]);
      expect(r.body).toMatchObject({ creados: 0, actualizados: 1 });
      const despues = await insumo(FX.sucursalA1, 'I1');
      expect(despues.id).toBe(antes.id);
      expect(despues.nombre).toBe('Leche entera (galón)');
      expect(despues.updatedAt.getTime()).toBeGreaterThan(antes.updatedAt.getTime());
      expect(
        await prisma.insumo.count({ where: { sucursalId: FX.sucursalA1, origenSrId: 'I1' } }),
      ).toBe(1);
      expect((await insumo(FX.sucursalA1, 'I2')).updatedAt).toEqual(otro.updatedAt);
    });

    it('cambiarle el grupo a un insumo actualiza la misma fila (el hash lo ve)', async () => {
      const antes = await insumo(FX.sucursalA1, 'I1');
      const r = await pagina(KEYS.a1, 'insumos', 22, T(4), [
        {
          origenSrId: 'I1',
          clave: 'I1',
          nombre: 'Leche entera (galón)',
          grupoOrigenSrId: 'GI2',
          unidadOrigenSrId: 'LT',
        },
      ]);
      expect(r.body).toMatchObject({ creados: 0, actualizados: 1 });
      const despues = await insumo(FX.sucursalA1, 'I1');
      expect(despues.id).toBe(antes.id);
      expect(despues.grupoOrigenSrId).toBe('GI2');
      expect(despues.hash).not.toBe(antes.hash);
    });

    it('una incremental que OMITE grupo y unidad los guarda nulos (contrato para F2-241)', async () => {
      const r = await pagina(KEYS.a1, 'insumos', 23, T(5), [
        { origenSrId: 'I2', clave: 'I2', nombre: 'Azúcar morena', activoPos: true },
      ]);
      expect(r.body).toMatchObject({ actualizados: 1 });
      const i2 = await insumo(FX.sucursalA1, 'I2');
      expect(i2.grupoOrigenSrId).toBeNull();
      expect(i2.unidadOrigenSrId).toBeNull();
    });

    it('un registro con costo (campo que el catálogo no tiene) se rechaza solo', async () => {
      const r = await pagina(KEYS.a1, 'insumos', 24, T(5), [
        { origenSrId: 'I7', nombre: 'Canela', costo: '300.00' },
        { origenSrId: 'I8', nombre: 'Clavo' },
      ]);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ creados: 1, rechazadosSinFila: 1 });
      expect(r.body.rechazados).toHaveLength(1);
      expect(r.body.rechazados[0]).toMatchObject({ indice: 0, origenSrId: 'I7' });
      expect(r.body.rechazados[0].motivo).not.toContain('300.00');
    });

    it('lo que desaparece de una completa queda inactivo con su visto_at, sin borrarse', async () => {
      const i3 = await insumo(FX.sucursalA1, 'I3');
      const quedan = await prisma.insumo.findMany({
        where: { sucursalId: FX.sucursalA1, origenSrId: { not: 'I3' } },
        select: {
          origenSrId: true,
          clave: true,
          nombre: true,
          grupoOrigenSrId: true,
          unidadOrigenSrId: true,
          activoPos: true,
        },
      });
      expect((await pagina(KEYS.a1, 'insumos', 30, T(6), quedan)).status).toBe(200);
      const c = await cierre(KEYS.a1, 'insumos', 30, T(6), quedan.length);
      expect(c.body).toMatchObject({ aplicado: true, desactivados: 1 });
      const despues = await insumo(FX.sucursalA1, 'I3');
      expect(despues.id).toBe(i3.id);
      expect(despues.activo).toBe(false);
      expect(despues.vistoAt).toEqual(i3.vistoAt);
      const inactivos = await get('/catalogos/insumos', USUARIOS.visorA, {
        empresaId: FX.empresaA,
        estado: 'inactivos',
      });
      expect(inactivos.body.filas.map((f: { origenSrId: string }) => f.origenSrId)).toEqual(['I3']);
    });
  });

  describe('resolución de grupo y unidad', () => {
    it('un grupo o unidad con el mismo origenSrId en OTRA sucursal o empresa no se usa', async () => {
      // A2 tiene un insumo que apunta a GI1/LT, pero A2 no tiene esos catálogos: A1 sí (y B1
      // también, con otro nombre). La lectura resuelve sólo en la sucursal del insumo.
      expect(
        (
          await pagina(KEYS.a2, 'insumos', 40, T(1), [
            {
              origenSrId: 'I1',
              nombre: 'Leche A2',
              grupoOrigenSrId: 'GI1',
              unidadOrigenSrId: 'LT',
            },
          ])
        ).status,
      ).toBe(200);
      expect(
        (
          await pagina(KEYS.b1, 'grupos_insumo', 41, T(1), [
            { origenSrId: 'GI1', nombre: 'Grupo de B' },
          ])
        ).status,
      ).toBe(200);
      const a2 = await get('/catalogos/insumos', USUARIOS.adminGlobal, {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA2,
      });
      expect(a2.status).toBe(200);
      expect(a2.body.filas).toHaveLength(1);
      expect(a2.body.filas[0]).toMatchObject({
        grupoOrigenSrId: 'GI1',
        grupo: null,
        unidadOrigenSrId: 'LT',
        unidad: null,
      });
      // En A1 el mismo par sí se resuelve.
      const a1 = await get('/catalogos/insumos', USUARIOS.visorA, {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        q: 'crema',
      });
      expect(a1.body.filas[0]).toMatchObject({ grupo: 'Lácteos y huevo', unidad: 'Litro' });
    });

    it('las listas de los cinco catálogos traen lo de la empresa pedida, por sucursal', async () => {
      for (const c of INVENTARIO) {
        const r = await get(RUTA[c], USUARIOS.adminEmpresaA, {
          empresaId: FX.empresaA,
          sucursalId: FX.sucursalA1,
        });
        expect(r.status).toBe(200);
        expect(r.body.total).toBeGreaterThan(0);
        expect(
          r.body.filas.every((f: { sucursalId: string }) => f.sucursalId === FX.sucursalA1),
        ).toBe(true);
      }
      const b = await get(RUTA.grupos_insumo, USUARIOS.visorB, { empresaId: FX.empresaB });
      expect(b.body.filas.map((f: { nombre: string }) => f.nombre)).toEqual(['Grupo de B']);
    });
  });

  describe('scope (404, nunca 403)', () => {
    it.each(INVENTARIO)(
      '%s: empresa ajena o inexistente = el mismo 404 para visor y admin de A',
      async (c) => {
        for (const u of [USUARIOS.visorA, USUARIOS.adminEmpresaA]) {
          const ajena = await get(RUTA[c], u, { empresaId: FX.empresaB });
          const inexistente = await get(RUTA[c], u, { empresaId: FX.inexistente });
          expect(ajena.status).toBe(404);
          expect(inexistente.status).toBe(404);
          expect(ajena.body).toEqual(inexistente.body);
          const sucAjena = await get(RUTA[c], u, {
            empresaId: FX.empresaA,
            sucursalId: FX.sucursalB1,
          });
          expect(sucAjena.status).toBe(404);
          expect(sucAjena.body).toEqual(ajena.body);
        }
        expect((await request(url).get(RUTA[c]).query({ empresaId: FX.empresaA })).status).toBe(
          401,
        );
        // admin_global lee cualquier empresa.
        expect((await get(RUTA[c], USUARIOS.adminGlobal, { empresaId: FX.empresaB })).status).toBe(
          200,
        );
      },
    );
  });

  describe('forzado desde administración', () => {
    it('AC: forzar pide también el inventario; queda pendiente hasta que cierran los once', async () => {
      const f = await post('/catalogos/sincronizacion/forzar', USUARIOS.adminEmpresaA, {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA2,
      });
      expect(f.status).toBe(202);
      expect(f.body.catalogos.map((c: { catalogo: string }) => c.catalogo)).toEqual([
        'grupos',
        'productos',
        'meseros',
        'clientes',
        'areas',
        'canales',
        ...INVENTARIO,
      ]);
      const t = new Date().toISOString();
      const viejos: CatalogoSr[] = [
        'grupos',
        'productos',
        'meseros',
        'clientes',
        'areas',
        'canales',
      ];
      for (const [i, c] of viejos.entries()) {
        expect((await cierre(KEYS.a2, c, 50 + i, t, 0)).status).toBe(200);
      }
      // Sólo con los seis de F2-230 sigue pendiente.
      expect((await solicitud(KEYS.a2)).body.pendiente).toBe(true);
      // El alta de un insumo por la sincronización forzada aparece en el panel.
      const nuevo = { origenSrId: 'I5', nombre: 'Tortilla de harina', unidadOrigenSrId: 'KG' };
      expect(
        (await pagina(KEYS.a2, 'unidades', 60, t, [{ origenSrId: 'KG', nombre: 'Kilo' }])).status,
      ).toBe(200);
      expect((await cierre(KEYS.a2, 'unidades', 60, t, 1)).status).toBe(200);
      const actuales = await prisma.insumo.findMany({
        where: { sucursalId: FX.sucursalA2 },
        select: { origenSrId: true, nombre: true, grupoOrigenSrId: true, unidadOrigenSrId: true },
      });
      expect((await pagina(KEYS.a2, 'insumos', 61, t, [...actuales, nuevo])).status).toBe(200);
      expect((await cierre(KEYS.a2, 'insumos', 61, t, actuales.length + 1)).status).toBe(200);
      for (const [i, c] of (['grupos_insumo', 'almacenes', 'proveedores'] as const).entries()) {
        expect((await solicitud(KEYS.a2)).body.pendiente).toBe(true);
        expect((await cierre(KEYS.a2, c, 62 + i, t, 0)).status).toBe(200);
      }
      expect((await solicitud(KEYS.a2)).body.pendiente).toBe(false);

      const lista = await get('/catalogos/insumos', USUARIOS.adminEmpresaA, {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA2,
        q: 'harina',
      });
      expect(lista.body.filas).toEqual([
        expect.objectContaining({ origenSrId: 'I5', unidad: 'Kilo', grupo: null, activo: true }),
      ]);
      // A1 no pidió nada: su solicitud no se enciende.
      expect((await solicitud(KEYS.a1)).body).toEqual({ solicitadaAt: null, pendiente: false });
    });
  });
});
