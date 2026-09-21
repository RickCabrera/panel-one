import type { ProductoTop, VentaDia, VentaSucursal } from '../../api/tipos';
import { armarCsv, campo, ErrorCsv, importeCsv, texto } from '../../csv/csv';

/**
 * Los CSV de los reportes (F1-043). Mismas reglas que el de Tickets (`csv/csv.ts`):
 * BOM, CRLF, anti-inyección en los textos de SR e importes exactos. Una fila por
 * renglón del reporte y NINGUNA fila de totales: el total lo saca Excel, y así no
 * hay una fila que alguien sume dos veces.
 */

const DIA = /^\d{4}-\d{2}-\d{2}$/;

export const ENCABEZADOS_POR_DIA = ['Día', 'Venta', 'Cuentas'] as const;
export const ENCABEZADOS_COMPARATIVO = [
  'Sucursal',
  'Venta',
  'Tickets',
  'Ticket promedio',
  'Comensales',
] as const;
export const ENCABEZADOS_TOP = ['Posición', 'Producto', 'Importe', 'Cantidad'] as const;

export function porDiaACsv(filas: readonly VentaDia[]): string {
  return armarCsv(
    ENCABEZADOS_POR_DIA,
    filas.map((f) => {
      if (!DIA.test(f.dia)) throw new ErrorCsv(`Día inválido en el reporte ("${f.dia}").`);
      return [
        f.dia,
        importeCsv(f.venta, () => `El día ${f.dia} trae una venta inválida ("${f.venta}").`),
        String(f.cuentas),
      ];
    }),
  );
}

export function comparativoACsv(filas: readonly VentaSucursal[]): string {
  return armarCsv(
    ENCABEZADOS_COMPARATIVO,
    filas.map((f) => [
      texto(f.nombre),
      importeCsv(f.venta, () => `La sucursal ${f.nombre} trae una venta inválida ("${f.venta}").`),
      String(f.cuentas),
      // Sin cuentas no hay promedio: celda vacía, nunca 0.00.
      f.ticketPromedio === null
        ? ''
        : importeCsv(
            f.ticketPromedio,
            () =>
              `La sucursal ${f.nombre} trae un ticket promedio inválido ("${f.ticketPromedio}").`,
          ),
      String(f.comensales),
    ]),
  );
}

export function topACsv(filas: readonly ProductoTop[]): string {
  return armarCsv(
    ENCABEZADOS_TOP,
    filas.map((f, i) => {
      if (!/^-?\d+(\.\d+)?$/.test(f.cantidad)) {
        throw new ErrorCsv(`${f.producto} trae una cantidad inválida ("${f.cantidad}").`);
      }
      return [
        String(i + 1),
        texto(f.producto),
        importeCsv(f.importe, () => `${f.producto} trae un importe inválido ("${f.importe}").`),
        campo(f.cantidad),
      ];
    }),
  );
}
