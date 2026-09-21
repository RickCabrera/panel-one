import { pedir } from '../../api/cliente';
import type { PaginaTickets, Ticket } from '../../api/tipos';
import type { ParametrosTickets } from './consultas';

/** El `porPagina` máximo de la API: menos requests para bajar el filtro completo. */
export const POR_PAGINA_EXPORT = 100;

/**
 * DECISION PROVISIONAL (nocturno): tope de tickets por export. Todo el filtro se
 * junta en memoria antes de armar el archivo, y un rango de 366 días con varias
 * sucursales puede ser de cientos de miles de tickets con su detalle. Por encima
 * de esto se pide acotar el rango en vez de colgar la pestaña. Ver
 * docs/nocturno-log.md (F1-042).
 */
export const MAX_TICKETS_EXPORT = 50_000;

export class ErrorExport extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorExport';
  }
}

export const MENSAJE_CAMBIARON =
  'Los tickets cambiaron mientras se exportaba (llegaron o se corrigieron cheques). Vuelve a intentarlo.';

/**
 * Baja TODAS las páginas del filtro actual, en serie, y devuelve los tickets en el
 * orden de la API.
 *
 * El conteo y las páginas de la API son lecturas separadas, no una foto (log de
 * F1-033). DECISION PROVISIONAL (nocturno): si el `total` cambia entre páginas o
 * los tickets únicos no cuadran con él, NO se entrega archivo: un CSV al que le
 * falta o le sobra un cheque sin avisar es peor que pedir que se repita. Con
 * "Hoy" en hora pico eso va a pasar seguido; está anotado para F1-092.
 */
export async function exportarTickets(
  parametros: ParametrosTickets,
  opciones: { signal?: AbortSignal; onProgreso?: (hechos: number, total: number) => void } = {},
): Promise<Ticket[]> {
  const pedirPagina = (pagina: number) =>
    pedir<PaginaTickets>('/ventas/tickets', {
      query: { ...parametros, pagina, porPagina: POR_PAGINA_EXPORT },
      signal: opciones.signal,
    });

  const primera = await pedirPagina(1);
  const total = primera.total;
  if (total > MAX_TICKETS_EXPORT) {
    throw new ErrorExport(
      `Son ${total.toLocaleString('es-MX')} tickets y el máximo por archivo es ` +
        `${MAX_TICKETS_EXPORT.toLocaleString('es-MX')}. Acota el rango o elige una sucursal.`,
    );
  }

  const porId = new Map<string, Ticket>();
  const agregar = (items: readonly Ticket[]) => {
    for (const t of items) if (!porId.has(t.id)) porId.set(t.id, t);
  };
  agregar(primera.items);
  opciones.onProgreso?.(porId.size, total);

  const paginas = Math.ceil(total / POR_PAGINA_EXPORT);
  for (let pagina = 2; pagina <= paginas; pagina++) {
    const respuesta = await pedirPagina(pagina);
    if (respuesta.total !== total) throw new ErrorExport(MENSAJE_CAMBIARON);
    agregar(respuesta.items);
    opciones.onProgreso?.(porId.size, total);
  }

  if (porId.size !== total) throw new ErrorExport(MENSAJE_CAMBIARON);
  return [...porId.values()];
}

/** Dispara la descarga de un texto como archivo, sin pasar por el servidor. */
export function descargar(
  nombre: string,
  contenido: string,
  tipo = 'text/csv;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.style.display = 'none';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Revocar en el mismo tick puede cancelar la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
