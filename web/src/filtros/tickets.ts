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
