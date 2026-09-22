import { Prisma } from '@prisma/client';

import { valorDe } from '../ingesta/existencias';

/**
 * La parte PURA de los conteos físicos (F2-123): la diferencia de cada renglón y los totales del
 * reporte. Todo en Decimal: cantidades NUMERIC(12,3), dinero NUMERIC(12,2), nunca un float.
 *
 * Un conteo es dato NUESTRO: el panel nunca ajusta nada en SoftRestaurant. El reporte es lo que
 * el encargado lleva a SR para registrar el ajuste ahí.
 */

type D = Prisma.Decimal;
const CERO = new Prisma.Decimal(0);

export const ESTADOS_RENGLON = ['con_diferencia', 'cuadra', 'sin_contar', 'sin_teorico'] as const;
export type EstadoRenglon = (typeof ESTADOS_RENGLON)[number];

export interface RenglonConteo {
  /** La existencia de la foto congelada al crear el conteo; nulo = no venía en la foto. */
  teorico: D | null;
  /** El costo promedio de esa misma foto; nulo cuando `teorico` es nulo. */
  costoPromedio: D | null;
  /** Lo capturado; nulo = todavía sin contar (NUNCA se toma como 0). */
  contado: D | null;
}

export interface DiferenciaRenglon {
  estado: EstadoRenglon;
  /** contado − teórico; nulo si falta alguno de los dos. */
  unidades: D | null;
  /** round(unidades × costo, 2); nulo si falta alguno. */
  importe: D | null;
}

/**
 * La diferencia de UN renglón. Sin contar o sin teórico no dan diferencia: se reportan aparte,
 * nunca como un 0 que parezca "cuadra". El importe se redondea POR RENGLÓN con la misma regla que
 * el valor de las existencias (`valorDe`, mitad lejos de cero): así los totales, que suman los
 * renglones ya redondeados, cuadran aritméticamente con lo que se ve en cada fila.
 */
export function diferenciaDe(r: RenglonConteo): DiferenciaRenglon {
  if (r.contado === null) {
    return { estado: 'sin_contar', unidades: null, importe: null };
  }
  if (r.teorico === null || r.costoPromedio === null) {
    return { estado: 'sin_teorico', unidades: null, importe: null };
  }
  const unidades = r.contado.minus(r.teorico);
  if (unidades.isZero()) {
    return { estado: 'cuadra', unidades: CERO, importe: CERO };
  }
  const importe = valorDe(unidades, r.costoPromedio);
  if (importe === null) {
    // No cabe en NUMERIC(12,2): no se inventa un importe; el renglón queda sin valuar.
    return { estado: 'con_diferencia', unidades, importe: null };
  }
  return { estado: 'con_diferencia', unidades, importe };
}

export interface TotalesConteo {
  articulos: number;
  contados: number;
  sinContar: number;
  sinTeorico: number;
  conDiferencia: number;
  /** Con diferencia pero con un importe que no cabe en NUMERIC(12,2): no suman a los $. */
  sinValuar: number;
  /** Σ de los importes negativos (lo que falta), ≤ 0, a 2 decimales. */
  faltante: string;
  /** Σ de los importes positivos (lo que sobra), ≥ 0. */
  sobrante: string;
  /** faltante + sobrante. */
  neto: string;
}

/**
 * Los totales del reporte: Σ de los importes de los renglones YA redondeados (no se recalcula el
 * total desde las unidades). `contados` incluye los `sin_teorico` (se contaron, no se pueden
 * comparar).
 */
export function totalesDe(renglones: readonly DiferenciaRenglon[]): TotalesConteo {
  let faltante = CERO;
  let sobrante = CERO;
  const t = {
    articulos: renglones.length,
    contados: 0,
    sinContar: 0,
    sinTeorico: 0,
    conDiferencia: 0,
    sinValuar: 0,
  };
  for (const r of renglones) {
    if (r.estado === 'sin_contar') {
      t.sinContar++;
      continue;
    }
    t.contados++;
    if (r.estado === 'sin_teorico') t.sinTeorico++;
    if (r.estado === 'con_diferencia') t.conDiferencia++;
    if (r.importe === null) {
      if (r.estado === 'con_diferencia') t.sinValuar++;
      continue;
    }
    if (r.importe.lessThan(0)) faltante = faltante.plus(r.importe);
    else sobrante = sobrante.plus(r.importe);
  }
  return {
    ...t,
    faltante: faltante.toFixed(2),
    sobrante: sobrante.toFixed(2),
    neto: faltante.plus(sobrante).toFixed(2),
  };
}
