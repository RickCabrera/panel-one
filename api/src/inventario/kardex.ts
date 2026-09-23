import { Prisma } from '@prisma/client';

import { instanteDesdeLocal } from '../comun/fechas';

/**
 * La parte PURA de Movimientos y Kardex (F2-122): saldo corrido, cuadre contra la existencia
 * leída y los límites de un rango de días en la zona de una sucursal. Todo en Decimal.
 */

type D = Prisma.Decimal;
const CERO = new Prisma.Decimal(0);

export interface MovimientoKardex {
  cantidad: D;
  /** De una póliza cancelada: se muestra, pero NO mueve el saldo. */
  cancelada: boolean;
}

export interface Kardex<T> {
  filas: Array<T & { saldo: D }>;
  saldoFinal: D;
  /** Σ de las cantidades positivas (no canceladas). */
  entradas: D;
  /** Σ del valor absoluto de las negativas (no canceladas). */
  salidas: D;
}

/**
 * El saldo corrido de un artículo: parte de `saldoInicial` y suma cada movimiento EN EL ORDEN
 * EN QUE LLEGA (quien llama ya lo ordenó: fecha, folio, renglón). Una fila cancelada repite el
 * saldo anterior.
 */
export function armarKardex<T extends MovimientoKardex>(
  saldoInicial: D,
  movimientos: readonly T[],
): Kardex<T> {
  let saldo = saldoInicial;
  let entradas = CERO;
  let salidas = CERO;
  const filas = movimientos.map((m) => {
    if (!m.cancelada) {
      saldo = saldo.plus(m.cantidad);
      if (m.cantidad.greaterThan(0)) entradas = entradas.plus(m.cantidad);
      else salidas = salidas.plus(m.cantidad.abs());
    }
    return { ...m, saldo };
  });
  return { filas, saldoFinal: saldo, entradas, salidas };
}

export interface Cuadre {
  /** true = la existencia leída es exactamente el saldo de los movimientos hasta su corte. */
  cuadra: boolean | null;
  /** existencia − saldo al corte; nulo si no hay con qué comparar. */
  diferencia: D | null;
}

/**
 * El cuadre del kardex contra la existencia de la última foto (F2-121). Se compara contra el
 * saldo de los movimientos HASTA EL CORTE de esa foto (no contra todo lo recibido: lo posterior
 * a la foto todavía no está en ella). Sin movimientos recibidos de la sucursal, o sin existencia
 * leída del artículo, no hay con qué comparar: `null`, nunca una "diferencia" inventada.
 */
export function cuadreDe(op: {
  polizasRecibidas: number;
  existencia: D | null;
  saldoAlCorte: D | null;
}): Cuadre {
  if (op.polizasRecibidas === 0 || op.existencia === null || op.saldoAlCorte === null) {
    return { cuadra: null, diferencia: null };
  }
  const diferencia = op.existencia.minus(op.saldoAlCorte);
  return { cuadra: diferencia.isZero(), diferencia: diferencia.isZero() ? CERO : diferencia };
}

/** `YYYY-MM-DD` + 1 día de calendario (aritmética sobre la medianoche UTC). */
export function diaSiguiente(dia: string): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/**
 * [desde 00:00, hasta+1 00:00) en la zona de la sucursal, como instantes UTC. Los días de
 * "hoy" se cortan en la zona de la SUCURSAL, nunca en la del servidor.
 */
export function limitesDelRango(
  desde: string,
  hasta: string,
  zona: string,
): { inicio: Date; fin: Date } {
  const inicio = instanteDesdeLocal(`${desde}T00:00:00`, zona);
  const fin = instanteDesdeLocal(`${diaSiguiente(hasta)}T00:00:00`, zona);
  if (!inicio || !fin) throw new Error('Rango de días inválido.');
  return { inicio, fin };
}
