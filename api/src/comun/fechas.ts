/**
 * ISO-8601 con zona OBLIGATORIA (`Z` u offset `±hh:mm`). Una fecha sin zona es
 * hora local de quién sabe dónde: se rechaza. Hasta 7 decimales de segundo
 * (lo que serializa .NET); se guardan milisegundos (`timestamptz(3)`).
 *
 * Vive aquí y no en la ingesta porque la usan la ingesta y el helper de scope de
 * ventas (`alturaAl`, F2-220). `ingesta/normalizar.ts` la reexporta.
 */
export const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * `AAAA-MM-DDThh:mm:ss` en la hora local de `zona`, sin offset: así pide la fecha el
 * Anexo 20 del CFDI 4.0 (hora del lugar de expedición). Movida aquí desde
 * `adaptadores/timbrado/cfdi-comun.ts` en F2-101, que la re-exporta como `fechaLocalCfdi`.
 */
export function fechaLocal(instante: Date, zona: string): string {
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

const CON_ZONA = /T.*(Z|[+-]\d{2}:?\d{2})$/i;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?$/;

/** Minutos que `zona` va adelante de UTC en el instante `ms`. */
function desfaseMinutos(ms: number, zona: string): number {
  const local = fechaLocal(new Date(ms), zona);
  const [f, h] = local.split('T');
  const [a, m, d] = f.split('-').map(Number);
  const [hh, mm, ss] = h.split(':').map(Number);
  return (Date.UTC(a, m - 1, d, hh, mm, ss) - Math.floor(ms / 1000) * 1000) / 60_000;
}

/**
 * Lo inverso de `fechaLocal`: una fecha que el PAC devuelve en hora local
 * (`AAAA-MM-DDThh:mm:ss`, sin zona) → instante UTC, leída en la zona de la sucursal y
 * NUNCA en la del proceso. Si el texto trae zona (`Z`, `-06:00`), se respeta tal cual.
 * Devuelve `null` si no es ninguno de los dos formatos.
 */
export function instanteDesdeLocal(texto: string, zona: string): Date | null {
  if (CON_ZONA.test(texto)) {
    const d = new Date(texto);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const p = LOCAL.exec(texto);
  if (!p) return null;
  const [, a, m, d, hh, mm, ss, frac] = p;
  const comoUtc =
    Date.UTC(+a, +m - 1, +d, +hh, +mm, +ss) + (frac ? Math.round(Number(frac) * 1000) : 0);
  // Dos pasadas: el desfase de la zona en el instante adivinado, y otra vez con el
  // corregido (cubre el cruce de un cambio de horario).
  let instante = comoUtc - desfaseMinutos(comoUtc, zona) * 60_000;
  instante = comoUtc - desfaseMinutos(instante, zona) * 60_000;
  return new Date(instante);
}
