import type { Importe, Sucursal, Ticket } from '../../api/tipos';
import { aCentavos } from '../../dinero/dinero';
import { fechaHoraDe, formasDePago } from './formato';

/**
 * El CSV de la vista Tickets, generado en el navegador.
 *
 * - BOM UTF-8 al inicio: sin él, Excel abre el archivo como Windows-1252 y los
 *   acentos salen rotos ("Ã±").
 * - Separador `,` y fin de línea CRLF (RFC 4180).
 * - Una fila por ticket y NINGUNA fila de totales: los cancelados se listan con su
 *   columna, pero no se suman en ningún lado.
 * - Importes como `1234.50`, sin `$` ni separador de miles, para que Excel los tome
 *   como número. Fechas en ISO (`YYYY-MM-DD`) en la zona de la sucursal.
 */
export const BOM = '﻿';
const FIN = '\r\n';

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

export class ErrorCsv extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCsv';
  }
}

/** Comillas sólo cuando hacen falta, y las internas dobladas. */
function campo(valor: string): string {
  return /[",\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

/**
 * Texto que viene de SR (mesero, mesa, folio...). Si empieza como una fórmula, Excel
 * la ejecuta al abrir el archivo (inyección CSV): se le antepone `'` para que quede
 * como texto. Sólo a los textos: los importes los escribimos nosotros ya validados.
 */
function texto(valor: string | null): string {
  if (valor === null) return '';
  return campo(/^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor);
}

/** Un importe validado, como número decimal. Uno inválido detiene el export. */
function importe(valor: Importe, ticket: Ticket, nombre: string): string {
  const centavos = aCentavos(valor);
  if (centavos === null) {
    throw new ErrorCsv(`El ticket ${ticket.folio} trae un ${nombre} inválido ("${valor}").`);
  }
  const negativo = centavos < 0n;
  const absoluto = negativo ? -centavos : centavos;
  const decimales = (absoluto % 100n).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}${absoluto / 100n}.${decimales}`;
}

export function ticketsACsv(
  tickets: readonly Ticket[],
  sucursales: ReadonlyMap<string, Sucursal>,
): string {
  const filas = [ENCABEZADOS.join(',')];
  for (const t of tickets) {
    const sucursal = sucursales.get(t.sucursalId);
    const fechaHora = fechaHoraDe(t, sucursales);
    if (!sucursal || !fechaHora) {
      // Sin la sucursal no hay zona para la fecha: mejor ningún archivo que uno con
      // la hora en la zona equivocada.
      throw new ErrorCsv(`El ticket ${t.folio} es de una sucursal que no está en tu lista.`);
    }
    filas.push(
      [
        texto(sucursal.nombre),
        texto(t.folio),
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
      ].join(','),
    );
  }
  return BOM + filas.join(FIN) + FIN;
}

/** `tickets_2026-09-01_2026-09-20_centro.csv`. Sin sucursal = todas. */
export function nombreArchivo(desde: string, hasta: string, sucursal?: string): string {
  const slug = (sucursal ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `tickets_${desde}_${hasta}${slug ? `_${slug}` : ''}.csv`;
}
