import type { RendimientoMeseros } from '../../api/tipos';
import { armarCsv, importeCsv, nombreCsv, texto } from '../../csv/csv';
import type { Rango } from '../../filtros/periodo';
import { estadoFila, nombreFila, sucursalDe } from './reglas';

/**
 * El CSV de Meseros (F2-231). Mismas reglas que Análisis: BOM, CRLF, textos del POS con
 * anti-inyección, importes exactos (uno ilegible detiene el archivo) y SIN fila de total.
 * Lleva TODAS las filas (también "Sin mesero": sin ella no suman la venta), no la página.
 * Descuentos y cancelaciones van en columnas propias, con importe y conteo.
 */

export const ENCABEZADOS_MESEROS = [
  'Sucursal',
  'Posición',
  'De',
  'Clave',
  'Mesero',
  'Estado',
  'Venta',
  'Cuentas',
  'Ticket promedio',
  'Comensales',
  'Propina',
  'Minutos promedio de mesa',
  'Descuentos',
  'Cuentas con descuento',
  'Cancelaciones',
  'Monto cancelado',
] as const;

export function meserosACsv(r: RendimientoMeseros): string {
  return armarCsv(
    ENCABEZADOS_MESEROS,
    r.filas.map((f) => {
      const quien = `El mesero ${nombreFila(f)} (${f.sucursal})`;
      const inv = (v: string) => () => `${quien} trae un importe inválido ("${v}").`;
      const de = sucursalDe(r, f.sucursalId)?.meserosEnRanking;
      return [
        texto(f.sucursal),
        f.posicion === null ? '' : String(f.posicion),
        f.posicion === null || de === undefined ? '' : String(de),
        texto(f.catalogo?.clave ?? null),
        texto(nombreFila(f)),
        texto(estadoFila(f)),
        importeCsv(f.venta, inv(f.venta)),
        String(f.cuentas),
        f.ticketPromedio === null ? '' : importeCsv(f.ticketPromedio, inv(f.ticketPromedio)),
        String(f.comensales),
        importeCsv(f.propina, inv(f.propina)),
        f.minutosPromedio ?? '',
        importeCsv(f.descuentos.monto, inv(f.descuentos.monto)),
        String(f.descuentos.cuentas),
        String(f.cancelados.cuentas),
        importeCsv(f.cancelados.monto, inv(f.cancelados.monto)),
      ];
    }),
  );
}

/** `meseros_<desde>_<hasta>[_<sucursal>].csv`. */
export function nombreCsvMeseros(rango: Rango, sucursal?: string): string {
  return nombreCsv('meseros', rango.desde, rango.hasta, sucursal);
}
