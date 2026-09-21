import { importeDe, totalDe } from '../inicio/ventaEnVivo';

/**
 * Hasta qué nivel se leen los modificadores de modificadores. Más abajo no se lee y
 * el nivel que se cortó lo dice (`truncado`): un payload patológico no revienta la
 * vista, y tampoco se esconde en silencio que había más.
 */
export const PROFUNDIDAD_MAX_MODIFICADORES = 4;

/** Un modificador de la partida; puede traer los suyos (modificador de modificador). */
export interface ModificadorMesa {
  nombre: string | null;
  /** Centavos; `0n` es un modificador de $0.00 (se muestra), `null` es "Sin dato". */
  precio: bigint | null;
  modificadores: ModificadorMesa[];
  /**
   * Traía modificadores que no se muestran: más abajo de
   * `PROFUNDIDAD_MAX_MODIFICADORES`, o un `modificadores` que no es lista.
   */
  truncado: boolean;
}

/** Una partida de la cuenta abierta: el grid pinta producto y cantidad; el modal, todo. */
export interface PartidaMesa {
  producto: string | null;
  /** Texto decimal (`"2"`, `"0.75"`), o null si no es legible. */
  cantidad: string | null;
  categoria: string | null;
  precioUnit: bigint | null;
  /**
   * El total de la partida TAL COMO LLEGA. Si falta es `null`: nunca se rellena con
   * `cantidad × precioUnit`, que con los redondeos de SR puede no dar lo mismo (§3).
   */
  total: bigint | null;
  /** `[]` = sin modificadores (también si el campo falta); `null` = no es una lista. */
  modificadores: ModificadorMesa[] | null;
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
 *    comensales, impreso (bool), partidas: [{ producto, categoria, cantidad, precioUnit,
 *    total, modificadores: [{ nombre, precio, modificadores?: [...] }] }] }`
 *
 * Los modificadores pueden anidarse con la MISMA llave (F1-051): un modificador de
 * modificador. Uno que llega como texto (`"Sin cebolla"`) es su nombre, sin precio.
 * Los importes siguen la regla del total de la mesa (`importeDe`).
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
  if (!esObjeto(crudo)) {
    return {
      producto: null,
      cantidad: null,
      categoria: null,
      precioUnit: null,
      total: null,
      modificadores: null,
    };
  }
  return {
    producto: texto(crudo.producto),
    cantidad: cantidad(crudo.cantidad),
    categoria: texto(crudo.categoria),
    precioUnit: importeDe(crudo.precioUnit),
    total: importeDe(crudo.total),
    // Ausente = sin modificadores, como en el contrato de ingesta (§13); presente y
    // que no sea lista = no se entiende: "Sin dato".
    modificadores:
      crudo.modificadores === undefined
        ? []
        : Array.isArray(crudo.modificadores)
          ? crudo.modificadores.map((m) => leerModificador(m, 1))
          : null,
  };
}

/** `nivel` 1 = modificador directo de la partida. */
function leerModificador(crudo: unknown, nivel: number): ModificadorMesa {
  if (typeof crudo === 'string') {
    return { nombre: texto(crudo), precio: null, modificadores: [], truncado: false };
  }
  if (!esObjeto(crudo)) {
    return { nombre: null, precio: null, modificadores: [], truncado: false };
  }
  const hijos = Array.isArray(crudo.modificadores) ? crudo.modificadores : [];
  // Traía algo en `modificadores` que no es lista: tampoco se esconde.
  const ilegibles = crudo.modificadores !== undefined && !Array.isArray(crudo.modificadores);
  const cabe = nivel < PROFUNDIDAD_MAX_MODIFICADORES;
  return {
    nombre: texto(crudo.nombre),
    precio: importeDe(crudo.precio),
    modificadores: cabe ? hijos.map((h) => leerModificador(h, nivel + 1)) : [],
    truncado: ilegibles || (!cabe && hijos.length > 0),
  };
}

function esObjeto(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
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
