import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';

import { pedir } from '../../api/cliente';
import type { PaginaTickets } from '../../api/tipos';
import type { Rango } from '../../filtros/periodo';
import type { Filtro } from '../inicio/consultas';

/** Tamaño de página de la tabla (backlog F1-042: "de 50 en 50"). */
export const POR_PAGINA = 50;

/** El filtro completo de `/ventas/tickets`, sin la paginación. */
export interface ParametrosTickets {
  empresaId: string;
  sucursalId: string | undefined;
  desde: string;
  hasta: string;
  folio: string | undefined;
}

export function parametrosDe(
  filtro: Filtro | null,
  rango: Rango | null,
  folio: string,
): ParametrosTickets | null {
  if (filtro === null || rango === null) return null;
  return {
    empresaId: filtro.empresaId,
    sucursalId: filtro.sucursalId,
    desde: rango.desde,
    hasta: rango.hasta,
    folio: folio || undefined,
  };
}

function llave(p: ParametrosTickets | null, pagina: number): QueryKey {
  return [
    'ventas',
    'tickets',
    p?.empresaId,
    p?.sucursalId ?? null,
    p?.desde,
    p?.hasta,
    p?.folio ?? null,
    pagina,
  ];
}

/** ¿Dos llaves de tickets difieren SÓLO en la página? (la página es lo último). */
export function mismoFiltro(a: QueryKey, b: QueryKey): boolean {
  return a.length === b.length && a.slice(0, -1).every((parte, i) => Object.is(parte, b[i]));
}

function consultar(p: ParametrosTickets, pagina: number, signal: AbortSignal) {
  return pedir<PaginaTickets>('/ventas/tickets', {
    query: { ...p, pagina, porPagina: POR_PAGINA },
    signal,
  });
}

/**
 * Una página de tickets. Al pasar de página se sigue viendo la anterior (atenuada)
 * hasta que llega la nueva, y la siguiente se pide de antemano: así la paginación
 * no parpadea. Pero SÓLO entre páginas del mismo filtro: con otro alcance, periodo
 * o folio nunca se muestran los tickets viejos bajo el filtro nuevo (misma regla
 * que F1-041).
 *
 * Sin auto-refresco: la lista se movería bajo el dedo mientras alguien la lee.
 */
export function useTickets(p: ParametrosTickets | null, pagina: number) {
  const queryClient = useQueryClient();
  const queryKey = llave(p, pagina);

  const consulta = useQuery({
    queryKey,
    queryFn: ({ signal }) => consultar(p!, pagina, signal),
    enabled: p !== null,
    placeholderData: (previos, consultaPrevia) =>
      consultaPrevia && mismoFiltro(consultaPrevia.queryKey, queryKey) ? previos : undefined,
  });

  const total = consulta.isPlaceholderData ? undefined : consulta.data?.total;
  const haySiguiente = total !== undefined && pagina * POR_PAGINA < total;
  const llaveSiguiente = JSON.stringify(llave(p, pagina + 1));
  useEffect(() => {
    if (p === null || !haySiguiente) return;
    void queryClient.prefetchQuery({
      queryKey: llave(p, pagina + 1),
      queryFn: ({ signal }) => consultar(p, pagina + 1, signal),
    });
    // `llaveSiguiente` resume `p` y `pagina`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llaveSiguiente, haySiguiente, queryClient]);

  return consulta;
}
