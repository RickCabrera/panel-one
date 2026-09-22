import type { VentaPorArea } from '../../api/tipos';
import { armarCsv, importeCsv, nombreCsv, texto } from '../../csv/csv';
import type { Rango } from '../../filtros/periodo';
import { canalTexto, estadoArea, nombreArea, SIN_CLASIFICAR } from './reglas';

/**
 * El CSV de Áreas y canales (F2-233). Mismas reglas que Análisis: BOM, CRLF, textos del POS con
 * anti-inyección, importes exactos (uno ilegible detiene el archivo) y SIN fila de total.
 *
 * Una fila por (sucursal, área) con su canal en una columna, y al final el renglón "sin
 * clasificar": así las filas suman la venta del periodo UNA vez y el corte por canal se saca con
 * una tabla dinámica. No lleva además las filas por canal: sumarían la venta dos veces.
 */

export const ENCABEZADOS_AREAS = [
  'Sucursal',
  'Área',
  'Id del área en el POS',
  'Estado',
  'Canal',
  'Venta',
  'Cuentas',
] as const;

const inv = (quien: string, v: string) => () => `${quien} trae un importe inválido ("${v}").`;

export function areasACsv(r: VentaPorArea): string {
  return armarCsv(ENCABEZADOS_AREAS, [
    ...r.areas.map((a) => [
      texto(a.sucursal),
      texto(nombreArea(a)),
      texto(a.areaOrigenSrId),
      estadoArea(a),
      canalTexto(a.canal),
      importeCsv(a.venta, inv(`El área ${nombreArea(a)} (${a.sucursal})`, a.venta)),
      String(a.cuentas),
    ]),
    ...(r.sinArea.cuentas > 0
      ? [
          [
            '',
            SIN_CLASIFICAR,
            '',
            '',
            '',
            importeCsv(r.sinArea.venta, inv('Las cuentas sin área', r.sinArea.venta)),
            String(r.sinArea.cuentas),
          ],
        ]
      : []),
  ]);
}

/** `areas-canales_<desde>_<hasta>[_<sucursal>].csv`. */
export function nombreCsvAreas(rango: Rango, sucursal?: string): string {
  return nombreCsv('areas-canales', rango.desde, rango.hasta, sucursal);
}
