import { useQuery } from '@tanstack/react-query';

import { pedir } from '../../../api/cliente';
import type {
  ConfiguracionGlobal,
  FacturaGlobalEmitida,
  PeriodicidadGlobal,
  PeriodosGlobal,
  VistaPreviaGlobal,
} from '../../../api/tipos';

/** Todo lo de la factura global cuelga de esta llave: emitir o configurar la invalida. */
export const LLAVE_GLOBAL = ['facturacion', 'global'] as const;

export function useConfiguracionGlobal(empresaId: string | null) {
  return useQuery({
    queryKey: [...LLAVE_GLOBAL, 'configuracion', empresaId],
    queryFn: ({ signal }) =>
      pedir<ConfiguracionGlobal>('/facturacion/global/configuracion', {
        query: { empresaId: empresaId ?? undefined },
        signal,
      }),
    enabled: empresaId !== null,
  });
}

export function guardarConfiguracionGlobal(body: {
  empresaId: string;
  periodicidad: PeriodicidadGlobal;
  automatica: boolean;
}): Promise<ConfiguracionGlobal> {
  return pedir<ConfiguracionGlobal>('/facturacion/global/configuracion', { method: 'PUT', body });
}

export function usePeriodosGlobal(
  empresaId: string | null,
  sucursalId: string | null,
  periodicidad: PeriodicidadGlobal | null,
) {
  return useQuery({
    queryKey: [...LLAVE_GLOBAL, 'periodos', empresaId, sucursalId, periodicidad],
    queryFn: ({ signal }) =>
      pedir<PeriodosGlobal>('/facturacion/global/periodos', {
        query: {
          empresaId: empresaId ?? undefined,
          sucursalId: sucursalId ?? undefined,
          periodicidad: periodicidad ?? undefined,
        },
        signal,
      }),
    enabled: empresaId !== null && sucursalId !== null && periodicidad !== null,
  });
}

export function useVistaPreviaGlobal(
  empresaId: string | null,
  sucursalId: string | null,
  periodicidad: PeriodicidadGlobal | null,
  clave: string | null,
) {
  return useQuery({
    queryKey: [...LLAVE_GLOBAL, 'vista', empresaId, sucursalId, periodicidad, clave],
    queryFn: ({ signal }) =>
      pedir<VistaPreviaGlobal>(`/facturacion/global/periodos/${clave}`, {
        query: {
          empresaId: empresaId ?? undefined,
          sucursalId: sucursalId ?? undefined,
          periodicidad: periodicidad ?? undefined,
        },
        signal,
      }),
    enabled: empresaId !== null && sucursalId !== null && periodicidad !== null && clave !== null,
  });
}

export function emitirGlobal(body: {
  empresaId: string;
  sucursalId: string;
  periodicidad: PeriodicidadGlobal;
  clave: string;
}): Promise<FacturaGlobalEmitida> {
  return pedir<FacturaGlobalEmitida>('/facturacion/global', { method: 'POST', body });
}
