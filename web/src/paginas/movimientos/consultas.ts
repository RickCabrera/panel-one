import { keepPreviousData, useQuery } from '@tanstack/react-query';

import { pedir } from '../../api/cliente';
import type { Kardex, Movimientos, PolizaDetalle, TipoPolizaInventario } from '../../api/tipos';
import type { Rango } from '../../filtros/periodo';
import type { Filtro } from '../inicio/consultas';
import type { Articulo } from './reglas';

export const POR_PAGINA = 50;

export interface FiltrosMovimientos {
  /** Un almacén es de UNA sucursal: elegirlo acota la consulta a ella. */
  almacen: { sucursalId: string; almacenOrigenSrId: string } | null;
  tipo: TipoPolizaInventario | null;
  /** El artículo del kardex: también acota la línea de tiempo. */
  articulo: Articulo | null;
  pagina: number;
}

/** La línea de tiempo (F2-122) del alcance, del periodo y de los filtros. */
export function useMovimientos(filtro: Filtro | null, rango: Rango | null, f: FiltrosMovimientos) {
  const sucursalId = f.articulo?.sucursalId ?? f.almacen?.sucursalId ?? filtro?.sucursalId;
  const almacen = f.articulo?.almacenOrigenSrId ?? f.almacen?.almacenOrigenSrId;
  return useQuery({
    queryKey: [
      'inventario',
      'movimientos',
      filtro?.empresaId,
      sucursalId ?? null,
      almacen ?? null,
      f.articulo?.insumoOrigenSrId ?? null,
      f.tipo,
      rango?.desde,
      rango?.hasta,
      f.pagina,
    ],
    queryFn: ({ signal }) =>
      pedir<Movimientos>('/inventario/movimientos', {
        query: {
          empresaId: filtro?.empresaId,
          sucursalId,
          almacenOrigenSrId: almacen,
          insumoOrigenSrId: f.articulo?.insumoOrigenSrId,
          tipo: f.tipo ?? undefined,
          desde: rango?.desde,
          hasta: rango?.hasta,
          pagina: f.pagina,
          porPagina: POR_PAGINA,
        },
        signal,
      }),
    enabled: filtro !== null && rango !== null,
    placeholderData: keepPreviousData,
  });
}

/** El detalle de una póliza con sus partidas. */
export function usePoliza(empresaId: string | undefined, id: string | null) {
  return useQuery({
    queryKey: ['inventario', 'poliza', empresaId, id],
    queryFn: ({ signal }) =>
      pedir<PolizaDetalle>(`/inventario/polizas/${encodeURIComponent(id ?? '')}`, {
        query: { empresaId },
        signal,
      }),
    enabled: empresaId !== undefined && id !== null,
  });
}

/** El kardex de un artículo en su almacén, en el periodo. */
export function useKardex(
  empresaId: string | undefined,
  articulo: Articulo | null,
  rango: Rango | null,
) {
  return useQuery({
    queryKey: [
      'inventario',
      'kardex',
      empresaId,
      articulo?.sucursalId,
      articulo?.almacenOrigenSrId,
      articulo?.insumoOrigenSrId,
      rango?.desde,
      rango?.hasta,
    ],
    queryFn: ({ signal }) =>
      pedir<Kardex>('/inventario/kardex', {
        query: {
          empresaId,
          sucursalId: articulo?.sucursalId,
          almacenOrigenSrId: articulo?.almacenOrigenSrId,
          insumoOrigenSrId: articulo?.insumoOrigenSrId,
          desde: rango?.desde,
          hasta: rango?.hasta,
        },
        signal,
      }),
    enabled: empresaId !== undefined && articulo !== null && rango !== null,
  });
}
