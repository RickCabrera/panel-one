import { Prisma, PrismaClient } from '@prisma/client';

import type { Reloj } from '../src/comun/reloj';
import { MesasService } from '../src/mesas/mesas.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import {
  DESCONECTADA_HACE_MS,
  generarSnapshots,
  MESAS_EN_VIVO,
  ORIGEN_SEED,
  sembrarMesas,
  type OpcionesMesas,
} from './seed-mesas';
import { meserosDe, nombreGrupo, precioEn, PRODUCTOS } from './seed-maestro/catalogos';

// El seed de snapshots de F1-050 contra Postgres real, en las sucursales de
// FIXTURES (empresa A), nunca en las de `SEED_IDS`. La idempotencia se prueba con
// un `ahora` FIJO: con otro `ahora` el seed genera, a propósito, otras horas.

const AHORA = new Date('2026-11-15T20:00:00.000Z');
const OPCIONES: OpcionesMesas = {
  empresaId: FX.empresaA,
  sucursales: [FX.sucursalA1, FX.sucursalA2],
  ahora: AHORA,
};

describe('generarSnapshots()', () => {
  const [vivo, desconectada] = generarSnapshots(OPCIONES);

  it('la primera sucursal está en vivo; la segunda, con su última lectura de hace 2 h', () => {
    expect(vivo.sucursalId).toBe(FX.sucursalA1);
    expect(vivo.capturadoAt.toISOString()).toBe('2026-11-15T20:00:00.000Z');
    expect(vivo.recibidoAt.toISOString()).toBe('2026-11-15T20:00:00.000Z');
    expect(desconectada.sucursalId).toBe(FX.sucursalA2);
    expect(DESCONECTADA_HACE_MS).toBe(7_200_000);
    expect(desconectada.capturadoAt.toISOString()).toBe('2026-11-15T18:00:00.000Z');
    expect(desconectada.recibidoAt.toISOString()).toBe('2026-11-15T18:00:00.000Z');
    expect(vivo.payload.origen).toBe(ORIGEN_SEED);
  });

  it('las mesas en vivo cubren todo el semáforo, "n partidas más" e impreso mezclado', () => {
    const minutos = vivo.payload.mesas.map(
      (m) => (AHORA.getTime() - Date.parse(m.abiertoAt)) / 60_000,
    );
    expect(minutos.some((m) => m < 40)).toBe(true);
    expect(minutos.some((m) => m >= 40 && m <= 60)).toBe(true);
    expect(minutos.some((m) => m > 60)).toBe(true);
    expect(vivo.payload.mesas.some((m) => m.partidas.length > 3)).toBe(true);
    expect(new Set(vivo.payload.mesas.map((m) => m.impreso))).toEqual(new Set([true, false]));
    const mods = vivo.payload.mesas.flatMap((m) => m.partidas.flatMap((p) => p.modificadores));
    expect(mods.some((x) => x.precio === '0.00')).toBe(true);
    expect(mods.some((x) => x.precio !== '0.00')).toBe(true);
  });

  it('F2-223: la sucursal en vivo trae 60 mesas, con número y folio únicos', () => {
    expect(MESAS_EN_VIVO).toBe(60);
    expect(vivo.payload.mesas).toHaveLength(60);
    expect(new Set(vivo.payload.mesas.map((m) => m.mesa)).size).toBe(60);
    expect(new Set(vivo.payload.mesas.map((m) => m.folio)).size).toBe(60);
    // Las 8 escritas a mano siguen siendo las primeras (sus importes se cuadran abajo).
    expect(vivo.payload.mesas.slice(0, 8).map((m) => m.mesa)).toEqual([
      '1',
      '2',
      '4',
      '5',
      '7',
      '10',
      '12',
      'Barra',
    ]);
    // Las generadas también cubren los tres colores del semáforo.
    const minutos = vivo.payload.mesas
      .slice(8)
      .map((m) => (AHORA.getTime() - Date.parse(m.abiertoAt)) / 60_000);
    expect(minutos.some((m) => m < 40)).toBe(true);
    expect(minutos.some((m) => m >= 40 && m <= 60)).toBe(true);
    expect(minutos.some((m) => m > 60)).toBe(true);
    expect(minutos.every((m) => Number.isInteger(m) && m >= 5 && m <= 150)).toBe(true);
  });

  it('F2-223: comandaImpresa mezclado, y siempre true en una cuenta ya impresa', () => {
    const todas = [vivo, desconectada].flatMap((s) => s.payload.mesas);
    const partidas = todas.flatMap((m) => m.partidas);
    expect(new Set(partidas.map((p) => p.comandaImpresa))).toEqual(new Set([true, false]));
    for (const m of todas.filter((x) => x.impreso)) {
      expect(m.partidas.every((p) => p.comandaImpresa)).toBe(true);
    }
    // La mesa 2 (sin imprimir, índice impar): su última partida está pendiente.
    const dos = vivo.payload.mesas.find((m) => m.mesa === '2')!;
    expect(dos.partidas.map((p) => p.comandaImpresa)).toEqual([true, false]);
  });

  it('los importes cuadran a mano: la mesa 5 y la mesa 2', () => {
    const mesa = (n: string) => vivo.payload.mesas.find((m) => m.mesa === n)!;
    // Mesa 2: 2 × (89.00 + 18.00 extra queso) + 4 × 38.00 = 214.00 + 152.00
    expect(mesa('2').partidas.map((p) => p.total)).toEqual(['214.00', '152.00']);
    expect(mesa('2').total).toBe('366.00');
    // Mesa 5: (112 + 18) + 0.75 × 489 + 2 × 138 + 6 × 55 + 2 × 68
    //       = 130.00 + 366.75 + 276.00 + 330.00 + 136.00 = 1238.75
    expect(mesa('5').total).toBe('1238.75');
  });

  it('cada total de mesa es la suma exacta de sus partidas', () => {
    for (const s of [vivo, desconectada]) {
      for (const m of s.payload.mesas) {
        const suma = m.partidas.reduce((a, p) => a.plus(p.total), new Prisma.Decimal(0));
        expect(m.total).toBe(suma.toFixed(2));
      }
    }
  });

  it('meseros, productos, grupos y precios son los del catálogo maestro (F2-201)', () => {
    const [centro, norte] = [meserosDe(0), meserosDe(1)].map(
      (l) => new Set(l.map((m) => m.nombre)),
    );
    for (const m of vivo.payload.mesas) expect(centro.has(m.mesero)).toBe(true);
    for (const m of desconectada.payload.mesas)
      expect(centro.has(m.mesero) || norte.has(m.mesero)).toBe(true);
    for (const [i, s] of [vivo, desconectada].entries()) {
      for (const p of s.payload.mesas.flatMap((m) => m.partidas)) {
        const q = PRODUCTOS.find((x) => x.nombre === p.producto)!;
        expect(q).toBeDefined();
        expect(nombreGrupo(q.grupo)).toBe(p.categoria);
        expect(p.precioUnit).toBe(precioEn(q, i));
      }
    }
  });

  it('es puro: el mismo ahora da exactamente lo mismo', () => {
    expect(generarSnapshots(OPCIONES)).toEqual(generarSnapshots(OPCIONES));
    expect(() => generarSnapshots({ ...OPCIONES, ahora: new Date('x') })).toThrow();
  });
});

describe('sembrarMesas() contra Postgres', () => {
  const prisma = new PrismaClient();
  const sucursales = { in: [FX.sucursalA1, FX.sucursalA2] };

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await sembrarMesas(prisma, OPCIONES);
  });

  afterAll(async () => {
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  const fotografia = () =>
    prisma.mesaSnapshot.findMany({
      where: { sucursalId: sucursales },
      orderBy: [{ sucursalId: 'asc' }, { capturadoAt: 'asc' }],
      omit: { id: true },
    });

  it('siembra un snapshot por sucursal', async () => {
    const filas = await fotografia();
    expect(filas).toHaveLength(2);
    expect(filas.find((f) => f.sucursalId === FX.sucursalA2)!.recibidoAt.toISOString()).toBe(
      '2026-11-15T18:00:00.000Z',
    );
  });

  it('es idempotente con el mismo ahora: tres corridas dejan los mismos datos', async () => {
    const antes = await fotografia();
    await sembrarMesas(prisma, OPCIONES);
    await sembrarMesas(prisma, OPCIONES);
    await sembrarMesas(prisma, OPCIONES);
    expect(await fotografia()).toEqual(antes);
  });

  it('con otro ahora reemplaza los suyos: no se acumulan', async () => {
    await sembrarMesas(prisma, { ...OPCIONES, ahora: new Date('2026-11-15T20:05:00Z') });
    await expect(prisma.mesaSnapshot.count({ where: { sucursalId: sucursales } })).resolves.toBe(2);
    await sembrarMesas(prisma, OPCIONES);
  });

  it('no toca snapshots que no sembró', async () => {
    // Un snapshot "del agente", ANTERIOR al sembrado (el último es el de mayor
    // capturadoAt): así el sembrado sigue siendo el último de A1.
    const ajeno = await prisma.mesaSnapshot.create({
      data: {
        sucursalId: FX.sucursalA1,
        empresaId: FX.empresaA,
        capturadoAt: new Date('2026-11-15T19:59:00Z'),
        payload: { mesas: [] },
      },
    });
    await sembrarMesas(prisma, OPCIONES);
    await expect(prisma.mesaSnapshot.count({ where: { id: ajeno.id } })).resolves.toBe(1);

    // Y GET /mesas/abiertas (el servicio real) devuelve el sembrado como el último.
    const reloj = { ahora: () => AHORA.getTime() + 30_000 } as Reloj;
    const servicio = new MesasService(
      new ScopedPrismaService(prisma as unknown as PrismaService),
      reloj,
    );
    const filas = await servicio.abiertas({ tipo: 'empresa', empresaId: FX.empresaA }, FX.empresaA);
    const a1 = filas.find((f) => f.sucursalId === FX.sucursalA1)!;
    expect(a1.snapshot!.capturadoAt).toBe('2026-11-15T20:00:00.000Z');
    expect(a1.snapshot!.edadRecepcionSegundos).toBe(30);
    expect(a1.snapshot!.mesas).toHaveLength(60);
    const a2 = filas.find((f) => f.sucursalId === FX.sucursalA2)!;
    expect(a2.snapshot!.edadRecepcionSegundos).toBe(7230);

    await prisma.mesaSnapshot.delete({ where: { id: ajeno.id } });
  });
});
