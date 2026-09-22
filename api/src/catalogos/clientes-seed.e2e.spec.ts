import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';

import { sembrarCatalogos } from '../../prisma/seed-catalogos';
import {
  generarVentas,
  sembrarVentas,
  universoDe,
  type ChequeSeed,
  type OpcionesVentas,
} from '../../prisma/seed-ventas';
import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';

// Clientes (F2-232) sobre el SEED (F2-201): ventas y catálogo de clientes sembrados por los
// mismos generadores del seed de desarrollo, en las sucursales de FIXTURES de la empresa A (A1
// en CDMX, A2 en Tijuana). Lo esperado sale A MANO del generador (`maestro.clienteClave` de
// cada cheque y el día local de SU sucursal).
//
// OJO, honestidad del seed: aquí `origenSrId = clave` (C001…), así que un cruce por CLAVE
// también pasaría. El cruce por id del POS se prueba en `clientes.e2e.spec.ts` con ids y claves
// distintos. Y el seed SÍ tiene clientes: el estado "sin clientes" se prueba allá, a mano.

const CDMX = 'America/Mexico_City';
const TIJUANA = 'America/Tijuana';
const OP: OpcionesVentas = {
  empresaId: FX.empresaA,
  sucursales: [
    { id: FX.sucursalA1, clave: 'A1', zonaHoraria: CDMX },
    { id: FX.sucursalA2, clave: 'A2', zonaHoraria: TIJUANA },
  ],
  hoy: '2026-11-15',
};
const ZONA: Record<string, string> = { [FX.sucursalA1]: CDMX, [FX.sucursalA2]: TIJUANA };
const cheques = generarVentas(OP);
const universo = universoDe(OP, cheques);

const diaLocal = (t: Date, zona: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(t);
const haceDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

const momento = (c: ChequeSeed) => (c.cancelado ? (c.cerradoAt ?? c.abiertoAt) : c.cerradoAt);
const enRango = (c: ChequeSeed, desde: string, hasta: string) => {
  const t = momento(c);
  if (!t) return false;
  const d = diaLocal(t, ZONA[c.sucursalId]);
  return d >= desde && d <= hasta;
};

/** Visitas y venta por (sucursal, clave del cliente), a mano del generador. */
function aMano(desde: string, hasta: string) {
  const m = new Map<string, { visitas: number; venta: Prisma.Decimal; canceladas: number }>();
  for (const c of cheques.filter((x) => x.maestro.clienteClave && enRango(x, desde, hasta))) {
    const k = `${c.sucursalId}|${c.maestro.clienteClave}`;
    const e = m.get(k) ?? { visitas: 0, venta: new Prisma.Decimal(0), canceladas: 0 };
    if (c.cancelado) e.canceladas += 1;
    else {
      e.visitas += 1;
      e.venta = e.venta.plus(c.total);
    }
    m.set(k, e);
  }
  return m;
}

interface Fila {
  id: string | null;
  sucursalId: string;
  cruce: string;
  origenSrId: string;
  visitas: number;
  venta: string;
  ticketPromedio: string | null;
  canceladas: { cuentas: number; monto: string };
}

describe('Clientes sobre el seed (e2e, F2-232)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const get = async (ruta: string, query: Record<string, string>) => {
    const u = USUARIOS.visorA;
    const token = await app
      .get(TokensService)
      .firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
    const r = await request(url).get(ruta).query(query).set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    return r.body as Record<string, unknown>;
  };
  /** Todas las páginas de la lista. */
  const todas = async (query: Record<string, string>) => {
    const filas: Fila[] = [];
    for (let pagina = 1; ; pagina++) {
      const r = await get('/catalogos/clientes/resumen', {
        ...query,
        porPagina: '500',
        pagina: String(pagina),
      });
      filas.push(...(r.filas as Fila[]));
      if (filas.length >= (r.total as number)) return { r, filas };
    }
  };

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { zonaHoraria: TIJUANA } });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await sembrarVentas(prisma, OP);
    await sembrarCatalogos(prisma, {
      empresaId: FX.empresaA,
      sucursales: OP.sucursales,
      universo,
      capturadoAt: new Date('2026-11-15T20:00:00.000Z'),
    });
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

  const TODO = { empresaId: FX.empresaA, desde: haceDias(OP.hoy, 100), hasta: OP.hoy };

  it('guarda: el seed persiste el cliente de las cuentas que lo traen, y sólo de ésas', async () => {
    const conCliente = cheques.filter((c) => c.maestro.clienteClave !== null);
    expect(conCliente.length).toBeGreaterThan(100);
    expect(
      await prisma.cheque.count({
        where: { empresaId: FX.empresaA, clienteOrigenSrId: { not: null } },
      }),
    ).toBe(conCliente.length);
  });

  it('cada fila liga con el espejo y sus visitas, venta y canceladas son las del generador', async () => {
    const { r, filas } = await todas(TODO);
    const esperado = aMano(TODO.desde, TODO.hasta);
    expect(filas.every((f) => f.cruce === 'ficha')).toBe(true);
    const conMovimiento = filas.filter((f) => f.visitas > 0 || f.canceladas.cuentas > 0);
    expect(conMovimiento.map((f) => `${f.sucursalId}|${f.origenSrId}`).sort()).toEqual(
      [...esperado.keys()].sort(),
    );
    for (const f of conMovimiento) {
      const e = esperado.get(`${f.sucursalId}|${f.origenSrId}`)!;
      expect({ visitas: f.visitas, venta: f.venta, canceladas: f.canceladas.cuentas }).toEqual({
        visitas: e.visitas,
        venta: e.venta.toFixed(2),
        canceladas: e.canceladas,
      });
    }
    const visitas = [...esperado.values()].reduce((n, e) => n + e.visitas, 0);
    expect(r.cuentasConCliente).toBe(visitas);
    expect(r.usaClientes).toBe(true);
  });

  it('AC cuadre sobre el seed: la ficha del cliente más frecuente = Tickets filtrado por él', async () => {
    const { filas } = await todas(TODO);
    const top = filas[0];
    expect(top.visitas).toBeGreaterThan(1);
    expect(top.visitas).toBeLessThanOrEqual(100);
    const ficha = await get(`/catalogos/clientes/${top.id}/ficha`, TODO);
    const periodo = ficha.periodo as { visitas: number; venta: string; ticketPromedio: string };
    const t = await get('/ventas/tickets', {
      ...TODO,
      clienteId: top.id!,
      canceladas: 'excluir',
      porPagina: '100',
    });
    expect(t.total).toBe(periodo.visitas);
    const suma = (t.items as Array<{ total: string }>).reduce(
      (s, x) => s.plus(x.total),
      new Prisma.Decimal(0),
    );
    expect(suma.toFixed(2)).toBe(periodo.venta);
    expect(suma.div(periodo.visitas).toFixed(2, Prisma.Decimal.ROUND_HALF_UP)).toBe(
      periodo.ticketPromedio,
    );
    expect({ visitas: top.visitas, venta: top.venta }).toEqual({
      visitas: periodo.visitas,
      venta: periodo.venta,
    });
  });
});
