import type { Importe } from '../api/tipos';
import { aCentavos } from '../dinero/dinero';

/**
 * Lo común de los CSV que genera el panel en el navegador (Tickets, F1-042, y los
 * reportes, F1-043).
 *
 * - BOM UTF-8 al inicio: sin él, Excel abre el archivo como Windows-1252 y los
 *   acentos salen rotos ("Ã±").
 * - Separador `,` y fin de línea CRLF (RFC 4180), también al final.
 * - Importes como `1234.50`, sin `$` ni separador de miles, para que Excel los tome
 *   como número. Un importe inválido detiene el archivo: nunca se escribe $0.00.
 */
export const BOM = '﻿';
const FIN = '\r\n';

export class ErrorCsv extends Error {
  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ErrorCsv';
  }
}

/** Comillas sólo cuando hacen falta, y las internas dobladas. */
export function campo(valor: string): string {
  return /[",\r\n]/.test(valor) ? `"${valor.replace(/"/g, '""')}"` : valor;
}

/**
 * Texto que viene de SR (mesero, mesa, folio, producto, sucursal...). Si empieza
 * como una fórmula, Excel la ejecuta al abrir el archivo (inyección CSV): se le
 * antepone `'` para que quede como texto. Sólo a los textos: los importes los
 * escribimos nosotros ya validados.
 */
export function texto(valor: string | null): string {
  if (valor === null) return '';
  return campo(/^[=+\-@\t\r]/.test(valor) ? `'${valor}` : valor);
}

/** Excel no acepta una cadena de más de 255 caracteres dentro de una fórmula. */
export const MAX_TEXTO_EXCEL = 255;

/**
 * Un texto que Excel tiene que dejar COMO TEXTO aunque parezca número o fecha (el
 * folio: `000123` perdería los ceros y un folio largo saldría en notación
 * científica). Se escribe como la fórmula `="<valor>"`: un literal de cadena, con las
 * comillas internas dobladas, así que NADA del contenido se evalúa y la inyección
 * CSV no aplica (un `=CMD()` sale tal cual, como texto). Luego `campo` lo
 * entrecomilla para el CSV (segunda capa de comillas dobladas).
 *
 * Con salto de línea o más de `MAX_TEXTO_EXCEL` caracteres la fórmula no sirve, y se
 * cae a `texto()`: ahí Excel SÍ puede volver a convertir un folio sólo de dígitos
 * (no pasa con folios reales, pero no queda protegido). Trade-off (F1-094): un programa que lea el CSV sin ser hoja de
 * cálculo ve `="000123"`; LibreOffice y Google Sheets lo evalúan como Excel.
 */
export function textoExcel(valor: string | null): string {
  if (valor === null) return '';
  if (valor.length > MAX_TEXTO_EXCEL || /[\r\n]/.test(valor)) return texto(valor);
  return campo(`="${valor.replace(/"/g, '""')}"`);
}

/** Centavos exactos como número decimal (`-12.50`, `1234567.89`). */
export function centavosCsv(centavos: bigint): string {
  const negativo = centavos < 0n;
  const absoluto = negativo ? -centavos : centavos;
  const decimales = (absoluto % 100n).toString().padStart(2, '0');
  return `${negativo ? '-' : ''}${absoluto / 100n}.${decimales}`;
}

/** Un importe de la API, validado. Uno inválido lanza `ErrorCsv` con `mensaje`. */
export function importeCsv(valor: Importe, mensaje: () => string): string {
  const centavos = aCentavos(valor);
  if (centavos === null) throw new ErrorCsv(mensaje());
  return centavosCsv(centavos);
}

/** Encabezado + filas (cada una ya escapada), con BOM y CRLF. */
export function armarCsv(encabezados: readonly string[], filas: readonly string[][]): string {
  const lineas = [encabezados.join(','), ...filas.map((f) => f.join(','))];
  return BOM + lineas.join(FIN) + FIN;
}

/** `Plaza Ñuñoa / Centro` → `plaza-nunoa-centro`, para nombres de archivo. */
export function slug(nombre: string): string {
  return nombre
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `<prefijo>_<desde>_<hasta>[_<sucursal>].csv`. Sin sucursal = todas. */
export function nombreCsv(
  prefijo: string,
  desde: string,
  hasta: string,
  sucursal?: string,
): string {
  const s = slug(sucursal ?? '');
  return `${prefijo}_${desde}_${hasta}${s ? `_${s}` : ''}.csv`;
}

/** Dispara la descarga de un texto como archivo, sin pasar por el servidor. */
export function descargar(
  nombre: string,
  contenido: string,
  tipo = 'text/csv;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([contenido], { type: tipo }));
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombre;
  enlace.style.display = 'none';
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  // Revocar en el mismo tick puede cancelar la descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
