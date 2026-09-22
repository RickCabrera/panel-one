import type { FormaPago } from '../api/tipos';
import { aCentavos } from '../dinero/dinero';

/**
 * La página y la búsqueda por folio de la vista Tickets, en la URL (`?pagina=&folio=`)
 * igual que el alcance y el periodo: un enlace copiado abre la misma página y
 * "atrás" deshace el cambio.
 */
export const PARAM_PAGINA = 'pagina';
export const PARAM_FOLIO = 'folio';

/** Topes de la API (`GET /ventas/tickets`). */
export const MAX_PAGINA = 10_000;
export const MAX_LARGO_FOLIO = 40;

/** Un entero de 1 a `MAX_PAGINA`. Cualquier otra cosa (`"abc"`, `"0"`, `"2.5"`) → 1. */
export function leerPagina(parametros: URLSearchParams): number {
  const texto = parametros.get(PARAM_PAGINA) ?? '';
  if (!/^\d{1,5}$/.test(texto)) return 1;
  const pagina = Number(texto);
  return pagina >= 1 && pagina <= MAX_PAGINA ? pagina : 1;
}

/** El prefijo de folio a buscar, sin espacios alrededor y recortado al tope de la API. */
export function limpiarFolio(texto: string): string {
  return texto.trim().slice(0, MAX_LARGO_FOLIO);
}

export function leerFolio(parametros: URLSearchParams): string {
  return limpiarFolio(parametros.get(PARAM_FOLIO) ?? '');
}

/** La página 1 no se escribe: es el default. */
export function escribirPagina(previos: URLSearchParams, pagina: number): URLSearchParams {
  const nuevos = new URLSearchParams(previos);
  if (pagina <= 1) nuevos.delete(PARAM_PAGINA);
  else nuevos.set(PARAM_PAGINA, String(pagina));
  return nuevos;
}

/** Una búsqueda nueva siempre arranca en la página 1. */
export function escribirFolio(previos: URLSearchParams, folio: string): URLSearchParams {
  const nuevos = new URLSearchParams(previos);
  const limpio = limpiarFolio(folio);
  if (limpio) nuevos.set(PARAM_FOLIO, limpio);
  else nuevos.delete(PARAM_FOLIO);
  nuevos.delete(PARAM_PAGINA);
  return nuevos;
}

export function paginasDe(total: number, porPagina: number): number {
  return Math.max(1, Math.ceil(total / porPagina));
}

// --- Filtros y orden (F2-222) ---------------------------------------------------------------

/**
 * Los filtros de Tickets viven en la URL como la página y el folio: un enlace copiado o una
 * recarga abren exactamente la misma lista. Son de la vista: NO van en `PARAMS_VISTA`.
 */
export const PARAMS_FILTRO = {
  mesero: 'mesero',
  mesa: 'mesa',
  forma: 'forma',
  importeMin: 'min',
  importeMax: 'max',
  canceladas: 'canceladas',
  producto: 'producto',
} as const;
export const PARAM_ORDEN = 'orden';
export const PARAM_DIR = 'dir';

/** Topes de la API para los textos de filtro. */
export const MAX_LARGO_TEXTO_FILTRO = 80;
export const MAX_LARGO_MESA = 40;

export const FORMAS = [
  'efectivo',
  'tarjeta',
  'transferencia',
  'otro',
] as const satisfies readonly FormaPago[];
export const CANCELADAS = ['incluir', 'excluir', 'solo'] as const;
export type Canceladas = (typeof CANCELADAS)[number];
export const ORDENES = [
  'momento',
  'folio',
  'total',
  'mesa',
  'mesero',
  'comensales',
  'propina',
  'duracion',
] as const;
export type Orden = (typeof ORDENES)[number];
export type Direccion = 'asc' | 'desc';

export interface FiltrosTickets {
  mesero: string;
  mesa: string;
  forma: FormaPago | '';
  /** Pesos en texto (`"100"`, `"99.50"`); `''` = sin filtro. */
  importeMin: string;
  importeMax: string;
  canceladas: Canceladas;
  producto: string;
}

export const SIN_FILTROS: FiltrosTickets = {
  mesero: '',
  mesa: '',
  forma: '',
  importeMin: '',
  importeMax: '',
  canceladas: 'incluir',
  producto: '',
};

export interface OrdenTickets {
  orden: Orden;
  dir: Direccion;
}

export const ORDEN_DEFAULT: OrdenTickets = { orden: 'momento', dir: 'desc' };

/** El formato que acepta la API (`^-?\d{1,10}(\.\d{1,2})?$`). */
const IMPORTE = /^-?\d{1,10}(\.\d{1,2})?$/;

/** Un importe de filtro normalizado, o `''` si no es válido. */
export function limpiarImporte(texto: string): string {
  const limpio = texto.trim();
  return IMPORTE.test(limpio) ? limpio : '';
}

/** ¿El mínimo es mayor que el máximo? En centavos exactos, nunca en float. */
export function importesInvertidos(importeMin: string, importeMax: string): boolean {
  const min = importeMin ? aCentavos(importeMin) : null;
  const max = importeMax ? aCentavos(importeMax) : null;
  return min !== null && max !== null && min > max;
}

function textoDe(parametros: URLSearchParams, clave: string, tope: number): string {
  return (parametros.get(clave) ?? '').trim().slice(0, tope);
}

/**
 * Los filtros de la URL. Lo inválido se descarta (igual que `leerPagina`): una forma fuera del
 * catálogo, un importe mal escrito o un rango de importes al revés no llegan a la API.
 */
export function leerFiltros(parametros: URLSearchParams): FiltrosTickets {
  const forma = parametros.get(PARAMS_FILTRO.forma) ?? '';
  const canceladas = parametros.get(PARAMS_FILTRO.canceladas) ?? '';
  let importeMin = limpiarImporte(parametros.get(PARAMS_FILTRO.importeMin) ?? '');
  let importeMax = limpiarImporte(parametros.get(PARAMS_FILTRO.importeMax) ?? '');
  if (importesInvertidos(importeMin, importeMax)) {
    importeMin = '';
    importeMax = '';
  }
  return {
    mesero: textoDe(parametros, PARAMS_FILTRO.mesero, MAX_LARGO_TEXTO_FILTRO),
    mesa: textoDe(parametros, PARAMS_FILTRO.mesa, MAX_LARGO_MESA),
    forma: (FORMAS as readonly string[]).includes(forma) ? (forma as FormaPago) : '',
    importeMin,
    importeMax,
    canceladas: (CANCELADAS as readonly string[]).includes(canceladas)
      ? (canceladas as Canceladas)
      : 'incluir',
    producto: textoDe(parametros, PARAMS_FILTRO.producto, MAX_LARGO_TEXTO_FILTRO),
  };
}

/** Escribe TODOS los filtros (los vacíos y los default se borran) y vuelve a la página 1. */
export function escribirFiltros(
  previos: URLSearchParams,
  filtros: FiltrosTickets,
): URLSearchParams {
  const nuevos = new URLSearchParams(previos);
  const limpios = leerFiltros(
    new URLSearchParams(
      Object.entries(PARAMS_FILTRO).map(([llave, param]) => [
        param,
        String(filtros[llave as keyof FiltrosTickets]),
      ]),
    ),
  );
  for (const [llave, param] of Object.entries(PARAMS_FILTRO)) {
    const valor = limpios[llave as keyof FiltrosTickets];
    if (valor === '' || (llave === 'canceladas' && valor === 'incluir')) nuevos.delete(param);
    else nuevos.set(param, valor);
  }
  nuevos.delete(PARAM_PAGINA);
  return nuevos;
}

/** ¿Hay algún filtro aplicado (sin contar el folio)? */
export function hayFiltros(filtros: FiltrosTickets): boolean {
  return (Object.keys(SIN_FILTROS) as Array<keyof FiltrosTickets>).some(
    (llave) => filtros[llave] !== SIN_FILTROS[llave],
  );
}

export function leerOrden(parametros: URLSearchParams): OrdenTickets {
  const orden = parametros.get(PARAM_ORDEN) ?? '';
  const dir = parametros.get(PARAM_DIR) ?? '';
  return {
    orden: (ORDENES as readonly string[]).includes(orden) ? (orden as Orden) : ORDEN_DEFAULT.orden,
    dir: dir === 'asc' || dir === 'desc' ? dir : ORDEN_DEFAULT.dir,
  };
}

/** El orden default no se escribe. Cambiar de orden vuelve a la página 1. */
export function escribirOrden(previos: URLSearchParams, orden: OrdenTickets): URLSearchParams {
  const nuevos = new URLSearchParams(previos);
  if (orden.orden === ORDEN_DEFAULT.orden && orden.dir === ORDEN_DEFAULT.dir) {
    nuevos.delete(PARAM_ORDEN);
    nuevos.delete(PARAM_DIR);
  } else {
    nuevos.set(PARAM_ORDEN, orden.orden);
    nuevos.set(PARAM_DIR, orden.dir);
  }
  nuevos.delete(PARAM_PAGINA);
  return nuevos;
}

/**
 * Tocar el encabezado de la columna que ya ordena invierte la dirección; tocar otra la elige
 * en su dirección natural: textos y folio de A a Z, cifras y fechas de mayor a menor.
 */
export function siguienteOrden(actual: OrdenTickets, columna: Orden): OrdenTickets {
  if (actual.orden === columna)
    return { orden: columna, dir: actual.dir === 'asc' ? 'desc' : 'asc' };
  const deTexto = columna === 'folio' || columna === 'mesa' || columna === 'mesero';
  return { orden: columna, dir: deTexto ? 'asc' : 'desc' };
}
