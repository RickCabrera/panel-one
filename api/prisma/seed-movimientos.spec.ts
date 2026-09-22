import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { MovimientosService } from '../src/inventario/movimientos.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import { sembrarCatalogos } from './seed-catalogos';
import { sembrarExistencias } from './seed-existencias';
import { diasHasta } from './seed-maestro/azar';
import { fechaPoliza, lotesDe, prefijoPolizas, sembrarMovimientos } from './seed-movimientos';
import { DIAS, generarVentas, universoDe, type OpcionesVentas } from './seed-ventas';

// El seed de pólizas y movimientos (F2-122) contra Postgres real, en las sucursales de FIXTURES
// (empresa A), nunca en las del seed de desarrollo. Reloj FIJO por corrida.
//
// Qué prueba y qué NO: que la ingesta y el kardex CONSERVAN lo que simuló el seed maestro (las
// existencias del universo son inicial + Σ movimientos de la misma simulación). No prueba que SR
// registre así sus movimientos: ese cuadre es de F2-193 con el piloto. La prueba independiente
// del kardex, con literales escritos a mano, es `src/inventario/movimientos.e2e.spec.ts`.
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const SUCURSALES = [
  { id: FX.sucursalA1, clave: 'A1', zonaHoraria: 'America/Mexico_City' },
  { id: FX.sucursalA2, clave: 'A2', zonaHoraria: 'America/Tijuana' },
];
const opDe = (hoy: string, ahora: Date): OpcionesVentas => ({
  empresaId: FX.empresaA,
  sucursales: SUCURSALES,
  hoy,
  ahora,
});
const DIA_1 = { hoy: '2026-09-15', ahora: new Date('2026-09-15T20:00:00.000Z') };
const DIA_2 = { hoy: '2026-09-16', ahora: new Date('2026-09-16T20:00:00.000Z') };
const universoDel = (d: typeof DIA_1) =>
  universoDe(opDe(d.hoy, d.ahora), generarVentas(opDe(d.hoy, d.ahora)));
const U1 = universoDel(DIA_1);
const U2 = universoDel(DIA_2);

type D = Prisma.Decimal;

/** Sembrar la ventana completa (~1000 pólizas) y recorrer el kardex de cada artículo tarda. */
const LENTO_MS = 180_000;

describe('sembrarMovimientos() (F2-122)', () => {
  const prisma = new PrismaClient();
  const servicio = new MovimientosService(
    new ScopedPrismaService(prisma as unknown as PrismaService),
  );

  async function sembrarTodo(u: typeof U1, ahora: Date) {
    await sembrarCatalogos(prisma, {
      empresaId: FX.empresaA,
      sucursales: SUCURSALES,
      universo: u,
      capturadoAt: ahora,
    });
    const r = await sembrarMovimientos(prisma, {
      empresaId: FX.empresaA,
      sucursales: SUCURSALES,
      universo: u,
      ahora,
    });
    await sembrarExistencias(prisma, {
      empresaId: FX.empresaA,
      sucursales: SUCURSALES,
      universo: u,
      capturadoAt: ahora,
    });
    return r;
  }

  async function foto() {
    const w = { where: { empresaId: FX.empresaA }, orderBy: { id: 'asc' as const } };
    return JSON.parse(
      JSON.stringify(
        await Promise.all([
          prisma.polizaInventario.findMany(w),
          prisma.movimientoInventario.findMany(w),
        ]),
      ),
    );
  }

  /**
   * EL AC: por cada artículo, Σ de sus movimientos = su existencia (sin huecos ni dobles), y el
   * kardex de la ventana completa parte de 0, termina en la existencia y dice `cuadra`.
   */
  async function kardexCuadra(u: typeof U1, hoy: string) {
    const sumas = await prisma.movimientoInventario.groupBy({
      by: ['sucursalId', 'almacenOrigenSrId', 'insumoOrigenSrId'],
      where: { empresaId: FX.empresaA },
      _sum: { cantidad: true },
    });
    const llave = (s: string, a: string, i: string) => `${s}|${a}|${i}`;
    const suma = new Map<string, D>(
      sumas.map((x) => [
        llave(x.sucursalId, x.almacenOrigenSrId, x.insumoOrigenSrId),
        x._sum.cantidad ?? new Prisma.Decimal(0),
      ]),
    );
    // Ningún artículo con movimientos fuera de las existencias del universo.
    const deExistencias = new Set(
      u.existencias.map((e) => llave(e.sucursalId, e.almacen, e.insumo)),
    );
    expect([...suma.keys()].filter((k) => !deExistencias.has(k))).toEqual([]);
    const dias = diasHasta(hoy, DIAS);
    for (const e of u.existencias) {
      const k = llave(e.sucursalId, e.almacen, e.insumo);
      expect([k, (suma.get(k) ?? new Prisma.Decimal(0)).toFixed(3)]).toEqual([
        k,
        e.cantidad.toFixed(3),
      ]);
      const r = await servicio.kardex(
        { tipo: 'global' },
        {
          empresaId: FX.empresaA,
          sucursalId: e.sucursalId,
          almacenOrigenSrId: e.almacen,
          insumoOrigenSrId: e.insumo,
          desde: dias[0],
          hasta: hoy,
        },
      );
      expect([k, r.saldoInicial, r.saldoFinal, r.existencia, r.cuadra, r.diferencia]).toEqual([
        k,
        '0.000',
        e.cantidad.toFixed(3),
        e.cantidad.toFixed(3),
        true,
        '0.000',
      ]);
    }
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('los lotes respetan los dos topes del contrato y no pierden ni repiten pólizas', () => {
    const lotes = lotesDe(U1.polizas);
    expect(lotes.flat().map((p) => p.folio)).toEqual(U1.polizas.map((p) => p.folio));
    for (const l of lotes) {
      expect(l.length).toBeLessThanOrEqual(200);
      expect(l.reduce((n, p) => n + p.movimientos.length, 0)).toBeLessThanOrEqual(5000);
    }
  });

  it('las fechas siguen el orden de la simulación y nunca pasan de ahora', () => {
    for (const s of SUCURSALES) {
      const suyas = U1.polizas.filter((p) => p.sucursalId === s.id);
      const fechas = suyas.map((p) => fechaPoliza(p, s.zonaHoraria, DIA_1.ahora).getTime());
      expect(fechas.every((t) => t <= DIA_1.ahora.getTime())).toBe(true);
      // Por almacén, en el orden de folio (el de la simulación), la fecha nunca retrocede.
      for (const almacen of new Set(suyas.map((p) => p.almacen))) {
        const f = suyas
          .map((p, i) => ({ p, t: fechas[i] }))
          .filter((x) => x.p.almacen === almacen)
          .map((x) => x.t);
        expect(f).toEqual([...f].sort((a, b) => a - b));
      }
    }
  });

  it(
    'persiste póliza por póliza lo del universo, con importes y nombres',
    async () => {
      const r = await sembrarTodo(U1, DIA_1.ahora);
      const movimientos = U1.polizas.reduce((n, p) => n + p.movimientos.length, 0);
      expect(r).toEqual({ polizas: U1.polizas.length, movimientos, borradas: 0 });
      const guardadas = await prisma.polizaInventario.findMany({
        where: { empresaId: FX.empresaA },
        include: { movimientos: { orderBy: { renglon: 'asc' } } },
      });
      expect(guardadas).toHaveLength(U1.polizas.length);
      const porFolio = new Map(guardadas.map((g) => [g.origenSrId, g]));
      for (const p of U1.polizas) {
        const g = porFolio.get(p.folio)!;
        expect([p.folio, g.tipo, g.almacenOrigenSrId, g.referencia, g.cancelada]).toEqual([
          p.folio,
          p.tipo,
          p.almacen,
          p.referencia,
          false,
        ]);
        expect(
          g.movimientos.map((m) => [
            m.insumoOrigenSrId,
            m.cantidad.toFixed(3),
            m.importe.toFixed(2),
          ]),
        ).toEqual(
          p.movimientos.map((m) => [m.insumo, m.cantidad.toFixed(3), m.importe.toFixed(2)]),
        );
      }
    },
    LENTO_MS,
  );

  it(
    'AC: el kardex de cada artículo reproduce su existencia (inicial + movimientos)',
    async () => {
      await kardexCuadra(U1, DIA_1.hoy);
    },
    LENTO_MS,
  );

  it(
    'idempotente: N corridas con el mismo reloj dejan exactamente lo mismo',
    async () => {
      const antes = await foto();
      await sembrarTodo(U1, DIA_1.ahora);
      await sembrarTodo(U1, DIA_1.ahora);
      expect(await foto()).toEqual(antes);
    },
    LENTO_MS,
  );

  it(
    'otro día: borra lo de la ventana vieja, no deja dobles y el kardex sigue cuadrando',
    async () => {
      const r = await sembrarTodo(U2, DIA_2.ahora);
      const guardadas = await prisma.polizaInventario.findMany({
        where: { empresaId: FX.empresaA },
        select: { origenSrId: true },
      });
      expect(guardadas.map((g) => g.origenSrId).sort()).toEqual(
        U2.polizas.map((p) => p.folio).sort(),
      );
      // Los folios se numeran desde 1 por sucursal: sobran los del final de la ventana más larga.
      const cuantas = (u: typeof U1, id: string) =>
        u.polizas.filter((p) => p.sucursalId === id).length;
      expect(r.borradas).toBe(
        SUCURSALES.reduce((n, s) => n + Math.max(0, cuantas(U1, s.id) - cuantas(U2, s.id)), 0),
      );
      expect(
        guardadas.every((g) =>
          SUCURSALES.some((s) => g.origenSrId.startsWith(prefijoPolizas(s.clave))),
        ),
      ).toBe(true);
      await kardexCuadra(U2, DIA_2.hoy);
    },
    LENTO_MS,
  );
});
