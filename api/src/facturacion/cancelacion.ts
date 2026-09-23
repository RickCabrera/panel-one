import type { PlantillaCorreo } from '../adaptadores/correo/puerto';
import type { EstadoCfdi, MotivoCancelacion } from '../adaptadores/timbrado/puerto';
import { escaparHtml, formatoPesos } from '../reportes/formato';
import { COLOR_CORREO_POR_DEFECTO } from './entrega';
import { normalizarColor } from './portal';

/**
 * Reglas puras de la cancelación de CFDI (F2-109). Sin base y sin red: qué motivo se puede usar en
 * qué factura, qué se concluye de lo que contesta el PAC, qué le pasa al ticket y el correo al
 * receptor. Las usa `EscrituraFacturacion` (bajo candado) y `CancelacionCfdiService`.
 */

export const MOTIVOS_CANCELACION: readonly MotivoCancelacion[] = ['01', '02', '03', '04'];

/** c_MotivoCancelacion del SAT, en el texto que se le muestra al administrador y al receptor. */
export const TEXTO_MOTIVO: Readonly<Record<MotivoCancelacion, string>> = {
  '01': 'Comprobante emitido con errores con relación',
  '02': 'Comprobante emitido con errores sin relación',
  '03': 'No se llevó a cabo la operación',
  '04': 'Operación nominativa relacionada en una factura global',
};

/**
 * Una solicitud en `solicitando` más vieja que esto se puede CONCILIAR (consultar al PAC y
 * resolverla). Más nueva, puede haber una llamada al PAC en vuelo: no se toca.
 */
export const SOLICITUD_VENCIDA_MS = 10 * 60 * 1000;

/** Máximo de caracteres del último error del PAC que se guarda en la solicitud. */
export const MAX_ERROR_CANCELACION = 300;

export type EstadoSolicitudAbierta = 'solicitando' | 'en_proceso';

export const MENSAJE_CANCELACION_ABIERTA =
  'Esta factura ya tiene una solicitud de cancelación en curso. Pulsa "Actualizar estado" para ' +
  'saber si ya se resolvió.';
export const MENSAJE_REFACTURAR_CON_CANCELACION =
  'Esta factura tiene una cancelación en curso: espera a que se resuelva (Actualizar estado) antes ' +
  'de refacturarla.';
export const MENSAJE_SIN_SOLICITUD =
  'Esta factura no tiene una solicitud de cancelación pendiente.';
export const MENSAJE_YA_CANCELADA = 'Esta factura ya está cancelada.';
export const MENSAJE_01_SIN_SUSTITUTO =
  'Para cancelar con motivo 01 primero hay que emitir la factura que la sustituye: usa ' +
  '"Refacturar", que emite el sustituto y después cancela ésta.';
export const MENSAJE_01_SUSTITUTO_EN_EMISION =
  'El sustituto de esta factura todavía se está emitiendo. Espera a que se confirme.';
export const MENSAJE_01_SUSTITUTO_CANCELADO =
  'El sustituto de esta factura está cancelado: cancélala con motivo 02 o 03.';
export const MENSAJE_01_SUSTITUTO_AJENO =
  'Ese folio fiscal no es el de la factura que sustituye a ésta (relación 04).';
export const MENSAJE_CON_SUSTITUTO =
  'Esta factura tiene una refacturación en curso o hecha: sólo se cancela con motivo 01 y el folio ' +
  'fiscal de su sustituto.';
export const MENSAJE_04_NO_GLOBAL =
  'El motivo 04 sólo aplica a una factura global (un ticket que se facturó a nombre de un cliente ' +
  'después de entrar a la global).';
export const MENSAJE_GLOBAL_SIN_SUSTITUCION =
  'Una factura global no se sustituye: cancélala con motivo 02, 03 o 04 y emite otra.';
export const MENSAJE_ANTERIOR_VIGENTE =
  'Esta factura sustituye a otra que sigue vigente (su cancelación con motivo 01 está pendiente). ' +
  'Primero termina esa cancelación.';
export const MENSAJE_PAC_NO_CONOCE =
  'El PAC no tiene registro de esta factura (p. ej. una factura de demostración que el PAC de prueba ' +
  'no emitió en esta corrida). No se canceló nada.';
export const MENSAJE_CANCELACION_INCIERTA =
  'El PAC no confirmó la cancelación a tiempo (pudo haberse registrado). No la vuelvas a pedir: en ' +
  'unos minutos pulsa "Actualizar estado".';
export const MENSAJE_PAC_CAIDO_CANCELACION =
  'El servicio de timbrado no está disponible. No se canceló nada: intenta de nuevo en unos minutos.';

/** Lo que hace falta saber de un CFDI para decidir si un motivo aplica (medido bajo candado). */
export interface CfdiACancelar {
  origen: 'ticket' | 'manual' | 'global';
  /** El CFDI que SUSTITUYE a éste (relación 04), si lo hay. */
  sustituto: { estado: 'timbrando' | 'vigente' | 'cancelado'; uuid: string | null } | null;
  /** El CFDI al que éste sustituye, si éste es un sustituto. */
  anterior: { estado: 'timbrando' | 'vigente' | 'cancelado' } | null;
}

/**
 * ¿Por qué NO se puede cancelar este CFDI con este motivo? Null = sí se puede. Todo es 409 (depende
 * del estado de la factura, no de la forma del pedido). `uuidSustitucion` ya viene en mayúsculas.
 */
export function conflictoDeMotivo(
  cfdi: CfdiACancelar,
  motivo: MotivoCancelacion,
  uuidSustitucion: string | null,
): string | null {
  if (cfdi.origen === 'global' && motivo === '01') return MENSAJE_GLOBAL_SIN_SUSTITUCION;
  if (cfdi.origen !== 'global' && motivo === '04') return MENSAJE_04_NO_GLOBAL;
  // Un sustituto cuyo anterior sigue vigente: soltar su código dejaría el ticket facturable con
  // la factura anterior todavía vigente.
  if (cfdi.anterior && cfdi.anterior.estado !== 'cancelado') return MENSAJE_ANTERIOR_VIGENTE;
  const sus = cfdi.sustituto;
  if (motivo === '01') {
    if (sus === null) return MENSAJE_01_SIN_SUSTITUTO;
    if (sus.estado === 'timbrando' || sus.uuid === null) return MENSAJE_01_SUSTITUTO_EN_EMISION;
    if (sus.estado === 'cancelado') return MENSAJE_01_SUSTITUTO_CANCELADO;
    if (sus.uuid.toUpperCase() !== uuidSustitucion) return MENSAJE_01_SUSTITUTO_AJENO;
    return null;
  }
  if (sus !== null && sus.estado !== 'cancelado') return MENSAJE_CON_SUSTITUTO;
  return null;
}

/** Lo que se hace con una solicitud abierta después de consultar al PAC. */
export type Resolucion = 'aceptada' | 'en_proceso' | 'rechazada' | 'no_procedio' | 'sin_cambio';

/**
 * Qué se concluye de una solicitud ABIERTA según lo que dice el PAC:
 * - `cancelado` → aceptada (el receptor aceptó, venció el plazo, o no hacía falta aceptación).
 * - `en_cancelacion` → en proceso (si ya lo estaba, nada cambia).
 * - `vigente` → si estaba `en_proceso`, el receptor la RECHAZÓ; si estaba `solicitando` y ya
 *   venció, la solicitud nunca llegó (se libera); si es reciente, puede ir en vuelo: nada.
 * - `no_encontrado` → nada (se anota el error; la solicitud no se toca a ciegas).
 */
export function resolucionDeConsulta(
  estado: EstadoSolicitudAbierta,
  pac: EstadoCfdi,
  vencida: boolean,
): Resolucion {
  if (pac === 'cancelado') return 'aceptada';
  if (pac === 'en_cancelacion') return estado === 'en_proceso' ? 'sin_cambio' : 'en_proceso';
  if (pac === 'vigente') {
    if (estado === 'en_proceso') return 'rechazada';
    return vencida ? 'no_procedio' : 'sin_cambio';
  }
  return 'sin_cambio';
}

/**
 * Qué le pasa al TICKET cuando la cancelación procede:
 * - `soltar_codigo`: motivo 02/03 de un CFDI que tiene el código del ticket (de un ticket, o el
 *   sustituto de una refacturación): el código vuelve a `pendiente` y el ticket se puede facturar
 *   otra vez (o, si ya venció, entra a una global).
 *   DECISION PROVISIONAL (nocturno): 02 y 03 sueltan por igual; la ficha dice "el cheque vuelve a
 *   ser facturable si la cancelación procede" sin distinguir (docs/esquema-sr.md §2).
 * - `soltar_global`: una factura GLOBAL cancelada (02/03/04) suelta todos sus tickets para que
 *   entren a otra global.
 * - `nada`: motivo 01 (el código ya pasó al sustituto al confirmarlo, F2-107), o un CFDI sin código
 *   (factura sin ticket).
 */
export function efectoEnTicket(
  motivo: MotivoCancelacion,
  origen: CfdiACancelar['origen'],
  tieneCodigo: boolean,
): 'soltar_codigo' | 'soltar_global' | 'nada' {
  if (origen === 'global') return motivo === '01' ? 'nada' : 'soltar_global';
  if ((motivo === '02' || motivo === '03') && tieneCodigo) return 'soltar_codigo';
  return 'nada';
}

/** Un ticket de una global cancelada, como se guarda en la solicitud (total como TEXTO). */
export interface TicketGlobalCancelado {
  codigoId: string;
  /** Dinero como texto decimal con 2 decimales ("123.45"), nunca número JSON. */
  total: string;
}

/** El error de un PAC como texto para guardar: código + mensaje recortado, sin saltos de línea. */
export function textoErrorPac(error: unknown): string {
  const codigo =
    typeof error === 'object' && error !== null && 'codigo' in error
      ? `${String((error as { codigo: unknown }).codigo)}: `
      : '';
  const mensaje = error instanceof Error ? error.message : String(error);
  return `${codigo}${mensaje}`.replace(/\s+/g, ' ').trim().slice(0, MAX_ERROR_CANCELACION);
}

export const NOMBRE_PLANTILLA_CANCELACION = 'factura-cancelada';

export interface DatosCorreoCancelacion {
  sucursal: string;
  color: string | null;
  emisor: string;
  uuid: string;
  serieFolio: string;
  /** Dinero como texto con 2 decimales. */
  total: string;
  motivo: MotivoCancelacion;
  /** Con motivo 01: el folio fiscal de la factura que la sustituye. */
  uuidSustitucion: string | null;
}

/**
 * El correo `factura-cancelada` al receptor: HTML con estilos en línea y su versión de texto, con
 * el mismo escape que `plantillaFactura` (F2-105). Nada de adjuntos: la factura ya no vale.
 */
export function plantillaCancelacion(d: DatosCorreoCancelacion): PlantillaCorreo {
  const e = escaparHtml;
  const color = (d.color && normalizarColor(d.color)) || COLOR_CORREO_POR_DEFECTO;
  const total = formatoPesos(d.total);
  const motivo = `${d.motivo} · ${TEXTO_MOTIVO[d.motivo]}`;
  const aviso =
    d.uuidSustitucion !== null
      ? `La sustituye la factura con folio fiscal ${d.uuidSustitucion}.`
      : 'Si necesitas una factura nueva, pídela en el restaurante con tu ticket.';
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
    '<p style="margin:0 0 12px;">Tu factura fue CANCELADA ante el SAT y ya no tiene validez ' +
    'fiscal.</p>' +
    '<table role="presentation" style="border-collapse:collapse;font-size:14px;">' +
    fila('Emisor', d.emisor) +
    fila('Folio fiscal (UUID)', d.uuid) +
    fila('Serie y folio', d.serieFolio) +
    fila('Total', total) +
    fila('Motivo', motivo) +
    '</table>' +
    `<p style="margin:16px 0 0;">${e(aviso)}</p>` +
    '</div></div></body></html>';
  const texto = [
    d.sucursal,
    '',
    'Tu factura fue CANCELADA ante el SAT y ya no tiene validez fiscal.',
    '',
    `Emisor: ${d.emisor}`,
    `Folio fiscal (UUID): ${d.uuid}`,
    `Serie y folio: ${d.serieFolio}`,
    `Total: ${total}`,
    `Motivo: ${motivo}`,
    '',
    aviso,
  ].join('\n');
  return {
    nombre: NOMBRE_PLANTILLA_CANCELACION,
    asunto: `Factura cancelada: ${d.serieFolio} de ${d.sucursal}`,
    html,
    texto,
  };
}
