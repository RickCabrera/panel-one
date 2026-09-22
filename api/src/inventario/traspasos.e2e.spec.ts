import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, RolUsuario } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, DOMINIO, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AlertasService } from '../alertas/alertas.service';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';

// E2E de los traspasos (F2-124) sobre la app REAL contra Postgres REAL, con las fixtures
// sintéticas de F1-011 y un reloj fijo que se mueve a mano. Lo esperado (importes, qué concilia y
// qué no, cuándo abre la alerta) está ESCRITO A MANO, no recalculado con la regla del API.
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const KEYS = {
  a1: 'msr_sintetica-traspasos-F2-124-sucursal-a1-00000000001',
  a2: 'msr_sintetica-traspasos-F2-124-sucursal-a2-00000000002',
  b1: 'msr_sintetica-traspasos-F2-124-sucursal-b1-00000000003',
} as const;

const H = 3_600_000;
/** 10-sep-2026 09:00 en CDMX (15:00Z). Las fixtures están en America/Mexico_City. */
const T0 = Date.parse('2026-09-10T15:00:00Z');
const iso = (ms: number) => new Date(ms).toISOString();
const sinc = (n: number) => `f2124000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NO_EXISTE = 'f2124000-0000-4000-8000-0000000fffff';

const ADMIN_B = {
  id: 'f2124000-0000-4000-8000-000000000b0b',
  email: `admin.b.traspasos${DOMINIO}`,
  rol: RolUsuario.admin_empresa,
  empresaId: FX.empresaB,
  activo: true,
} as const;

class RelojFijo extends Reloj {
  t = T0;
  override ahora(): number {
    return this.t;
  }
}

type Usuario = { id: string; rol: RolUsuario; empresaId: string | null };
type Registro = Record<string, unknown>;
interface Espejo {
  folio: string;
  renglon: number;
}
interface Partida {
  insumoOrigenSrId: string;
  cantidad: string;
  costoUnitario: string | null;
  importe: string | null;
  salida: Espejo | null;
  entrada: Espejo | null;
}

describe('Traspasos (e2e, F2-124)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojFijo();
  let app: NestExpressApplication;
  let url: string;
  let alertas: AlertasService;
  const ids: Record<string, string> = {};
  let leido = 0;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const auth = async (u: Usuario) => `Bearer ${await token(u)}`;
  const listar = async (u: Usuario, query: Record<string, string>) =>
    request(url)
      .get('/inventario/traspasos')
      .query(query)
      .set('Authorization', await auth(u));
  const detalle = async (u: Usuario, id: string, empresaId: string = FX.empresaA) =>
    request(url)
      .get(`/inventario/traspasos/${id}`)
      .query({ empresaId })
      .set('Authorization', await auth(u));
  const enviar = async (u: Usuario, body: Registro) =>
    request(url)
      .post('/inventario/traspasos')
      .set('Authorization', await auth(u))
      .send({
        empresaId: FX.empresaA,
        sucursalOrigenId: FX.sucursalA1,
        almacenOrigenSrId: 'GEN',
        sucursalDestinoId: FX.sucursalA2,
        almacenDestinoSrId: 'GEN',
        ...body,
      });
  const accion = async (
    u: Usuario,
    id: string,
    que: 'recibir' | 'cancelar',
    empresaId: string = FX.empresaA,
  ) =>
    request(url)
      .post(`/inventario/traspasos/${id}/${que}`)
      .set('Authorization', await auth(u))
      .send({ empresaId });
  const catalogo = (key: string, cat: string, n: number, registros: Registro[]) =>
    request(url)
      .post('/ingesta/catalogos')
      .set('X-Api-Key', key)
      .send({ catalogo: cat, sincronizacionId: sinc(n), capturadoAt: iso(T0 - H), registros });
  const foto = (key: string, almacen: string, registros: Registro[]) =>
    request(url)
      .post('/ingesta/existencias')
      .set('X-Api-Key', key)
      .send({ almacenOrigenSrId: almacen, capturadoAt: iso(T0 - H), registros });
  /** Una póliza de SR (una partida por insumo). */
  const poliza = (
    id: string,
    tipo: 'traspaso_salida' | 'traspaso_entrada' | 'consumo',
    almacen: string,
    fecha: number,
    partidas: Array<[string, string]>,
    extra: Registro = {},
  ) => ({
    origenSrId: id,
    folio: id,
    tipo,
    almacenOrigenSrId: almacen,
    fecha: iso(fecha),
    referencia: null,
    cancelada: false,
    partidas: partidas.map(([insumo, cantidad]) => ({
      insumoOrigenSrId: insumo,
      cantidad,
      costoUnitario: '30.00',
    })),
    ...extra,
  });
  /** Cada lote se lee "después" del anterior: una corrección siempre gana. */
  const lote = async (key: string, polizas: Registro[]) => {
    const r = await request(url)
      .post('/ingesta/movimientos')
      .set('X-Api-Key', key)
      .send({ leidoAt: iso(reloj.t - 60_000 + ++leido), polizas });
    expect(r.status).toBe(200);
    expect(r.body.rechazadas).toEqual([]);
    return r;
  };
  const vuelta = () => alertas.evaluarEmpresa(FX.empresaA);
  const resumen = async (id: string) => (await detalle(USUARIOS.adminEmpresaA, id)).body;
  const abiertas = () =>
    prisma.alerta.findMany({
      where: { empresaId: FX.empresaA, tipo: 'traspaso_sin_conciliar', cerradaAt: null },
      select: { llave: true, detalle: true },
      orderBy: { llave: 'asc' },
    });
  const filas = () =>
    prisma.partidaTraspaso.findMany({
      where: { empresaId: FX.empresaA },
      orderBy: { id: 'asc' },
    });
  const espejoSr = async () => ({
    polizas: await prisma.polizaInventario.findMany({ orderBy: { id: 'asc' } }),
    movimientos: await prisma.movimientoInventario.count(),
    existencias: await prisma.existencia.findMany({ orderBy: { id: 'asc' } }),
    lecturas: await prisma.lecturaExistencias.findMany({ orderBy: { id: 'asc' } }),
    insumos: await prisma.insumo.findMany({ orderBy: { id: 'asc' } }),
  });

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.usuario.create({
      data: { ...ADMIN_B, nombre: 'Admin B traspasos', passwordHash: 'no-se-usa' },
    });
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

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    alertas = app.get(AlertasService);

    let n = 0;
    for (const key of [KEYS.a1, KEYS.a2, KEYS.b1]) {
      expect(
        (
          await catalogo(key, 'almacenes', ++n, [
            { origenSrId: 'GEN', nombre: 'General' },
            { origenSrId: 'BAR', nombre: 'Barra' },
          ])
        ).status,
      ).toBe(200);
      await catalogo(key, 'insumos', ++n, [
        { origenSrId: 'I1', nombre: 'Leche' },
        { origenSrId: 'I2', nombre: 'Tomate' },
        { origenSrId: 'I3', nombre: 'Cebolla' },
      ]);
    }
    // A1 · GEN: I1 10 × 30.00, I2 5 × 19.99. I3 está en el catálogo y NO en la foto (sin costo).
    expect(
      (
        await foto(KEYS.a1, 'GEN', [
          { insumoOrigenSrId: 'I1', cantidad: '10', costoPromedio: '30.00' },
          { insumoOrigenSrId: 'I2', cantidad: '5', costoPromedio: '19.99' },
        ])
      ).body.rechazados,
    ).toEqual([]);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('enviar', () => {
    it('A1·GEN → A2·GEN: 201, folio 1, pendiente de SR, costo congelado de la foto de origen', async () => {
      const antes = await espejoSr();
      reloj.t = T0;
      const r = await enviar(USUARIOS.adminEmpresaA, {
        nota: 'Pedido del lunes',
        partidas: [
          { insumoOrigenSrId: 'I1', cantidad: '2.5' },
          { insumoOrigenSrId: 'I3', cantidad: '1' },
        ],
      });
      expect(r.status).toBe(201);
      ids.t1 = r.body.traspaso.id;
      expect(r.body.traspaso).toMatchObject({
        folio: 1,
        sucursal: 'A1',
        almacenOrigen: 'General',
        sucursalDestino: 'A2',
        almacenDestino: 'General',
        nota: 'Pedido del lunes',
        estado: 'enviado',
        conciliacion: 'pendiente_sr',
        enviadoAt: iso(T0),
        recibidoAt: null,
        conciliadoAt: null,
        articulos: 2,
        conciliados: 0,
      });
      // 2.5 × 30.00 = 75.00; I3 sin costo: no suma y se cuenta aparte.
      expect(r.body.partidas).toEqual([
        expect.objectContaining({
          insumoOrigenSrId: 'I3',
          insumo: 'Cebolla',
          cantidad: '1.000',
          costoUnitario: null,
          importe: null,
          salida: null,
          entrada: null,
        }),
        expect.objectContaining({
          insumoOrigenSrId: 'I1',
          insumo: 'Leche',
          cantidad: '2.500',
          costoUnitario: '30.00',
          importe: '75.00',
        }),
      ]);
      expect(r.body.totales).toEqual({ importe: '75.00', sinCosto: 1 });
      // Enviar no toca el espejo de SR.
      expect(await espejoSr()).toEqual(antes);
    });

    it('el folio es por EMPRESA: A1·GEN → A1·BAR es el 2 (enviado a T0 + 2 h)', async () => {
      reloj.t = T0 + 2 * H;
      const r = await enviar(USUARIOS.adminGlobal, {
        sucursalDestinoId: FX.sucursalA1,
        almacenDestinoSrId: 'BAR',
        partidas: [{ insumoOrigenSrId: 'I2', cantidad: '1' }],
      });
      expect(r.status).toBe(201);
      ids.t2 = r.body.traspaso.id;
      // 1 × 19.99
      expect(r.body.traspaso).toMatchObject({ folio: 2, almacenDestino: 'Barra' });
      expect(r.body.totales).toEqual({ importe: '19.99', sinCosto: 0 });
    });

    it('rechaza lo inválido sin crear nada', async () => {
      const antes = await prisma.traspaso.count();
      const casos: Array<[Registro, number]> = [
        [
          {
            sucursalDestinoId: FX.sucursalA1,
            partidas: [{ insumoOrigenSrId: 'I1', cantidad: '1' }],
          },
          400,
        ],
        [{ partidas: [{ insumoOrigenSrId: 'IX', cantidad: '1' }] }, 400],
        [{ partidas: [{ insumoOrigenSrId: 'I1', cantidad: '0' }] }, 400],
        [{ partidas: [{ insumoOrigenSrId: 'I1', cantidad: '-1' }] }, 400],
        [{ partidas: [{ insumoOrigenSrId: 'I1', cantidad: '1.0001' }] }, 400],
        [
          {
            partidas: [
              { insumoOrigenSrId: 'I1', cantidad: '1' },
              { insumoOrigenSrId: 'I1', cantidad: '2' },
            ],
          },
          400,
        ],
        [{ partidas: [] }, 400],
        [{ almacenOrigenSrId: 'ALMX', partidas: [{ insumoOrigenSrId: 'I1', cantidad: '1' }] }, 404],
        [
          { almacenDestinoSrId: 'ALMX', partidas: [{ insumoOrigenSrId: 'I1', cantidad: '1' }] },
          404,
        ],
        [
          {
            sucursalDestinoId: FX.sucursalB1,
            partidas: [{ insumoOrigenSrId: 'I1', cantidad: '1' }],
          },
          404,
        ],
        [
          { sucursalOrigenId: NO_EXISTE, partidas: [{ insumoOrigenSrId: 'I1', cantidad: '1' }] },
          404,
        ],
      ];
      for (const [body, status] of casos) {
        const r = await enviar(USUARIOS.adminEmpresaA, body);
        expect({ body, status: r.status }).toEqual({ body, status });
      }
      expect(await prisma.traspaso.count()).toBe(antes);
    });

    it('visor de la misma empresa = 403; admin de OTRA empresa = 404 (nunca 403)', async () => {
      const cuerpo = { partidas: [{ insumoOrigenSrId: 'I1', cantidad: '1' }] };
      expect((await enviar(USUARIOS.visorA, cuerpo)).status).toBe(403);
      expect((await enviar(ADMIN_B, cuerpo)).status).toBe(404);
      expect((await accion(ADMIN_B, ids.t1, 'recibir')).status).toBe(404);
      expect((await accion(ADMIN_B, ids.t1, 'cancelar')).status).toBe(404);
      expect((await detalle(ADMIN_B, ids.t1)).status).toBe(404);
      // Con SU empresa: el traspaso de A no existe para B.
      expect((await detalle(ADMIN_B, ids.t1, FX.empresaB)).status).toBe(404);
      expect((await accion(ADMIN_B, ids.t1, 'recibir', FX.empresaB)).status).toBe(404);
      expect((await detalle(USUARIOS.adminEmpresaA, NO_EXISTE)).status).toBe(404);
    });

    it('la API key del agente no alcanza ninguna ruta de traspasos (401)', async () => {
      const rutas = [
        request(url).get('/inventario/traspasos').query({ empresaId: FX.empresaA }),
        request(url)
          .get('/inventario/traspasos/sr')
          .query({ empresaId: FX.empresaA, desde: '2026-09-10', hasta: '2026-09-10' }),
        request(url).get(`/inventario/traspasos/${ids.t1}`).query({ empresaId: FX.empresaA }),
        request(url).post('/inventario/traspasos').send({ empresaId: FX.empresaA }),
        request(url)
          .post(`/inventario/traspasos/${ids.t1}/recibir`)
          .send({ empresaId: FX.empresaA }),
        request(url)
          .post(`/inventario/traspasos/${ids.t1}/cancelar`)
          .send({ empresaId: FX.empresaA }),
      ];
      for (const r of rutas) expect((await r.set('X-Api-Key', KEYS.a1)).status).toBe(401);
    });
  });

  describe('conciliación automática', () => {
    it('prepara los traspasos 3 a 8 (todos A1·GEN → A2·GEN, a T0 + 1 h)', async () => {
      reloj.t = T0 + H;
      const mandar = async (clave: string, insumo: string, cantidad: string) => {
        const r = await enviar(USUARIOS.adminEmpresaA, {
          partidas: [{ insumoOrigenSrId: insumo, cantidad }],
        });
        expect(r.status).toBe(201);
        ids[clave] = r.body.traspaso.id;
      };
      await mandar('t3', 'I2', '0.5'); // salida sólo FUERA de la ventana (+25 h)
      await mandar('t4', 'I2', '0.75'); // cantidad distinta en SR
      await mandar('t5', 'I2', '0.25'); // póliza de SR cancelada
      await mandar('t6', 'I2', '3'); // t6 y t7 idénticos, SR sólo tiene uno
      await mandar('t7', 'I2', '3');
      await mandar('t8', 'I2', '1.5'); // espejos en otra sucursal, otro almacén, otra empresa
    });

    it('sin nada en SR, la vuelta no concilia nada', async () => {
      reloj.t = T0 + 26 * H;
      const antes = await filas();
      await vuelta();
      expect(await filas()).toEqual(antes);
      expect((await resumen(ids.t1)).traspaso.conciliacion).toBe('pendiente_sr');
    });

    it('llega SR: cada traspaso se concilia (o no) según artículo + cantidad + fecha ± 1 día', async () => {
      // A1 (origen): salidas del almacén GEN.
      await lote(KEYS.a1, [
        // t1: a +23 h de su envío (T0). Dos renglones.
        poliza(
          'S-T1',
          'traspaso_salida',
          'GEN',
          T0 + 23 * H,
          [
            ['I1', '-2.5'],
            ['I3', '-1'],
          ],
          { referencia: 'TR-1' },
        ),
        // t3: a +25 h de su envío (T0 + 1 h): fuera.
        poliza('S-T3-LEJOS', 'traspaso_salida', 'GEN', T0 + 26 * H, [['I2', '-0.5']]),
        // t4: cantidad distinta.
        poliza('S-T4', 'traspaso_salida', 'GEN', T0 + 2 * H, [['I2', '-0.7']]),
        // t5: cancelada.
        poliza('S-T5', 'traspaso_salida', 'GEN', T0 + 2 * H, [['I2', '-0.25']], {
          cancelada: true,
        }),
        // t6/t7: UNA salida de 3.
        poliza('S-T6', 'traspaso_salida', 'GEN', T0 + 2 * H, [['I2', '-3']]),
        // t8: salida en el almacén equivocado (BAR).
        poliza('S-T8-BAR', 'traspaso_salida', 'BAR', T0 + 2 * H, [['I2', '-1.5']]),
        // Un consumo con la misma forma NO es un traspaso.
        poliza('C-T8', 'consumo', 'GEN', T0 + 2 * H, [['I2', '-1.5']]),
      ]);
      // A2 (destino): entradas a GEN.
      await lote(KEYS.a2, [
        poliza(
          'E-T1',
          'traspaso_entrada',
          'GEN',
          T0 + 23 * H,
          [
            ['I1', '2.5'],
            ['I3', '1'],
          ],
          { referencia: 'TR-1' },
        ),
        poliza('E-T3', 'traspaso_entrada', 'GEN', T0 + 2 * H, [['I2', '0.5']]),
        poliza('E-T4', 'traspaso_entrada', 'GEN', T0 + 2 * H, [['I2', '0.7']]),
        poliza('E-T5', 'traspaso_entrada', 'GEN', T0 + 2 * H, [['I2', '0.25']]),
        poliza('E-T6', 'traspaso_entrada', 'GEN', T0 + 2 * H, [['I2', '3']]),
        // t8: la SALIDA en la sucursal de destino, no en la de origen.
        poliza('S-T8-A2', 'traspaso_salida', 'GEN', T0 + 2 * H, [['I2', '-1.5']]),
        poliza('E-T8', 'traspaso_entrada', 'GEN', T0 + 2 * H, [['I2', '1.5']]),
      ]);
      // t8: idéntica en OTRA empresa (B1, mismo almacén y clave).
      await lote(KEYS.b1, [
        poliza('S-T8-B', 'traspaso_salida', 'GEN', T0 + 2 * H, [['I2', '-1.5']]),
      ]);

      await vuelta();

      const t1 = await resumen(ids.t1);
      expect(t1.traspaso).toMatchObject({
        conciliacion: 'conciliado',
        conciliadoAt: iso(T0 + 26 * H),
        conciliados: 2,
      });
      const i1 = t1.partidas.find((p: Partida) => p.insumoOrigenSrId === 'I1');
      // Los renglones de una póliza cuentan desde 0 (así los numera la ingesta de F2-122).
      expect(i1.salida).toMatchObject({ folio: 'S-T1', renglon: 0, referencia: 'TR-1' });
      expect(i1.entrada).toMatchObject({ folio: 'E-T1', renglon: 0 });
      const i3 = t1.partidas.find((p: Partida) => p.insumoOrigenSrId === 'I3');
      expect(i3.salida).toMatchObject({ folio: 'S-T1', renglon: 1 });
      expect(i3.entrada).toMatchObject({ folio: 'E-T1', renglon: 1 });

      // t3: la entrada sí, la salida está a +25 h → pendiente (0 renglones completos).
      const t3 = await resumen(ids.t3);
      expect(t3.traspaso).toMatchObject({ conciliacion: 'pendiente_sr', conciliados: 0 });
      expect(t3.partidas[0].salida).toBeNull();
      expect(t3.partidas[0].entrada).toMatchObject({ folio: 'E-T3' });
      // t4 (0.7 ≠ 0.75) y t5 (salida cancelada): pendientes.
      expect((await resumen(ids.t4)).partidas[0]).toMatchObject({ salida: null, entrada: null });
      expect((await resumen(ids.t5)).partidas[0]).toMatchObject({ salida: null });
      expect((await resumen(ids.t5)).partidas[0].entrada).toMatchObject({ folio: 'E-T5' });
      // t6 y t7: una sola salida de SR concilia UN solo traspaso (el más viejo por folio).
      expect((await resumen(ids.t6)).traspaso.conciliacion).toBe('conciliado');
      expect((await resumen(ids.t7)).traspaso.conciliacion).toBe('pendiente_sr');
      expect((await resumen(ids.t7)).partidas[0]).toMatchObject({ salida: null, entrada: null });
      // t8: ni otro almacén, ni otra sucursal, ni otra empresa, ni un consumo: sin salida.
      const t8 = await resumen(ids.t8);
      expect(t8.partidas[0].salida).toBeNull();
      expect(t8.partidas[0].entrada).toMatchObject({ folio: 'E-T8' });
      expect(t8.traspaso.conciliacion).toBe('pendiente_sr');
    });

    it('conciliar tres veces deja exactamente lo mismo', async () => {
      const antes = await filas();
      const cabeceras = await prisma.traspaso.findMany({ orderBy: { id: 'asc' } });
      for (let i = 0; i < 3; i++) {
        const r = await app
          .get(ScopedPrismaService)
          .traspasos({ tipo: 'empresa', empresaId: FX.empresaA })
          .conciliar(FX.empresaA, new Date(reloj.t + i * 1000));
        expect(r).toMatchObject({ espejosCambiados: 0, conciliados: 0, desconciliados: 0 });
      }
      expect(await filas()).toEqual(antes);
      expect(await prisma.traspaso.findMany({ orderBy: { id: 'asc' } })).toEqual(cabeceras);
    });

    it('la base rechaza un espejo de otra sucursal u otra empresa (FK compuesta)', async () => {
      const [a2, b1] = await Promise.all([
        prisma.polizaInventario.findFirstOrThrow({ where: { origenSrId: 'S-T8-A2' } }),
        prisma.polizaInventario.findFirstOrThrow({ where: { origenSrId: 'S-T8-B' } }),
      ]);
      const partida = await prisma.partidaTraspaso.findFirstOrThrow({
        where: { traspasoId: ids.t8 },
      });
      // La salida de t8 tiene que ser de A1: una póliza de A2 (misma empresa) o de B1 no entra.
      for (const p of [a2, b1]) {
        await expect(
          prisma.$executeRaw`UPDATE partidas_traspaso SET poliza_salida_id = ${p.id}::uuid, renglon_salida = 1 WHERE id = ${partida.id}::uuid`,
        ).rejects.toThrow(/partidas_traspaso_poliza_salida_fkey/);
      }
      // Y la entrada, de A2 (destino): la de B1 no.
      await expect(
        prisma.$executeRaw`UPDATE partidas_traspaso SET poliza_entrada_id = ${b1.id}::uuid, renglon_entrada = 1 WHERE id = ${partida.id}::uuid`,
      ).rejects.toThrow(/partidas_traspaso_poliza_entrada_fkey/);
    });

    it('la lista filtra por sucursal: origen O destino', async () => {
      const a2 = await listar(USUARIOS.visorA, {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA2,
      });
      expect(a2.status).toBe(200);
      const folios = a2.body.traspasos
        .map((t: { folio: number }) => t.folio)
        .sort((x: number, y: number) => x - y);
      // t2 (folio 2) es A1 → A1: no toca A2.
      expect(folios).toEqual([1, 3, 4, 5, 6, 7, 8]);
      const todos = await listar(USUARIOS.visorA, { empresaId: FX.empresaA });
      expect(todos.body).toMatchObject({ total: 8, umbralAlertaHoras: 48 });
      // Los más recientes por envío: t2 (T0 + 2 h) va antes que t3…t8 (T0 + 1 h, folio desc).
      expect(todos.body.traspasos.map((t: { folio: number }) => t.folio)).toEqual([
        2, 8, 7, 6, 5, 4, 3, 1,
      ]);
      expect((await listar(USUARIOS.visorB, { empresaId: FX.empresaA })).status).toBe(404);
    });
  });

  describe('alerta de 48 h', () => {
    it('a las 48 h exactas todavía no; pasándolas, sí: una por traspaso sin conciliar', async () => {
      // t2 se envió a T0 + 2 h: a T0 + 50 h lleva EXACTAMENTE 48 h.
      reloj.t = T0 + 50 * H;
      await vuelta();
      const llaves = (await abiertas()).map((a) => a.llave).sort();
      // t3, t4, t5, t7, t8 (T0 + 1 h: 49 h). t1 y t6 conciliados; t2 en el borde.
      expect(llaves).toEqual([ids.t3, ids.t4, ids.t5, ids.t7, ids.t8].sort());
      expect((await resumen(ids.t2)).traspaso.conciliacion).toBe('pendiente_sr');
      expect((await resumen(ids.t3)).traspaso.conciliacion).toBe('en_alerta');

      reloj.t = T0 + 50 * H + 1000;
      await vuelta();
      expect((await abiertas()).map((a) => a.llave)).toContain(ids.t2);
      const t3 = (await abiertas()).find((a) => a.llave === ids.t3)!;
      expect(t3.detalle).toMatchObject({
        folio: 3,
        horas: 49,
        almacenOrigen: 'General',
        sucursalDestino: 'A2',
        almacenDestino: 'General',
      });
    });

    it('corregir el costo de la póliza espejo NO desconcilia ni abre alerta (> 48 h)', async () => {
      const antesT1 = (await resumen(ids.t1)).traspaso;
      reloj.t = T0 + 51 * H;
      const corregida = poliza(
        'S-T1',
        'traspaso_salida',
        'GEN',
        T0 + 23 * H,
        [
          ['I1', '-2.5'],
          ['I3', '-1'],
        ],
        { referencia: 'TR-1' },
      );
      (corregida.partidas[0] as Registro).costoUnitario = '31.00';
      const r = await lote(KEYS.a1, [corregida]);
      expect(r.body).toMatchObject({ actualizadas: 1 });
      await vuelta();
      const t1 = (await resumen(ids.t1)).traspaso;
      expect(t1).toMatchObject({ conciliacion: 'conciliado', conciliadoAt: antesT1.conciliadoAt });
      expect((await abiertas()).map((a) => a.llave)).not.toContain(ids.t1);
    });

    it('si SR cancela la póliza espejo, vuelve a pendiente y (> 48 h) abre su alerta', async () => {
      reloj.t = T0 + 52 * H;
      await lote(KEYS.a1, [
        poliza(
          'S-T1',
          'traspaso_salida',
          'GEN',
          T0 + 23 * H,
          [
            ['I1', '-2.5'],
            ['I3', '-1'],
          ],
          { referencia: 'TR-1', cancelada: true },
        ),
      ]);
      // Antes de la vuelta, la vista ya no pinta la salida (espejo re-verificado al leer).
      const leido = await resumen(ids.t1);
      expect(leido.traspaso).toMatchObject({ conciliacion: 'en_alerta', conciliadoAt: null });
      expect(leido.partidas.every((p: Partida) => p.salida === null)).toBe(true);
      await vuelta();
      const t1 = await prisma.traspaso.findUniqueOrThrow({ where: { id: ids.t1 } });
      expect(t1.conciliadoAt).toBeNull();
      expect((await abiertas()).map((a) => a.llave)).toContain(ids.t1);
      // La entrada sigue siendo suya.
      expect((await resumen(ids.t1)).partidas.every((p: Partida) => p.entrada !== null)).toBe(true);
    });

    it('cuando llega la salida que faltaba, se concilia y su alerta se cierra', async () => {
      await lote(KEYS.a1, [poliza('S-T3', 'traspaso_salida', 'GEN', T0 + 3 * H, [['I2', '-0.5']])]);
      await vuelta();
      expect((await resumen(ids.t3)).traspaso.conciliacion).toBe('conciliado');
      expect((await abiertas()).map((a) => a.llave)).not.toContain(ids.t3);
      const cerrada = await prisma.alerta.findFirstOrThrow({
        where: { tipo: 'traspaso_sin_conciliar', llave: ids.t3 },
      });
      expect(cerrada).toMatchObject({ motivoCierre: 'condicion' });
    });
  });

  describe('flujo', () => {
    it('recibir: sólo admin, sólo desde enviado', async () => {
      expect((await accion(USUARIOS.visorA, ids.t2, 'recibir')).status).toBe(403);
      reloj.t = T0 + 53 * H;
      const r = await accion(USUARIOS.adminEmpresaA, ids.t2, 'recibir');
      expect(r.status).toBe(200);
      expect(r.body.traspaso).toMatchObject({ estado: 'recibido', recibidoAt: iso(T0 + 53 * H) });
      expect((await accion(USUARIOS.adminEmpresaA, ids.t2, 'recibir')).status).toBe(409);
      expect((await accion(USUARIOS.adminEmpresaA, ids.t2, 'cancelar')).status).toBe(409);
    });

    it('cancelar: no si SR ya tiene movimientos; sí si no, y su alerta se cierra', async () => {
      const antes = await espejoSr();
      // t1 tiene sus entradas en SR.
      expect((await accion(USUARIOS.adminEmpresaA, ids.t1, 'cancelar')).status).toBe(409);
      // t4 no tiene nada en SR.
      const r = await accion(USUARIOS.adminEmpresaA, ids.t4, 'cancelar');
      expect(r.status).toBe(200);
      expect(r.body.traspaso).toMatchObject({ estado: 'cancelado', conciliacion: 'cancelado' });
      expect((await accion(USUARIOS.adminEmpresaA, ids.t4, 'cancelar')).status).toBe(409);
      expect((await accion(USUARIOS.adminEmpresaA, ids.t4, 'recibir')).status).toBe(409);
      await vuelta();
      expect((await abiertas()).map((a) => a.llave)).not.toContain(ids.t4);
      // Ni recibir, ni cancelar, ni conciliar tocaron el espejo de SR.
      expect(await espejoSr()).toEqual(antes);
    });
  });

  describe('leídos de SR', () => {
    it('agrupa por referencia, corta el rango en la zona de la sucursal y liga al panel', async () => {
      // 10-sep 23:30 CDMX = 11-sep 05:30Z (entra el día 10); 11-sep 00:30 CDMX (no entra).
      await lote(KEYS.a1, [
        poliza('S-2330', 'traspaso_salida', 'BAR', Date.parse('2026-09-11T05:30:00Z'), [
          ['I1', '-9'],
        ]),
        poliza('S-0030', 'traspaso_salida', 'BAR', Date.parse('2026-09-11T06:30:00Z'), [
          ['I1', '-9'],
        ]),
      ]);
      const r = await request(url)
        .get('/inventario/traspasos/sr')
        .query({ empresaId: FX.empresaA, desde: '2026-09-10', hasta: '2026-09-10' })
        .set('Authorization', await auth(USUARIOS.visorA));
      expect(r.status).toBe(200);
      const folios = r.body.traspasos.flatMap((g: { polizas: Array<{ folio: string }> }) =>
        g.polizas.map((p) => p.folio),
      );
      expect(folios).toContain('S-2330');
      expect(folios).not.toContain('S-0030');
      expect(folios).not.toContain('S-T1'); // 11-sep 08:00 CDMX
      expect(folios).not.toContain('C-T8'); // un consumo no es traspaso
      const t6 = r.body.traspasos.find((g: { polizas: Array<{ folio: string }> }) =>
        g.polizas.some((p) => p.folio === 'S-T6'),
      );
      expect(t6.traspasosPanel).toEqual([{ id: ids.t6, folio: 6 }]);
      expect(r.body).toMatchObject({ truncado: false, hayPolizas: true });

      // S-T1/E-T1 (11-sep) comparten referencia: un solo documento, salida primero.
      const dia11 = await request(url)
        .get('/inventario/traspasos/sr')
        .query({ empresaId: FX.empresaA, desde: '2026-09-11', hasta: '2026-09-11' })
        .set('Authorization', await auth(USUARIOS.visorA));
      expect(dia11.status).toBe(200);
      const tr1 = dia11.body.traspasos.find(
        (g: { referencia: string | null }) => g.referencia === 'TR-1',
      );
      expect(tr1.polizas.map((p: { folio: string }) => p.folio)).toEqual(['S-T1', 'E-T1']);
      // S-T1 está cancelada: sólo la entrada sigue ligando al traspaso 1.
      expect(tr1.traspasosPanel).toEqual([{ id: ids.t1, folio: 1 }]);
      expect(tr1.polizas[0]).toMatchObject({
        tipo: 'traspaso_salida',
        cancelada: true,
        partidas: 2,
      });

      expect(
        (
          await request(url)
            .get('/inventario/traspasos/sr')
            .query({ empresaId: FX.empresaA, desde: '2026-09-11', hasta: '2026-09-10' })
            .set('Authorization', await auth(USUARIOS.visorA))
        ).status,
      ).toBe(400);
      expect(
        (
          await request(url)
            .get('/inventario/traspasos/sr')
            .query({ empresaId: FX.empresaA, desde: '2026-09-10', hasta: '2026-09-10' })
            .set('Authorization', await auth(USUARIOS.visorB))
        ).status,
      ).toBe(404);
    });
  });
});
