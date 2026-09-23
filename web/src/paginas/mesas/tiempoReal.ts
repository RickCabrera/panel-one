import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useSyncExternalStore } from 'react';

import { estaVivo, oirEstado, suscribirTiempoReal } from '../../tiempo-real/socket';
import type { Filtro } from '../inicio/consultas';
import { POLLING_MS } from './reglas';

/**
 * Con el socket vivo (F2-142) cada ingesta avisa y la consulta se relee al momento; el polling
 * queda sólo de respaldo por si un aviso se pierde. Con el socket caído vuelve el de siempre
 * (`POLLING_MS`, 20 s). El semáforo de frescura NO depende de esto: la edad del dato la sigue
 * calculando el navegador con su reloj (`useConReloj`), haya o no refresco.
 */
export const POLLING_RESPALDO_MS = 60_000;

/** El intervalo de polling de las mesas según si el socket está vivo. */
export function intervaloMesas(enVivo: boolean): number {
  return enVivo ? POLLING_RESPALDO_MS : POLLING_MS;
}

/** ¿Los avisos del alcance están llegando? Sólo lee; no abre nada. */
export function useEnVivo(filtro: Filtro | null): boolean {
  const empresaId = filtro?.empresaId;
  const sucursalId = filtro?.sucursalId ?? null;
  const leer = () => (empresaId === undefined ? false : estaVivo({ empresaId, sucursalId }));
  return useSyncExternalStore(oirEstado, leer, leer);
}

/**
 * Escucha el socket para el alcance y, con cada aviso, invalida la consulta de mesas abiertas
 * de ESE alcance (la misma llave que usan el Monitor, la cabecera y el Panel). Devuelve si
 * está vivo, para elegir el intervalo de polling.
 */
export function useTiempoRealMesas(filtro: Filtro | null): boolean {
  const cliente = useQueryClient();
  const empresaId = filtro?.empresaId;
  const sucursalId = filtro?.sucursalId ?? null;
  useEffect(() => {
    if (empresaId === undefined) return;
    return suscribirTiempoReal({ empresaId, sucursalId }, () => {
      // `cancelRefetch: false`: si ya hay una lectura en vuelo, ésa sirve.
      void cliente.invalidateQueries(
        { queryKey: ['mesas', 'abiertas', empresaId, sucursalId], exact: true },
        { cancelRefetch: false },
      );
    });
  }, [cliente, empresaId, sucursalId]);
  return useEnVivo(filtro);
}
