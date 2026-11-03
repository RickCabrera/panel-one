import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

import { pedir } from '../../api/cliente';
import type { DetalleCorte, ListaCortes, ResumenCorte } from '../../api/tipos';
import type { Rango } from '../../filtros/periodo';
import { suscribirTiempoReal } from '../../tiempo-real/socket';
import { AUTO_REFRESCO_MS, type Filtro } from '../inicio/consultas';

/**
 * Cortes (MVP): los turnos de SR y lo cobrado en cada uno. Un turno ABIERTO es un acumulado en
 * curso, así que las consultas se refrescan solas (60 s, como las tarjetas del Panel) y, con el
 * socket vivo, en cuanto la sucursal manda cheques nuevos.
 */

/** Con cada aviso de ingesta del alcance, relee los cortes (lista, en curso y detalle). */
export function useTiempoRealCortes(filtro: Filtro | null): void {
  const cliente = useQueryClient();
  const empresaId = filtro?.empresaId;
  const sucursalId = filtro?.sucursalId ?? null;
  useEffect(() => {
    if (empresaId === undefined) return;
    return suscribirTiempoReal({ empresaId, sucursalId }, () => {
      void cliente.invalidateQueries({ queryKey: ['cortes'] }, { cancelRefetch: false });
    });
  }, [cliente, empresaId, sucursalId]);
}

export function useCortes(filtro: Filtro | null, rango: Rango | null) {
  return useQuery({
    queryKey: [
      'cortes',
      'lista',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
    ],
    queryFn: ({ signal }) =>
      pedir<ListaCortes>('/cortes', {
        query: {
          empresaId: filtro?.empresaId,
          sucursalId: filtro?.sucursalId,
          desde: rango?.desde,
          hasta: rango?.hasta,
        },
        signal,
      }),
    enabled: filtro !== null && rango !== null,
    placeholderData: keepPreviousData,
    refetchInterval: AUTO_REFRESCO_MS,
  });
}

export function useDetalleCorte(id: string | null) {
  return useQuery({
    queryKey: ['cortes', 'detalle', id],
    queryFn: ({ signal }) =>
      pedir<DetalleCorte>(`/cortes/${encodeURIComponent(id ?? '')}`, { signal }),
    enabled: id !== null,
    refetchInterval: AUTO_REFRESCO_MS,
  });
}

/** Los turnos abiertos ahora: la tarjeta "Turno en curso" del Panel. */
export function useCortesEnCurso(filtro: Filtro | null) {
  return useQuery({
    queryKey: ['cortes', 'en-curso', filtro?.empresaId, filtro?.sucursalId ?? null],
    queryFn: ({ signal }) =>
      pedir<ResumenCorte[]>('/cortes/en-curso', {
        query: { empresaId: filtro?.empresaId, sucursalId: filtro?.sucursalId },
        signal,
      }),
    enabled: filtro !== null,
    refetchInterval: AUTO_REFRESCO_MS,
  });
}
