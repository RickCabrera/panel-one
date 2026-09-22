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

    // F2-140 · Comparativos: cada fila de `comparativo-sucursales` es lo que Inicio pinta para
    // ESA sucursal (`/ventas/resumen?sucursalId=`), y las dos cuadran contra un esperado
    // calculado a mano sobre el seed. Fechas fijas del reloj del archivo (HOY = 2026-11-15,
    // 20:00Z): "este mes a la misma altura" y "mes anterior completo". No inserta nada: sólo lee
    // el seed, así que no mueve los números de ningún otro caso.
    describe('F2-140: comparativo por sucursal = dashboard individual', () => {
      const ALTURA = '2026-11-15T20:00:00.000Z';

      /** Milisegundos desde la medianoche LOCAL de `t` en `zona`. */
      function msDelDia(t: Date, zona: string): number {
        const partes = new Intl.DateTimeFormat('en-GB', {
          timeZone: zona,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        }).formatToParts(t);
        const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)?.value);
        return ((v('hour') * 60 + v('minute')) * 60 + v('second')) * 1000 + t.getUTCMilliseconds();
      }

      /**
       * Lo que debería decir la fila de `suc`, a mano: cuentas no canceladas cerradas en el
       * rango (día local de SU zona); con `alturaAl`, las del último día sólo si cerraron ANTES
       * de la hora local de ese instante en SU zona (corte exclusivo).
       */
      function aMano(suc: string, desde: string, hasta: string, alturaAl?: string) {
        const zona = ZONA[suc];
        const corte = alturaAl === undefined ? null : msDelDia(new Date(alturaAl), zona);
        const cuentas = chequesA.filter((c) => {
          if (c.sucursalId !== suc || c.cancelado || !c.cerradoAt) return false;
          const dia = diaLocal(c.cerradoAt, zona);
          if (dia < desde || dia > hasta) return false;
          return corte === null || dia !== hasta || msDelDia(c.cerradoAt, zona) < corte;
        });
        const venta = cuentas.reduce((s, c) => s.plus(c.total), new Prisma.Decimal(0));
        return {
          venta: venta.toFixed(2),
          cuentas: cuentas.length,
          ticketPromedio:
            cuentas.length === 0
              ? null
              : venta
                  .div(cuentas.length)
                  .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
                  .toFixed(2),
          comensales: cuentas.reduce((n, c) => n + (c.comensales ?? 0), 0),
        };
      }

      it.each([
        ['este mes a la misma altura', '2026-11-01', HOY, ALTURA],
        ['mes anterior completo', '2026-10-01', '2026-10-31', undefined],
      ])('%s', async (_nombre, desde, hasta, alturaAl) => {
        const q = { empresaId: FX.empresaA, desde, hasta, alturaAl };
        const filas = (await get(`/ventas/comparativo-sucursales?${Q(q)}`, USUARIOS.visorA))
          .body as Array<Record<string, unknown>>;
        expect(filas.map((f) => f.sucursalId).sort()).toEqual(
          [FX.sucursalA1, FX.sucursalA2].sort(),
        );
        for (const suc of [FX.sucursalA1, FX.sucursalA2]) {
          const esperado = aMano(suc, desde, hasta, alturaAl);
          expect(esperado.cuentas).toBeGreaterThan(0);
          const f = filas.find((x) => x.sucursalId === suc)!;
          expect({
            venta: f.venta,
            cuentas: f.cuentas,
            ticketPromedio: f.ticketPromedio,
            comensales: f.comensales,
          }).toEqual(esperado);
          // Y no trae nada más que esas cifras y su identidad.
          expect(Object.keys(f).sort()).toEqual([
            'comensales',
            'cuentas',
            'nombre',
            'sucursalId',
            'ticketPromedio',
            'venta',
          ]);

          const r = (await get(`/ventas/resumen?${Q({ ...q, sucursalId: suc })}`, USUARIOS.visorA))
            .body;
          expect({
            venta: r.venta,
            cuentas: r.cuentas,
            ticketPromedio: r.ticketPromedio,
            comensales: r.comensales.total,
          }).toEqual(esperado);
        }
      });

      it('el corte de Tijuana es a SU hora local (12:00 PST), no a la de CDMX (14:00)', async () => {
        // Guarda del caso: el seed SÍ trae cuentas de Tijuana cerradas el 15-nov entre las
        // 12:00 y las 14:00 locales. Si no las trajera, este caso no probaría nada.
        const entre = chequesA.filter(
          (c) =>
            c.sucursalId === FX.sucursalA2 &&
            !c.cancelado &&
            c.cerradoAt !== null &&
            diaLocal(c.cerradoAt, TIJUANA) === HOY &&
            msDelDia(c.cerradoAt, TIJUANA) >= 12 * 3_600_000 &&
            msDelDia(c.cerradoAt, TIJUANA) < 14 * 3_600_000,
        );
        expect(entre.length).toBeGreaterThan(0);

        const q = { empresaId: FX.empresaA, desde: '2026-11-01', hasta: HOY, alturaAl: ALTURA };
        const filas = (await get(`/ventas/comparativo-sucursales?${Q(q)}`, USUARIOS.visorA))
          .body as Array<{ sucursalId: string; cuentas: number }>;
        const tijuana = filas.find((f) => f.sucursalId === FX.sucursalA2)!;
        const conHoraDeCdmx = aMano(FX.sucursalA2, '2026-11-01', HOY, '2026-11-15T22:00:00.000Z');
        expect(tijuana.cuentas).toBe(aMano(FX.sucursalA2, '2026-11-01', HOY, ALTURA).cuentas);
        expect(conHoraDeCdmx.cuentas - tijuana.cuentas).toBe(entre.length);
      });
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
        corte: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      });
    });

    // F2-203: corte por recepción, para que el export no aborte en hora pico.
    describe('corte por recepción (F2-203)', () => {
      const FOLIOS_SR = ['CORTE-NUEVO', 'CORTE-ABIERTA'];
      const datosCheque = (folioSr: string, cerradoAt: Date | null) => ({
        sucursalId: FX.sucursalA1,
        empresaId: FX.empresaA,
        folio: folioSr,
        folioSr,
        abiertoAt: new Date('2026-11-10T17:00:00Z'),
        cerradoAt,
        subtotal: new Prisma.Decimal('100.00'),
        impuestos: new Prisma.Decimal('16.00'),
        descuentos: new Prisma.Decimal('0.00'),
        propina: new Prisma.Decimal('0.00'),
        total: new Prisma.Decimal('116.00'),
      });
      const pedir = (extra: Record<string, string | number> = {}) =>
        get(`/ventas/tickets?${Q({ ...base, porPagina: 100, ...extra })}`, USUARIOS.visorA);
      const borrar = () =>
        prisma.cheque.deleteMany({
          where: { sucursalId: FX.sucursalA1, folioSr: { in: FOLIOS_SR } },
        });
      beforeEach(borrar);
      afterAll(borrar);
      // Estas pruebas recorren páginas con detalle completo y esperan al reloj de la
      // base: en una máquina lenta pasan de los 5 s por defecto de jest (revisor,
      // F2-203). El tope sólo da tiempo; lo que se afirma no cambia.
      const TIMEOUT = 30_000;

      const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
      /**
       * Un instante estrictamente posterior a todo lo ya guardado y anterior a lo que
       * venga, con el reloj de la BASE: el de Node va unos ms atrás del que pone
       * `created_at` en esta máquina (medido: un cheque creado antes quedaba 3 ms
       * DESPUÉS de un `new Date()` tomado luego). Por eso la API tampoco usa el de Node.
       */
      async function corteAhora(): Promise<string> {
        await esperar(50);
        const [{ t }] = await prisma.$queryRaw<{ t: Date }[]>`
          SELECT date_trunc('milliseconds', clock_timestamp()) AS t`;
        await esperar(50);
        return t.toISOString();
      }

      it(
        'sin corte no filtra, y sugiere "ahora − 30 s" del reloj de la base',
        async () => {
          const antes = Date.now();
          const res = await pedir();
          expect(res.status).toBe(200);
          expect(res.body.total).toBe(esperados().length);
          const sugerido = Date.parse(res.body.corte);
          // Mismo host: el reloj de Postgres y el de Node coinciden al segundo.
          expect(sugerido).toBeGreaterThan(antes - 35_000);
          expect(sugerido).toBeLessThan(Date.now() - 25_000);
        },
        TIMEOUT,
      );

      it(
        'un cheque que llega DESPUÉS del corte no cuenta ni sale; sin corte, sí',
        async () => {
          const corte = await corteAhora();
          const conCorte = await pedir({ corte });
          expect(conCorte.body.total).toBe(esperados().length);
          expect(conCorte.body.corte).toBe(corte);

          const nuevo = await prisma.cheque.create({
            data: datosCheque('CORTE-NUEVO', new Date('2026-11-10T18:00:00Z')),
          });

          const otraVez = await pedir({ corte });
          expect(otraVez.body.total).toBe(esperados().length);
          expect(otraVez.body.items.map((i: { id: string }) => i.id)).not.toContain(nuevo.id);
          // Página a página con el mismo corte: la unión sigue siendo la de antes.
          const ids: string[] = [];
          for (let pagina = 1; ; pagina++) {
            const r = await get(
              `/ventas/tickets?${Q({ ...base, pagina, porPagina: 100, corte })}`,
              USUARIOS.visorA,
            );
            expect(r.body.total).toBe(esperados().length);
            if (r.body.items.length === 0) break;
            ids.push(...r.body.items.map((i: { id: string }) => i.id));
          }
          expect(ids).toEqual(esperados().map(({ c }) => c.id));

          const sinCorte = await pedir();
          expect(sinCorte.body.total).toBe(esperados().length + 1);
          const despues = await pedir({ corte: await corteAhora() });
          expect(despues.body.total).toBe(esperados().length + 1);
        },
        TIMEOUT,
      );

      it(
        'el corte NO congela un cheque ya recibido que cambia: una cuenta abierta que se cierra SÍ mueve el total',
        async () => {
          // DECISION PROVISIONAL (nocturno): si el agente llegara a mandar cuentas
          // abiertas (esquema-sr.md §2, "Corte por recepción"), llegan antes del corte
          // y entran al rango al cerrarse. El total cambia con el mismo corte, y el
          // export (web) lo detecta y aborta: nunca falta en silencio.
          await prisma.cheque.create({ data: datosCheque('CORTE-ABIERTA', null) });
          const corte = await corteAhora();
          expect((await pedir({ corte })).body.total).toBe(esperados().length);

          await prisma.cheque.update({
            where: {
              sucursalId_folioSr: { sucursalId: FX.sucursalA1, folioSr: 'CORTE-ABIERTA' },
            },
            data: { cerradoAt: new Date('2026-11-10T18:30:00Z') },
          });
          expect((await pedir({ corte })).body.total).toBe(esperados().length + 1);
        },
        TIMEOUT,
      );

      it(
        'con corte, otra empresa sigue siendo 404 (el corte no abre el alcance)',
        async () => {
          const res = await get(
            `/ventas/tickets?${Q({ ...RANGO, empresaId: FX.empresaB, corte: await corteAhora() })}`,
            USUARIOS.visorA,
          );
          expect(res.status).toBe(404);
        },
        TIMEOUT,
      );

      it('el corte vuelve idéntico, en ms UTC, aunque venga con offset', async () => {
        const res = await pedir({ corte: '2026-11-15T14:00:00.123-06:00' });
        expect(res.status).toBe(200);
        expect(res.body.corte).toBe('2026-11-15T20:00:00.123Z');
        const otra = await pedir({ corte: res.body.corte });
        expect(otra.body.corte).toBe(res.body.corte);
      });

      it.each([
        ['sin zona', '2026-11-15T14:00:00'],
        ['sin zona con ms', '2026-11-15T14:00:00.123'],
        ['sólo fecha', '2026-11-15'],
        ['basura', 'ayer'],
        ['vacío', ''],
      ])('400: corte %s', async (_n, corte) => {
        const res = await get(
          `/ventas/tickets?${Q(base)}&corte=${encodeURIComponent(corte)}`,
          USUARIOS.visorA,
        );
        expect(res.status).toBe(400);
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
      // Con 90 días de seed (F2-201) los folios del rango son los últimos (~500–750):
      // "74" encuentra 740–749 dentro y deja fuera el 74, que es de agosto.
      const res = await get(
        `/ventas/tickets?${Q({ ...base, folio: '74', porPagina: 100 })}`,
        USUARIOS.visorA,
      );
      const e = esperados().filter(({ c }) => c.folio.startsWith('74'));
      expect(e.length).toBeGreaterThan(0);
      // El 74 existe pero cae fuera del rango: el prefijo no se salta el rango.
      expect(chequesA.some((c) => c.folio === '74')).toBe(true);
      expect(e.some(({ c }) => c.folio === '74')).toBe(false);
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
