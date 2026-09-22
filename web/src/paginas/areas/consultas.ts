import { useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type { CanalNegocio, FilaMapeoArea, MapeoAreas } from '../../api/tipos';
import type { Filtro } from '../inicio/consultas';

/** Áreas y canales (F2-233): las áreas del catálogo del POS con su canal asignado. */
export function useMapeoAreas(filtro: Filtro | null) {
  return useQuery({
    queryKey: ['catalogos', 'areas-mapeo', filtro?.empresaId, filtro?.sucursalId ?? null],
    queryFn: ({ signal }) =>
      pedir<MapeoAreas>('/catalogos/areas/mapeo', {
        query: { empresaId: filtro?.empresaId, sucursalId: filtro?.sucursalId },
        signal,
      }),
    enabled: filtro !== null,
  });
}

/**
 * Asigna (o, con `null`, quita) el canal de negocio de un área. Es nuestro, no del POS, y se
 * aplica al leer: quien llama invalida `['ventas', 'por-area']` y el mapeo para ver el cambio.
 */
export function asignarCanal(
  empresaId: string,
  areaId: string,
  canal: CanalNegocio | null,
): Promise<FilaMapeoArea> {
  return pedir<FilaMapeoArea>(`/catalogos/areas/${areaId}/canal`, {
    method: 'PUT',
    body: { empresaId, canal },
  });
}
