import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type { Existencias, FilaExistencia } from '../../api/tipos';
import type { Filtro } from '../inicio/consultas';

export const llaveExistencias = ['inventario', 'existencias'] as const;

/**
 * Existencias (F2-121) del alcance, del almacén elegido y de la búsqueda. La búsqueda viaja
 * sólo en esta petición: la vista no la escribe en la URL.
 */
export function useExistencias(filtro: Filtro | null, almacen: string | null, q: string) {
  return useQuery({
    queryKey: [...llaveExistencias, filtro?.empresaId, filtro?.sucursalId ?? null, almacen, q],
    queryFn: ({ signal }) =>
      pedir<Existencias>('/inventario/existencias', {
        query: {
          empresaId: filtro?.empresaId,
          sucursalId: filtro?.sucursalId,
          almacenOrigenSrId: almacen ?? undefined,
          q: q || undefined,
        },
        signal,
      }),
    enabled: filtro !== null,
    placeholderData: keepPreviousData,
  });
}

/**
 * Guarda el mínimo y el máximo de un artículo en su almacén (los dos nulos = se borran). Son
 * NUESTROS: nunca se escriben a SoftRestaurant. Quien llama invalida `llaveExistencias`.
 */
export function guardarLimites(
  empresaId: string,
  fila: Pick<FilaExistencia, 'sucursalId' | 'almacenOrigenSrId' | 'insumoOrigenSrId'>,
  minimo: string | null,
  maximo: string | null,
): Promise<FilaExistencia> {
  return pedir<FilaExistencia>('/inventario/existencias/limites', {
    method: 'PUT',
    body: {
      empresaId,
      sucursalId: fila.sucursalId,
      almacenOrigenSrId: fila.almacenOrigenSrId,
      insumoOrigenSrId: fila.insumoOrigenSrId,
      minimo,
      maximo,
    },
  });
}
