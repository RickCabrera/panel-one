import { useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import { llaveConAltura, mantenerSiSoloCambiaLaAltura } from '../../consultas/altura';
import type { ProductoTop, VentaDia, VentaSucursal } from '../../api/tipos';
import type { Rango } from '../../filtros/periodo';
import { AUTO_REFRESCO_MS, type Filtro } from '../inicio/consultas';

export type OrdenTop = 'importe' | 'cantidad';
/** Los límites que ofrece la vista. La API acepta de 1 a 50. */
export const LIMITES_TOP = [10, 20, 50] as const;
export type LimiteTop = (typeof LIMITES_TOP)[number];

interface Endpoints {
  'por-dia': VentaDia[];
  'comparativo-sucursales': VentaSucursal[];
  'top-productos': ProductoTop[];
}

/**
 * Un reporte de `/ventas/*`. La llave lleva TODO lo que cambia la respuesta
 * (empresa, sucursal, días y, en el top, orden y límite): cambiar cualquiera
 * consulta de nuevo, y sin `placeholderData` nunca se ve el dato de otro alcance
 * bajo el título del nuevo. Sin auto-refresco: es un reporte, no el panel en vivo.
 */
export function useReporte<E extends keyof Endpoints>(
  endpoint: E,
  filtro: Filtro | null,
  rango: Rango | null,
  extra: Record<string, string | number> = {},
  /** Corte "a la misma altura" (F2-220). Sin él, la llave es la de siempre. */
  alturaAl?: string,
  /**
   * Refresco solo cada `AUTO_REFRESCO_MS`, como el Panel. Reportes no lo usa (es un reporte);
   * el Resumen sí, cuando el periodo incluye hoy: si no, su base avanza cada minuto y la cifra
   * actual se quedaría congelada, y el Δ saldría falso (F2-220).
   */
  autoRefresco = false,
) {
  const queryKey = llaveConAltura(
    [
      'ventas',
      endpoint,
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
      extra,
    ],
    alturaAl,
  );
  return useQuery({
    queryKey,
    queryFn: ({ signal }) =>
      pedir<Endpoints[E]>(`/ventas/${endpoint}`, {
        query: {
          empresaId: filtro?.empresaId,
          sucursalId: filtro?.sucursalId,
          desde: rango?.desde,
          hasta: rango?.hasta,
          ...extra,
          alturaAl,
        },
        signal,
      }),
    enabled: filtro !== null && rango !== null,
    refetchInterval: autoRefresco ? AUTO_REFRESCO_MS : false,
    placeholderData: (anterior, previa) =>
      mantenerSiSoloCambiaLaAltura(anterior, previa?.queryKey, queryKey, alturaAl),
  });
}
