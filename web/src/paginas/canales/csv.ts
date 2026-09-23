import type { VentaPorArea } from '../../api/tipos';
import { armarCsv, ErrorCsv, importeCsv, nombreCsv, texto } from '../../csv/csv';
import type { Rango } from '../../filtros/periodo';
import { filasMezcla, type LadoCanal } from './reglas';

/**
 * El CSV de Ventas por canal (F2-144). Mismas reglas que Comparativos: BOM, CRLF, importes
 * exactos (uno ilegible detiene el archivo), sin datos en un periodo = celda VACÍA (nunca 0 ni
 * 0.00) y SIN fila de total. Una fila por canal más "área sin canal" y "sin clasificar": suman la
 * venta de cada periodo UNA vez. Mezcla como número sin `%` (`33.3`).
 */

export const ENCABEZADOS_CANALES = [
  'Canal',
  'Venta A',
  'Mezcla A %',
  'Cuentas A',
  'Venta B',
  'Mezcla B %',
  'Cuentas B',
] as const;

const DIA = /^\d{4}-\d{2}-\d{2}$/;

function columnas(l: LadoCanal | null, canal: string, periodo: string): string[] {
  if (l === null) return ['', '', ''];
  const venta = importeCsv(
    l.venta,
    () => `${canal} trae un importe inválido en el periodo ${periodo} ("${l.venta}").`,
  );
  return [venta, l.mezcla === null ? '' : l.mezcla.replace(' %', ''), String(l.cuentas)];
}

export function canalesACsv(a: VentaPorArea, b: VentaPorArea | null): string {
  return armarCsv(
    ENCABEZADOS_CANALES,
    filasMezcla(a, b).map((f) => [
      // El nombre es nuestro (fijo), pero pasa por el mismo escape que todo texto del CSV.
      texto(f.nombre),
      ...columnas(f.a, f.nombre, 'A'),
      ...columnas(f.b, f.nombre, 'B'),
    ]),
  );
}

/** `ventas-canal_<desdeA>_<hastaA>_vs_<desdeB>_<hastaB>[_<sucursal>].csv`. */
export function nombreCsvCanales(a: Rango, b: Rango | null, sucursal?: string): string {
  const dias = b === null ? [a.desde, a.hasta] : [a.desde, a.hasta, b.desde, b.hasta];
  for (const dia of dias) {
    if (!DIA.test(dia)) throw new ErrorCsv(`Fecha inválida en el periodo ("${dia}").`);
  }
  const hasta = b === null ? a.hasta : `${a.hasta}_vs_${b.desde}_${b.hasta}`;
  return nombreCsv('ventas-canal', a.desde, hasta, sucursal);
}
