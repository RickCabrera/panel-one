import type { Prisma } from '@prisma/client';

/** Dinero a 2 decimales como texto (XML del CFDI). */
export const dinero = (d: Prisma.Decimal): string => d.toFixed(2);
/** Cantidad y tasa: el SAT admite hasta 6 decimales. */
export const seis = (d: Prisma.Decimal): string => d.toFixed(6);

/**
 * `AAAA-MM-DDThh:mm:ss` en la hora local de `zona`, sin offset: así pide la fecha el
 * Anexo 20 del CFDI 4.0 (hora del lugar de expedición).
 */
export function fechaLocalCfdi(instante: Date, zona: string): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const p = (tipo: Intl.DateTimeFormatPartTypes): string =>
    partes.find((x) => x.type === tipo)?.value ?? '';
  return `${p('year')}-${p('month')}-${p('day')}T${p('hour')}:${p('minute')}:${p('second')}`;
}
