import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type { ConsumoTeorico, Recetas } from '../../api/tipos';
import type { Rango } from '../../filtros/periodo';
import type { Filtro } from '../inicio/consultas';

/** El consumo teórico contra el real (F2-125) del alcance y del periodo. */
export function useConsumoTeorico(filtro: Filtro | null, rango: Rango | null) {
  return useQuery({
    queryKey: [
      'inventario',
      'consumo-teorico',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
    ],
    queryFn: ({ signal }) =>
      pedir<ConsumoTeorico>('/inventario/consumo-teorico', {
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
  });
}

/** Las recetas por producto (F2-125) del alcance. No dependen del periodo. */
export function useRecetas(filtro: Filtro | null) {
  return useQuery({
    queryKey: ['inventario', 'recetas', filtro?.empresaId, filtro?.sucursalId ?? null],
    queryFn: ({ signal }) =>
      pedir<Recetas>('/inventario/recetas', {
        query: { empresaId: filtro?.empresaId, sucursalId: filtro?.sucursalId },
        signal,
      }),
    enabled: filtro !== null,
    placeholderData: keepPreviousData,
  });
}
