import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type {
  CategoriaGasto,
  CompraDetalle,
  Compras,
  EstadoResultados,
  Gastos,
} from '../../api/tipos';
import type { Rango } from '../../filtros/periodo';
import type { Filtro } from '../inicio/consultas';

/** Todo lo de finanzas cuelga de esta llave: una escritura de gastos la invalida completa. */
export const LLAVE_FINANZAS = ['finanzas'] as const;

const rangoQuery = (filtro: Filtro | null, rango: Rango | null) => ({
  empresaId: filtro?.empresaId,
  sucursalId: filtro?.sucursalId,
  desde: rango?.desde,
  hasta: rango?.hasta,
});

/** El estado de resultados (F2-126) del alcance y del periodo. */
export function useEstadoResultados(filtro: Filtro | null, rango: Rango | null) {
  return useQuery({
    queryKey: [
      ...LLAVE_FINANZAS,
      'estado-resultados',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
    ],
    queryFn: ({ signal }) =>
      pedir<EstadoResultados>('/finanzas/estado-resultados', {
        query: rangoQuery(filtro, rango),
        signal,
      }),
    enabled: filtro !== null && rango !== null,
    placeholderData: keepPreviousData,
  });
}

/** Las compras leídas de SR (F2-126) del alcance y del periodo. */
export function useCompras(filtro: Filtro | null, rango: Rango | null) {
  return useQuery({
    queryKey: [
      ...LLAVE_FINANZAS,
      'compras',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
    ],
    queryFn: ({ signal }) =>
      pedir<Compras>('/finanzas/compras', { query: rangoQuery(filtro, rango), signal }),
    enabled: filtro !== null && rango !== null,
    placeholderData: keepPreviousData,
  });
}

/** Una compra con sus partidas; sólo se pide al abrirla. */
export function useCompra(empresaId: string | null, id: string | null) {
  return useQuery({
    queryKey: [...LLAVE_FINANZAS, 'compra', empresaId, id],
    queryFn: ({ signal }) =>
      pedir<CompraDetalle>(`/finanzas/compras/${encodeURIComponent(id ?? '')}`, {
        query: { empresaId },
        signal,
      }),
    enabled: empresaId !== null && id !== null,
  });
}

/** Los gastos capturados en el panel (F2-126) del alcance y del periodo. */
export function useGastos(filtro: Filtro | null, rango: Rango | null, incluirAnulados: boolean) {
  return useQuery({
    queryKey: [
      ...LLAVE_FINANZAS,
      'gastos',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
      incluirAnulados,
    ],
    queryFn: ({ signal }) =>
      pedir<Gastos>('/finanzas/gastos', {
        query: {
          ...rangoQuery(filtro, rango),
          incluirAnulados: incluirAnulados ? 'true' : undefined,
        },
        signal,
      }),
    enabled: filtro !== null && rango !== null,
    placeholderData: keepPreviousData,
  });
}

/** Las categorías de gasto de la empresa (activas e inactivas). */
export function useCategoriasGasto(empresaId: string | null) {
  return useQuery({
    queryKey: [...LLAVE_FINANZAS, 'categorias', empresaId],
    queryFn: ({ signal }) =>
      pedir<{ categorias: CategoriaGasto[] }>('/finanzas/categorias-gasto', {
        query: { empresaId },
        signal,
      }),
    enabled: empresaId !== null,
  });
}

export function crearGasto(body: {
  empresaId: string;
  sucursalId: string;
  categoriaId: string;
  dia: string;
  concepto: string;
  monto: string;
}): Promise<{ id: string }> {
  return pedir<{ id: string }>('/finanzas/gastos', { method: 'POST', body });
}

export function editarGasto(
  id: string,
  body: {
    empresaId: string;
    categoriaId?: string;
    dia?: string;
    concepto?: string;
    monto?: string;
  },
): Promise<void> {
  return pedir<void>(`/finanzas/gastos/${encodeURIComponent(id)}`, { method: 'PATCH', body });
}

export function anularGasto(empresaId: string, id: string): Promise<void> {
  return pedir<void>(`/finanzas/gastos/${encodeURIComponent(id)}/anular`, {
    method: 'POST',
    query: { empresaId },
    body: {},
  });
}

export function crearCategoria(empresaId: string, nombre: string): Promise<{ id: string }> {
  return pedir<{ id: string }>('/finanzas/categorias-gasto', {
    method: 'POST',
    body: { empresaId, nombre },
  });
}

export function cambiarCategoria(
  empresaId: string,
  id: string,
  cambios: { nombre?: string; activa?: boolean },
): Promise<void> {
  return pedir<void>(`/finanzas/categorias-gasto/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { empresaId, ...cambios },
  });
}
