import { Prisma, type TipoPolizaInventario } from '@prisma/client';

/**
 * La parte PURA de Proyecciones y sugerido de compra (F2-127): promedio móvil PONDERADO de las
 * 4 semanas completas anteriores a hoy, por día de la semana. Sin ML: cada número se puede
 * rehacer a mano con las 4 cifras semanales que devuelve el API. Todo en Decimal; los días son
 * `YYYY-MM-DD` LOCALES de la sucursal (quien llama ya los cortó en su zona).
 *
 * DECISION PROVISIONAL (nocturno): la demanda de un almacén = lo que SALE de él por consumo,
 * merma y traspaso de salida (pólizas no canceladas). El ajuste (conteo físico, ±) no es demanda;
 * compras, inicial y entradas tampoco. El traspaso de salida SÍ: el almacén que surte a otro
 * tiene que comprar también para lo que manda. esquema-sr §10 "Proyecciones (F2-127)".
 */

type D = Prisma.Decimal;
const Dec = Prisma.Decimal;
const CERO = new Dec(0);

/** Los tipos de póliza cuyas SALIDAS son demanda del almacén. */
export const TIPOS_DEMANDA = [
  'consumo',
  'merma',
  'traspaso_salida',
] as const satisfies readonly TipoPolizaInventario[];

export const SEMANAS = 4;
/** Peso de cada semana, la MÁS RECIENTE primero. Σ = 10. */
export const PESOS = [4, 3, 2, 1] as const;
export const DIAS_VENTANA = SEMANAS * 7;
export const HORIZONTE_DEFECTO = 7;
export const HORIZONTE_MAX = 28;

const SUMA_PESOS = PESOS.reduce((a, b) => a + b, 0);
const DIA_MS = 86_400_000;

/** `dia` + `n` días de calendario (n puede ser negativo). */
export function sumarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + n * DIA_MS).toISOString().slice(0, 10);
}

/** Días de calendario de `desde` a `hasta` (positivo si `hasta` es posterior). */
export function diasEntre(desde: string, hasta: string): number {
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / DIA_MS);
}

/** 0 = domingo … 6 = sábado. */
export function diaDeSemana(dia: string): number {
  return new Date(`${dia}T00:00:00Z`).getUTCDay();
}

/** La ventana de historial: las 4 semanas completas ANTES de hoy, [hoy − 28, hoy − 1]. */
export function ventanaDe(hoy: string): { desde: string; hasta: string; dias: string[] } {
  const dias = Array.from({ length: DIAS_VENTANA }, (_, i) => sumarDias(hoy, i - DIAS_VENTANA));
  return { desde: dias[0], hasta: dias[dias.length - 1], dias };
}

/**
 * Los días del horizonte: [hoy, hoy + H − 1]. DECISION PROVISIONAL (nocturno): hoy entra
 * COMPLETO aunque la foto de existencias ya descontó parte de él: sobrestima un poco lo que
 * falta, que es el lado seguro (no quedarse sin insumo).
 */
export function diasDelHorizonte(hoy: string, horizonte: number): string[] {
  return Array.from({ length: horizonte }, (_, i) => sumarDias(hoy, i));
}

/**
 * Días de historial de un artículo: desde el día de su PRIMER movimiento hasta hoy (sin contar
 * hoy). Sin movimientos = 0. Con menos de 28 no se proyecta: "sin datos", nunca 0.
 */
export function diasDeHistorial(primerDia: string | null, hoy: string): number {
  if (primerDia === null) return 0;
  return Math.max(0, diasEntre(primerDia, hoy));
}

export function tieneHistorial(dias: number): boolean {
  return dias >= DIAS_VENTANA;
}

export interface Proyeccion {
  /** Demanda total de cada semana de la ventana, la MÁS RECIENTE primero. */
  semanas: D[];
  /** Σ sobre los días del horizonte del promedio ponderado de su día de semana, a 3 decimales. */
  proyeccion: D;
}

/**
 * La proyección de un artículo. `demandaPorDia` = lo que salió cada día local (positivo); un día
 * sin entrada es 0. Para cada día de la semana hay exactamente 4 muestras en la ventana; la de
 * la semana más reciente pesa 4 y la más vieja 1:
 *
 *   diario(w) = (4·c₁ + 3·c₂ + 2·c₃ + 1·c₄) / 10
 *   proyección = Σ_{d ∈ horizonte} diario(díaDeSemana(d))
 *
 * Se redondea UNA vez, al final, a 3 decimales (mitad lejos de cero): el cálculo a mano cuadra.
 */
export function proyectar(
  demandaPorDia: ReadonlyMap<string, D>,
  hoy: string,
  horizonte: number,
): Proyeccion {
  const semanas: D[] = PESOS.map(() => CERO);
  const ponderado: D[] = Array.from({ length: 7 }, () => CERO);
  for (const dia of ventanaDe(hoy).dias) {
    const c = demandaPorDia.get(dia) ?? CERO;
    const semana = Math.floor((diasEntre(dia, hoy) - 1) / 7);
    semanas[semana] = semanas[semana].plus(c);
    const w = diaDeSemana(dia);
    ponderado[w] = ponderado[w].plus(c.times(PESOS[semana]));
  }
  const total = diasDelHorizonte(hoy, horizonte).reduce(
    (acc, d) => acc.plus(ponderado[diaDeSemana(d)]),
    CERO,
  );
  return {
    semanas,
    proyeccion: total.div(SUMA_PESOS).toDecimalPlaces(3, Dec.ROUND_HALF_UP),
  };
}

/**
 * Sugerido de compra = max(0, proyección − existencia + mínimo). Sin existencia conocida (el
 * almacén no tiene foto) no se sugiere nada: nulo, no un número a ciegas. Sin mínimo, cuenta 0
 * (la fila lo avisa). Una existencia negativa se usa tal cual (sube el sugerido).
 */
export function sugerido(proyeccion: D, existencia: D | null, minimo: D | null): D | null {
  if (existencia === null) return null;
  const s = proyeccion.minus(existencia).plus(minimo ?? CERO);
  return s.greaterThan(0) ? s : CERO;
}
