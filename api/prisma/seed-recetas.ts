import type { PrismaClient } from '@prisma/client';

import type { Reloj } from '../src/comun/reloj';
import { MAX_RECETAS_LOTE, MAX_RENGLONES_LOTE } from '../src/ingesta/dto/recetas.dto';
import { RecetasIngestaService } from '../src/ingesta/recetas-ingesta.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import type { Universo } from './seed-maestro';

/**
 * Persiste las recetas del seed maestro (F2-201) en las tablas de F2-125.
 *
 * - No las escribe directo: las manda en lotes por el MISMO servicio de la ingesta del agente
 *   (`RecetasIngestaService`), igual que `seed-movimientos.ts`.
 * - `productoOrigenSrId` = la clave del producto (P001…) e `insumoOrigenSrId` = la del insumo
 *   (I001…): las mismas que usa `seed-catalogos.ts`, así el cruce por nombre y los nombres de los
 *   insumos se resuelven. Cada sucursal recibe las mismas recetas (cada una es su POS).
 * - Los dos caminos de "sin receta": P020 (Refresco) NO se manda (sin cabecera) y P021 (Cerveza
 *   nacional) se manda con `renglones: []` (SR dice que no tiene receta). Los dos salen aparte en
 *   el consumo teórico sin tronarlo.
 * - Idempotente: la misma receta tiene el mismo hash y no se toca. El conjunto de productos es
 *   fijo, así que nada que borrar entre corridas. No mueve el PRNG.
 */

/** El producto sin receta que se manda VACÍO (el otro, P020, simplemente no se manda). */
export const PRODUCTO_RECETA_VACIA = 'P021';

export interface RecetaSembrada {
  productoOrigenSrId: string;
  renglones: Array<{ insumoOrigenSrId: string; cantidad: string }>;
}

/** Las recetas que se mandan a CADA sucursal, en el orden del universo. */
export function recetasDelSeed(u: Universo): RecetaSembrada[] {
  const conReceta = u.recetas.map((r) => ({
    productoOrigenSrId: r.producto,
    renglones: r.renglones.map(([insumoOrigenSrId, cantidad]) => ({ insumoOrigenSrId, cantidad })),
  }));
  if (!u.productosSinReceta.includes(PRODUCTO_RECETA_VACIA)) {
    throw new Error(`El seed espera que ${PRODUCTO_RECETA_VACIA} no tenga receta.`);
  }
  return [...conReceta, { productoOrigenSrId: PRODUCTO_RECETA_VACIA, renglones: [] }];
}

/** Parte las recetas en lotes que respetan los dos topes del contrato. */
export function lotesDeRecetas(recetas: readonly RecetaSembrada[]): RecetaSembrada[][] {
  const lotes: RecetaSembrada[][] = [];
  let actual: RecetaSembrada[] = [];
  let renglones = 0;
  for (const r of recetas) {
    if (r.renglones.length > MAX_RENGLONES_LOTE) {
      throw new Error(`La receta ${r.productoOrigenSrId} del seed tiene demasiados renglones.`);
    }
    if (actual.length === MAX_RECETAS_LOTE || renglones + r.renglones.length > MAX_RENGLONES_LOTE) {
      lotes.push(actual);
      actual = [];
      renglones = 0;
    }
    actual.push(r);
    renglones += r.renglones.length;
  }
  if (actual.length > 0) lotes.push(actual);
  return lotes;
}

export interface ResultadoSembrarRecetas {
  recetas: number;
  renglones: number;
  creadas: number;
  actualizadas: number;
}

export async function sembrarRecetas(
  prisma: PrismaClient,
  op: {
    empresaId: string;
    sucursales: ReadonlyArray<{ id: string; clave: string }>;
    universo: Universo;
    ahora: Date;
  },
): Promise<ResultadoSembrarRecetas> {
  const reloj: Reloj = { ahora: () => op.ahora.getTime() };
  const servicio = new RecetasIngestaService(
    new ScopedPrismaService(prisma as unknown as PrismaService),
    reloj,
  );
  const recetas = recetasDelSeed(op.universo);
  const total: ResultadoSembrarRecetas = { recetas: 0, renglones: 0, creadas: 0, actualizadas: 0 };
  for (const s of op.sucursales) {
    for (const lote of lotesDeRecetas(recetas)) {
      const r = await servicio.recibir(
        { sucursalId: s.id, empresaId: op.empresaId },
        { leidoAt: op.ahora.toISOString(), recetas: lote.map((x) => ({ ...x })) },
      );
      if (r.rechazadas.length > 0) {
        throw new Error(
          `El seed de recetas mandó recetas inválidas de ${s.clave}: ` +
            r.rechazadas.map((x) => x.motivo).join('; '),
        );
      }
      total.recetas += lote.length;
      total.renglones += lote.reduce((n, x) => n + x.renglones.length, 0);
      total.creadas += r.creadas;
      total.actualizadas += r.actualizadas;
    }
  }
  return total;
}
