import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { FormaPago, Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';

import {
  CATALOGO_SEED,
  generarVentas,
  sembrarVentas,
  type ChequeSeed,
  type OpcionesVentas,
} from '../../prisma/seed-ventas';
import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import type { EmpresaScope } from '../scope/empresa-scope';
import { AgregadosVentasService } from './agregados-ventas.service';
import { TTL_CACHE_MS } from './cache-agregados';

// E2E de los endpoints de lectura (F1-033) sobre la app REAL (AppModule +
// configurarApp: guard JWT global, ValidationPipe) contra Postgres REAL, con
// las fixtures sintéticas de F1-011 y el seed de ventas de F1-032.
//
// Lo central es el SCOPING POR ROL de cada endpoint: un visor o admin_empresa
// de A nunca ve B (404, idéntico a "no existe"), admin_global ve todo pero no
// puede mezclar la empresa A con una sucursal de B, y sin token es 401.
//
// El reloj de la app se reemplaza (`overrideProvider(Reloj)`): es el MISMO
// provider que usan el cache de agregados y la edad de las mesas.

const CDMX = 'America/Mexico_City';
const TIJUANA = 'America/Tijuana';
const HOY = '2026-11-15';
const OPCIONES_A: OpcionesVentas = {
  empresaId: FX.empresaA,
  sucursales: [
    { id: FX.sucursalA1, clave: 'A1', zonaHoraria: CDMX },
    { id: FX.sucursalA2, clave: 'A2', zonaHoraria: TIJUANA },
  ],
  hoy: HOY,
};
const OPCIONES_B: OpcionesVentas = {
  empresaId: FX.empresaB,
  sucursales: [{ id: FX.sucursalB1, clave: 'B1', zonaHoraria: CDMX }],
  hoy: HOY,
  semilla: 99,
};
const ZONA: Record<string, string> = {
  [FX.sucursalA1]: CDMX,
  [FX.sucursalA2]: TIJUANA,
  [FX.sucursalB1]: CDMX,
};
const RANGO = { desde: '2026-10-17', hasta: HOY };

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

class RelojFijo extends Reloj {
  t = Date.parse('2026-11-15T20:00:00Z');
  override ahora(): number {
    return this.t;
  }
}

async function crearApp(reloj: Reloj): Promise<INestApplication> {
  const modulo = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(Reloj)
    .useValue(reloj)
    .compile();
  const app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
  await app.init();
  return app;
}

function diaLocal(t: Date, zona: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(t);
}

/** Tickets del rango calculados a mano: no cancelados por cierre, cancelados por cierre o apertura. */
function ticketsAMano(cheques: ChequeSeed[], desde: string, hasta: string) {
  return cheques
    .map((c) => ({ c, momento: c.cancelado ? (c.cerradoAt ?? c.abiertoAt) : c.cerradoAt }))
    .filter(({ momento, c }) => {
      if (!momento) return false;
      const dia = diaLocal(momento, ZONA[c.sucursalId]);
      return dia >= desde && dia <= hasta;
    })
    .sort((x, y) => y.momento!.getTime() - x.momento!.getTime() || (x.c.id < y.c.id ? 1 : -1));
}

const Q = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

/** Los endpoints que reciben empresa (y sucursal opcional). */
const CON_EMPRESA: Array<{ ruta: string; extra: Record<string, string> }> = [
  { ruta: '/ventas/resumen', extra: RANGO },
  { ruta: '/ventas/por-hora', extra: RANGO },
  { ruta: '/ventas/por-dia', extra: RANGO },
  { ruta: '/ventas/comparativo-sucursales', extra: RANGO },
  { ruta: '/ventas/formas-pago', extra: RANGO },
  { ruta: '/ventas/top-productos', extra: RANGO },
  { ruta: '/ventas/tickets', extra: RANGO },
  { ruta: '/mesas/abiertas', extra: {} },
];

describe('Endpoints de lectura (e2e, F1-033)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojFijo();
  let app: INestApplication;
  const chequesA = generarVentas(OPCIONES_A);

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });

  async function get(ruta: string, u?: Usuario) {
    const r = request(app.getHttpServer()).get(ruta);
    return u === undefined ? r : r.set('Authorization', `Bearer ${await token(u)}`);
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { zonaHoraria: TIJUANA } });
    await sembrarVentas(prisma, OPCIONES_A);
    await sembrarVentas(prisma, OPCIONES_B);
    // Snapshots sintéticos: A1 con dos (vale el último), A2 sin ninguno, B1 con uno.
    await prisma.mesaSnapshot.createMany({
      data: [
        {
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          capturadoAt: new Date('2026-11-15T19:58:00Z'),
          recibidoAt: new Date('2026-11-15T19:58:05Z'),
          payload: { mesas: [{ mesa: 'viejo' }] },
        },
        {
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          capturadoAt: new Date('2026-11-15T19:59:30Z'),
          recibidoAt: new Date('2026-11-15T19:59:31Z'),
          payload: { mesas: [{ mesa: '4', total: '350.00' }, { mesa: '7' }] },
        },
        {
          sucursalId: FX.sucursalB1,
          empresaId: FX.empresaB,
          capturadoAt: new Date('2026-11-15T19:59:00Z'),
          recibidoAt: new Date('2026-11-15T19:59:00Z'),
          payload: { mesas: [{ mesa: 'DE-B' }] },
        },
      ],
    });
    app = await crearApp(reloj);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  // -------------------------------------------------------------------------
  describe('scoping por rol en cada endpoint', () => {
    const casos = CON_EMPRESA.flatMap(({ ruta, extra }) => [
      { ruta, extra, u: USUARIOS.visorA, empresa: FX.empresaA, suc: undefined, status: 200 },
      {
        ruta,
        extra,
        u: USUARIOS.adminEmpresaA,
        empresa: FX.empresaA,
        suc: FX.sucursalA2,
        status: 200,
      },
      { ruta, extra, u: USUARIOS.visorA, empresa: FX.empresaB, suc: undefined, status: 404 },
      {
        ruta,
        extra,
        u: USUARIOS.adminEmpresaA,
        empresa: FX.empresaB,
        suc: FX.sucursalB1,
        status: 404,
      },
      { ruta, extra, u: USUARIOS.visorA, empresa: FX.empresaA, suc: FX.sucursalB1, status: 404 },
      { ruta, extra, u: USUARIOS.visorB, empresa: FX.empresaA, suc: undefined, status: 404 },
      { ruta, extra, u: USUARIOS.adminGlobal, empresa: FX.empresaA, suc: undefined, status: 200 },
      {
        ruta,
        extra,
        u: USUARIOS.adminGlobal,
        empresa: FX.empresaB,
        suc: FX.sucursalB1,
        status: 200,
      },
      // Ver todo no permite mezclar la empresa A con una sucursal de B.
      {
        ruta,
        extra,
        u: USUARIOS.adminGlobal,
        empresa: FX.empresaA,
        suc: FX.sucursalB1,
        status: 404,
      },
      { ruta, extra, u: USUARIOS.visorA, empresa: FX.inexistente, suc: undefined, status: 404 },
    ]);

    it.each(casos)(
      '$ruta · $u.email · empresa $empresa · sucursal $suc → $status',
      async ({ ruta, extra, u, empresa, suc, status }) => {
        const res = await get(`${ruta}?${Q({ empresaId: empresa, sucursalId: suc, ...extra })}`, u);
        expect(res.status).toBe(status);
        if (status === 404) {
          // Idéntico a lo que responde para algo que no existe: no confirma nada.
          expect(res.body).toEqual({
            statusCode: 404,
            message: 'Recurso no encontrado',
            error: 'Not Found',
          });
        }
      },
    );

    it.each(CON_EMPRESA)('$ruta sin token → 401', async ({ ruta, extra }) => {
      const res = await get(`${ruta}?${Q({ empresaId: FX.empresaA, ...extra })}`);
      expect(res.status).toBe(401);
    });

    it('nada de B aparece en lo que ve A: tickets y mesas', async () => {
      const t = await get(
        `/ventas/tickets?${Q({ empresaId: FX.empresaA, ...RANGO, porPagina: 100 })}`,
        USUARIOS.visorA,
      );
      expect(t.status).toBe(200);
      expect(
        t.body.items.every((i: { sucursalId: string }) => i.sucursalId !== FX.sucursalB1),
      ).toBe(true);
      const m = await get(`/mesas/abiertas?${Q({ empresaId: FX.empresaA })}`, USUARIOS.visorA);
      expect(JSON.stringify(m.body)).not.toContain('DE-B');
      expect(JSON.stringify(m.body)).not.toContain(FX.sucursalB1);
    });

    it('GET /empresas: cada quien ve su alcance', async () => {
      const visor = await get('/empresas', USUARIOS.visorA);
      expect(visor.status).toBe(200);
      expect(visor.body).toEqual([
        { id: FX.empresaA, nombre: 'Empresa Prueba A (F1-011)', activo: true },
      ]);
      const b = await get('/empresas', USUARIOS.visorB);
      expect(b.body.map((e: { id: string }) => e.id)).toEqual([FX.empresaB]);
      const global = await get('/empresas', USUARIOS.adminGlobal);
      expect(global.body.map((e: { id: string }) => e.id)).toEqual(
        expect.arrayContaining([FX.empresaA, FX.empresaB, FX.empresaC]),
      );
      expect(global.body.find((e: { id: string }) => e.id === FX.empresaC).activo).toBe(false);
      expect((await get('/empresas')).status).toBe(401);
    });

    it('GET /sucursales: alcance, filtro por empresa con 404, y nunca la API key', async () => {
      await prisma.sucursal.update({
        where: { id: FX.sucursalA1 },
        data: { apiKeyHash: 'hash-sintetico-f1-033' },
      });
      try {
        const visor = await get('/sucursales', USUARIOS.visorA);
        expect(visor.status).toBe(200);
        expect(visor.body.map((s: { id: string }) => s.id).sort()).toEqual(
          [FX.sucursalA1, FX.sucursalA2].sort(),
        );
        for (const s of visor.body) {
          expect(Object.keys(s).sort()).toEqual([
            'activo',
            'empresaId',
            'id',
            'nombre',
            'zonaHoraria',
          ]);
        }
        expect(JSON.stringify(visor.body)).not.toContain('hash-sintetico');
        const filtrado = await get(`/sucursales?empresaId=${FX.empresaA}`, USUARIOS.adminEmpresaA);
        expect(filtrado.body).toHaveLength(2);
        const ajena = await get(`/sucursales?empresaId=${FX.empresaB}`, USUARIOS.visorA);
        expect(ajena.status).toBe(404);
        expect(
          (await get(`/sucursales?empresaId=${FX.inexistente}`, USUARIOS.visorA)).body,
        ).toEqual(ajena.body);
        const global = await get(`/sucursales?empresaId=${FX.empresaB}`, USUARIOS.adminGlobal);
        expect(global.body).toEqual([
          {
            id: FX.sucursalB1,
            empresaId: FX.empresaB,
            nombre: 'B1',
            zonaHoraria: CDMX,
            activo: true,
          },
        ]);
        await get('/sucursales?empresaId=no-uuid', USUARIOS.adminGlobal).then((r) =>
          expect(r.status).toBe(400),
        );
        expect((await get('/sucursales')).status).toBe(401);
      } finally {
        await prisma.sucursal.update({ where: { id: FX.sucursalA1 }, data: { apiKeyHash: null } });
      }
    });
  });

  // -------------------------------------------------------------------------
  describe('agregados: los números', () => {
    const A: EmpresaScope = { tipo: 'empresa', empresaId: FX.empresaA };
    const filtro = { empresaId: FX.empresaA, ...RANGO };

    it('cada endpoint devuelve exactamente lo que calcula el servicio con el mismo scope', async () => {
      const s = app.get(AgregadosVentasService);
      const qs = Q(filtro);
      expect((await get(`/ventas/resumen?${qs}`, USUARIOS.visorA)).body).toEqual(
        await s.resumen(A, filtro),
      );
      expect((await get(`/ventas/por-hora?${qs}`, USUARIOS.visorA)).body).toEqual(
        await s.porHora(A, filtro),
      );
      expect((await get(`/ventas/formas-pago?${qs}`, USUARIOS.visorA)).body).toEqual(
        await s.formasPago(A, filtro),
      );
      expect(
        (await get(`/ventas/top-productos?${qs}&por=cantidad&limite=5`, USUARIOS.visorA)).body,
      ).toEqual(await s.topProductos(A, filtro, { por: 'cantidad', limite: 5 }));
      expect((await get(`/ventas/por-dia?${qs}`, USUARIOS.visorA)).body).toEqual(
        await s.porDia(A, filtro),
      );
      expect((await get(`/ventas/comparativo-sucursales?${qs}`, USUARIOS.visorA)).body).toEqual(
        await s.comparativoSucursales(A, filtro),
      );
    });

    it('F1-043: por día y comparativo suman exactamente lo que dice el resumen', async () => {
      const filtros = [
        filtro,
        { ...filtro, sucursalId: FX.sucursalA2 },
        { empresaId: FX.empresaA, desde: '2026-11-01', hasta: '2026-11-01' },
      ];
      for (const f of filtros) {
        const qs = Q(f);
        const r = (await get(`/ventas/resumen?${qs}`, USUARIOS.visorA)).body;
        const dias = (await get(`/ventas/por-dia?${qs}`, USUARIOS.visorA)).body as Array<{
          venta: string;
          cuentas: number;
        }>;
        const suc = (await get(`/ventas/comparativo-sucursales?${qs}`, USUARIOS.visorA))
          .body as Array<{ venta: string; cuentas: number }>;
        const suma = (xs: Array<{ venta: string }>) =>
          xs.reduce((acc, x) => acc.plus(x.venta), new Prisma.Decimal(0)).toFixed(2);
        const cuentas = (xs: Array<{ cuentas: number }>) => xs.reduce((n, x) => n + x.cuentas, 0);
        expect(r.cuentas).toBeGreaterThan(0);
        expect(suma(dias)).toBe(r.venta);
        expect(cuentas(dias)).toBe(r.cuentas);
        expect(suma(suc)).toBe(r.venta);
        expect(cuentas(suc)).toBe(r.cuentas);
      }
    });

    it('GET /ventas/resumen cuadra contra el cálculo a mano sobre el seed', async () => {
      const suc = FX.sucursalA2;
      const res = await get(
        `/ventas/resumen?${Q({ ...filtro, sucursalId: suc })}`,
        USUARIOS.adminEmpresaA,
      );
      const deA2 = ticketsAMano(chequesA, RANGO.desde, RANGO.hasta).filter(
        ({ c }) => c.sucursalId === suc,
      );
      const ventas = deA2.filter(({ c }) => !c.cancelado).map(({ c }) => c);
      const venta = ventas.reduce((s, c) => s.plus(c.total), new Prisma.Decimal(0));
      expect(res.status).toBe(200);
      expect(res.body.venta).toBe(venta.toFixed(2));
      expect(res.body.cuentas).toBe(ventas.length);
      expect(res.body.ticketPromedio).toBe(
        venta.div(ventas.length).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2),
      );
      expect(res.body.cancelados.cuentas).toBe(deA2.length - ventas.length);
    });

    it('sin cuentas: sumas en cero y promedios en null (convención de F1-033)', async () => {
      const res = await get(
        `/ventas/resumen?${Q({ empresaId: FX.empresaA, desde: '2027-01-01', hasta: '2027-01-01' })}`,
        USUARIOS.visorA,
      );
      expect(res.status).toBe(200);
      expect(res.body.venta).toBe('0.00');
      expect(res.body.cuentas).toBe(0);
      expect(res.body.ticketPromedio).toBeNull();
      expect(res.body.comensales.promedioPorComensal).toBeNull();
    });

    it.each([
      ['empresaId no UUID', { empresaId: 'x', ...RANGO }],
      ['sin empresaId', { ...RANGO }],
      ['sucursalId no UUID', { empresaId: FX.empresaA, sucursalId: 'x', ...RANGO }],
      ['fecha con formato malo', { empresaId: FX.empresaA, desde: '17/10/2026', hasta: HOY }],
      ['fecha que no existe', { empresaId: FX.empresaA, desde: '2026-02-30', hasta: HOY }],
      ['desde > hasta', { empresaId: FX.empresaA, desde: HOY, hasta: '2026-10-17' }],
      ['rango de más de 366 días', { empresaId: FX.empresaA, desde: '2025-01-01', hasta: HOY }],
      ['sin fechas', { empresaId: FX.empresaA }],
      ['un campo de más', { empresaId: FX.empresaA, ...RANGO, empresa: 'B' }],
    ])('400 en resumen: %s', async (_nombre, q) => {
      const res = await get(`/ventas/resumen?${Q(q)}`, USUARIOS.visorA);
      expect(res.status).toBe(400);
    });

    it.each([
      ['por inválido', 'por=otra'],
      ['limite 0', 'limite=0'],
      ['limite 51', 'limite=51'],
      ['limite no entero', 'limite=2.5'],
    ])('400 en top-productos: %s', async (_nombre, extra) => {
      const res = await get(
        `/ventas/top-productos?${Q({ empresaId: FX.empresaA, ...RANGO })}&${extra}`,
        USUARIOS.visorA,
      );
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /ventas/tickets', () => {
    const base = { empresaId: FX.empresaA, ...RANGO };
    const esperados = () => ticketsAMano(chequesA, RANGO.desde, RANGO.hasta);

    it('recorrer todas las páginas da exactamente los tickets del rango, en orden, sin huecos ni repetidos', async () => {
      const todos: string[] = [];
      let total: number | undefined;
      for (let pagina = 1; ; pagina++) {
        const res = await get(
          `/ventas/tickets?${Q({ ...base, pagina, porPagina: 37 })}`,
          USUARIOS.visorA,
        );
        expect(res.status).toBe(200);
        total = res.body.total;
        expect(res.body.pagina).toBe(pagina);
        expect(res.body.porPagina).toBe(37);
        if (res.body.items.length === 0) break;
        todos.push(...res.body.items.map((i: { id: string }) => i.id));
      }
      const e = esperados();
      expect(total).toBe(e.length);
      expect(todos).toEqual(e.map(({ c }) => c.id));
      expect(e.some(({ c }) => c.cancelado)).toBe(true);
    });

    it('página más allá del final: items vacío y el total real', async () => {
      const res = await get(`/ventas/tickets?${Q({ ...base, pagina: 9999 })}`, USUARIOS.visorA);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        items: [],
        total: esperados().length,
        pagina: 9999,
        porPagina: 50,
      });
    });

    it('el detalle: importes, partidas en orden del POS, pagos con la forma del catálogo, cancelado', async () => {
      const res = await get(`/ventas/tickets?${Q({ ...base, porPagina: 100 })}`, USUARIOS.visorA);
      const formas = new Map(CATALOGO_SEED.map((c) => [c.formaRaw, c.forma]));
      const porId = new Map(chequesA.map((c) => [c.id, c]));
      for (const t of res.body.items) {
        const c = porId.get(t.id)!;
        expect(t).toMatchObject({
          sucursalId: c.sucursalId,
          folio: c.folio,
          mesa: c.mesa,
          mesero: c.mesero,
          comensales: c.comensales,
          abiertoAt: c.abiertoAt.toISOString(),
          cerradoAt: c.cerradoAt?.toISOString() ?? null,
          cancelado: c.cancelado,
          total: c.total.toFixed(2),
          descuentos: c.descuentos.toFixed(2),
        });
        expect(t.partidas).toEqual(
          [...c.partidas]
            .sort((x, y) => x.orden - y.orden)
            .map((p) => ({
              producto: p.producto,
              categoria: p.categoria,
              cantidad: p.cantidad.toFixed(3),
              precioUnit: p.precioUnit.toFixed(2),
              total: p.total.toFixed(2),
              modificadores: p.modificadores,
            })),
        );
        const pagos = [...t.pagos].sort(
          (x: { formaRaw: string; monto: string }, y: { formaRaw: string; monto: string }) =>
            (x.formaRaw + x.monto).localeCompare(y.formaRaw + y.monto),
        );
        const esperadosPagos = c.pagos
          .map((p) => ({
            formaRaw: p.formaRaw,
            forma: formas.get(p.formaRaw) ?? FormaPago.otro,
            monto: p.monto.toFixed(2),
          }))
          .sort((x, y) => (x.formaRaw + x.monto).localeCompare(y.formaRaw + y.monto));
        expect(pagos).toEqual(esperadosPagos);
      }
      expect(res.body.items).toHaveLength(100);
    });

    it('búsqueda por prefijo de folio, dentro del rango', async () => {
      const res = await get(
        `/ventas/tickets?${Q({ ...base, folio: '12', porPagina: 100 })}`,
        USUARIOS.visorA,
      );
      const e = esperados().filter(({ c }) => c.folio.startsWith('12'));
      expect(e.length).toBeGreaterThan(0);
      expect(res.body.total).toBe(e.length);
      expect(res.body.items.map((i: { id: string }) => i.id)).toEqual(e.map(({ c }) => c.id));
    });

    it('el folio es literal: % y _ no son comodines', async () => {
      for (const folio of ['%', '_', '1%', '\\']) {
        const res = await get(`/ventas/tickets?${Q({ ...base, folio })}`, USUARIOS.visorA);
        expect(res.status).toBe(200);
        expect(res.body.total).toBe(0);
      }
    });

    it.each([
      ['pagina 0', 'pagina=0'],
      ['pagina de más (tope 10000)', 'pagina=10001'],
      ['pagina enorme', 'pagina=1000000000000000'],
      ['porPagina 0', 'porPagina=0'],
      ['porPagina 101', 'porPagina=101'],
      ['folio vacío', 'folio='],
      ['folio de 41 caracteres', `folio=${'1'.repeat(41)}`],
    ])('400: %s', async (_n, extra) => {
      const res = await get(`/ventas/tickets?${Q(base)}&${extra}`, USUARIOS.visorA);
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('GET /mesas/abiertas', () => {
    it('el último snapshot de cada sucursal, la edad del dato, y null donde nunca llegó uno', async () => {
      reloj.t = Date.parse('2026-11-15T20:00:00Z');
      const res = await get(`/mesas/abiertas?empresaId=${FX.empresaA}`, USUARIOS.visorA);
      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        {
          sucursalId: FX.sucursalA1,
          nombre: 'A1',
          zonaHoraria: CDMX,
          snapshot: {
            capturadoAt: '2026-11-15T19:59:30.000Z',
            recibidoAt: '2026-11-15T19:59:31.000Z',
            edadSegundos: 30,
            edadRecepcionSegundos: 29,
            mesas: [{ mesa: '4', total: '350.00' }, { mesa: '7' }],
          },
        },
        { sucursalId: FX.sucursalA2, nombre: 'A2', zonaHoraria: TIJUANA, snapshot: null },
      ]);
    });

    it('con sucursalId, sólo esa', async () => {
      const res = await get(
        `/mesas/abiertas?${Q({ empresaId: FX.empresaA, sucursalId: FX.sucursalA2 })}`,
        USUARIOS.visorA,
      );
      expect(res.body).toEqual([
        { sucursalId: FX.sucursalA2, nombre: 'A2', zonaHoraria: TIJUANA, snapshot: null },
      ]);
    });

    it('un reloj del agente adelantado no da edades negativas', async () => {
      reloj.t = Date.parse('2026-11-15T19:59:00Z');
      try {
        const res = await get(
          `/mesas/abiertas?${Q({ empresaId: FX.empresaA, sucursalId: FX.sucursalA1 })}`,
          USUARIOS.visorA,
        );
        expect(res.body[0].snapshot.edadSegundos).toBe(0);
        expect(res.body[0].snapshot.edadRecepcionSegundos).toBe(0);
      } finally {
        reloj.t = Date.parse('2026-11-15T20:00:00Z');
      }
    });

    it('no se cachea: un snapshot nuevo se ve en el siguiente request', async () => {
      await prisma.mesaSnapshot.create({
        data: {
          sucursalId: FX.sucursalA2,
          empresaId: FX.empresaA,
          capturadoAt: new Date('2026-11-15T19:59:50Z'),
          payload: { mesas: [] },
        },
      });
      const res = await get(
        `/mesas/abiertas?${Q({ empresaId: FX.empresaA, sucursalId: FX.sucursalA2 })}`,
        USUARIOS.visorA,
      );
      expect(res.body[0].snapshot).toMatchObject({ edadSegundos: 10, mesas: [] });
    });

    it('400 con un id que no es UUID', async () => {
      const res = await get('/mesas/abiertas?empresaId=x', USUARIOS.visorA);
      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------------------
  describe('cache de 15 s en agregados', () => {
    // Un día sin ventas del seed, para que el cheque de prueba sea el único.
    const dia = { desde: '2027-03-01', hasta: '2027-03-01' };
    const ruta = `/ventas/resumen?${Q({ empresaId: FX.empresaA, ...dia })}`;

    afterAll(async () => {
      await prisma.cheque.deleteMany({ where: { folioSr: 'F1-033-CACHE' } });
    });

    it('sirve lo guardado dentro de los 15 s, no cruza tenants, y recalcula al vencer', async () => {
      reloj.t = Date.parse('2027-03-01T20:00:00Z');
      const antes = await get(ruta, USUARIOS.visorA);
      expect(antes.body.cuentas).toBe(0);

      await prisma.cheque.create({
        data: {
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          folio: 'C1',
          folioSr: 'F1-033-CACHE',
          abiertoAt: new Date('2027-03-01T18:00:00Z'),
          cerradoAt: new Date('2027-03-01T19:00:00Z'),
          subtotal: '86.21',
          impuestos: '13.79',
          descuentos: '0',
          propina: '0',
          total: '100.00',
        },
      });

      // Mismo scope y filtro dentro de los 15 s: el cache, que todavía no ve el cheque.
      reloj.t += TTL_CACHE_MS - 1;
      expect((await get(ruta, USUARIOS.visorA)).body.cuentas).toBe(0);
      // El cache no cruza tenants: B con el filtro de A sigue en 404.
      expect((await get(ruta, USUARIOS.visorB)).status).toBe(404);
      // admin_global tiene su propia entrada: calcula y ya ve el cheque.
      expect((await get(ruta, USUARIOS.adminGlobal)).body.cuentas).toBe(1);

      // Vencido: A recalcula.
      reloj.t += 1;
      const despues = await get(ruta, USUARIOS.visorA);
      expect(despues.body.cuentas).toBe(1);
      expect(despues.body.venta).toBe('100.00');
    });

    it('F1-043: por día y comparativo también se cachean por scope, sin cruzar tenants', async () => {
      // Otro día sin ventas del seed; el cheque de la prueba anterior está en el 1 de marzo.
      const dia2 = { desde: '2027-03-03', hasta: '2027-03-03' };
      const rutas = [
        `/ventas/por-dia?${Q({ empresaId: FX.empresaA, ...dia2 })}`,
        `/ventas/comparativo-sucursales?${Q({ empresaId: FX.empresaA, ...dia2 })}`,
      ];
      const cuentas = (body: Array<{ cuentas: number }>) => body.reduce((n, x) => n + x.cuentas, 0);
      reloj.t = Date.parse('2027-03-03T20:00:00Z');
      for (const r of rutas) {
        expect(cuentas((await get(r, USUARIOS.visorA)).body)).toBe(0);
      }
      await prisma.cheque.create({
        data: {
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          folio: 'C2',
          folioSr: 'F1-043-CACHE',
          abiertoAt: new Date('2027-03-03T18:00:00Z'),
          cerradoAt: new Date('2027-03-03T19:00:00Z'),
          subtotal: '43.10',
          impuestos: '6.90',
          descuentos: '0',
          propina: '0',
          total: '50.00',
        },
      });
      try {
        reloj.t += TTL_CACHE_MS - 1;
        for (const r of rutas) {
          expect(cuentas((await get(r, USUARIOS.visorA)).body)).toBe(0);
          expect((await get(r, USUARIOS.visorB)).status).toBe(404);
          expect(cuentas((await get(r, USUARIOS.adminGlobal)).body)).toBe(1);
        }
        reloj.t += 1;
        for (const r of rutas) {
          expect(cuentas((await get(r, USUARIOS.visorA)).body)).toBe(1);
        }
      } finally {
        await prisma.cheque.deleteMany({ where: { folioSr: 'F1-043-CACHE' } });
      }
    });

    it('tickets no se cachea', async () => {
      const rutaT = `/ventas/tickets?${Q({ empresaId: FX.empresaA, desde: '2027-03-02', hasta: '2027-03-02' })}`;
      expect((await get(rutaT, USUARIOS.visorA)).body.total).toBe(0);
      await prisma.cheque.update({
        where: { sucursalId_folioSr: { sucursalId: FX.sucursalA1, folioSr: 'F1-033-CACHE' } },
        data: { cerradoAt: new Date('2027-03-02T19:00:00Z') },
      });
      expect((await get(rutaT, USUARIOS.visorA)).body.total).toBe(1);
    });
  });
});
