import type { TipoAlerta } from '@prisma/client';

import type { PlantillaCorreo } from '../adaptadores/correo/puerto';
import type {
  ConteoAlertas,
  ContenidoDiario,
  ContenidoReporte,
  ContenidoSemanal,
} from './contenido';
import { escaparHtml, fechaCorta, fechaLarga, formatoEntero, formatoPesos } from './formato';

/**
 * El correo de cada reporte (F2-141): HTML simple (tablas con estilos en línea, que es lo
 * que los clientes de correo respetan) y su versión de texto. PURO: recibe el contenido ya
 * armado y los enlaces.
 *
 * Todo texto que viene de datos (nombre de empresa, sucursal o producto: lo escribe quien
 * opera el POS) pasa por `escaparHtml`. El dinero llega como texto decimal y se formatea
 * sobre el texto (`formatoPesos`), nunca con float.
 *
 * Estados vacíos: una sucursal sin cuentas dice "Sin ventas registradas", no "$0.00"; una
 * comparación sin lectura en alguno de los dos lados dice "—".
 */

export interface EnlacesReporte {
  /** El panel en el periodo del reporte. */
  panel: string;
  /** La página de baja de ESTE tipo de reporte; null en la vista previa sin suscripción. */
  baja: string | null;
}

export const NOMBRE_PLANTILLA = { diario: 'reporte-diario', semanal: 'reporte-semanal' } as const;

const NOMBRE_ALERTA: Record<TipoAlerta, string> = {
  sucursal_sin_reporte: 'Sucursal sin reportar',
  mesa_abierta: 'Mesa abierta mucho tiempo',
  cuenta_sin_imprimir: 'Cuenta sin imprimir',
  caida_venta: 'Caída de venta',
};

export const SIN_VENTAS = 'Sin ventas registradas';
const GUION = '—';

const e = escaparHtml;
const TD = 'padding:6px 8px;border-bottom:1px solid #e5e7eb;';
const TD_NUM = `${TD}text-align:right;white-space:nowrap;`;
const TH = 'padding:6px 8px;border-bottom:2px solid #d1d5db;text-align:left;font-weight:600;';
const TH_NUM = `${TH}text-align:right;`;

function tabla(
  encabezados: Array<[string, boolean]>,
  filas: string[][],
  numericas: boolean[],
): string {
  const cab = encabezados
    .map(([t, num]) => `<th style="${num ? TH_NUM : TH}">${e(t)}</th>`)
    .join('');
  const cuerpo = filas
    .map(
      (f) =>
        `<tr>${f.map((c, i) => `<td style="${numericas[i] ? TD_NUM : TD}">${c}</td>`).join('')}</tr>`,
    )
    .join('');
  return `<table role="presentation" style="border-collapse:collapse;width:100%;font-size:14px;margin:8px 0 20px;"><thead><tr>${cab}</tr></thead><tbody>${cuerpo}</tbody></table>`;
}

function porcentaje(p: string | null): string {
  if (p === null) return GUION;
  return `${p.startsWith('-') ? '' : '+'}${p} %`;
}

function diferencia(d: string | null): string {
  if (d === null) return GUION;
  return d.startsWith('-') ? formatoPesos(d) : `+${formatoPesos(d)}`;
}

function documento(titulo: string, cuerpo: string, enlaces: EnlacesReporte): string {
  const baja = enlaces.baja
    ? `<a href="${e(enlaces.baja)}" style="color:#6b7280;">Dejar de recibir este reporte</a>`
    : 'El enlace para dejar de recibir este reporte aparece en el correo real.';
  return (
    '<!doctype html><html lang="es"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<title>${e(titulo)}</title></head>` +
    '<body style="margin:0;padding:16px;background:#f9fafb;font-family:Arial,Helvetica,sans-serif;color:#111827;">' +
    '<div style="max-width:640px;margin:0 auto;background:#ffffff;padding:20px;border-radius:8px;">' +
    cuerpo +
    `<p style="margin:24px 0 8px;"><a href="${e(enlaces.panel)}" style="display:inline-block;background:#1f2937;color:#ffffff;padding:10px 16px;border-radius:6px;text-decoration:none;">Ver en el panel</a></p>` +
    `<p style="font-size:12px;color:#6b7280;margin-top:24px;">Recibes este correo porque lo activaste en Mi cuenta. ${baja}</p>` +
    '</div></body></html>'
  );
}

function listaAlertas(conteos: ConteoAlertas[]): string {
  return conteos.map((c) => `${NOMBRE_ALERTA[c.tipo]}: ${formatoEntero(c.cuentas)}`).join(' · ');
}

function totalAlertas(conteos: ConteoAlertas[]): number {
  return conteos.reduce((s, c) => s + c.cuentas, 0);
}

function venta(v: { venta: string; cuentas: number }): string {
  return v.cuentas === 0 ? SIN_VENTAS : formatoPesos(v.venta);
}

export function asuntoDe(c: ContenidoReporte): string {
  if (c.tipo === 'diario')
    return `Resumen del ${fechaLarga(c.periodo.periodo)} · ${c.empresa.nombre}`;
  return `Resumen semanal del ${fechaCorta(c.periodo.desde)} al ${fechaCorta(c.periodo.hasta)} · ${c.empresa.nombre}`;
}

function htmlDiario(c: ContenidoDiario): string {
  const r = c.resumen;
  const partes: string[] = [];
  partes.push(`<h1 style="font-size:20px;margin:0 0 4px;">${e(c.empresa.nombre)}</h1>`);
  partes.push(
    `<p style="margin:0 0 16px;color:#4b5563;">Resumen del ${e(fechaLarga(c.periodo.periodo))}</p>`,
  );
  if (r.cuentas === 0) {
    partes.push(
      `<p style="font-size:16px;"><strong>${SIN_VENTAS} ayer</strong> en ninguna sucursal. Si abrieron, revisa en el panel que el agente de cada sucursal esté conectado.</p>`,
    );
  } else {
    partes.push(
      `<p style="font-size:16px;margin:0 0 4px;">Venta total: <strong>${formatoPesos(r.venta)}</strong></p>` +
        `<p style="margin:0 0 16px;color:#4b5563;">${formatoEntero(r.cuentas)} cuentas · ticket promedio ${r.ticketPromedio === null ? GUION : formatoPesos(r.ticketPromedio)} · ${formatoEntero(r.cancelados.cuentas)} canceladas</p>`,
    );
  }
  partes.push('<h2 style="font-size:16px;margin:16px 0 0;">Por sucursal</h2>');
  partes.push(
    tabla(
      [
        ['Sucursal', false],
        ['Venta', true],
        ['Cuentas', true],
        ['Ticket promedio', true],
      ],
      c.sucursales.map((s) => [
        e(s.nombre),
        venta(s),
        s.cuentas === 0 ? GUION : formatoEntero(s.cuentas),
        s.ticketPromedio === null ? GUION : formatoPesos(s.ticketPromedio),
      ]),
      [false, true, true, true],
    ),
  );
  partes.push('<h2 style="font-size:16px;margin:16px 0 0;">Top 5 productos</h2>');
  partes.push(
    c.top.length === 0
      ? `<p style="color:#4b5563;">${SIN_VENTAS}: no hay productos que listar.</p>`
      : tabla(
          [
            ['Producto', false],
            ['Importe', true],
            ['Cantidad', true],
          ],
          c.top.map((p) => [e(p.producto), formatoPesos(p.importe), e(p.cantidad)]),
          [false, true, true],
        ),
  );
  partes.push('<h2 style="font-size:16px;margin:16px 0 0;">Alertas</h2>');
  const abiertas = totalAlertas(c.alertas.abiertas);
  const recientes = totalAlertas(c.alertas.ultimas24h);
  partes.push(
    `<p style="margin:8px 0;">${abiertas === 0 ? 'Ninguna alerta abierta ahora.' : `<strong>${formatoEntero(abiertas)} abiertas ahora</strong>: ${e(listaAlertas(c.alertas.abiertas))}`}</p>` +
      `<p style="margin:8px 0;color:#4b5563;">${recientes === 0 ? 'Ninguna alerta en las últimas 24 horas.' : `${formatoEntero(recientes)} en las últimas 24 horas: ${e(listaAlertas(c.alertas.ultimas24h))}`}</p>`,
  );
  return partes.join('');
}

function htmlSemanal(c: ContenidoSemanal): string {
  const partes: string[] = [];
  partes.push(`<h1 style="font-size:20px;margin:0 0 4px;">${e(c.empresa.nombre)}</h1>`);
  partes.push(
    `<p style="margin:0 0 16px;color:#4b5563;">Semana del ${e(fechaLarga(c.periodo.desde))} al ${e(fechaLarga(c.periodo.hasta))}, contra la semana anterior</p>`,
  );
  partes.push(
    `<p style="font-size:16px;margin:0 0 4px;">Venta de la semana: <strong>${venta(c.resumen)}</strong></p>` +
      `<p style="margin:0 0 16px;color:#4b5563;">Semana anterior: ${venta(c.resumenAnterior)} · diferencia ${diferencia(c.diferencia)} (${porcentaje(c.variacionPct)})</p>`,
  );
  partes.push('<h2 style="font-size:16px;margin:16px 0 0;">Comparativo por sucursal</h2>');
  partes.push(
    tabla(
      [
        ['Sucursal', false],
        ['Esta semana', true],
        ['Anterior', true],
        ['Diferencia', true],
        ['Variación', true],
      ],
      c.sucursales.map((s) => [
        e(s.nombre),
        venta(s.actual),
        s.anterior === null ? GUION : venta(s.anterior),
        diferencia(s.diferencia),
        porcentaje(s.variacionPct),
      ]),
      [false, true, true, true, true],
    ),
  );
  partes.push('<h2 style="font-size:16px;margin:16px 0 0;">Tendencia por día</h2>');
  partes.push(
    tabla(
      [
        ['Día', false],
        ['Esta semana', true],
        ['Semana anterior', true],
      ],
      c.dias.map((d) => [
        e(fechaLarga(d.dia)),
        d.cuentas === 0 ? SIN_VENTAS : formatoPesos(d.venta),
        d.cuentasAnterior === 0 ? SIN_VENTAS : formatoPesos(d.ventaAnterior),
      ]),
      [false, true, true],
    ),
  );
  return partes.join('');
}

function textoDiario(c: ContenidoDiario): string {
  const l: string[] = [`${c.empresa.nombre}`, `Resumen del ${fechaLarga(c.periodo.periodo)}`, ''];
  l.push(
    c.resumen.cuentas === 0
      ? `${SIN_VENTAS} ayer en ninguna sucursal.`
      : `Venta total: ${formatoPesos(c.resumen.venta)} (${formatoEntero(c.resumen.cuentas)} cuentas)`,
  );
  l.push('', 'Por sucursal:');
  for (const s of c.sucursales) l.push(`- ${s.nombre}: ${venta(s)}`);
  l.push('', 'Top 5 productos:');
  if (c.top.length === 0) l.push(`- ${SIN_VENTAS}`);
  for (const p of c.top) l.push(`- ${p.producto}: ${formatoPesos(p.importe)} (${p.cantidad})`);
  l.push('', `Alertas abiertas ahora: ${formatoEntero(totalAlertas(c.alertas.abiertas))}`);
  l.push(`Alertas en las últimas 24 horas: ${formatoEntero(totalAlertas(c.alertas.ultimas24h))}`);
  return l.join('\n');
}

function textoSemanal(c: ContenidoSemanal): string {
  const l: string[] = [
    `${c.empresa.nombre}`,
    `Semana del ${fechaLarga(c.periodo.desde)} al ${fechaLarga(c.periodo.hasta)}`,
    '',
    `Venta de la semana: ${venta(c.resumen)}`,
    `Semana anterior: ${venta(c.resumenAnterior)} · diferencia ${diferencia(c.diferencia)} (${porcentaje(c.variacionPct)})`,
    '',
    'Por sucursal:',
  ];
  for (const s of c.sucursales) {
    l.push(
      `- ${s.nombre}: ${venta(s.actual)} (anterior ${s.anterior === null ? GUION : venta(s.anterior)}, ${porcentaje(s.variacionPct)})`,
    );
  }
  l.push('', 'Tendencia por día:');
  for (const d of c.dias) {
    l.push(
      `- ${fechaLarga(d.dia)}: ${d.cuentas === 0 ? SIN_VENTAS : formatoPesos(d.venta)} (anterior ${d.cuentasAnterior === 0 ? SIN_VENTAS : formatoPesos(d.ventaAnterior)})`,
    );
  }
  return l.join('\n');
}

export function renderizar(c: ContenidoReporte, enlaces: EnlacesReporte): PlantillaCorreo {
  const asunto = asuntoDe(c);
  const cuerpo = c.tipo === 'diario' ? htmlDiario(c) : htmlSemanal(c);
  const texto = c.tipo === 'diario' ? textoDiario(c) : textoSemanal(c);
  const pie = [
    '',
    `Ver en el panel: ${enlaces.panel}`,
    enlaces.baja ? `Dejar de recibir este reporte: ${enlaces.baja}` : '',
  ]
    .filter((x, i) => i === 0 || x !== '')
    .join('\n');
  return {
    nombre: NOMBRE_PLANTILLA[c.tipo],
    asunto,
    html: documento(asunto, cuerpo, enlaces),
    texto: texto + '\n' + pie,
  };
}
