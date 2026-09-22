import { useQuery } from '@tanstack/react-query';
import { useEffect, useState, useSyncExternalStore } from 'react';

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

/**
 * UN solo intervalo para todos los suscriptores (F2-223): con 60 tarjetas del Monitor
 * serían 60 relojes desfasados, y cada uno con su propio render. Así, todo lo que
 * cambia en un pulso sale en el mismo commit. Arranca con el primer suscriptor y se
 * detiene con el último.
 */
const suscriptores = new Set<() => void>();
let pulso: ReturnType<typeof setInterval> | null = null;

function suscribirPulso(avisar: () => void): () => void {
  suscriptores.add(avisar);
  if (pulso === null) {
    pulso = setInterval(() => {
      for (const s of [...suscriptores]) s();
    }, PULSO_MS);
  }
  return () => {
    suscriptores.delete(avisar);
    if (suscriptores.size === 0 && pulso !== null) {
      clearInterval(pulso);
      pulso = null;
    }
  };
}

/**
 * Un valor derivado de la hora (p. ej. cuántas sucursales pasaron un umbral), que se
 * recalcula cada `PULSO_MS` pero sólo re-renderiza cuando CAMBIA. `useAhora` pinta
 * cada 5 s aunque nada cambie; esto no (F1-094: el badge de agentes). `calcular`
 * tiene que devolver un primitivo, porque React compara con `Object.is`.
 */
export function useConReloj<T extends string | number | boolean | null>(
  calcular: (ahora: number) => T,
): T {
  const snapshot = () => calcular(Date.now());
  return useSyncExternalStore(suscribirPulso, snapshot, snapshot);
}
