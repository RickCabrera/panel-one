import { useQuery } from '@tanstack/react-query';

import { pedir } from '../api/cliente';
import type { Alerta, HistorialAlertas, ReglaAlerta, TipoAlerta } from '../api/tipos';
import { useAlcance } from '../filtros/alcance';
import type { Filtro } from '../paginas/inicio/consultas';

/** Cada cuánto se consultan las alertas abiertas. El API las evalúa cada 60 s. */
export const POLLING_ALERTAS_MS = 30_000;

/** El alcance YA VALIDADO (el mismo criterio que las vistas), o null mientras no lo está. */
export function useFiltroAlcance(): Filtro | null {
  const { empresa, sucursal, sucursalId, sucursales } = useAlcance();
  return empresa && !sucursales.isPending && (!sucursalId || sucursal)
    ? { empresaId: empresa.id, sucursalId: sucursal?.id }
    : null;
}

export const llaveAbiertas = (filtro: Filtro | null) =>
  ['alertas', 'abiertas', filtro?.empresaId, filtro?.sucursalId ?? null] as const;

/**
 * Las alertas abiertas del alcance. La campana de la cabecera, el panel de `/alertas` y la
 * tarjeta del Resumen leen ESTA consulta (misma llave): el número de la campana y las filas
 * del panel salen de la misma respuesta y no pueden diferir (AC3 de F2-224).
 */
export function useAlertasAbiertas(filtro: Filtro | null) {
  return useQuery({
    queryKey: llaveAbiertas(filtro),
    queryFn: ({ signal }) =>
      pedir<Alerta[]>('/alertas/abiertas', {
        query: { empresaId: filtro?.empresaId, sucursalId: filtro?.sucursalId },
        signal,
      }),
    enabled: filtro !== null,
    refetchInterval: POLLING_ALERTAS_MS,
  });
}

/** Una página del historial (abiertas y cerradas). Sin `placeholderData`: otra página no pinta la anterior. */
export function useHistorialAlertas(filtro: Filtro | null, pagina: number) {
  return useQuery({
    queryKey: ['alertas', 'historial', filtro?.empresaId, filtro?.sucursalId ?? null, pagina],
    queryFn: ({ signal }) =>
      pedir<HistorialAlertas>('/alertas/historial', {
        query: { empresaId: filtro?.empresaId, sucursalId: filtro?.sucursalId, pagina },
        signal,
      }),
    enabled: filtro !== null,
    refetchInterval: POLLING_ALERTAS_MS,
  });
}

export function useReglasAlertas(empresaId: string | undefined) {
  return useQuery({
    queryKey: ['alertas', 'reglas', empresaId],
    queryFn: ({ signal }) =>
      pedir<ReglaAlerta[]>('/alertas/reglas', { query: { empresaId }, signal }),
    enabled: empresaId !== undefined,
  });
}

/** Guarda una regla. El API recalcula las alertas en la misma petición. */
export function guardarRegla(
  empresaId: string,
  tipo: TipoAlerta,
  cambio: { activa: boolean; umbral: number },
): Promise<ReglaAlerta[]> {
  return pedir<ReglaAlerta[]>(`/alertas/reglas/${tipo}`, {
    method: 'PUT',
    body: { empresaId, ...cambio },
  });
}
