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
 * Corte por recepción (F2-203): una primera llamada de un solo ticket trae el
 * `corte` que sugiere la API ("ahora − 30 s" del reloj de la base), y todas las
 * páginas, la 1 incluida, se piden con él. Así un cheque que LLEGA a media
 * descarga, lo normal en "Hoy" en hora pico, ya no entra y ya no aborta nada.
 *
 * Lo que el corte NO congela: un ticket ya recibido que cambia de rango o de
 * estado a media descarga (se cancela, se corrige su fecha, o una cuenta abierta
 * que se cierra si el agente las llegara a mandar; docs/esquema-sr.md §2). Eso
 * mueve el conteo, y DECISION PROVISIONAL (nocturno): si el `total` cambia entre
 * páginas o los tickets únicos no cuadran con él, NO se entrega archivo: un CSV al
 * que le falta o le sobra un cheque sin avisar es peor que pedir que se repita.
 * Lo que tampoco se detecta: que cambie el IMPORTE de un ticket ya bajado (el
 * conteo no se mueve). Ver docs/nocturno-log.md (F2-203).
 */
export async function exportarTickets(
  parametros: ParametrosTickets,
  opciones: {
    signal?: AbortSignal;
    onProgreso?: (hechos: number, total: number) => void;
    /** El corte con que se bajó el archivo, para decir en pantalla hasta cuándo llega (F2-222). */
    onCorte?: (corte: string) => void;
  } = {},
): Promise<Ticket[]> {
  const { corte } = await pedir<PaginaTickets>('/ventas/tickets', {
    query: { ...parametros, pagina: 1, porPagina: 1 },
    signal: opciones.signal,
  });
  opciones.onCorte?.(corte);
  const pedirPagina = (pagina: number) =>
    pedir<PaginaTickets>('/ventas/tickets', {
      query: { ...parametros, pagina, porPagina: POR_PAGINA_EXPORT, corte },
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

/** Movida a `csv/csv.ts` (F1-043); se reexporta para Tickets. */
export { descargar } from '../../csv/csv';
