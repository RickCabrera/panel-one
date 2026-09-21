import { totalDe } from '../inicio/ventaEnVivo';

/** Una partida de la cuenta abierta, lo mínimo que pinta el grid. */
export interface PartidaMesa {
  producto: string | null;
  /** Texto decimal (`"2"`, `"0.75"`), o null si no es legible. */
  cantidad: string | null;
}

/**
 * Una cuenta abierta leída del snapshot. Cada campo que no se pudo leer es `null` y la
 * vista lo pinta como "Sin dato": nunca se inventa un $0.00 ni 0 minutos.
 */
export interface MesaAbierta {
  mesa: string | null;
  mesero: string | null;
  folio: string | null;
  /** Instante de apertura en ms, con el reloj de la PC del POS. */
  abiertoAt: number | null;
  total: bigint | null;
  comensales: number | null;
  /** `null` = el agente no dijo si la cuenta ya se imprimió. */
  impreso: boolean | null;
  /** `null` si el campo falta o no es una lista. */
  partidas: PartidaMesa[] | null;
}

/**
 * DECISION PROVISIONAL (nocturno): la forma de cada mesa del snapshot no está fijada
 * (esquema-sr.md §5, SUPUESTO; la valida F1-023 contra una instalación real de SR).
 * Se lee así:
 *
 * `{ mesa, mesero, folio, abiertoAt (ISO UTC, reloj del POS), total ("350.50" o número),
 *    comensales, impreso (bool), partidas: [{ producto, cantidad, ... }] }`
 *
 * La lectura es defensiva campo por campo: si mañana el agente manda otra forma, la
 * vista dice "Sin dato" en vez de romperse o de mostrar números falsos.
 */
export function leerMesa(crudo: Record<string, unknown>): MesaAbierta {
  return {
    mesa: texto(crudo.mesa),
    mesero: texto(crudo.mesero),
    folio: texto(crudo.folio),
    abiertoAt: instante(crudo.abiertoAt),
    // La misma regla que la tarjeta "Venta en vivo" del Panel (F1-041).
    total: totalDe(crudo),
    comensales: entero(crudo.comensales),
    impreso: typeof crudo.impreso === 'boolean' ? crudo.impreso : null,
    partidas: Array.isArray(crudo.partidas) ? crudo.partidas.map(leerPartida) : null,
  };
}

function leerPartida(crudo: unknown): PartidaMesa {
  if (crudo === null || typeof crudo !== 'object' || Array.isArray(crudo)) {
    return { producto: null, cantidad: null };
  }
  const p = crudo as Record<string, unknown>;
  return { producto: texto(p.producto), cantidad: cantidad(p.cantidad) };
}

function texto(v: unknown): string | null {
  if (typeof v === 'string' && v.trim() !== '') return v.trim();
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return null;
}

function instante(v: unknown): number | null {
  // Sólo ISO con zona explícita: una fecha sin zona se leería en la del navegador.
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(Z|[+-]\d{2}:\d{2})$/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isNaN(ms) ? null : ms;
}

function entero(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null;
}

const CANTIDAD = /^\d+(\.\d+)?$/;

function cantidad(v: unknown): string | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return String(v);
  if (typeof v === 'string' && CANTIDAD.test(v.trim())) {
    // "2.000" → "2", "0.750" → "0.75": como se lee en el POS.
    const [enteros, decimales = ''] = v.trim().split('.');
    const limpio = decimales.replace(/0+$/, '');
    return limpio === '' ? String(Number(enteros)) : `${Number(enteros)}.${limpio}`;
  }
  return null;
}
