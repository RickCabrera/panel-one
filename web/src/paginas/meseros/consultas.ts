import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type { RendimientoMeseros } from '../../api/tipos';
import type { Rango } from '../../filtros/periodo';
import type { Filtro } from '../inicio/consultas';

/** Meseros (F2-231): el rendimiento del periodo, ligado con el espejo de meseros del POS. */
export function useRendimientoMeseros(filtro: Filtro | null, rango: Rango | null) {
  return useQuery({
    queryKey: [
      'catalogos',
      'meseros-rendimiento',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
    ],
    queryFn: ({ signal }) =>
      pedir<RendimientoMeseros>('/catalogos/meseros/rendimiento', {
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
