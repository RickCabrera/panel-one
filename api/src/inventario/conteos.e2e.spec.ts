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

// E2E de los conteos físicos (F2-123) sobre la app REAL contra Postgres REAL, con las fixtures
// sintéticas de F1-011. Las diferencias y los importes esperados están ESCRITOS A MANO: no se
// recalculan con la fórmula del API.
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const KEYS = {
  a1: 'msr_sintetica-conteos-F2-123-sucursal-a1-0000000000001',
  a2: 'msr_sintetica-conteos-F2-123-sucursal-a2-0000000000002',
  b1: 'msr_sintetica-conteos-F2-123-sucursal-b1-0000000000003',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];
type Registro = Record<string, unknown>;
interface Partida {
  insumoOrigenSrId: string;
  teorico: string | null;
  costoPromedio: string | null;
  contado: string | null;
  estado: string;
  diferencia: string | null;
  importe: string | null;
  insumo: string | null;
  unidad: string | null;
  grupo: string | null;
}

const BASE = Date.now() - 60 * 60_000;
const T = (n: number) => new Date(BASE + n * 60_000).toISOString();
const sinc = (n: number) => `f2123000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NO_EXISTE = 'f2123000-0000-4000-8000-0000000fffff';

/**
 * A1 · ALM1 (General): I1 12.5 × 30.00 · I2 3 × 19.99 · I3 7 × 12.00 · I9 2 × 5.00 (I9 sólo
 * viene en la foto, no en el catálogo). I4 está en el catálogo y NO en la foto: "sin teórico".
 */
const ALM1: Registro[] = [
  { insumoOrigenSrId: 'I1', cantidad: '12.5', costoPromedio: '30.00' },
  { insumoOrigenSrId: 'I2', cantidad: '3', costoPromedio: '19.99' },
  { insumoOrigenSrId: 'I3', cantidad: '7', costoPromedio: '12.00' },
  { insumoOrigenSrId: 'I9', cantidad: '2', costoPromedio: '5.00' },
];
/** A1 · ALM2 (Barra): 50 artículos X01…X50, cada uno 10 × 1.50 (para el conteo de ≥ 50). */
const X = Array.from({ length: 50 }, (_, i) => `X${String(i + 1).padStart(2, '0')}`);
const ALM2: Registro[] = X.map((x) => ({
  insumoOrigenSrId: x,
  cantidad: '10',
  costoPromedio: '1.50',
}));

describe('Conteos físicos (e2e, F2-123)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;
  const ids: Record<string, string> = {};

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const auth = async (u: Usuario) => `Bearer ${await token(u)}`;
  const listar = async (u: Usuario, query: Record<string, string>) =>
    request(url)
      .get('/inventario/conteos')
      .query(query)
      .set('Authorization', await auth(u));
  const detalle = async (u: Usuario, id: string, empresaId: string = FX.empresaA) =>
    request(url)
      .get(`/inventario/conteos/${id}`)
      .query({ empresaId })
      .set('Authorization', await auth(u));
  const crear = async (u: Usuario, body: Registro) =>
    request(url)
      .post('/inventario/conteos')
      .set('Authorization', await auth(u))
      .send({ empresaId: FX.empresaA, sucursalId: FX.sucursalA1, ...body });
  const capturar = async (
    u: Usuario,
    id: string,
    partidas: unknown[],
    empresaId: string = FX.empresaA,
  ) =>
    request(url)
      .put(`/inventario/conteos/${id}/partidas`)
      .set('Authorization', await auth(u))
      .send({ empresaId, partidas });
  const accion = async (
    u: Usuario,
    id: string,
    que: 'cerrar' | 'cancelar',
    empresaId: string = FX.empresaA,
  ) =>
    request(url)
      .post(`/inventario/conteos/${id}/${que}`)
      .set('Authorization', await auth(u))
      .send({ empresaId });
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
  const partidaDe = (body: { partidas: Partida[] }, insumo: string) =>
    body.partidas.find((p) => p.insumoOrigenSrId === insumo);
  const filasConteo = (conteoId: string) =>
    prisma.partidaConteo.findMany({
      where: { conteoId },
      orderBy: { insumoOrigenSrId: 'asc' },
      select: { insumoOrigenSrId: true, contado: true, capturadoAt: true, capturadoPor: true },
    });

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

    expect(
      (await catalogo(KEYS.a1, 'unidades', 1, [{ origenSrId: 'KG', nombre: 'Kilogramo' }])).status,
    ).toBe(200);
    await catalogo(KEYS.a1, 'grupos_insumo', 2, [
      { origenSrId: 'G1', nombre: 'Lácteos' },
      { origenSrId: 'G2', nombre: 'Verduras' },
      { origenSrId: 'G3', nombre: 'Vacío' },
    ]);
    await catalogo(KEYS.a1, 'insumos', 3, [
      { origenSrId: 'I1', nombre: 'Leche', grupoOrigenSrId: 'G1', unidadOrigenSrId: 'KG' },
      { origenSrId: 'I2', nombre: 'Tomate', grupoOrigenSrId: 'G2' },
      { origenSrId: 'I3', nombre: 'Cebolla', grupoOrigenSrId: 'G2' },
      { origenSrId: 'I4', nombre: 'Crema', grupoOrigenSrId: 'G1' },
    ]);
    await catalogo(KEYS.a1, 'almacenes', 4, [
      { origenSrId: 'ALM1', nombre: 'General' },
      { origenSrId: 'ALM2', nombre: 'Barra' },
      { origenSrId: 'ALM3', nombre: 'Bodega sin lectura' },
    ]);
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

  describe('crear', () => {
    it('todos los artículos: catálogo activo ∪ foto, teórico congelado de la foto', async () => {
      const r = await crear(USUARIOS.adminEmpresaA, { almacenOrigenSrId: 'ALM1', nota: 'Turno 1' });
      expect(r.status).toBe(201);
      ids.todos = r.body.conteo.id;
      expect(r.body.conteo).toMatchObject({
        folio: 1,
        sucursalId: FX.sucursalA1,
        almacenOrigenSrId: 'ALM1',
        almacen: 'General',
        grupoOrigenSrId: null,
        nota: 'Turno 1',
        estado: 'en_captura',
        teoricoCapturadoAt: T(1),
        teoricoAtrasado: false,
        articulos: 5,
        contados: 0,
        cerradoAt: null,
      });
      expect(r.body.partidas.map((p: Partida) => p.insumoOrigenSrId).sort()).toEqual([
        'I1',
        'I2',
        'I3',
        'I4',
        'I9',
      ]);
      expect(partidaDe(r.body, 'I1')).toMatchObject({
        insumo: 'Leche',
        unidad: 'Kilogramo',
        grupo: 'Lácteos',
        teorico: '12.500',
        costoPromedio: '30.00',
        contado: null,
        estado: 'sin_contar',
      });
      // En el catálogo y no en la foto: sin teórico, NUNCA 0.
      expect(partidaDe(r.body, 'I4')).toMatchObject({ teorico: null, costoPromedio: null });
      // Sólo en la foto: entra, con su teórico y sin nombre.
      expect(partidaDe(r.body, 'I9')).toMatchObject({ insumo: null, teorico: '2.000' });
    });

    it('una foto posterior NO cambia el teórico de un conteo ya creado', async () => {
      await foto(KEYS.a1, 'ALM1', T(2), [
        { insumoOrigenSrId: 'I1', cantidad: '99', costoPromedio: '1.00' },
      ]);
      const r = await detalle(USUARIOS.visorA, ids.todos);
      expect(r.status).toBe(200);
      expect(partidaDe(r.body, 'I1')).toMatchObject({ teorico: '12.500', costoPromedio: '30.00' });
      expect(r.body.conteo.teoricoCapturadoAt).toBe(T(1));
      // Se restaura la foto original para lo que sigue.
      await foto(KEYS.a1, 'ALM1', T(3), ALM1);
    });

    it('por grupo: sólo los del grupo según el catálogo (lo que sólo está en la foto, fuera)', async () => {
      const r = await crear(USUARIOS.adminEmpresaA, {
        almacenOrigenSrId: 'ALM1',
        grupoOrigenSrId: 'G2',
      });
      expect(r.status).toBe(201);
      ids.grupo = r.body.conteo.id;
      expect(r.body.conteo).toMatchObject({ folio: 2, grupo: 'Verduras', articulos: 2 });
      expect(r.body.partidas.map((p: Partida) => p.insumoOrigenSrId).sort()).toEqual(['I2', 'I3']);
    });

    it('almacén propio sin lectura = 409; ajeno, inexistente o grupo ajeno = 404', async () => {
      const sinLectura = await crear(USUARIOS.adminEmpresaA, { almacenOrigenSrId: 'ALM3' });
      expect(sinLectura.status).toBe(409);
      const r404 = [
        await crear(USUARIOS.adminEmpresaA, { almacenOrigenSrId: 'NOPE' }),
        // ALM9 es de A2, no de A1.
        await crear(USUARIOS.adminEmpresaA, { almacenOrigenSrId: 'ALM9' }),
        await crear(USUARIOS.adminEmpresaA, { almacenOrigenSrId: 'ALM1', grupoOrigenSrId: 'GX' }),
        // Sucursal de otra empresa.
        await crear(USUARIOS.adminEmpresaA, {
          sucursalId: FX.sucursalB1,
          almacenOrigenSrId: 'ALM1',
        }),
        // Admin global con la empresa B y una sucursal de A.
        await crear(USUARIOS.adminGlobal, { empresaId: FX.empresaB, almacenOrigenSrId: 'ALM1' }),
      ];
      for (const r of r404) {
        expect(r.status).toBe(404);
        expect(r.body).toEqual(r404[0].body);
      }
    });

    it('un grupo sin artículos = 400; el visor no crea (403)', async () => {
      const vacio = await crear(USUARIOS.adminEmpresaA, {
        almacenOrigenSrId: 'ALM1',
        grupoOrigenSrId: 'G3',
      });
      expect(vacio.status).toBe(400);
      expect((await crear(USUARIOS.visorA, { almacenOrigenSrId: 'ALM1' })).status).toBe(403);
      expect(await prisma.conteoFisico.count({ where: { sucursalId: FX.sucursalA1 } })).toBe(2);
    });
  });

  describe('captura y reporte', () => {
    const LOTE = [
      { insumoOrigenSrId: 'I1', contado: '10' },
      { insumoOrigenSrId: 'I2', contado: '4.25' },
      { insumoOrigenSrId: 'I3', contado: '7' },
      { insumoOrigenSrId: 'I4', contado: '3' },
    ];

    it('reporte de diferencias con literales a mano; Σ de renglones = totales', async () => {
      const c = await capturar(USUARIOS.adminEmpresaA, ids.todos, LOTE);
      expect(c.status).toBe(200);
      expect(c.body.guardadas).toEqual([
        { insumoOrigenSrId: 'I1', contado: '10.000' },
        { insumoOrigenSrId: 'I2', contado: '4.250' },
        { insumoOrigenSrId: 'I3', contado: '7.000' },
        { insumoOrigenSrId: 'I4', contado: '3.000' },
      ]);
      const r = await detalle(USUARIOS.visorA, ids.todos);
      // I1: 10 − 12.5 = −2.5 × 30.00 = −75.00 · I2: 4.25 − 3 = 1.25 × 19.99 = 24.9875 → 24.99 ·
      // I3 cuadra · I4 sin teórico · I9 sin contar.
      expect(partidaDe(r.body, 'I1')).toMatchObject({
        estado: 'con_diferencia',
        diferencia: '-2.500',
        importe: '-75.00',
      });
      expect(partidaDe(r.body, 'I2')).toMatchObject({ diferencia: '1.250', importe: '24.99' });
      expect(partidaDe(r.body, 'I3')).toMatchObject({
        estado: 'cuadra',
        diferencia: '0.000',
        importe: '0.00',
      });
      expect(partidaDe(r.body, 'I4')).toMatchObject({
        estado: 'sin_teorico',
        contado: '3.000',
        importe: null,
      });
      expect(partidaDe(r.body, 'I9')).toMatchObject({ estado: 'sin_contar', importe: null });
      expect(r.body.totales).toEqual({
        articulos: 5,
        contados: 4,
        sinContar: 1,
        sinTeorico: 1,
        conDiferencia: 2,
        sinValuar: 0,
        faltante: '-75.00',
        sobrante: '24.99',
        neto: '-50.01',
      });
      const suma = (r.body.partidas as Partida[])
        .filter((p) => p.importe !== null)
        .reduce((s, p) => s + Math.round(Number(p.importe) * 100), 0);
      expect(suma).toBe(-5001);
      expect(r.body.conteo.contados).toBe(4);
    });

    it('idempotente: el mismo lote ×3 deja exactamente las mismas filas (ni capturado_at se mueve)', async () => {
      const antes = await filasConteo(ids.todos);
      for (let i = 0; i < 3; i++) {
        expect((await capturar(USUARIOS.adminEmpresaA, ids.todos, LOTE)).status).toBe(200);
      }
      expect(await filasConteo(ids.todos)).toEqual(antes);
    });

    it('todo o nada: un artículo ajeno o repetido = 400 y no se guarda nada del lote', async () => {
      const antes = await filasConteo(ids.todos);
      const ajeno = await capturar(USUARIOS.adminEmpresaA, ids.todos, [
        { insumoOrigenSrId: 'I1', contado: '11' },
        { insumoOrigenSrId: 'X01', contado: '1' },
      ]);
      expect(ajeno.status).toBe(400);
      const repetido = await capturar(USUARIOS.adminEmpresaA, ids.todos, [
        { insumoOrigenSrId: 'I1', contado: '11' },
        { insumoOrigenSrId: 'I1', contado: '12' },
      ]);
      expect(repetido.status).toBe(400);
      expect(await filasConteo(ids.todos)).toEqual(antes);
    });

    it('cantidades inválidas = 400, nunca se redondean', async () => {
      for (const contado of ['1.2345', '-1', 'abc', '', 5]) {
        const r = await capturar(USUARIOS.adminEmpresaA, ids.todos, [
          { insumoOrigenSrId: 'I1', contado },
        ]);
        expect(r.status).toBe(400);
      }
      const sinCampo = await capturar(USUARIOS.adminEmpresaA, ids.todos, [
        { insumoOrigenSrId: 'I1' },
      ]);
      expect(sinCampo.status).toBe(400);
      expect((await capturar(USUARIOS.adminEmpresaA, ids.todos, [])).status).toBe(400);
      const r = await detalle(USUARIOS.visorA, ids.todos);
      expect(partidaDe(r.body, 'I1')?.contado).toBe('10.000');
    });

    it('nulo borra lo capturado (vuelve a "sin contar", no a 0)', async () => {
      await capturar(USUARIOS.adminEmpresaA, ids.todos, [
        { insumoOrigenSrId: 'I3', contado: null },
      ]);
      let r = await detalle(USUARIOS.visorA, ids.todos);
      expect(partidaDe(r.body, 'I3')).toMatchObject({ contado: null, estado: 'sin_contar' });
      await capturar(USUARIOS.adminEmpresaA, ids.todos, [{ insumoOrigenSrId: 'I3', contado: '7' }]);
      r = await detalle(USUARIOS.visorA, ids.todos);
      expect(partidaDe(r.body, 'I3')).toMatchObject({ contado: '7.000', estado: 'cuadra' });
    });

    it('el visor ve pero no captura (403)', async () => {
      expect(
        (await capturar(USUARIOS.visorA, ids.todos, [{ insumoOrigenSrId: 'I1', contado: '1' }]))
          .status,
      ).toBe(403);
      expect((await accion(USUARIOS.visorA, ids.todos, 'cerrar')).status).toBe(403);
    });

    it('conteo de ≥ 50 artículos: captura en lotes, reenvío ×3 idéntico, reporte cuadrado', async () => {
      const r = await crear(USUARIOS.adminEmpresaA, { almacenOrigenSrId: 'ALM2' });
      expect(r.status).toBe(201);
      ids.cincuenta = r.body.conteo.id;
      // 4 del catálogo (sin teórico en la Barra) + los 50 de la foto.
      expect(r.body.conteo.articulos).toBe(54);
      // X01…X25 cuadran (10); X26…X50 faltan 0.5 cada uno: −0.5 × 1.50 = −0.75 × 25 = −18.75.
      const lote = X.map((x, i) => ({ insumoOrigenSrId: x, contado: i < 25 ? '10' : '9.5' }));
      for (let vuelta = 0; vuelta < 3; vuelta++) {
        expect(
          (await capturar(USUARIOS.adminEmpresaA, ids.cincuenta, lote.slice(0, 20))).status,
        ).toBe(200);
        expect((await capturar(USUARIOS.adminEmpresaA, ids.cincuenta, lote.slice(20))).status).toBe(
          200,
        );
      }
      const d = await detalle(USUARIOS.adminEmpresaA, ids.cincuenta);
      expect(d.body.totales).toMatchObject({
        articulos: 54,
        contados: 50,
        sinContar: 4,
        conDiferencia: 25,
        faltante: '-18.75',
        sobrante: '0.00',
        neto: '-18.75',
      });
      expect(await prisma.partidaConteo.count({ where: { conteoId: ids.cincuenta } })).toBe(54);
    });
  });

  describe('cierre, cancelación y concurrencia', () => {
    it('cerrar congela: capturar después = 409, y cerrar o cancelar otra vez = 409', async () => {
      const r = await accion(USUARIOS.adminEmpresaA, ids.todos, 'cerrar');
      expect(r.status).toBe(200);
      expect(r.body.conteo.estado).toBe('cerrado');
      expect(r.body.conteo.cerradoAt).not.toBeNull();
      expect(r.body.totales.neto).toBe('-50.01');
      const antes = await filasConteo(ids.todos);
      expect(
        (
          await capturar(USUARIOS.adminEmpresaA, ids.todos, [
            { insumoOrigenSrId: 'I9', contado: '2' },
          ])
        ).status,
      ).toBe(409);
      expect((await accion(USUARIOS.adminEmpresaA, ids.todos, 'cerrar')).status).toBe(409);
      expect((await accion(USUARIOS.adminEmpresaA, ids.todos, 'cancelar')).status).toBe(409);
      expect(await filasConteo(ids.todos)).toEqual(antes);
    });

    it('cancelar un conteo en captura; después no admite captura', async () => {
      const r = await accion(USUARIOS.adminEmpresaA, ids.grupo, 'cancelar');
      expect(r.status).toBe(200);
      expect(r.body.conteo).toMatchObject({ estado: 'cancelado', cerradoAt: null });
      expect(
        (
          await capturar(USUARIOS.adminEmpresaA, ids.grupo, [
            { insumoOrigenSrId: 'I2', contado: '1' },
          ])
        ).status,
      ).toBe(409);
    });

    it('captura y cierre concurrentes: nada se escribe después del cierre', async () => {
      const nuevo = await crear(USUARIOS.adminEmpresaA, { almacenOrigenSrId: 'ALM1' });
      const id = nuevo.body.conteo.id as string;
      const capturas = ['I1', 'I2', 'I3', 'I4', 'I9'].map((insumo, i) =>
        capturar(USUARIOS.adminEmpresaA, id, [
          { insumoOrigenSrId: insumo, contado: String(i + 1) },
        ]),
      );
      const [cierre, ...resultados] = await Promise.all([
        accion(USUARIOS.adminEmpresaA, id, 'cerrar'),
        ...capturas,
      ]);
      expect(cierre.status).toBe(200);
      for (const r of resultados) expect([200, 409]).toContain(r.status);
      const conteo = await prisma.conteoFisico.findUniqueOrThrow({ where: { id } });
      const filas = await filasConteo(id);
      for (const f of filas) {
        if (f.capturadoAt) {
          expect(f.capturadoAt.getTime()).toBeLessThanOrEqual(conteo.cerradoAt!.getTime());
        }
      }
      // Cada 200 dejó su valor; cada 409 no dejó nada.
      const guardados = filas.filter((f) => f.contado !== null).length;
      expect(guardados).toBe(resultados.filter((r) => r.status === 200).length);
    });
  });

  describe('alcance', () => {
    it('lista: avance por conteo, almacenes (con y sin lectura) y grupos; nada de B', async () => {
      const r = await listar(USUARIOS.visorA, { empresaId: FX.empresaA });
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(4);
      const todos = r.body.conteos.find((c: { id: string }) => c.id === ids.todos);
      expect(todos).toMatchObject({ estado: 'cerrado', articulos: 5, contados: 4 });
      const alm3 = r.body.almacenes.find(
        (a: { almacenOrigenSrId: string }) => a.almacenOrigenSrId === 'ALM3',
      );
      expect(alm3).toMatchObject({ almacen: 'Bodega sin lectura', capturadoAt: null });
      expect(r.body.grupos.map((g: { grupo: string }) => g.grupo)).toEqual([
        'Lácteos',
        'Vacío',
        'Verduras',
      ]);
      const filtrado = await listar(USUARIOS.visorA, {
        empresaId: FX.empresaA,
        estado: 'cancelado',
      });
      expect(filtrado.body.conteos.map((c: { id: string }) => c.id)).toEqual([ids.grupo]);
      const deB = await listar(USUARIOS.visorB, { empresaId: FX.empresaB });
      expect(deB.body.conteos).toEqual([]);
    });

    it('404 uniforme: conteo de otra empresa, empresa ajena o inexistente', async () => {
      const casos = [
        await detalle(USUARIOS.visorB, ids.todos, FX.empresaB),
        await detalle(USUARIOS.visorB, ids.todos, FX.empresaA),
        await detalle(USUARIOS.adminGlobal, ids.todos, FX.empresaB),
        await detalle(USUARIOS.visorA, NO_EXISTE),
        await capturar(
          USUARIOS.adminGlobal,
          ids.cincuenta,
          [{ insumoOrigenSrId: 'X01', contado: '1' }],
          FX.empresaB,
        ),
        await accion(USUARIOS.adminGlobal, ids.cincuenta, 'cerrar', FX.empresaB),
        await listar(USUARIOS.visorB, { empresaId: FX.empresaA }),
      ];
      for (const r of casos) {
        expect(r.status).toBe(404);
        expect(r.body).toEqual(casos[0].body);
      }
      const d = await detalle(USUARIOS.adminEmpresaA, ids.cincuenta);
      expect(d.body.conteo.estado).toBe('en_captura');
    });

    it('sin token = 401', async () => {
      expect(
        (await request(url).get('/inventario/conteos').query({ empresaId: FX.empresaA })).status,
      ).toBe(401);
    });
  });

  describe('nunca escribe a SoftRestaurant (ni al espejo de SR)', () => {
    const espejo = async () => {
      const deEstas = {
        where: { sucursalId: { in: [FX.sucursalA1, FX.sucursalA2, FX.sucursalB1] } },
      };
      const orden = { orderBy: { id: 'asc' as const } };
      return JSON.stringify([
        await prisma.existencia.findMany({ ...deEstas, ...orden }),
        await prisma.lecturaExistencias.findMany({ ...deEstas, ...orden }),
        await prisma.limiteExistencia.findMany({ ...deEstas, ...orden }),
        await prisma.polizaInventario.findMany({ ...deEstas, ...orden }),
        await prisma.movimientoInventario.findMany({ ...deEstas, ...orden }),
        await prisma.insumo.findMany({ ...deEstas, ...orden }),
        await prisma.grupoInsumo.findMany({ ...deEstas, ...orden }),
        await prisma.almacenCatalogo.findMany({ ...deEstas, ...orden }),
        await prisma.unidadCatalogo.findMany({ ...deEstas, ...orden }),
        await prisma.sincronizacionCatalogo.findMany({
          ...deEstas,
          orderBy: [{ sucursalId: 'asc' }, { catalogo: 'asc' }],
        }),
        await prisma.solicitudSincronizacion.findMany({
          ...deEstas,
          orderBy: { sucursalId: 'asc' },
        }),
        await prisma.agenteEstado.findMany({ ...deEstas, orderBy: { sucursalId: 'asc' } }),
      ]);
    };

    it('crear, capturar, cerrar y cancelar dejan idénticas las tablas espejo de SR', async () => {
      const antes = await espejo();
      const a = await crear(USUARIOS.adminEmpresaA, { almacenOrigenSrId: 'ALM1' });
      await capturar(USUARIOS.adminEmpresaA, a.body.conteo.id, [
        { insumoOrigenSrId: 'I1', contado: '1' },
      ]);
      await accion(USUARIOS.adminEmpresaA, a.body.conteo.id, 'cerrar');
      const b = await crear(USUARIOS.adminEmpresaA, { almacenOrigenSrId: 'ALM2' });
      await accion(USUARIOS.adminEmpresaA, b.body.conteo.id, 'cancelar');
      expect(await espejo()).toBe(antes);
    });

    it('el agente no alcanza ninguna ruta de conteos con su API key (401)', async () => {
      const conKey = [
        request(url).get('/inventario/conteos').query({ empresaId: FX.empresaA }),
        request(url).get(`/inventario/conteos/${ids.todos}`).query({ empresaId: FX.empresaA }),
        request(url).post('/inventario/conteos').send({}),
        request(url).put(`/inventario/conteos/${ids.todos}/partidas`).send({}),
        request(url).post(`/inventario/conteos/${ids.todos}/cerrar`).send({}),
        request(url).post(`/inventario/conteos/${ids.todos}/cancelar`).send({}),
      ];
      for (const r of await Promise.all(conKey.map((q) => q.set('X-Api-Key', KEYS.a1)))) {
        expect(r.status).toBe(401);
      }
    });
  });
});
