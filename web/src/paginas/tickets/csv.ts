import type { Importe, Sucursal, Ticket } from '../../api/tipos';
import { armarCsv, BOM, ErrorCsv, importeCsv, nombreCsv, texto, textoExcel } from '../../csv/csv';
import { fechaHoraDe, formasDePago } from './formato';

export { BOM, ErrorCsv };

/**
 * El CSV de la vista Tickets, generado en el navegador. Las reglas comunes (BOM,
 * CRLF, anti-inyección, importes exactos) están en `csv/csv.ts`.
 *
 * - Una fila por ticket y NINGUNA fila de totales: los cancelados se listan con su
 *   columna, pero no se suman en ningún lado.
 * - Fechas en ISO (`YYYY-MM-DD`) en la zona de la sucursal.
 * - El folio va como `="..."` (`textoExcel`): Excel lo deja como texto, con sus
 *   ceros a la izquierda y sin notación científica.
 */

export const ENCABEZADOS = [
  'Sucursal',
  'Folio',
  'Fecha',
  'Hora',
  'Mesa',
  'Mesero',
  'Comensales',
  'Subtotal',
  'Impuestos',
  'Descuentos',
  'Propina',
  'Total',
  'Forma de pago',
  'Cancelado',
] as const;

/** Un importe validado, como número decimal. Uno inválido detiene el export. */
function importe(valor: Importe, ticket: Ticket, nombre: string): string {
  return importeCsv(
    valor,
    () => `El ticket ${ticket.folio} trae un ${nombre} inválido ("${valor}").`,
  );
}

export function ticketsACsv(
  tickets: readonly Ticket[],
  sucursales: ReadonlyMap<string, Sucursal>,
): string {
  const filas: string[][] = [];
  for (const t of tickets) {
    const sucursal = sucursales.get(t.sucursalId);
    const fechaHora = fechaHoraDe(t, sucursales);
    if (!sucursal || !fechaHora) {
      // Sin la sucursal no hay zona para la fecha: mejor ningún archivo que uno con
      // la hora en la zona equivocada.
      throw new ErrorCsv(`El ticket ${t.folio} es de una sucursal que no está en tu lista.`);
    }
    filas.push([
      texto(sucursal.nombre),
      textoExcel(t.folio),
      fechaHora.fecha,
      fechaHora.hora,
      texto(t.mesa),
      texto(t.mesero),
      t.comensales === null ? '' : String(t.comensales),
      importe(t.subtotal, t, 'subtotal'),
      importe(t.impuestos, t, 'impuesto'),
      importe(t.descuentos, t, 'descuento'),
      importe(t.propina, t, 'propina'),
      importe(t.total, t, 'total'),
      texto(formasDePago(t.pagos)),
      t.cancelado ? 'Sí' : 'No',
    ]);
  }
  return armarCsv(ENCABEZADOS, filas);
}

/** `tickets_2026-09-01_2026-09-20_centro.csv`. Sin sucursal = todas. */
export function nombreArchivo(desde: string, hasta: string, sucursal?: string): string {
  return nombreCsv('tickets', desde, hasta, sucursal);
}
