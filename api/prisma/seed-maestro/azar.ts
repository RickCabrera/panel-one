import { Prisma } from '@prisma/client';

/**
 * Utilidades deterministas del seed (F2-201). Nada aquí lee el reloj ni la red:
 * la misma entrada da exactamente la misma salida en cualquier máquina.
 */

/** mulberry32: PRNG pequeño y determinista. */
export function prng(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a de 32 bits en hex: prefijo estable de los ids. */
export function fnv(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Entero en [min, max] (ambos incluidos). */
export function entero(r: () => number, min: number, max: number): number {
  return min + Math.floor(r() * (max - min + 1));
}

export function elegir<T>(r: () => number, lista: readonly T[]): T {
  return lista[Math.floor(r() * lista.length)];
}

/** Dinero a 2 decimales, redondeo comercial (mitad hacia arriba). */
export function dinero(v: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(v).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Cantidad a 3 decimales (NUMERIC(12,3)), redondeo comercial. */
export function cantidad3(v: Prisma.Decimal.Value): Prisma.Decimal {
  return new Prisma.Decimal(v).toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}

/** Días `YYYY-MM-DD` desde `hoy - (n-1)` hasta `hoy`. */
export function diasHasta(hoy: string, n: number): string[] {
  const [a, m, d] = hoy.split('-').map(Number);
  const base = Date.UTC(a, m - 1, d);
  if (Number.isNaN(base) || new Date(base).toISOString().slice(0, 10) !== hoy) {
    throw new Error(`hoy inválido: ${hoy}`);
  }
  return Array.from({ length: n }, (_, i) =>
    new Date(base - (n - 1 - i) * 86_400_000).toISOString().slice(0, 10),
  );
}

/** `dia` desplazado `n` días (negativo = hacia atrás). */
export function sumarDias(dia: string, n: number): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}

/** Día de la semana (0 = domingo) de un `YYYY-MM-DD`. */
export function diaSemana(dia: string): number {
  return new Date(`${dia}T00:00:00Z`).getUTCDay();
}

/** Diferencia (ms) entre la hora local de `zona` y UTC en el instante `t`. */
function desfase(zona: string, t: number): number {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const v = (tipo: string) => Number(partes.find((p) => p.type === tipo)!.value);
  const local = Date.UTC(v('year'), v('month') - 1, v('day'), v('hour'), v('minute'), v('second'));
  return local - Math.floor(t / 1000) * 1000;
}

/** El instante UTC de una hora de pared en `zona` (sin horas ambiguas en el seed). */
export function instanteLocal(dia: string, segundosDelDia: number, zona: string): Date {
  const [a, m, d] = dia.split('-').map(Number);
  const pared = Date.UTC(a, m - 1, d) + segundosDelDia * 1000;
  let t = pared - desfase(zona, pared);
  t = pared - desfase(zona, t);
  return new Date(t);
}

/** Hoy (`YYYY-MM-DD`) en una zona IANA. */
export function hoyEn(zona: string, ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}
