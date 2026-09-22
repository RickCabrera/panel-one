import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

import { pedir } from '../../api/cliente';
import type { CapturaRespuesta, ConteoDetalle, Conteos, EstadoConteo } from '../../api/tipos';
import type { Filtro } from '../inicio/consultas';
import { llaveBorrador } from './borrador';
import { CapturaConteo, type EstadoCaptura } from './captura';

export const llaveConteos = ['inventario', 'conteos'] as const;

export function useConteos(filtro: Filtro | null, estado: EstadoConteo | null) {
  return useQuery({
    queryKey: [...llaveConteos, 'lista', filtro?.empresaId, filtro?.sucursalId ?? null, estado],
    queryFn: ({ signal }) =>
      pedir<Conteos>('/inventario/conteos', {
        query: {
          empresaId: filtro?.empresaId,
          sucursalId: filtro?.sucursalId,
          estado: estado ?? undefined,
        },
        signal,
      }),
    enabled: filtro !== null,
    placeholderData: keepPreviousData,
  });
}

export function useConteo(empresaId: string | null, id: string) {
  return useQuery({
    queryKey: [...llaveConteos, 'detalle', empresaId, id],
    queryFn: ({ signal }) =>
      pedir<ConteoDetalle>(`/inventario/conteos/${encodeURIComponent(id)}`, {
        query: { empresaId: empresaId ?? undefined },
        signal,
      }),
    enabled: empresaId !== null,
  });
}

export function crearConteo(body: {
  empresaId: string;
  sucursalId: string;
  almacenOrigenSrId: string;
  grupoOrigenSrId?: string;
  nota?: string;
}): Promise<ConteoDetalle> {
  return pedir<ConteoDetalle>('/inventario/conteos', { method: 'POST', body });
}

export function terminarConteo(
  empresaId: string,
  id: string,
  que: 'cerrar' | 'cancelar',
): Promise<ConteoDetalle> {
  return pedir<ConteoDetalle>(`/inventario/conteos/${encodeURIComponent(id)}/${que}`, {
    method: 'POST',
    body: { empresaId },
  });
}

/**
 * La captura de un conteo con borrador local: un `CapturaConteo` por montaje (quien la usa monta
 * con `key` = conteo, así un cambio de conteo es un montaje nuevo). Reenvía al montar, al
 * ocultarse o volver la pestaña (`visibilitychange`: bloqueo de pantalla) y al volver la red.
 */
export function useCapturaConteo(op: { usuarioId: string; empresaId: string; conteoId: string }) {
  const queryClient = useQueryClient();
  const [captura] = useState(
    () =>
      new CapturaConteo({
        llave: llaveBorrador(op.usuarioId, op.empresaId, op.conteoId),
        mandar: (partidas) =>
          pedir<CapturaRespuesta>(
            `/inventario/conteos/${encodeURIComponent(op.conteoId)}/partidas`,
            { method: 'PUT', body: { empresaId: op.empresaId, partidas } },
          ),
        alGuardar: (guardadas) => {
          const valor = new Map(guardadas.map((g) => [g.insumoOrigenSrId, g.contado]));
          queryClient.setQueryData<ConteoDetalle>(
            [...llaveConteos, 'detalle', op.empresaId, op.conteoId],
            (d) =>
              d && {
                ...d,
                partidas: d.partidas.map((p) =>
                  valor.has(p.insumoOrigenSrId)
                    ? { ...p, contado: valor.get(p.insumoOrigenSrId) ?? null }
                    : p,
                ),
              },
          );
          void queryClient.invalidateQueries({ queryKey: llaveConteos });
        },
      }),
  );
  const [estado, setEstado] = useState<EstadoCaptura>(() => captura.estado());

  useEffect(() => {
    const quitar = captura.suscribir(setEstado);
    void captura.enviar();
    const reenviar = () => void captura.enviar();
    document.addEventListener('visibilitychange', reenviar);
    window.addEventListener('online', reenviar);
    return () => {
      quitar();
      captura.detener();
      document.removeEventListener('visibilitychange', reenviar);
      window.removeEventListener('online', reenviar);
    };
  }, [captura]);

  return {
    ...estado,
    pendientes: Object.keys(estado.borrador).length,
    capturar: (insumo: string, valor: string | null) => captura.capturar(insumo, valor),
    enviar: () => void captura.enviar(),
    descartar: () => captura.descartar(),
  };
}
