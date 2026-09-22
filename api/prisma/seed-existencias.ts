import type { PrismaClient } from '@prisma/client';

import type { Reloj } from '../src/comun/reloj';
import { ExistenciasIngestaService } from '../src/ingesta/existencias-ingesta.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import type { Universo } from './seed-maestro';

/**
 * Persiste las existencias del seed maestro (F2-201) en las tablas de F2-121.
 *
 * - No escribe directo: manda, por cada almacén del universo, UNA foto completa por el MISMO
 *   servicio de la ingesta del agente (`ExistenciasIngestaService`). Así la base queda
 *   exactamente como la dejaría el agente, con su valor calculado por el API.
 * - `almacenOrigenSrId` = la clave del almacén (`<sucursal>-GEN|BAR`) y `insumoOrigenSrId` = la
 *   clave del insumo: las mismas que usa `seed-catalogos.ts`, así los nombres se resuelven.
 * - Los mínimos y máximos del universo (2 y 7 días de consumo) se siembran como límites del
 *   panel sólo donde el artículo NO tiene límite todavía (`skipDuplicates`): re-sembrar no pisa lo
 *   que alguien editó en el panel.
 * - Idempotente: con el mismo `capturadoAt` N corridas dejan la misma foto; con uno posterior
 *   sólo se mueve la lectura (`capturado_at`, `recibida_at`), nunca las filas iguales.
 * - No genera nada nuevo: el PRNG no se mueve.
 */

/** `actualizado_por` de los límites demo: no es un usuario (la columna no tiene FK). */
export const ACTOR_SEED_EXISTENCIAS = '00000000-0000-4000-8000-00000000f121';

export interface ResultadoSembrarExistencias {
  almacenes: number;
  existencias: number;
  limites: number;
}

export async function sembrarExistencias(
  prisma: PrismaClient,
  op: {
    empresaId: string;
    sucursales: ReadonlyArray<{ id: string }>;
    universo: Universo;
    capturadoAt: Date;
  },
): Promise<ResultadoSembrarExistencias> {
  const reloj: Reloj = { ahora: () => op.capturadoAt.getTime() };
  const servicio = new ExistenciasIngestaService(
    new ScopedPrismaService(prisma as unknown as PrismaService),
    reloj,
  );
  const ids = new Set(op.sucursales.map((s) => s.id));
  const almacenes = op.universo.almacenes.filter((a) => ids.has(a.sucursalId));
  let existencias = 0;
  for (const a of almacenes) {
    const del = op.universo.existencias.filter((e) => e.almacen === a.clave);
    const r = await servicio.recibir(
      { sucursalId: a.sucursalId, empresaId: op.empresaId },
      {
        almacenOrigenSrId: a.clave,
        capturadoAt: op.capturadoAt.toISOString(),
        registros: del.map((e) => ({
          insumoOrigenSrId: e.insumo,
          cantidad: e.cantidad.toFixed(3),
          costoPromedio: e.costoPromedio.toFixed(2),
        })),
      },
    );
    if (r.rechazados.length > 0) {
      throw new Error(
        `El seed de existencias mandó registros inválidos del almacén ${a.clave}: ` +
          r.rechazados.map((x) => x.motivo).join('; '),
      );
    }
    existencias += del.length;
  }
  const limites = await prisma.limiteExistencia.createMany({
    data: op.universo.existencias
      .filter((e) => ids.has(e.sucursalId))
      .map((e) => ({
        empresaId: op.empresaId,
        sucursalId: e.sucursalId,
        almacenOrigenSrId: e.almacen,
        insumoOrigenSrId: e.insumo,
        minimo: e.minimo,
        maximo: e.maximo,
        actualizadoPor: ACTOR_SEED_EXISTENCIAS,
        updatedAt: op.capturadoAt,
      })),
    skipDuplicates: true,
  });
  return { almacenes: almacenes.length, existencias, limites: limites.count };
}
