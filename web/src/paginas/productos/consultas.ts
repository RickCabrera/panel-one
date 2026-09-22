import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type {
  DetalleProducto,
  GuardarMetadata,
  Menu,
  PaginaProductos,
  SincronizacionSucursal,
  VendidosSinCatalogo,
} from '../../api/tipos';
import type { Rango } from '../../filtros/periodo';
import type { Filtro } from '../inicio/consultas';

/**
 * Consultas de Productos y del orquestador de menú (F2-145). Todo lo del POS es de sólo
 * lectura; lo único que se escribe es la metadata propia y la solicitud de sincronización.
 */

export type EstadoProductos = 'activos' | 'inactivos' | 'todos';

export function useProductos(
  filtro: Filtro | null,
  estado: EstadoProductos,
  q: string,
  pagina: number,
) {
  return useQuery({
    queryKey: [
      'catalogos',
      'productos',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      estado,
      q,
      pagina,
    ],
    queryFn: ({ signal }) =>
      pedir<PaginaProductos>('/catalogos/productos', {
        query: {
          empresaId: filtro?.empresaId,
          sucursalId: filtro?.sucursalId,
          estado,
          q: q || undefined,
          pagina,
        },
        signal,
      }),
    enabled: filtro !== null,
    placeholderData: keepPreviousData,
  });
}

export function useProducto(empresaId: string | undefined, id: string | null) {
  return useQuery({
    queryKey: ['catalogos', 'producto', empresaId, id],
    queryFn: ({ signal }) =>
      pedir<DetalleProducto>(`/catalogos/productos/${id}`, { query: { empresaId }, signal }),
    enabled: empresaId !== undefined && id !== null,
  });
}

export function useSincronizacion(empresaId: string | undefined) {
  return useQuery({
    queryKey: ['catalogos', 'sincronizacion', empresaId],
    queryFn: ({ signal }) =>
      pedir<SincronizacionSucursal[]>('/catalogos/sincronizacion', {
        query: { empresaId },
        signal,
      }),
    enabled: empresaId !== undefined,
  });
}

export function useMenu(filtro: Filtro | null) {
  return useQuery({
    queryKey: ['catalogos', 'menu', filtro?.empresaId, filtro?.sucursalId ?? null],
    queryFn: ({ signal }) =>
      pedir<Menu>('/catalogos/menu', {
        query: { empresaId: filtro?.empresaId, sucursalId: filtro?.sucursalId },
        signal,
      }),
    enabled: filtro !== null,
  });
}

export function useSinCatalogo(filtro: Filtro | null, rango: Rango | null) {
  return useQuery({
    queryKey: [
      'catalogos',
      'sin-catalogo',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
    ],
    queryFn: ({ signal }) =>
      pedir<VendidosSinCatalogo>('/catalogos/sin-catalogo', {
        query: {
          empresaId: filtro?.empresaId,
          sucursalId: filtro?.sucursalId,
          desde: rango?.desde,
          hasta: rango?.hasta,
        },
        signal,
      }),
    enabled: filtro !== null && rango !== null,
  });
}

export const api = {
  guardarMetadata: (id: string, datos: GuardarMetadata) =>
    pedir<DetalleProducto>(`/catalogos/productos/${id}/metadata`, { method: 'PUT', body: datos }),
  pedirSincronizacion: (empresaId: string, sucursalId: string) =>
    pedir<SincronizacionSucursal>('/catalogos/sincronizacion/forzar', {
      method: 'POST',
      body: { empresaId, sucursalId },
    }),
};
