import type { PrismaClient } from '@prisma/client';

import type { Reloj } from '../src/comun/reloj';
import { ComprasIngestaService } from '../src/ingesta/compras-ingesta.service';
import { MAX_COMPRAS_LOTE, MAX_PARTIDAS_COMPRAS_LOTE } from '../src/ingesta/dto/compras.dto';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import type { Universo } from './seed-maestro';
import { instanteLocal } from './seed-maestro/azar';
import type { CompraSeed } from './seed-maestro/inventario';

/**
 * Persiste las compras del seed maestro (F2-201) en las tablas de F2-126.
 *
 * - No las escribe directo: las manda en lotes por el MISMO servicio de la ingesta del agente
 *   (`ComprasIngestaService`), así importes y totales los calcula el API.
 * - `origenSrId` = `folio` = el folio del seed (`<sucursal>-OC-0001`), proveedor = la clave del
 *   proveedor (ya sembrado por F2-120 en `proveedores_catalogo`), almacén = la clave del almacén e
 *   insumo = la del insumo: los nombres se resuelven contra los espejos.
 * - `fecha` = el día de la compra a las 10:00 locales de la sucursal, RECORTADA a `ahora` (la
 *   ingesta no acepta futuro). Cae siempre en su día local.
 * - La compra es un documento APARTE de su póliza `compra` (F2-122, `CompraSeed.poliza`), que ya
 *   sembró `seed-movimientos.ts`: aquí no se toca ni se duplica.
 * - La ventana del universo se mueve con el reloj y renumera folios: antes de mandar se BORRAN las
 *   compras sembradas antes (prefijo `<sucursal>-OC-`) que ya no están en el universo actual.
 * - Idempotente: con el mismo reloj N corridas dejan exactamente lo mismo. No mueve el PRNG.
 */

/** Hora local (segundos del día) de las compras del seed. */
export const HORA_COMPRA = 10 * 3600;

export const prefijoCompras = (claveSucursal: string) => `${claveSucursal}-OC-`;

/** El instante de la compra: su día a las 10:00 locales, ≤ ahora. */
export function fechaCompra(c: CompraSeed, zona: string, ahora: Date): Date {
  const t = instanteLocal(c.dia, HORA_COMPRA, zona);
  return t.getTime() > ahora.getTime() ? ahora : t;
}

/** Parte las compras en lotes que respetan los dos topes del contrato. */
export function lotesDeCompras(compras: readonly CompraSeed[]): CompraSeed[][] {
  const lotes: CompraSeed[][] = [];
  let actual: CompraSeed[] = [];
  let partidas = 0;
  for (const c of compras) {
    if (c.partidas.length > MAX_PARTIDAS_COMPRAS_LOTE) {
      throw new Error(`La compra ${c.folio} del seed tiene demasiadas partidas.`);
    }
    if (
      actual.length === MAX_COMPRAS_LOTE ||
      partidas + c.partidas.length > MAX_PARTIDAS_COMPRAS_LOTE
    ) {
      lotes.push(actual);
      actual = [];
      partidas = 0;
    }
    actual.push(c);
    partidas += c.partidas.length;
  }
  if (actual.length > 0) lotes.push(actual);
  return lotes;
}

export interface ResultadoSembrarCompras {
  compras: number;
  partidas: number;
  borradas: number;
}

export async function sembrarCompras(
  prisma: PrismaClient,
  op: {
    empresaId: string;
    sucursales: ReadonlyArray<{ id: string; clave: string; zonaHoraria: string }>;
    universo: Universo;
    ahora: Date;
  },
): Promise<ResultadoSembrarCompras> {
  const reloj: Reloj = { ahora: () => op.ahora.getTime() };
  const servicio = new ComprasIngestaService(
    new ScopedPrismaService(prisma as unknown as PrismaService),
    reloj,
  );
  let compras = 0;
  let partidas = 0;
  let borradas = 0;
  for (const s of op.sucursales) {
    const suyas = op.universo.compras.filter((c) => c.sucursalId === s.id);
    const { count } = await prisma.compra.deleteMany({
      where: {
        empresaId: op.empresaId,
        sucursalId: s.id,
        origenSrId: { startsWith: prefijoCompras(s.clave), notIn: suyas.map((c) => c.folio) },
      },
    });
    borradas += count;
    for (const lote of lotesDeCompras(suyas)) {
      const r = await servicio.recibir(
        { sucursalId: s.id, empresaId: op.empresaId },
        {
          leidoAt: op.ahora.toISOString(),
          compras: lote.map((c) => ({
            origenSrId: c.folio,
            folio: c.folio,
            proveedorOrigenSrId: c.proveedor,
            almacenOrigenSrId: c.almacen,
            fecha: fechaCompra(c, s.zonaHoraria, op.ahora).toISOString(),
            cancelada: false,
            partidas: c.partidas.map((p) => ({
              insumoOrigenSrId: p.insumo,
              cantidad: p.cantidad.toFixed(3),
              costoUnitario: p.costoUnitario.toFixed(2),
            })),
          })),
        },
      );
      if (r.rechazadas.length > 0 || r.obsoletas > 0) {
        throw new Error(
          `El seed de compras mandó compras inválidas u obsoletas de ${s.clave}: ` +
            r.rechazadas.map((x) => x.motivo).join('; '),
        );
      }
      compras += lote.length;
      partidas += lote.reduce((n, c) => n + c.partidas.length, 0);
    }
  }
  return { compras, partidas, borradas };
}
