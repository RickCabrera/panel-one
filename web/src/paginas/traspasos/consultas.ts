import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type { EstadoTraspaso, TraspasoDetalle, Traspasos, TraspasosSr } from '../../api/tipos';
import type { Rango } from '../../filtros/periodo';
import type { Filtro } from '../inicio/consultas';

export const llaveTraspasos = ['inventario', 'traspasos'] as const;

export function useTraspasos(filtro: Filtro | null, estado: EstadoTraspaso | null) {
  return useQuery({
    queryKey: [...llaveTraspasos, 'lista', filtro?.empresaId, filtro?.sucursalId ?? null, estado],
    queryFn: ({ signal }) =>
      pedir<Traspasos>('/inventario/traspasos', {
        query: {
          empresaId: filtro?.empresaId,
          sucursalId: filtro?.sucursalId,
          estado: estado ?? undefined,
        },
        signal,
      }),
    enabled: filtro !== null,
    placeholderData: keepPreviousData,
  });
}

/** Los traspasos LEÍDOS de SR en el periodo (pólizas de traspaso de F2-122). */
export function useTraspasosSr(filtro: Filtro | null, rango: Rango | null, activa: boolean) {
  return useQuery({
    queryKey: [
      ...llaveTraspasos,
      'sr',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
    ],
    queryFn: ({ signal }) =>
      pedir<TraspasosSr>('/inventario/traspasos/sr', {
        query: {
          empresaId: filtro?.empresaId,
          sucursalId: filtro?.sucursalId,
          desde: rango?.desde,
          hasta: rango?.hasta,
        },
        signal,
      }),
    enabled: activa && filtro !== null && rango !== null,
    placeholderData: keepPreviousData,
  });
}

export function useTraspaso(empresaId: string | null, id: string) {
  return useQuery({
    queryKey: [...llaveTraspasos, 'detalle', empresaId, id],
    queryFn: ({ signal }) =>
      pedir<TraspasoDetalle>(`/inventario/traspasos/${encodeURIComponent(id)}`, {
        query: { empresaId: empresaId ?? undefined },
        signal,
      }),
    enabled: empresaId !== null,
  });
}

export function enviarTraspaso(body: {
  empresaId: string;
  sucursalOrigenId: string;
  almacenOrigenSrId: string;
  sucursalDestinoId: string;
  almacenDestinoSrId: string;
  nota?: string;
  partidas: Array<{ insumoOrigenSrId: string; cantidad: string }>;
}): Promise<TraspasoDetalle> {
  return pedir<TraspasoDetalle>('/inventario/traspasos', { method: 'POST', body });
}

export function accionTraspaso(
  empresaId: string,
  id: string,
  que: 'recibir' | 'cancelar',
): Promise<TraspasoDetalle> {
  return pedir<TraspasoDetalle>(`/inventario/traspasos/${encodeURIComponent(id)}/${que}`, {
    method: 'POST',
    body: { empresaId },
  });
}
