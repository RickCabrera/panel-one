import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type { Proyecciones } from '../../api/tipos';
import type { Filtro } from '../inicio/consultas';

export const llaveProyecciones = ['inventario', 'proyecciones'] as const;

/** Proyecciones (F2-127) del alcance para un horizonte de días (1–28). */
export function useProyecciones(filtro: Filtro | null, horizonte: number) {
  return useQuery({
    queryKey: [...llaveProyecciones, filtro?.empresaId, filtro?.sucursalId ?? null, horizonte],
    queryFn: ({ signal }) =>
      pedir<Proyecciones>('/inventario/proyecciones', {
        query: {
          empresaId: filtro?.empresaId,
          sucursalId: filtro?.sucursalId,
          horizonte: String(horizonte),
        },
        signal,
      }),
    enabled: filtro !== null,
    placeholderData: keepPreviousData,
  });
}
