import { Prisma } from '@prisma/client';

/**
 * La parte PURA de la vista de Existencias (F2-121): el estado (semáforo) de cada artículo y
 * los KPIs. Todo en Decimal: cantidades NUMERIC(12,3), dinero NUMERIC(12,2), nunca un float.
 */

type D = Prisma.Decimal;

export const ESTADOS_EXISTENCIA = [
  'sin_existencia',
  'bajo_minimo',
  'sobre_maximo',
  'ok',
  'sin_limites',
  'sin_lectura',
] as const;
export type EstadoExistencia = (typeof ESTADOS_EXISTENCIA)[number];

/**
 * - `sin_lectura`: hay un límite guardado pero el artículo ya no viene en la foto de su almacén
 *   (no se sabe su existencia: se muestra, no se oculta ni se inventa un 0).
 * - `sin_existencia`: cantidad ≤ 0 (también negativa).
 * - `bajo_minimo`: con mínimo y 0 < cantidad < mínimo (en el mínimo exacto, no).
 * - `sobre_maximo`: con máximo y cantidad > máximo.
 * - `ok`: con algún límite y dentro de él. `sin_limites`: sin mínimo ni máximo.
 */
export function estadoDe(cantidad: D | null, minimo: D | null, maximo: D | null): EstadoExistencia {
  if (cantidad === null) return 'sin_lectura';
  if (cantidad.lessThanOrEqualTo(0)) return 'sin_existencia';
  if (minimo !== null && cantidad.lessThan(minimo)) return 'bajo_minimo';
  if (maximo !== null && cantidad.greaterThan(maximo)) return 'sobre_maximo';
  if (minimo === null && maximo === null) return 'sin_limites';
  return 'ok';
}

export interface Kpis {
  /** Artículos con lectura (los `sin_lectura` van aparte). */
  articulos: number;
  /** Σ valor de los artículos con lectura, negativos incluidos, a 2 decimales. */
  valor: string;
  /** "Atención requerida" = bajo mínimo. */
  atencion: number;
  sinExistencia: number;
  sobreMaximo: number;
  sinLectura: number;
}

/**
 * Los KPIs sobre las filas ya filtradas por sucursal, almacén y búsqueda. El valor suma TODO lo
 * leído, negativos incluidos: SUPUESTO de cómo lo suma el reporte de SR (esquema-sr §10, lo
 * cuadra F2-193 contra el piloto).
 */
export function kpisDe(filas: ReadonlyArray<{ estado: EstadoExistencia; valor: D | null }>): Kpis {
  const k: Kpis = {
    articulos: 0,
    valor: '0.00',
    atencion: 0,
    sinExistencia: 0,
    sobreMaximo: 0,
    sinLectura: 0,
  };
  let valor = new Prisma.Decimal(0);
  for (const f of filas) {
    if (f.estado === 'sin_lectura' || f.valor === null) {
      k.sinLectura++;
      continue;
    }
    k.articulos++;
    valor = valor.plus(f.valor);
    if (f.estado === 'bajo_minimo') k.atencion++;
    else if (f.estado === 'sin_existencia') k.sinExistencia++;
    else if (f.estado === 'sobre_maximo') k.sobreMaximo++;
  }
  k.valor = valor.toFixed(2);
  return k;
}

/**
 * DECISION PROVISIONAL (nocturno): una lectura es "atrasada" si se RECIBIÓ hace más de 90 min
 * (3 × los 30 min con que el agente lee, F2-241). Instantes UTC del reloj del API.
 */
export const LECTURA_ATRASADA_MS = 90 * 60 * 1000;

export function atrasada(recibidaAt: Date | null, ahora: number): boolean {
  return recibidaAt !== null && ahora - recibidaAt.getTime() > LECTURA_ATRASADA_MS;
}
