import type { ConteoDetalle } from '../../api/tipos';
import { armarCsv, importeCsv, slug, texto, textoExcel } from '../../csv/csv';
import { nombreAlmacenConteo, TEXTO_RENGLON } from './reglas';

/**
 * El CSV del reporte de diferencias de un conteo (F2-123): lo que el encargado lleva a
 * SoftRestaurant para registrar ahí el ajuste (el panel nunca ajusta nada en SR).
 *
 * Mismas reglas que el resto de los CSV: BOM, CRLF, textos del POS con anti-inyección, importes
 * exactos (uno ilegible detiene el archivo). Un renglón sin contar o sin teórico lleva sus celdas
 * de diferencia VACÍAS, nunca 0, y SIN fila de total (sumar la columna Importe da el neto).
 */

export const ENCABEZADOS_CONTEO = [
  'Folio',
  'Sucursal',
  'Almacén',
  'Artículo',
  'Clave',
  'Id del insumo en el POS',
  'Unidad',
  'Teórico',
  'Contado',
  'Diferencia',
  'Costo promedio',
  'Importe',
  'Estado',
] as const;

export function conteoACsv(d: ConteoDetalle): string {
  const c = d.conteo;
  const inv = (insumo: string, v: string) => () =>
    `El artículo ${insumo} trae un importe inválido ("${v}").`;
  return armarCsv(
    ENCABEZADOS_CONTEO,
    d.partidas.map((p) => [
      String(c.folio),
      texto(c.sucursal),
      texto(nombreAlmacenConteo(c)),
      texto(p.insumo),
      texto(p.clave),
      textoExcel(p.insumoOrigenSrId),
      texto(p.unidad),
      p.teorico ?? '',
      p.contado ?? '',
      p.diferencia ?? '',
      p.costoPromedio === null
        ? ''
        : importeCsv(p.costoPromedio, inv(p.insumoOrigenSrId, p.costoPromedio)),
      p.importe === null ? '' : importeCsv(p.importe, inv(p.insumoOrigenSrId, p.importe)),
      TEXTO_RENGLON[p.estado],
    ]),
  );
}

/** `conteo_<sucursal>_<folio>.csv`. */
export function nombreCsvConteo(d: ConteoDetalle): string {
  return `conteo_${slug(d.conteo.sucursal) || 'sucursal'}_${d.conteo.folio}.csv`;
}
