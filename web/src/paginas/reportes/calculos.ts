import type { VentaDia, VentaSucursal } from '../../api/tipos';
import { aCentavos, sumar } from '../../dinero/dinero';

/**
 * Totales de los reportes (F1-043), exactos en centavos `bigint`. Son la fila
 * "Total" de cada tabla, y tienen que dar lo mismo que la tarjeta Venta total del
 * Panel de ventas para el mismo periodo: la API garantiza que Σ por-día y Σ
 * comparativo = `resumen.venta`, y aquí sólo se suma sin perder un centavo.
 *
 * Si una sola fila trae un importe ilegible, el total es `null` ("Sin dato"): una
 * suma que se salta una fila no cuadra, y un $0.00 inventado tampoco.
 */

export interface Totales {
  venta: bigint | null;
  cuentas: number;
}

export function totalDe(filas: readonly { venta: string; cuentas: number }[]): Totales {
  const centavos = filas.map((f) => aCentavos(f.venta));
  const cuentas = filas.reduce((n, f) => n + f.cuentas, 0);
  if (centavos.some((c) => c === null)) return { venta: null, cuentas };
  return { venta: sumar(centavos as bigint[]), cuentas };
}

/**
 * `a / b` a centavos, mitad lejos de cero: la misma regla que la API
 * (`ROUND_HALF_UP` de Decimal) para el ticket promedio. `null` sin divisor.
 */
export function dividirRedondeado(a: bigint, b: number): bigint | null {
  if (b <= 0) return null;
  const divisor = BigInt(b);
  const negativo = a < 0n;
  const absoluto = negativo ? -a : a;
  const q = (absoluto * 2n + divisor) / (divisor * 2n);
  return negativo ? -q : q;
}

export interface TotalComparativo extends Totales {
  /** Venta total / cuentas totales. Null sin cuentas o con la venta ilegible. */
  ticketPromedio: bigint | null;
  comensales: number;
}

export function totalComparativo(filas: readonly VentaSucursal[]): TotalComparativo {
  const { venta, cuentas } = totalDe(filas);
  return {
    venta,
    cuentas,
    ticketPromedio: venta === null ? null : dividirRedondeado(venta, cuentas),
    comensales: filas.reduce((n, f) => n + f.comensales, 0),
  };
}

export function totalPorDia(filas: readonly VentaDia[]): Totales {
  return totalDe(filas);
}

const FORMATO_DIA = new Intl.DateTimeFormat('es-MX', {
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

/**
 * `2026-09-01` → `mar, 1 sept`. El texto YA es el día local de la sucursal (lo
 * cortó la API): se formatea como fecha de calendario, en UTC, para que la zona
 * del navegador no lo mueva un día.
 */
export function etiquetaDia(dia: string): string {
  const t = Date.parse(`${dia}T12:00:00Z`);
  return Number.isNaN(t) ? dia : FORMATO_DIA.format(t);
}

/** `"12.500"` → `"12.5"`, `"3.000"` → `"3"`. Sólo recorta ceros, sin pasar por float. */
export function cantidadLegible(cantidad: string): string {
  if (!/^-?\d+(\.\d+)?$/.test(cantidad)) return cantidad;
  return cantidad.includes('.') ? cantidad.replace(/\.?0+$/, '') : cantidad;
}
