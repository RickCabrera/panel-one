import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { pedir, pedirArchivo } from '../../../api/cliente';
import type {
  CfdiFila,
  EnvioCfdi,
  EstadoCfdiEmitido,
  PaginaCfdis,
  PaginaPorFacturar,
  TableroFacturacion,
} from '../../../api/tipos';
import type { Rango } from '../../../filtros/periodo';
import type { Filtro } from '../../inicio/consultas';

/** Todo lo del tablero cuelga de esta llave: un reintento de envío la invalida. */
export const LLAVE_TABLERO = ['facturacion', 'tablero'] as const;

export const POR_PAGINA_TABLA = 20;
/** El máximo que acepta el api por página: el export pide de a estas. */
export const POR_PAGINA_EXPORT = 200;

const consulta = (filtro: Filtro | null, rango: Rango | null) => ({
  empresaId: filtro?.empresaId,
  sucursalId: filtro?.sucursalId,
  desde: rango?.desde,
  hasta: rango?.hasta,
});

/**
 * El resumen del tablero (KPIs, barras, por facturar). Lo leen el tablero y la columna Tasa de
 * facturación de Comparativos (F2-140), así que acepta `alturaAl` para el periodo B cortado.
 */
export function useTablero(filtro: Filtro | null, rango: Rango | null, alturaAl?: string) {
  return useQuery({
    queryKey: [
      ...LLAVE_TABLERO,
      'resumen',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
      alturaAl ?? null,
    ],
    queryFn: ({ signal }) =>
      pedir<TableroFacturacion>('/facturacion/tablero', {
        query: { ...consulta(filtro, rango), alturaAl },
        signal,
      }),
    enabled: filtro !== null && rango !== null,
  });
}

export interface FiltroTabla {
  q: string;
  estado: EstadoCfdiEmitido | null;
  pagina: number;
}

export function useCfdis(filtro: Filtro | null, rango: Rango | null, tabla: FiltroTabla) {
  return useQuery({
    queryKey: [
      ...LLAVE_TABLERO,
      'cfdis',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
      tabla.q,
      tabla.estado,
      tabla.pagina,
    ],
    queryFn: ({ signal }) =>
      pedir<PaginaCfdis>('/facturacion/cfdis', {
        query: {
          ...consulta(filtro, rango),
          q: tabla.q || undefined,
          estado: tabla.estado,
          pagina: tabla.pagina,
          porPagina: POR_PAGINA_TABLA,
        },
        signal,
      }),
    enabled: filtro !== null && rango !== null,
    placeholderData: keepPreviousData,
  });
}

export function usePorFacturar(filtro: Filtro | null, rango: Rango | null, pagina: number) {
  return useQuery({
    queryKey: [
      ...LLAVE_TABLERO,
      'por-facturar',
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
      pagina,
    ],
    queryFn: ({ signal }) =>
      pedir<PaginaPorFacturar>('/facturacion/por-facturar', {
        query: { ...consulta(filtro, rango), pagina, porPagina: POR_PAGINA_TABLA },
        signal,
      }),
    enabled: filtro !== null && rango !== null,
    placeholderData: keepPreviousData,
  });
}

/** Los envíos por correo que hay que reintentar (F2-105): fallidos y atorados. */
export function useEnviosPendientes(empresaId: string | null) {
  return useQuery({
    queryKey: [...LLAVE_TABLERO, 'envios', empresaId],
    queryFn: ({ signal }) =>
      pedir<EnvioCfdi[]>('/facturacion/envios', { query: { empresaId }, signal }),
    enabled: empresaId !== null,
  });
}

export function reintentarEnvio(cfdiId: string): Promise<EnvioCfdi> {
  return pedir<EnvioCfdi>(`/facturacion/cfdis/${cfdiId}/envios/reintento`, { method: 'POST' });
}

/** El XML o el PDF de un CFDI, con la sesión (`GET /facturacion/cfdis/{id}/xml|pdf`). */
export function bajarArchivoCfdi(id: string, extension: 'xml' | 'pdf'): Promise<Blob> {
  return pedirArchivo(`/facturacion/cfdis/${id}/${extension}`);
}

/**
 * TODA la búsqueda de la tabla, página por página (para el CSV). Se detiene al llegar al `total`
 * de la primera página o a una página vacía; `onProgreso` cuenta lo bajado.
 */
export async function todosLosCfdis(
  filtro: Filtro,
  rango: Rango,
  tabla: Pick<FiltroTabla, 'q' | 'estado'>,
  onProgreso?: (hechos: number, total: number) => void,
  signal?: AbortSignal,
): Promise<CfdiFila[]> {
  const todos: CfdiFila[] = [];
  for (let pagina = 1; ; pagina++) {
    const p = await pedir<PaginaCfdis>('/facturacion/cfdis', {
      query: {
        ...consulta(filtro, rango),
        q: tabla.q || undefined,
        estado: tabla.estado,
        pagina,
        porPagina: POR_PAGINA_EXPORT,
      },
      signal,
    });
    todos.push(...p.cfdis);
    onProgreso?.(todos.length, p.total);
    if (p.cfdis.length === 0 || todos.length >= p.total) return todos;
  }
}
