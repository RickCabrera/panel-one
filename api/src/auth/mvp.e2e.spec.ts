import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { configurarApp } from '../configurar-app';
import { TokensService } from './tokens.service';

// MVP (9-nov-2026): las rutas de las vistas ocultas a los clientes (Orquestador de menú,
// Comensales, Áreas y canales, Inventario y compras) están cerradas del lado del servidor con
// `@SoloInterno()` (auth/mvp.ts). Sobre la app REAL contra Postgres REAL, con el interruptor
// PRENDIDO (este archivo no lo mockea):
// - a admin_empresa y visor les responden 404 (nunca 403, ni 400 por parámetros: el guard va
//   antes que la validación), lean o escriban;
// - admin_global (el equipo interno) sí pasa;
// - lo que los clientes siguen viendo (Productos, Meseros, el estado de resultados de
//   Comparativos) sigue abierto.

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];
type Metodo = 'get' | 'post' | 'put' | 'patch';

const ID = '00000000-0000-4000-8000-000000000001';
const Q = { empresaId: FX.empresaA, desde: '2026-09-02', hasta: '2026-09-02' };

/** Cada ruta cerrada, con un método y una URL que existen. */
const CERRADAS: [Metodo, string][] = [
  ['get', '/catalogos/clientes'],
  ['get', '/catalogos/unidades'],
  ['get', '/catalogos/grupos-insumo'],
  ['get', '/catalogos/insumos'],
  ['get', '/catalogos/almacenes'],
  ['get', '/catalogos/proveedores'],
  ['get', '/catalogos/areas/mapeo'],
  ['put', `/catalogos/areas/${ID}/canal`],
  ['get', '/catalogos/menu'],
  ['get', '/catalogos/sin-catalogo'],
  ['get', '/catalogos/clientes/resumen'],
  ['get', `/catalogos/clientes/${ID}/ficha`],
  ['get', '/finanzas/compras'],
  ['get', `/finanzas/compras/${ID}`],
  ['get', '/finanzas/categorias-gasto'],
  ['post', '/finanzas/categorias-gasto'],
  ['patch', `/finanzas/categorias-gasto/${ID}`],
  ['get', '/finanzas/gastos'],
  ['post', '/finanzas/gastos'],
  ['patch', `/finanzas/gastos/${ID}`],
  ['post', `/finanzas/gastos/${ID}/anular`],
  ['get', '/inventario/existencias'],
  ['put', '/inventario/existencias/limites'],
  ['get', '/inventario/movimientos'],
  ['get', `/inventario/polizas/${ID}`],
  ['get', '/inventario/kardex'],
  ['get', '/inventario/recetas'],
  ['get', '/inventario/consumo-teorico'],
  ['get', '/inventario/proyecciones'],
  ['get', '/inventario/conteos'],
  ['post', '/inventario/conteos'],
  ['get', `/inventario/conteos/${ID}`],
  ['put', `/inventario/conteos/${ID}/partidas`],
  ['post', `/inventario/conteos/${ID}/cerrar`],
  ['post', `/inventario/conteos/${ID}/cancelar`],
  ['get', '/inventario/traspasos'],
  ['get', '/inventario/traspasos/sr'],
  ['post', '/inventario/traspasos'],
  ['get', `/inventario/traspasos/${ID}`],
  ['post', `/inventario/traspasos/${ID}/recibir`],
  ['post', `/inventario/traspasos/${ID}/cancelar`],
];

describe('MVP · rutas cerradas a los clientes (e2e)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const llamar = async (u: Usuario, metodo: Metodo, ruta: string) =>
    request(url)
      [metodo](ruta)
      .query(Q)
      .set('Authorization', `Bearer ${await token(u)}`)
      .send(metodo === 'get' ? undefined : {});

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
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

  it.each([
    ['admin_empresa', USUARIOS.adminEmpresaA],
    ['visor', USUARIOS.visorA],
  ])('%s: cada ruta cerrada da 404, lea o escriba', async (_rol, u) => {
    const resultado: string[] = [];
    for (const [metodo, ruta] of CERRADAS) {
      const res = await llamar(u, metodo, ruta);
      resultado.push(`${metodo.toUpperCase()} ${ruta} → ${res.status}`);
    }
    expect(resultado).toEqual(CERRADAS.map(([m, r]) => `${m.toUpperCase()} ${r} → 404`));
  });

  it('sin token sigue siendo 401 (el cierre no adelanta nada a un anónimo)', async () => {
    const res = await request(url).get('/inventario/existencias').query(Q);
    expect(res.status).toBe(401);
  });

  // Para los que SÍ pasan, la prueba es que la respuesta no sea la del cierre: ni 404 ni 403.
  // Lo que respondan después (200, o 400 porque esta prueba manda los mismos parámetros a todas)
  // ya es la ruta haciendo su trabajo, y eso lo prueban los e2e de cada vista.
  const pasa = (status: number) => status !== 404 && status !== 403;

  it('admin_global (equipo interno) pasa el cierre', async () => {
    for (const [metodo, ruta] of CERRADAS) {
      // Las de `:id` pueden dar 404 legítimo (el recurso inventado no existe): de ésas sólo se
      // exige que no sea 403.
      const res = await llamar(USUARIOS.adminGlobal, metodo, ruta);
      const ok = ruta.includes(ID) ? res.status !== 403 : pasa(res.status);
      expect([`${metodo} ${ruta}`, res.status, ok]).toEqual([
        `${metodo} ${ruta}`,
        res.status,
        true,
      ]);
    }
  });

  it('lo que el cliente sigue viendo no lo toca el cierre: Productos, Meseros, estado de resultados', async () => {
    for (const ruta of [
      '/catalogos/productos',
      '/catalogos/meseros',
      '/finanzas/estado-resultados',
    ]) {
      for (const u of [USUARIOS.visorA, USUARIOS.adminEmpresaA]) {
        const res = await llamar(u, 'get', ruta);
        expect([ruta, u.rol, res.status, pasa(res.status)]).toEqual([
          ruta,
          u.rol,
          res.status,
          true,
        ]);
      }
    }
    // Y el estado de resultados de Comparativos, con sus parámetros de verdad, responde 200.
    const res = await request(url)
      .get('/finanzas/estado-resultados')
      .query(Q)
      .set('Authorization', `Bearer ${await token(USUARIOS.visorA)}`);
    expect(res.status).toBe(200);
  });
});
