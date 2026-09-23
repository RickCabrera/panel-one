import type { PlantillaCorreo } from '../adaptadores/correo/puerto';
import { escaparHtml } from '../reportes/formato';

/** Lo que llega del formulario de la landing, ya validado por `ContactoDto`. */
export interface DatosContacto {
  nombre: string;
  email: string;
  telefono?: string;
  negocio?: string;
  sucursales?: number;
  mensaje: string;
}

/** Quita saltos de línea de lo que va en el asunto: un asunto con `\r\n` es inyección de cabeceras. */
function unaLinea(texto: string): string {
  return texto.replace(/[\r\n\t]+/g, ' ').trim();
}

/**
 * El correo `contacto-landing` (F2-147) al buzón del negocio. TODO lo que escribió el visitante
 * va escapado: el formulario es público y cualquiera puede mandar `<script>` o un enlace
 * disfrazado. El texto plano lleva lo mismo sin HTML.
 */
export function plantillaContacto(d: DatosContacto): PlantillaCorreo {
  const e = escaparHtml;
  const campos: [string, string][] = [
    ['Nombre', d.nombre],
    ['Email', d.email],
    ['Teléfono', d.telefono || '—'],
    ['Negocio', d.negocio || '—'],
    ['Sucursales', d.sucursales === undefined ? '—' : String(d.sucursales)],
  ];
  const fila = ([titulo, valor]: [string, string]) =>
    `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;">${e(titulo)}</td>` +
    `<td style="padding:4px 0;font-weight:600;">${e(valor)}</td></tr>`;
  const mensajeHtml = e(d.mensaje).replace(/\r?\n/g, '<br>');
  const html =
    '<!doctype html><html lang="es"><body style="margin:0;padding:0;background:#f9fafb;' +
    'font-family:Arial,Helvetica,sans-serif;color:#111827;">' +
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:20px;' +
    'font-size:14px;line-height:1.5;">' +
    '<p style="margin:0 0 12px;font-size:16px;font-weight:600;">Nuevo contacto desde la ' +
    'página</p>' +
    `<table role="presentation" style="border-collapse:collapse;font-size:14px;">` +
    campos.map(fila).join('') +
    '</table>' +
    `<p style="margin:16px 0 4px;color:#6b7280;">Mensaje</p><p style="margin:0;">${mensajeHtml}</p>` +
    '</div></body></html>';
  const texto = [
    'Nuevo contacto desde la página',
    '',
    ...campos.map(([t, v]) => `${t}: ${v}`),
    '',
    'Mensaje:',
    d.mensaje,
  ].join('\n');
  return {
    nombre: 'contacto-landing',
    asunto: unaLinea(`Contacto: ${d.nombre}${d.negocio ? ` · ${d.negocio}` : ''}`).slice(0, 200),
    html,
    texto,
  };
}
