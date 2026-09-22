import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import type { Auditoria } from '../src/comun/auditoria';
import { ExistenciasService } from '../src/inventario/existencias.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import { sembrarCatalogos } from './seed-catalogos';
import { ACTOR_SEED_EXISTENCIAS, sembrarExistencias } from './seed-existencias';
import { FORZADOS } from './seed-maestro/insumos';
import { generarVentas, universoDe, type OpcionesVentas } from './seed-ventas';

// El seed de existencias (F2-121) contra Postgres real, en las sucursales de FIXTURES (empresa
// A), nunca en las del seed de desarrollo. Reloj FIJO: la misma foto en cada corrida.

const OP: OpcionesVentas = {
  empresaId: FX.empresaA,
  sucursales: [
    { id: FX.sucursalA1, clave: 'A1', zonaHoraria: 'America/Mexico_City' },
    { id: FX.sucursalA2, clave: 'A2', zonaHoraria: 'America/Tijuana' },
  ],
  hoy: '2026-09-15',
};
const RELOJ = new Date('2026-09-15T20:00:00.000Z');
const universo = universoDe(OP, generarVentas(OP));

describe('sembrarExistencias() (F2-121)', () => {
  const prisma = new PrismaClient();
  const sembrar = (capturadoAt: Date) =>
    sembrarExistencias(prisma, {
      empresaId: FX.empresaA,
      sucursales: OP.sucursales,
      universo,
      capturadoAt,
    });

  async function foto() {
    const w = { where: { empresaId: FX.empresaA }, orderBy: { id: 'asc' as const } };
    return JSON.parse(
      JSON.stringify(
        await Promise.all([
          prisma.existencia.findMany(w),
          prisma.lecturaExistencias.findMany(w),
          prisma.limiteExistencia.findMany(w),
        ]),
      ),
    );
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await sembrarCatalogos(prisma, {
      empresaId: FX.empresaA,
      sucursales: OP.sucursales,
      universo,
      capturadoAt: RELOJ,
    });
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('persiste fila por fila lo del universo, con su valor y sus límites', async () => {
    const r = await sembrar(RELOJ);
    expect(r).toEqual({
      almacenes: universo.almacenes.length,
      existencias: universo.existencias.length,
      limites: universo.existencias.length,
    });
    const filas = await prisma.existencia.findMany({ where: { empresaId: FX.empresaA } });
    expect(filas).toHaveLength(universo.existencias.length);
    for (const e of universo.existencias) {
      const f = filas.find(
        (x) =>
          x.sucursalId === e.sucursalId &&
          x.almacenOrigenSrId === e.almacen &&
          x.insumoOrigenSrId === e.insumo,
      );
      expect(f).toBeDefined();
      expect(f!.cantidad.toFixed(3)).toBe(e.cantidad.toFixed(3));
      expect(f!.costoPromedio.toFixed(2)).toBe(e.costoPromedio.toFixed(2));
      expect(f!.valor.toFixed(2)).toBe(e.valor.toFixed(2));
    }
    const limites = await prisma.limiteExistencia.findMany({ where: { empresaId: FX.empresaA } });
    expect(limites.every((l) => l.actualizadoPor === ACTOR_SEED_EXISTENCIAS)).toBe(true);
    const lecturas = await prisma.lecturaExistencias.findMany({
      where: { empresaId: FX.empresaA },
    });
    expect(lecturas.map((l) => l.capturadoAt.toISOString())).toEqual(
      universo.almacenes.map(() => RELOJ.toISOString()),
    );
  });

  it('AC en la vista: valor total = Σ del universo; bajo mínimo y agotado forzados salen', async () => {
    const servicio = new ExistenciasService(
      new ScopedPrismaService(prisma as unknown as PrismaService),
      { ahora: () => RELOJ.getTime() },
      { registrar: () => undefined } as unknown as Auditoria,
    );
    const r = await servicio.listar({ tipo: 'global' }, { empresaId: FX.empresaA });
    const suma = universo.existencias.reduce((a, e) => a.plus(e.valor), new Prisma.Decimal(0));
    expect(r.kpis.valor).toBe(suma.toFixed(2));
    expect(r.kpis.articulos).toBe(universo.existencias.length);
    for (const tipo of ['GEN', 'BAR'] as const) {
      for (const s of OP.sucursales) {
        const almacen = `${s.clave}-${tipo}`;
        const de = (insumo: string) =>
          r.filas.find((f) => f.almacenOrigenSrId === almacen && f.insumoOrigenSrId === insumo)!;
        expect(de(FORZADOS[tipo].bajoMinimo).estado).toBe('bajo_minimo');
        expect(de(FORZADOS[tipo].agotado).estado).toBe('sin_existencia');
        // Con nombre del catálogo espejo (F2-120), no el id.
        expect(de(FORZADOS[tipo].bajoMinimo).insumo).not.toBeNull();
        expect(de(FORZADOS[tipo].bajoMinimo).almacen).not.toBeNull();
      }
    }
    expect(r.kpis.atencion).toBeGreaterThanOrEqual(4);
    expect(r.kpis.sinExistencia).toBeGreaterThanOrEqual(4);
  });

  it('idempotente: N corridas con el mismo reloj dejan la misma foto', async () => {
    const antes = await foto();
    await sembrar(RELOJ);
    await sembrar(RELOJ);
    expect(await foto()).toEqual(antes);
  });

  it('re-sembrar NO pisa un límite editado en el panel', async () => {
    const e = universo.existencias[0];
    await prisma.limiteExistencia.updateMany({
      where: { sucursalId: e.sucursalId, almacenOrigenSrId: e.almacen, insumoOrigenSrId: e.insumo },
      data: { minimo: new Prisma.Decimal('1.234'), maximo: null, actualizadoPor: FX.empresaA },
    });
    const r = await sembrar(new Date(RELOJ.getTime() + 60_000));
    expect(r.limites).toBe(0);
    const l = await prisma.limiteExistencia.findFirstOrThrow({
      where: { sucursalId: e.sucursalId, almacenOrigenSrId: e.almacen, insumoOrigenSrId: e.insumo },
    });
    expect(l.minimo!.toFixed(3)).toBe('1.234');
    expect(l.maximo).toBeNull();
  });
});
