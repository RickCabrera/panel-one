import type { PrismaClient } from '@prisma/client';

import type { Reloj } from '../src/comun/reloj';
import { MAX_PARTIDAS_LOTE, MAX_POLIZAS_LOTE } from '../src/ingesta/dto/movimientos.dto';
import { MovimientosIngestaService } from '../src/ingesta/movimientos-ingesta.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import type { Universo } from './seed-maestro';
import { instanteLocal } from './seed-maestro/azar';
import type { PolizaSeed, TipoPoliza } from './seed-maestro/inventario';

/**
 * Persiste las pólizas y movimientos del seed maestro (F2-201) en las tablas de F2-122.
 *
 * - No escribe las pólizas directo: las manda en lotes por el MISMO servicio de la ingesta del
 *   agente (`MovimientosIngestaService`). Así la base queda como la dejaría el agente, con los
 *   importes calculados por el API.
 * - `origenSrId` = `folio` = el folio del seed (`<sucursal>-POL-00001`), almacén = la clave del
 *   almacén (`<sucursal>-GEN|BAR`) e insumo = la clave del insumo: las mismas que usan
 *   `seed-catalogos.ts` y `seed-existencias.ts`, así los nombres se resuelven y el kardex cuadra
 *   contra la foto de existencias.
 * - `fecha` = el día de la póliza a una hora fija por tipo, en el orden en que la simulación los
 *   aplica (inicial, compra, consumo, merma, traspaso, ajuste), RECORTADA a `ahora`: el día de hoy
 *   todavía no termina y la ingesta no acepta futuro. El desempate es el folio, que crece en el
 *   orden de la simulación (con ceros a la izquierda).
 * - La ventana del universo se mueve con el reloj: sembrar otro día renumera los folios. Antes de
 *   mandar, se BORRAN las pólizas sembradas antes (por el prefijo `<sucursal>-POL-`) que ya no
 *   están en el universo actual; las que siguen se reemplazan por la ingesta (su hash cambió). Así
 *   nunca quedan dobles y el kardex sigue reproduciendo la existencia.
 * - Idempotente: con el mismo reloj N corridas dejan exactamente lo mismo. No mueve el PRNG.
 */

/** Hora local (segundos del día) de cada tipo, en el orden de la simulación. */
const HORA_TIPO: Record<TipoPoliza, number> = {
  inicial: 7 * 3600,
  compra: 8 * 3600,
  consumo: 22 * 3600,
  merma: 22 * 3600 + 1800,
  traspaso_salida: 23 * 3600,
  traspaso_entrada: 23 * 3600,
  ajuste: 23 * 3600 + 1800,
};

export const prefijoPolizas = (claveSucursal: string) => `${claveSucursal}-POL-`;

export interface ResultadoSembrarMovimientos {
  polizas: number;
  movimientos: number;
  borradas: number;
}

/** El instante de la póliza: su día a la hora de su tipo, en la zona de la sucursal, ≤ ahora. */
export function fechaPoliza(p: PolizaSeed, zona: string, ahora: Date): Date {
  const t = instanteLocal(p.dia, HORA_TIPO[p.tipo], zona);
  return t.getTime() > ahora.getTime() ? ahora : t;
}

/** Parte las pólizas en lotes que respetan los dos topes del contrato. */
export function lotesDe(polizas: readonly PolizaSeed[]): PolizaSeed[][] {
  const lotes: PolizaSeed[][] = [];
  let actual: PolizaSeed[] = [];
  let partidas = 0;
  for (const p of polizas) {
    if (p.movimientos.length > MAX_PARTIDAS_LOTE) {
      throw new Error(`La póliza ${p.folio} del seed tiene más de ${MAX_PARTIDAS_LOTE} partidas.`);
    }
    if (actual.length === MAX_POLIZAS_LOTE || partidas + p.movimientos.length > MAX_PARTIDAS_LOTE) {
      lotes.push(actual);
      actual = [];
      partidas = 0;
    }
    actual.push(p);
    partidas += p.movimientos.length;
  }
  if (actual.length > 0) lotes.push(actual);
  return lotes;
}

export async function sembrarMovimientos(
  prisma: PrismaClient,
  op: {
    empresaId: string;
    sucursales: ReadonlyArray<{ id: string; clave: string; zonaHoraria: string }>;
    universo: Universo;
    ahora: Date;
  },
): Promise<ResultadoSembrarMovimientos> {
  const reloj: Reloj = { ahora: () => op.ahora.getTime() };
  const servicio = new MovimientosIngestaService(
    new ScopedPrismaService(prisma as unknown as PrismaService),
    reloj,
  );
  let polizas = 0;
  let movimientos = 0;
  let borradas = 0;
  for (const s of op.sucursales) {
    const suyas = op.universo.polizas.filter((p) => p.sucursalId === s.id);
    // Lo sembrado en otra ventana que ya no existe en ésta (las partidas caen en cascada).
    const viejas = {
      empresaId: op.empresaId,
      sucursalId: s.id,
      origenSrId: { startsWith: prefijoPolizas(s.clave), notIn: suyas.map((p) => p.folio) },
    };
    // F2-124: un traspaso del panel conciliado contra una de ellas la apunta con ON DELETE
    // RESTRICT. Se suelta el espejo (el renglón vuelve a "sin espejo"); la siguiente
    // conciliación lo re-verifica y deja el traspaso pendiente o lo vuelve a conciliar.
    const idsViejas = (
      await prisma.polizaInventario.findMany({ where: viejas, select: { id: true } })
    ).map((p) => p.id);
    if (idsViejas.length > 0) {
      await prisma.partidaTraspaso.updateMany({
        where: { empresaId: op.empresaId, polizaSalidaId: { in: idsViejas } },
        data: { polizaSalidaId: null, renglonSalida: null },
      });
      await prisma.partidaTraspaso.updateMany({
        where: { empresaId: op.empresaId, polizaEntradaId: { in: idsViejas } },
        data: { polizaEntradaId: null, renglonEntrada: null },
      });
    }
    const { count } = await prisma.polizaInventario.deleteMany({ where: viejas });
    borradas += count;
    for (const lote of lotesDe(suyas)) {
      const r = await servicio.recibir(
        { sucursalId: s.id, empresaId: op.empresaId },
        {
          leidoAt: op.ahora.toISOString(),
          polizas: lote.map((p) => ({
            origenSrId: p.folio,
            folio: p.folio,
            tipo: p.tipo,
            almacenOrigenSrId: p.almacen,
            fecha: fechaPoliza(p, s.zonaHoraria, op.ahora).toISOString(),
            referencia: p.referencia,
            cancelada: false,
            partidas: p.movimientos.map((m) => ({
              insumoOrigenSrId: m.insumo,
              cantidad: m.cantidad.toFixed(3),
              costoUnitario: m.costoUnitario.toFixed(2),
            })),
          })),
        },
      );
      if (r.rechazadas.length > 0 || r.obsoletas > 0) {
        throw new Error(
          `El seed de movimientos mandó pólizas inválidas u obsoletas de ${s.clave}: ` +
            r.rechazadas.map((x) => x.motivo).join('; '),
        );
      }
      polizas += lote.length;
      movimientos += lote.reduce((n, p) => n + p.movimientos.length, 0);
    }
  }
  return { polizas, movimientos, borradas };
}
