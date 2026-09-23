import { Prisma } from '@prisma/client';

/**
 * Reglas puras del tablero de facturación (F2-106). Sin base y sin red. Dinero en Decimal siempre;
 * la salida en texto con 2 decimales (la tasa, con 4).
 *
 * Una sola base de fechas para todo lo del CFDI: la fecha de EMISIÓN (`emitido_at`), cortada en la
 * zona de la sucursal del CFDI como las ventas de Fase 1. La tasa compara lo facturado en el periodo
 * contra lo vendido en el MISMO periodo: un ticket del día 31 facturado el día 1 cuenta en el mes
 * siguiente, así que la tasa puede pasar de 1 (se deja real, no se recorta).
 *
 * DECISION PROVISIONAL (nocturno): la tasa es facturado por EMISIÓN / venta por CIERRE, el mismo
 * rango. La alternativa (lo facturado DE las cuentas del periodo, acotada a 0..1) es decisión abierta
 * de Ricardo (docs/nocturno-log.md, F2-106). Hereda además el supuesto de que `cheques.total` no
 * incluye propina (docs/esquema-sr.md §2): la venta y la base del CFDI son la misma columna.
 */

const CERO = new Prisma.Decimal(0);

export const dec = (valor: unknown): Prisma.Decimal =>
  valor === null || valor === undefined ? CERO : new Prisma.Decimal(valor as Prisma.Decimal.Value);

export const pesos = (d: Prisma.Decimal): string => d.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * `facturado / venta` con 4 decimales, mitad lejos de cero. `null` si la venta no es positiva: sin
 * venta no hay tasa (nunca "0.0000", que diría que no se facturó nada de algo que no existe).
 */
export function tasaDe(facturado: Prisma.Decimal, venta: Prisma.Decimal): string | null {
  if (venta.lte(0)) return null;
  return facturado.div(venta).toFixed(4, Prisma.Decimal.ROUND_HALF_UP);
}

/** Los meses `YYYY-MM` que toca el rango de días `desde..hasta` (inclusivo), en orden. */
export function mesesDelRango(desde: string, hasta: string): string[] {
  const [a0, m0] = desde.split('-').map(Number);
  const [a1, m1] = hasta.split('-').map(Number);
  const meses: string[] = [];
  // Mes absoluto (año × 12 + mes − 1): una suma por vuelta, sin casos de diciembre.
  for (let n = a0 * 12 + m0 - 1; n <= a1 * 12 + m1 - 1; n++) {
    meses.push(`${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, '0')}`);
  }
  return meses;
}

export interface Acumulado {
  facturado: string;
  cfdis: number;
}

interface FilaAcumulada<K> {
  clave: K;
  facturado: unknown;
  /** No `cfdis`: la guardia del helper rechaza el nombre de la tabla real como alias. */
  num_cfdi: number;
}

/**
 * Completa una serie con TODAS sus claves (los meses del rango, las 24 horas): una clave sin CFDI
 * del periodo es un cero de verdad (sí hubo lectura: no se emitió nada ahí), no un hueco. Una
 * clave que el SQL trae y no está en la lista es un error nuestro: truena en vez de perderla.
 */
export function completar<K extends string | number>(
  claves: readonly K[],
  filas: readonly FilaAcumulada<K>[],
): Array<{ clave: K } & Acumulado> {
  const porClave = new Map(filas.map((f) => [f.clave, f]));
  for (const f of filas) {
    if (!claves.includes(f.clave)) {
      throw new Error(`Tablero de facturación: clave fuera de la serie (${String(f.clave)}).`);
    }
  }
  return claves.map((clave) => {
    const f = porClave.get(clave);
    return { clave, facturado: pesos(dec(f?.facturado)), cfdis: f?.num_cfdi ?? 0 };
  });
}

export const HORAS: readonly number[] = Array.from({ length: 24 }, (_, h) => h);

/**
 * El texto de búsqueda de la tabla de CFDI: sin espacios alrededor y en mayúsculas (RFC, UUID y
 * serie se guardan así). Vacío = sin búsqueda.
 */
export function normalizarBusqueda(q: string | undefined): string | null {
  const t = (q ?? '').trim().toUpperCase();
  return t.length === 0 ? null : t;
}
