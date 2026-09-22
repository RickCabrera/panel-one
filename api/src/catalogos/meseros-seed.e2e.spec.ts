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

// Meseros (F2-231) sobre el SEED (F2-201): ventas y catálogo de meseros sembrados por los
// mismos generadores del seed de desarrollo, en las sucursales de FIXTURES de la empresa A
// (A1 en CDMX, A2 en Tijuana). Todo lo esperado sale A MANO del generador:
// - la clave de cada cheque, de `maestro.meseroClave` (dato independiente del nombre), así el
//   cruce por nombre se prueba contra algo que no es la misma normalización;
// - las bajas, de `bajaDesde` del universo (anclado al `hoy` fijo de OP, no al reloj real);
// - el día de cada cuenta, en la zona de SU sucursal.
// Lo que el seed NO trae (mesero nulo, sólo cancelaciones, textos con otra capitalización) se
// prueba en `meseros.e2e.spec.ts` con cuentas escritas a mano.

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

/** El momento que ubica la cuenta en el rango: cierre, o apertura si es cancelada sin cierre. */
const momento = (c: ChequeSeed) => (c.cancelado ? (c.cerradoAt ?? c.abiertoAt) : c.cerradoAt);
const enRango = (c: ChequeSeed, desde: string, hasta: string) => {
  const t = momento(c);
  if (!t) return false;
  const d = diaLocal(t, ZONA[c.sucursalId]);
  return d >= desde && d <= hasta;
};

interface Esperado {
  venta: Prisma.Decimal;
  cuentas: number;
  cancelados: number;
  montoCancelado: Prisma.Decimal;
}
/** Por (sucursal, clave del generador). */
function aMano(desde: string, hasta: string): Map<string, Esperado> {
  const m = new Map<string, Esperado>();
  for (const c of cheques.filter((x) => enRango(x, desde, hasta))) {
    const k = `${c.sucursalId}|${c.maestro.meseroClave}`;
    const e = m.get(k) ?? {
      venta: new Prisma.Decimal(0),
      cuentas: 0,
      cancelados: 0,
      montoCancelado: new Prisma.Decimal(0),
    };
    if (c.cancelado) {
      e.cancelados += 1;
      e.montoCancelado = e.montoCancelado.plus(c.total);
    } else {
      e.venta = e.venta.plus(c.total);
      e.cuentas += 1;
    }
    m.set(k, e);
  }
  return m;
}

interface Respuesta {
  venta: string;
  filas: Array<{
    sucursalId: string;
    mesero: string | null;
    cruce: string;
    catalogo: { clave: string | null; activoPos: boolean | null } | null;
    venta: string;
    cuentas: number;
    cancelados: { cuentas: number; monto: string };
    posicion: number | null;
  }>;
  sinVentas: Array<{ sucursalId: string; clave: string | null }>;
}

describe('Meseros sobre el seed (e2e, F2-231)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const rendimiento = async (query: Record<string, string>) => {
    const u = USUARIOS.visorA;
    const token = await app
      .get(TokensService)
      .firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
    const r = await request(url)
      .get('/catalogos/meseros/rendimiento')
      .query(query)
      .set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    return r.body as Respuesta;
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

  const TODO = { desde: haceDias(OP.hoy, 100), hasta: OP.hoy };

  it('guarda: el seed trae bajas con ventas antes de su baja y ninguna después', () => {
    const bajas = universo.meseros.filter((m) => m.bajaDesde !== null);
    expect(bajas.length).toBeGreaterThanOrEqual(2);
    for (const m of bajas) {
      const suyas = cheques.filter(
        (c) => c.sucursalId === m.sucursalId && c.maestro.meseroClave === m.clave,
      );
      expect(suyas.some((c) => enRango(c, TODO.desde, haceDias(m.bajaDesde!, 1)))).toBe(true);
      expect(suyas.some((c) => enRango(c, m.bajaDesde!, OP.hoy))).toBe(false);
    }
  });

  it('AC: Σ venta de los meseros = venta del periodo = Σ a mano del generador', async () => {
    const r = await rendimiento({ empresaId: FX.empresaA, ...TODO });
    const aManoTotal = cheques
      .filter((c) => !c.cancelado && enRango(c, TODO.desde, TODO.hasta))
      .reduce((s, c) => s.plus(c.total), new Prisma.Decimal(0));
    expect(r.venta).toBe(aManoTotal.toFixed(2));
    const suma = r.filas.reduce((s, f) => s.plus(f.venta), new Prisma.Decimal(0));
    expect(suma.toFixed(2)).toBe(r.venta);
  });

  it('el cruce por nombre asigna a cada mesero la clave que el generador le dio a sus cheques', async () => {
    const r = await rendimiento({ empresaId: FX.empresaA, ...TODO });
    const esperado = aMano(TODO.desde, TODO.hasta);
    // Todas las filas ligan con el espejo: el seed no trae textos fuera del catálogo.
    expect(r.filas.every((f) => f.cruce === 'catalogo')).toBe(true);
    const obtenido = new Map(
      r.filas.map((f) => [
        `${f.sucursalId}|${f.catalogo!.clave}`,
        {
          venta: f.venta,
          cuentas: f.cuentas,
          cancelados: f.cancelados,
        },
      ]),
    );
    expect([...obtenido.keys()].sort()).toEqual([...esperado.keys()].sort());
    for (const [k, e] of esperado) {
      expect(obtenido.get(k)).toEqual({
        venta: e.venta.toFixed(2),
        cuentas: e.cuentas,
        cancelados: { cuentas: e.cancelados, monto: e.montoCancelado.toFixed(2) },
      });
    }
  });

  it('AC: un mesero dado de baja sale ANTES de su baja con sus cifras, y después no vende', async () => {
    for (const m of universo.meseros.filter((x) => x.bajaDesde !== null)) {
      const antes = { desde: TODO.desde, hasta: haceDias(m.bajaDesde!, 1) };
      const r = await rendimiento({ empresaId: FX.empresaA, sucursalId: m.sucursalId, ...antes });
      const f = r.filas.find((x) => x.catalogo?.clave === m.clave);
      const e = aMano(antes.desde, antes.hasta).get(`${m.sucursalId}|${m.clave}`)!;
      expect(f).toMatchObject({
        mesero: m.nombre,
        venta: e.venta.toFixed(2),
        cuentas: e.cuentas,
        catalogo: { clave: m.clave, activoPos: false },
      });
      expect(f!.posicion).not.toBeNull();

      const despues = await rendimiento({
        empresaId: FX.empresaA,
        sucursalId: m.sucursalId,
        desde: m.bajaDesde!,
        hasta: OP.hoy,
      });
      expect(despues.filas.some((x) => x.catalogo?.clave === m.clave)).toBe(false);
      expect(despues.sinVentas.map((x) => x.clave)).toContain(m.clave);
    }
  });
});
