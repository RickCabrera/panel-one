import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type { FichaCliente, FilaResumenCliente, ResumenClientes } from '../../api/tipos';
import type { Rango } from '../../filtros/periodo';
import type { Filtro } from '../inicio/consultas';

/** Filas por página de la tabla (el tope de la API por página es 500: lo usa el export). */
export const POR_PAGINA = 50;
export const POR_PAGINA_EXPORT = 500;

function query(filtro: Filtro, rango: Rango) {
  return {
    empresaId: filtro.empresaId,
    sucursalId: filtro.sucursalId,
    desde: rango.desde,
    hasta: rango.hasta,
  };
}

/**
 * Clientes (F2-232): una página de la lista del periodo. `q` (que puede ser un nombre) viaja
 * sólo en esta petición: la vista no lo escribe en la URL del navegador.
 */
export function useResumenClientes(
  filtro: Filtro | null,
  rango: Rango | null,
  q: string,
  pagina: number,
) {
  return useQuery({
    queryKey: [
      'catalogos',
      'clientes-resumen',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
      q,
      pagina,
    ],
    queryFn: ({ signal }) =>
      pedir<ResumenClientes>('/catalogos/clientes/resumen', {
        query: { ...query(filtro!, rango!), q: q || undefined, pagina, porPagina: POR_PAGINA },
        signal,
      }),
    enabled: filtro !== null && rango !== null,
    placeholderData: keepPreviousData,
  });
}

export function useFichaCliente(empresaId: string | null, id: string | null, rango: Rango | null) {
  return useQuery({
    queryKey: ['catalogos', 'clientes-ficha', empresaId, id, rango?.desde, rango?.hasta],
    queryFn: ({ signal }) =>
      pedir<FichaCliente>(`/catalogos/clientes/${id}/ficha`, {
        query: { empresaId, desde: rango?.desde, hasta: rango?.hasta },
        signal,
      }),
    enabled: empresaId !== null && id !== null && rango !== null,
  });
}

/**
 * TODAS las filas (para el CSV), de 500 en 500. Los datos de contacto sólo se piden si el
 * usuario marcó la casilla (`contacto`).
 */
export async function todasLasFilas(
  filtro: Filtro,
  rango: Rango,
  q: string,
  contacto: boolean,
): Promise<FilaResumenCliente[]> {
  const filas: FilaResumenCliente[] = [];
  for (let pagina = 1; ; pagina++) {
    const r = await pedir<ResumenClientes>('/catalogos/clientes/resumen', {
      query: {
        ...query(filtro, rango),
        q: q || undefined,
        pagina,
        porPagina: POR_PAGINA_EXPORT,
        contacto: contacto ? 'true' : undefined,
      },
    });
    filas.push(...r.filas);
    if (r.filas.length === 0 || filas.length >= r.total) return filas;
  }
}
