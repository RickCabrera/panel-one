import type { Adjunto, PlantillaCorreo } from '../adaptadores/correo/puerto';
import { fechaLocal } from '../comun/fechas';
import { escaparHtml, formatoPesos } from '../reportes/formato';
import { normalizarColor } from './portal';

/**
 * La entrega de un CFDI (F2-105), la parte PURA: dónde se guardan el XML y el PDF, cómo se llaman
 * los adjuntos y el correo `factura-emitida`. Lo que toca base, disco o correo es de
 * `EntregaCfdiService`.
 */

export const NOMBRE_PLANTILLA_FACTURA = 'factura-emitida';

/** Todo archivo de CFDI vive bajo este prefijo; el endpoint público no sirve nada fuera de él. */
export const PREFIJO_ARCHIVOS_CFDI = 'cfdi/';

export const TIPO_XML = 'application/xml';
export const TIPO_PDF = 'application/pdf';

/**
 * DECISION PROVISIONAL (nocturno): los enlaces de descarga de la pantalla de éxito del portal
 * duran 1 h. El correo ya lleva los dos archivos; el enlace es para bajarlos en ese momento. Si el
 * cliente vuelve después, la re-descarga es la decisión abierta (a)/(b) de F2-105 (backlog).
 */
export const TTL_DESCARGA_PORTAL_S = 60 * 60;

/** El color de la franja del correo cuando la sucursal no tiene portal (o su color no es válido). */
export const COLOR_CORREO_POR_DEFECTO = '#0f766e';

export type ExtensionCfdi = 'xml' | 'pdf';

/**
 * `cfdi/{empresaId}/{AAAA}/{MM}/{uuid}.{xml|pdf}`: el `/data/cfdi/{empresa}/{año}/{mes}/` del
 * backlog con `ARCHIVOS_RAIZ=/data`. Año y mes de la fecha de TIMBRADO en la zona de la sucursal que
 * expide (una factura timbrada el 30 de septiembre a las 21:00 en CDMX es de septiembre, aunque en
 * UTC ya sea octubre).
 */
export function claveArchivoCfdi(
  empresaId: string,
  uuid: string,
  fechaTimbrado: Date,
  zonaHoraria: string,
  extension: ExtensionCfdi,
): string {
  const [anio, mes] = fechaLocal(fechaTimbrado, zonaHoraria).split('-');
  return `${PREFIJO_ARCHIVOS_CFDI}${empresaId}/${anio}/${mes}/${uuid.toUpperCase()}.${extension}`;
}

/** El tipo MIME de una clave de CFDI por su extensión, o null si no es XML ni PDF. */
export function tipoDeClaveCfdi(clave: string): string | null {
  if (!clave.startsWith(PREFIJO_ARCHIVOS_CFDI)) return null;
  if (clave.endsWith('.xml')) return TIPO_XML;
  if (clave.endsWith('.pdf')) return TIPO_PDF;
  return null;
}

/** Los dos adjuntos del correo, nombrados por serie y folio (lo que el cliente reconoce). */
export function adjuntosCfdi(serieFolio: string, xml: Buffer, pdf: Buffer): Adjunto[] {
  const base = serieFolio.replace(/[^A-Za-z0-9-]/g, '_');
  return [
    { nombre: `${base}.pdf`, tipo: TIPO_PDF, contenido: pdf },
    { nombre: `${base}.xml`, tipo: TIPO_XML, contenido: xml },
  ];
}

export interface DatosCorreoFactura {
  sucursal: string;
  /** El color del portal de la sucursal (`#rrggbb`), o null. */
  color: string | null;
  emisor: string;
  uuid: string;
  serieFolio: string;
  /** Dinero como texto con 2 decimales. */
  total: string;
}

/**
 * El correo `factura-emitida`: HTML con estilos en línea (lo que respetan los clientes de correo) y
 * su versión de texto. Todo dato pasa por `escaparHtml`; el color sólo entra si es `#rrggbb`.
 */
export function plantillaFactura(d: DatosCorreoFactura): PlantillaCorreo {
  const e = escaparHtml;
  const color = (d.color && normalizarColor(d.color)) || COLOR_CORREO_POR_DEFECTO;
  const total = formatoPesos(d.total);
  const fila = (titulo: string, valor: string) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${e(titulo)}</td>` +
    `<td style="padding:4px 0;font-weight:600;">${e(valor)}</td></tr>`;
  const html =
    '<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f9fafb;' +
    'font-family:Arial,Helvetica,sans-serif;color:#111827;">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;">' +
    `<div style="background:${color};color:#ffffff;padding:16px 20px;font-size:18px;` +
    `font-weight:600;">${e(d.sucursal)}</div>` +
    '<div style="padding:20px;font-size:14px;line-height:1.5;">' +
    '<p style="margin:0 0 12px;">Tu factura ya está timbrada. Te enviamos el PDF y el XML ' +
    'adjuntos a este correo.</p>' +
    '<table role="presentation" style="border-collapse:collapse;font-size:14px;">' +
    fila('Emisor', d.emisor) +
    fila('Folio fiscal (UUID)', d.uuid) +
    fila('Serie y folio', d.serieFolio) +
    fila('Total', total) +
    '</table>' +
    '<p style="margin:16px 0 0;color:#6b7280;font-size:12px;">Guarda el XML: es la factura ' +
    'válida ante el SAT. El PDF es su representación impresa.</p>' +
    '</div></div></body></html>';
  const texto = [
    d.sucursal,
    '',
    'Tu factura ya está timbrada. Te enviamos el PDF y el XML adjuntos a este correo.',
    '',
    `Emisor: ${d.emisor}`,
    `Folio fiscal (UUID): ${d.uuid}`,
    `Serie y folio: ${d.serieFolio}`,
    `Total: ${total}`,
    '',
    'Guarda el XML: es la factura válida ante el SAT. El PDF es su representación impresa.',
  ].join('\n');
  return {
    nombre: NOMBRE_PLANTILLA_FACTURA,
    asunto: `Tu factura de ${d.sucursal} (${d.serieFolio})`,
    html,
    texto,
  };
}

/** El error de un puerto como texto para guardar: sin saltos de línea y recortado. */
export function textoDeError(error: unknown, max: number): string {
  const t = error instanceof Error ? error.message : String(error);
  return t.replace(/\s+/g, ' ').trim().slice(0, max) || 'Error desconocido del servicio de correo.';
}
