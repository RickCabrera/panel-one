import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router';

import type { MesasSucursal } from '../../api/tipos';
import { useUsuario } from '../../auth/contexto';
import { sumar } from '../../dinero/dinero';
import { useConReloj } from './consultas';
import {
  guardarPreferencia,
  leerPreferencia,
  PARAM_ESTADO,
  PARAM_ORDEN,
  resolverCriterio,
  type CriterioMesas,
} from './orden';
import { estadosSucursales, mesasVivas, type EstadoSucursal, type MesaViva } from './reglas';

/** Lo que pinta el Monitor y NO cambia al avanzar el reloj (F2-223). */
export interface MonitorVivo {
  /** Estado de cada sucursal, en el orden de la respuesta. */
  estados: Array<{ sucursalId: string; nombre: string; estado: EstadoSucursal }>;
  /** Sólo de sucursales conectadas: los datos viejos nunca se pintan como vivos. */
  mesas: MesaViva[];
  conectadas: number;
  /** Nombres de las sucursales que no entran en las cifras. */
  excluidas: string[];
  /** Σ de los totales; null si UNA no trae total legible (no hay suma parcial). */
  enCurso: bigint | null;
  /** Cuentas con `impreso === false`; null si alguna no dice si se imprimió. */
  sinImprimir: number | null;
  /** Mesas sin hora de apertura legible: no entran en "atención" ni se esconden. */
  sinHora: number;
}

/**
 * El Monitor sin el reloj adentro. Lo único de la hora que llega aquí es el ESTADO de
 * cada sucursal, codificado en un texto: la vista sólo vuelve a calcular cuando una
 * sucursal se conecta o se desconecta, no en cada pulso. Los minutos de cada mesa los
 * calcula su tarjeta (`useConReloj`), y la apertura se estabiliza entre polls para que
 * un poll con los mismos datos no vuelva a pintar las tarjetas.
 */
export function useMonitorVivo(
  filas: readonly MesasSucursal[] | undefined,
  respuestaAt: number,
): MonitorVivo | null {
  const claveEstados = useConReloj((ahora) =>
    filas === undefined
      ? ''
      : estadosSucursales(filas, respuestaAt, ahora)
          .map((s) => s.estado)
          .join('|'),
  );
  // Lo armado para la última respuesta, con sus aperturas: el siguiente poll se
  // estabiliza contra ellas. Se recalcula EN RENDER sólo si cambió la respuesta o el
  // estado de alguna sucursal (el patrón de React para "info del render anterior").
  const [cache, setCache] = useState<Armado | null>(null);
  if (filas === undefined) return null;
  if (
    cache === null ||
    cache.filas !== filas ||
    cache.respuestaAt !== respuestaAt ||
    cache.claveEstados !== claveEstados
  ) {
    const nuevo = armar(filas, respuestaAt, claveEstados, cache?.aperturas ?? new Map());
    setCache(nuevo);
    return nuevo.monitor;
  }
  return cache.monitor;
}

interface Armado {
  filas: readonly MesasSucursal[];
  respuestaAt: number;
  claveEstados: string;
  aperturas: ReadonlyMap<string, number>;
  monitor: MonitorVivo;
}

function armar(
  filas: readonly MesasSucursal[],
  respuestaAt: number,
  claveEstados: string,
  previas: ReadonlyMap<string, number>,
): Armado {
  const porFila = claveEstados.split('|') as EstadoSucursal[];
  const estados = filas.map((f, i) => ({
    sucursalId: f.sucursalId,
    nombre: f.nombre,
    estado: porFila[i],
  }));
  const conectadas = new Set(
    estados.filter((s) => s.estado === 'conectada').map((s) => s.sucursalId),
  );
  const { mesas, aperturas } = mesasVivas(filas, respuestaAt, conectadas, previas);
  const totales = mesas.map((m) => m.total);
  const impresos = mesas.map((m) => m.impreso);
  return {
    filas,
    respuestaAt,
    claveEstados,
    aperturas,
    monitor: {
      estados,
      mesas,
      conectadas: conectadas.size,
      excluidas: estados.filter((s) => s.estado !== 'conectada').map((s) => s.nombre),
      enCurso: totales.every((t) => t !== null) ? sumar(totales as bigint[]) : null,
      sinImprimir: impresos.every((i) => i !== null)
        ? impresos.filter((i) => i === false).length
        : null,
      sinHora: mesas.filter((m) => m.apertura === null).length,
    },
  };
}

/**
 * Orden y filtro del Monitor: de la URL, o lo recordado por este usuario (orden.ts).
 * Elegir escribe las dos cosas: la URL (sin ensuciar el historial) y la preferencia.
 */
export function useCriterioMesas(): {
  criterio: CriterioMesas;
  elegir: (cambio: Partial<CriterioMesas>) => void;
} {
  const [parametros, setParametros] = useSearchParams();
  const usuario = useUsuario();
  const guardado = useMemo(() => leerPreferencia(usuario.id), [usuario.id]);
  const criterio = resolverCriterio(parametros, guardado);
  const { orden, estado } = criterio;

  const elegir = useCallback(
    (cambio: Partial<CriterioMesas>) => {
      const nuevo = { orden, estado, ...cambio };
      guardarPreferencia(usuario.id, nuevo);
      setParametros(
        (previos) => {
          const nuevos = new URLSearchParams(previos);
          nuevos.set(PARAM_ORDEN, nuevo.orden);
          nuevos.set(PARAM_ESTADO, nuevo.estado);
          return nuevos;
        },
        { replace: true },
      );
    },
    [orden, estado, usuario.id, setParametros],
  );

  return { criterio, elegir };
}
