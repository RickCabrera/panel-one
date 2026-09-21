import { useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type { FormasPago, MesasSucursal, Resumen, VentaHora } from '../../api/tipos';
import type { Rango } from '../../filtros/periodo';
import { POLLING_MS } from '../mesas/reglas';

/** Cada cuánto se refrescan solas las tarjetas (backlog F1-041). */
export const AUTO_REFRESCO_MS = 60_000;

/**
 * El alcance YA VALIDADO contra las listas de la API. Nunca se consulta con lo que
 * dice la URL sin validar: una sucursal de otra empresa daría 404, y la
 * normalización de F1-040 la va a quitar de todos modos.
 */
export interface Filtro {
  empresaId: string;
  sucursalId: string | undefined;
}

interface Endpoints {
  resumen: Resumen;
  'por-hora': VentaHora[];
  'formas-pago': FormasPago;
}

/**
 * Un agregado de `/ventas/*`. La llave lleva TODO lo que cambia la respuesta
 * (empresa, sucursal y días): cambiar cualquiera consulta de nuevo sin recargar, y
 * nunca se muestra el dato de otro alcance bajo el título del nuevo.
 */
export function useVentas<E extends keyof Endpoints>(
  endpoint: E,
  filtro: Filtro | null,
  rango: Rango | null,
  autoRefresco: boolean,
) {
  return useQuery({
    queryKey: [
      'ventas',
      endpoint,
      filtro?.empresaId,
      filtro?.sucursalId ?? null,
      rango?.desde,
      rango?.hasta,
    ],
    queryFn: ({ signal }) =>
      pedir<Endpoints[E]>(`/ventas/${endpoint}`, {
        query: {
          empresaId: filtro?.empresaId,
          sucursalId: filtro?.sucursalId,
          desde: rango?.desde,
          hasta: rango?.hasta,
        },
        signal,
      }),
    enabled: filtro !== null && rango !== null,
    refetchInterval: autoRefresco ? AUTO_REFRESCO_MS : false,
  });
}

/**
 * Las mesas abiertas. No dependen del periodo (son el dato vivo), así que se
 * refrescan siempre, aunque el periodo sea el mes anterior. Cada `POLLING_MS` (20 s),
 * como el Monitor, y no cada 60 s (F1-094): la tarjeta aplica el mismo umbral de
 * desconexión (90 s) y con 60 s un snapshot sano de ~35 s lo cruzaría antes del
 * siguiente refresco, y la sucursal parpadearía a "desconectada" cada minuto.
 */
export function useMesasAbiertas(filtro: Filtro | null) {
  return useQuery({
    queryKey: ['mesas', 'abiertas', filtro?.empresaId, filtro?.sucursalId ?? null],
    queryFn: ({ signal }) =>
      pedir<MesasSucursal[]>('/mesas/abiertas', {
        query: { empresaId: filtro?.empresaId, sucursalId: filtro?.sucursalId },
        signal,
      }),
    enabled: filtro !== null,
    refetchInterval: POLLING_MS,
  });
}
