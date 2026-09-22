import { useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect } from 'react';

import { pedir } from '../../api/cliente';
import type { FormaPago, PaginaTickets } from '../../api/tipos';
import type { Rango } from '../../filtros/periodo';
import {
  ORDEN_DEFAULT,
  SIN_FILTROS,
  type Canceladas,
  type Direccion,
  type FiltrosTickets,
  type Orden,
  type OrdenTickets,
} from '../../filtros/tickets';
import type { Filtro } from '../inicio/consultas';

/** Tamaño de página de la tabla (backlog F1-042: "de 50 en 50"). */
export const POR_PAGINA = 50;

/**
 * El filtro completo de `/ventas/tickets`, sin la paginación: tal cual viaja en el query. Un
 * filtro sin valor (o en su default) va `undefined` y no se manda.
 */
export interface ParametrosTickets {
  empresaId: string;
  sucursalId: string | undefined;
  desde: string;
  hasta: string;
  folio: string | undefined;
  mesero: string | undefined;
  mesa: string | undefined;
  forma: FormaPago | undefined;
  importeMin: string | undefined;
  importeMax: string | undefined;
  canceladas: Exclude<Canceladas, 'incluir'> | undefined;
  producto: string | undefined;
  clienteId: string | undefined;
  orden: Orden | undefined;
  dir: Direccion | undefined;
}

export function parametrosDe(
  filtro: Filtro | null,
  rango: Rango | null,
  folio: string,
  filtros: FiltrosTickets = SIN_FILTROS,
  orden: OrdenTickets = ORDEN_DEFAULT,
): ParametrosTickets | null {
  if (filtro === null || rango === null) return null;
  const esDefault = orden.orden === ORDEN_DEFAULT.orden && orden.dir === ORDEN_DEFAULT.dir;
  return {
    empresaId: filtro.empresaId,
    sucursalId: filtro.sucursalId,
    desde: rango.desde,
    hasta: rango.hasta,
    folio: folio || undefined,
    mesero: filtros.mesero || undefined,
    mesa: filtros.mesa || undefined,
    forma: filtros.forma || undefined,
    importeMin: filtros.importeMin || undefined,
    importeMax: filtros.importeMax || undefined,
    canceladas: filtros.canceladas === 'incluir' ? undefined : filtros.canceladas,
    producto: filtros.producto || undefined,
    clienteId: filtros.cliente || undefined,
    orden: esDefault ? undefined : orden.orden,
    dir: esDefault ? undefined : orden.dir,
  };
}

/** Orden FIJO de las partes de la llave (no depende del orden de las llaves del objeto). */
const PARTES: ReadonlyArray<keyof ParametrosTickets> = [
  'empresaId',
  'sucursalId',
  'desde',
  'hasta',
  'folio',
  'mesero',
  'mesa',
  'forma',
  'importeMin',
  'importeMax',
  'canceladas',
  'producto',
  'clienteId',
  'orden',
  'dir',
];

function llave(p: ParametrosTickets | null, pagina: number): QueryKey {
  return ['ventas', 'tickets', ...PARTES.map((parte) => p?.[parte] ?? null), pagina];
}

/** ¿Dos llaves de tickets difieren SÓLO en la página? (la página es lo último). */
export function mismoFiltro(a: QueryKey, b: QueryKey): boolean {
  return a.length === b.length && a.slice(0, -1).every((parte, i) => Object.is(parte, b[i]));
}

function consultar(p: ParametrosTickets, pagina: number, signal: AbortSignal) {
  return pedir<PaginaTickets>('/ventas/tickets', {
    query: { ...p, pagina, porPagina: POR_PAGINA },
    signal,
  });
}

/**
 * Una página de tickets. Al pasar de página se sigue viendo la anterior (atenuada)
 * hasta que llega la nueva, y la siguiente se pide de antemano: así la paginación
 * no parpadea. Pero SÓLO entre páginas del mismo filtro: con otro alcance, periodo,
 * folio, filtro u orden nunca se muestran los tickets viejos bajo el filtro nuevo (misma regla
 * que F1-041).
 *
 * Sin auto-refresco: la lista se movería bajo el dedo mientras alguien la lee.
 */
export function useTickets(p: ParametrosTickets | null, pagina: number) {
  const queryClient = useQueryClient();
  const queryKey = llave(p, pagina);

  const consulta = useQuery({
    queryKey,
    queryFn: ({ signal }) => consultar(p!, pagina, signal),
    enabled: p !== null,
    placeholderData: (previos, consultaPrevia) =>
      consultaPrevia && mismoFiltro(consultaPrevia.queryKey, queryKey) ? previos : undefined,
  });

  const total = consulta.isPlaceholderData ? undefined : consulta.data?.total;
  const haySiguiente = total !== undefined && pagina * POR_PAGINA < total;
  const llaveSiguiente = JSON.stringify(llave(p, pagina + 1));
  useEffect(() => {
    if (p === null || !haySiguiente) return;
    void queryClient.prefetchQuery({
      queryKey: llave(p, pagina + 1),
      queryFn: ({ signal }) => consultar(p, pagina + 1, signal),
    });
    // `llaveSiguiente` resume `p` y `pagina`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [llaveSiguiente, haySiguiente, queryClient]);

  return consulta;
}
