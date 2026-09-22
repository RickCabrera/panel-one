import { useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type {
  VentaHoraDia,
  VentaMesero,
  VentaPorArea,
  VentaPorMesa,
  VentaPorProducto,
} from '../../api/tipos';
import { llaveConAltura, mantenerSiSoloCambiaLaAltura } from '../../consultas/altura';
import type { Rango } from '../../filtros/periodo';
import { AUTO_REFRESCO_MS, type Filtro } from '../inicio/consultas';

interface Endpoints {
  'por-mesero': VentaMesero[];
  'por-producto': VentaPorProducto;
  'hora-dia': VentaHoraDia;
  'por-mesa': VentaPorMesa;
  // F2-233: también lo usa la vista Áreas y canales (misma llave: un cambio de mapeo refresca las dos).
  'por-area': VentaPorArea;
}

export type EndpointAnalisis = keyof Endpoints;

/**
 * Un desglose de Análisis (F2-221), con el mismo patrón que `useReporte`: la llave lleva TODO lo
 * que cambia la respuesta (empresa, sucursal, días y, en la base de productos, `alturaAl`), y sin
 * `placeholderData` entre alcances nunca se ve el dato de otra sucursal bajo el título nuevo.
 * Mientras el periodo incluya hoy se refresca solo, como el Panel.
 */
export function useAnalisis<E extends EndpointAnalisis>(
  endpoint: E,
  filtro: Filtro | null,
  rango: Rango | null,
  autoRefresco: boolean,
  alturaAl?: string,
) {
  const queryKey = llaveConAltura(
    ['ventas', endpoint, filtro?.empresaId, filtro?.sucursalId ?? null, rango?.desde, rango?.hasta],
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
