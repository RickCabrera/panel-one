import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { RecetasService } from '../src/inventario/recetas.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import { AgregadosVentasService } from '../src/ventas/agregados-ventas.service';
import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import { sembrarCatalogos } from './seed-catalogos';
import { sembrarExistencias } from './seed-existencias';
import { diasHasta, hoyEn } from './seed-maestro/azar';
import { unidadEntera } from './seed-maestro/insumos';
import { RECETAS } from './seed-maestro/recetas';
import { sembrarMovimientos } from './seed-movimientos';
import {
  lotesDeRecetas,
  PRODUCTO_RECETA_VACIA,
  recetasDelSeed,
  sembrarRecetas,
} from './seed-recetas';
import { DIAS, generarVentas, sembrarVentas, universoDe, type OpcionesVentas } from './seed-ventas';

// El seed de recetas (F2-125) y EL CRITERIO DE CIERRE contra el seed (regla 2 de la Ronda 2), en
// las sucursales de FIXTURES (empresa A; A1 en CDMX y A2 en Tijuana), nunca en las del seed de
// desarrollo. Reloj FIJO.
//
// Se siembran ventas, catálogos, recetas, pólizas y existencias por las MISMAS ingestas del
// agente, y se le piden a `RecetasService.consumoTeorico` dos semanas. El esperado se calcula AQUÍ,
// A MANO, desde los datos CRUDOS del generador y sin pasar por el servicio: teórico = Σ
// `RECETAS[productoClave]` × cantidad de las partidas de los cheques no cancelados cerrados ese
// día LOCAL; real = −Σ de los movimientos de las `PolizaSeed` de consumo, merma y ajuste de esos
// días. El servicio, en cambio, cruza las partidas con el producto POR NOMBRE en `cheque_partidas`
// y lee las pólizas de Postgres: son dos caminos independientes.
//
// Qué prueba y qué NO: la variación del seed es la merma de 0–4 % que el generador le suma al
// consumo, el redondeo de piezas hacia arriba y los ajustes y mermas que él mismo programó
// (`seed-maestro/inventario.ts`, pasos 3, 4 y 6). Que cuadre prueba que la ingesta, el cruce y el
// cálculo CONSERVAN lo simulado; no dice nada de cómo registra SoftRestaurant su consumo (eso es de
// F2-193 con el piloto; esquema-sr §10 "Recetas").
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const SUCURSALES = [
  { id: FX.sucursalA1, clave: 'A1', zonaHoraria: 'America/Mexico_City' },
  { id: FX.sucursalA2, clave: 'A2', zonaHoraria: 'America/Tijuana' },
];
const HOY = '2026-09-15';
const AHORA = new Date('2026-09-15T20:00:00.000Z');
const OP: OpcionesVentas = {
  empresaId: FX.empresaA,
  sucursales: SUCURSALES,
  hoy: HOY,
  ahora: AHORA,
};
const CHEQUES = generarVentas(OP);
const U = universoDe(OP, CHEQUES);
/**
 * Las últimas dos semanas del universo, hoy incluido (el ajuste del conteo cae hoy). Dos y no una:
 * la merma del generador es aleatoria (12 % por almacén y día) y con el reloj fijo una semana de
 * A1 no trae ninguna; así el rango ejerce los tres tipos en las dos sucursales.
 */
const SEMANA = diasHasta(HOY, DIAS).slice(-14);

/** Los tres insumos de control: por kg vendido a peso, en varios productos, y en piezas. */
const CONTROL = {
  porKg: 'I003', // Arrachera: P015 se vende por kg (1.050 kg por kg vendido)
  varios: 'I030', // Tortilla de maíz: en P001, P002, P005, P006, P008, P009, P010, P015, P017
  piezas: 'I041', // Bolillo: P003 (2 por orden)
} as const;

type D = Prisma.Decimal;
const Dec = Prisma.Decimal;
const CERO = new Dec(0);
const LENTO_MS = 180_000;
/** "-0.0" y "0.0" son el mismo valor: el API responde el cero sin signo. */
const sinCeroNegativo = (v: D): D => (v.isZero() ? CERO : v);

/** El esperado, a mano, para UNA sucursal y los días `dias` (locales de esa sucursal). */
function esperado(sucursalId: string, zona: string, dias: readonly string[]) {
  const enRango = new Set(dias);
  const teorico = new Map<string, D>();
  for (const c of CHEQUES) {
    if (c.sucursalId !== sucursalId || c.cancelado || !c.cerradoAt) continue;
    if (!enRango.has(hoyEn(zona, c.cerradoAt))) continue;
    for (const p of c.partidas) {
      for (const [insumo, q] of RECETAS[p.productoClave] ?? []) {
        teorico.set(insumo, (teorico.get(insumo) ?? CERO).plus(p.cantidad.times(q)));
      }
    }
  }
  const real = new Map<string, { consumo: D; merma: D; ajuste: D }>();
  for (const p of U.polizas) {
    if (p.sucursalId !== sucursalId || !enRango.has(p.dia)) continue;
    if (p.tipo !== 'consumo' && p.tipo !== 'merma' && p.tipo !== 'ajuste') continue;
    for (const m of p.movimientos) {
      const r = real.get(m.insumo) ?? { consumo: CERO, merma: CERO, ajuste: CERO };
      r[p.tipo] = r[p.tipo].minus(m.cantidad);
      real.set(m.insumo, r);
    }
  }
  const insumos = new Set([...teorico.keys(), ...real.keys()]);
  return new Map(
    [...insumos].map((i) => {
      const t = (teorico.get(i) ?? CERO).toDecimalPlaces(3, Dec.ROUND_HALF_UP);
      const r = real.get(i) ?? { consumo: CERO, merma: CERO, ajuste: CERO };
      const total = r.consumo.plus(r.merma).plus(r.ajuste);
      const variacion = total.minus(t);
      return [
        i,
        {
          teorico: t.toFixed(3),
          real: total.toFixed(3),
          consumo: r.consumo.toFixed(3),
          merma: r.merma.toFixed(3),
          ajuste: r.ajuste.toFixed(3),
          variacion: variacion.toFixed(3),
          porcentaje: t.greaterThan(0)
            ? sinCeroNegativo(
                variacion.div(t).times(100).toDecimalPlaces(1, Dec.ROUND_HALF_UP),
              ).toFixed(1)
            : null,
        },
      ];
    }),
  );
}

describe('sembrarRecetas() y el consumo teórico contra el seed (F2-125)', () => {
  const prisma = new PrismaClient();
  const datos = new ScopedPrismaService(prisma as unknown as PrismaService);
  const servicio = new RecetasService(datos, new AgregadosVentasService(datos));
  const scopeA = { tipo: 'empresa', empresaId: FX.empresaA } as const;

  async function foto() {
    const w = { where: { empresaId: FX.empresaA }, orderBy: { id: 'asc' as const } };
    return JSON.parse(
      JSON.stringify(
        await Promise.all([prisma.receta.findMany(w), prisma.renglonReceta.findMany(w)]),
      ),
    );
  }

  beforeAll(async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({
      where: { id: FX.sucursalA2 },
      data: { zonaHoraria: 'America/Tijuana' },
    });
    await sembrarVentas(prisma, OP);
    await sembrarCatalogos(prisma, {
      empresaId: FX.empresaA,
      sucursales: SUCURSALES,
      universo: U,
      capturadoAt: AHORA,
    });
    await sembrarRecetas(prisma, {
      empresaId: FX.empresaA,
      sucursales: SUCURSALES,
      universo: U,
      ahora: AHORA,
    });
    await sembrarMovimientos(prisma, {
      empresaId: FX.empresaA,
      sucursales: SUCURSALES,
      universo: U,
      ahora: AHORA,
    });
    await sembrarExistencias(prisma, {
      empresaId: FX.empresaA,
      sucursales: SUCURSALES,
      universo: U,
      capturadoAt: AHORA,
    });
  }, LENTO_MS);

  afterAll(async () => {
    jest.restoreAllMocks();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  }, 60_000);

  it('siembra una receta por producto con receta más la vacía de P021, en cada sucursal', async () => {
    const lista = recetasDelSeed(U);
    expect(lista).toHaveLength(Object.keys(RECETAS).length + 1);
    expect(lista.map((r) => r.productoOrigenSrId)).not.toContain('P020');
    expect(lista.find((r) => r.productoOrigenSrId === PRODUCTO_RECETA_VACIA)!.renglones).toEqual(
      [],
    );
    expect(lotesDeRecetas(lista)).toHaveLength(1);
    const renglones = Object.values(RECETAS).reduce((n, r) => n + r.length, 0);
    for (const s of SUCURSALES) {
      await expect(prisma.receta.count({ where: { sucursalId: s.id } })).resolves.toBe(
        lista.length,
      );
      await expect(prisma.renglonReceta.count({ where: { sucursalId: s.id } })).resolves.toBe(
        renglones,
      );
    }
  });

  it('es idempotente: sembrar dos veces más deja exactamente las mismas filas', async () => {
    const antes = await foto();
    for (let i = 0; i < 2; i++) {
      const r = await sembrarRecetas(prisma, {
        empresaId: FX.empresaA,
        sucursales: SUCURSALES,
        universo: U,
        ahora: AHORA,
      });
      expect(r).toMatchObject({ creadas: 0, actualizadas: 0 });
    }
    expect(await foto()).toEqual(antes);
  });

  for (const s of SUCURSALES) {
    it(
      `${s.clave}: TODAS las filas de la semana cuadran con el cálculo a mano desde el universo`,
      async () => {
        const r = await servicio.consumoTeorico(scopeA, {
          empresaId: FX.empresaA,
          sucursalId: s.id,
          desde: SEMANA[0],
          hasta: SEMANA[SEMANA.length - 1],
        });
        const esp = esperado(s.id, s.zonaHoraria, SEMANA);
        expect(r.sucursales).toEqual([
          expect.objectContaining({ sucursalId: s.id, calculada: true }),
        ]);
        const obtenido = new Map(
          r.filas.map((f) => [
            f.insumoOrigenSrId,
            {
              teorico: f.teorico,
              real: f.real,
              consumo: f.consumo,
              merma: f.merma,
              ajuste: f.ajuste,
              variacion: f.variacion,
              porcentaje: f.porcentaje,
            },
          ]),
        );
        expect(obtenido).toEqual(esp);
        // Que no pase en vacío: hay variaciones, mermas y ajustes dentro del rango.
        expect(r.filas.some((f) => f.variacion !== '0.000')).toBe(true);
        expect(r.filas.some((f) => f.merma !== '0.000')).toBe(true);
        expect(r.filas.some((f) => f.ajuste !== '0.000')).toBe(true);
        // Los desechables (I060, I061) se consumen por canal, no por producto: sin teórico.
        expect(r.filas.find((f) => f.insumoOrigenSrId === 'I060')).toMatchObject({
          sinTeorico: true,
          porcentaje: null,
        });
        // Los dos caminos de "sin receta" salen aparte, y nada más.
        expect(r.aparte.map((a) => [a.motivo, a.productoOrigenSrId])).toEqual(
          expect.arrayContaining([
            ['sin_receta', 'P020'],
            ['sin_receta', 'P021'],
          ]),
        );
        expect(r.aparte.every((a) => a.motivo === 'sin_receta')).toBe(true);
        expect(r.aparte).toHaveLength(2);
      },
      LENTO_MS,
    );
  }

  it('A1: los 3 insumos de control (por kg, en varios productos, en piezas) cuadran', async () => {
    expect(unidadEntera(CONTROL.piezas)).toBe(true);
    expect(unidadEntera(CONTROL.porKg)).toBe(false);
    const productosCon = (i: string) =>
      Object.entries(RECETAS).filter(([, r]) => r.some(([x]) => x === i)).length;
    expect(productosCon(CONTROL.varios)).toBeGreaterThan(3);

    const r = await servicio.consumoTeorico(scopeA, {
      empresaId: FX.empresaA,
      sucursalId: FX.sucursalA1,
      desde: SEMANA[0],
      hasta: SEMANA[SEMANA.length - 1],
    });
    const esp = esperado(FX.sucursalA1, 'America/Mexico_City', SEMANA);
    const variaciones: string[] = [];
    for (const i of Object.values(CONTROL)) {
      const f = r.filas.find((x) => x.insumoOrigenSrId === i)!;
      const e = esp.get(i)!;
      expect(new Dec(e.teorico).greaterThan(0)).toBe(true);
      expect(f).toMatchObject({ ...e, sinTeorico: false });
      expect(f.costo).not.toBeNull();
      // El importe es la variación × el costo, a centavos, mitad lejos de cero.
      expect(f.importeVariacion).toBe(
        new Dec(e.variacion).times(f.costo!).toDecimalPlaces(2, Dec.ROUND_HALF_UP).toFixed(2),
      );
      variaciones.push(e.variacion);
    }
    expect(variaciones.some((v) => v !== '0.000')).toBe(true);
  });

  it('las recetas se ven con su costo; P020 y P021 salen sin receta', async () => {
    const r = await servicio.recetas(scopeA, { empresaId: FX.empresaA, sucursalId: FX.sucursalA1 });
    const p = (id: string) => r.productos.find((x) => x.productoOrigenSrId === id)!;
    expect(p('P020')).toMatchObject({ conReceta: false, enCatalogo: true });
    expect(p('P021')).toMatchObject({ conReceta: false, enCatalogo: true });
    expect(p('P003')).toMatchObject({ conReceta: true });
    expect(p('P003').renglones.map((x) => x.insumoOrigenSrId)).toEqual(['I010', 'I032', 'I041']);
    expect(r.productos.filter((x) => x.conReceta)).toHaveLength(Object.keys(RECETAS).length);
  });
});
