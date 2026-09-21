import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { pedir } from '../../api/cliente';
import type { MesasSucursal } from '../../api/tipos';
import type { Filtro } from '../inicio/consultas';
import { POLLING_MS } from './reglas';

/**
 * Las mesas abiertas del monitor, consultadas cada 20 s. La llave es la misma de la
 * tarjeta "Venta en vivo" del Panel (mismo endpoint, misma respuesta). Sin
 * `placeholderData`: al cambiar de alcance salen skeletons, nunca las mesas del
 * alcance anterior bajo el nombre del nuevo.
 */
export function useMonitorMesas(filtro: Filtro | null) {
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

/** Cada cuánto se recalculan edades y minutos entre una consulta y otra. */
export const PULSO_MS = 5_000;

/**
 * La hora del navegador, re-renderizando cada `PULSO_MS`. Con ella la edad del dato
 * sigue creciendo aunque el API no conteste, y el banner de desconectada aparece
 * solo.
 */
export function useAhora(): number {
  const [ahora, setAhora] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setAhora(Date.now()), PULSO_MS);
    return () => clearInterval(id);
  }, []);
  return ahora;
}
