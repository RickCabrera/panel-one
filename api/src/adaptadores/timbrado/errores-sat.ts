import type { CodigoErrorTimbrado } from './puerto';

/**
 * La tabla de errores del timbrado que se le traducen al cliente (F2-104). El PAC (Facturama)
 * reenvía las validaciones del SAT como texto; aquí se reconoce CUÁL es y se cambia por un mensaje
 * que una persona entiende, con el campo del portal que lo corrige. El texto crudo del PAC nunca
 * llega al cliente: se queda en el log del servidor.
 *
 * Se reconoce por dos cosas, en este orden:
 * 1. El código de la matriz de errores del Anexo 20 del CFDI 4.0 (`CFDI40xxx`), si el texto lo
 *    trae.
 * 2. El NOMBRE DEL ATRIBUTO del XML que el mensaje del SAT cita (`DomicilioFiscalReceptor`,
 *    `RegimenFiscalReceptor`, `UsoCFDI`, el `Nombre` o el `Rfc` del receptor). Las validaciones del
 *    SAT siempre nombran el atributo, y eso no depende de la redacción del PAC.
 *
 * SUPUESTO NO VALIDADO (se confirma en F2-190 contra apisandbox.facturama.mx): los códigos y los
 * textos salen de la matriz de errores publicada por el SAT para CFDI 4.0 y de la documentación
 * pública de Facturama, no de una respuesta real. Cada diferencia se corrige AQUÍ y en
 * `errores-sat.spec.ts`. Lo que no se reconoce queda como `RECHAZADO_POR_PAC` con un mensaje
 * genérico (nunca el crudo).
 */

/** El campo del portal (F2-103) que corrige el error. */
export type CampoReceptorSat = 'rfc' | 'razonSocial' | 'cp' | 'regimenFiscal' | 'usoCfdi';

export interface ErrorSatConocido {
  codigo: CodigoErrorTimbrado;
  campo: CampoReceptorSat;
  mensaje: string;
}

export const MENSAJES_SAT = {
  RFC_NO_INSCRITO:
    'El SAT no encuentra ese RFC entre los contribuyentes inscritos. Revísalo contra tu ' +
    'constancia de situación fiscal.',
  NOMBRE_NO_COINCIDE:
    'El nombre no coincide con el que el SAT tiene registrado para ese RFC. Escríbelo exactamente ' +
    'como aparece en tu constancia de situación fiscal (sin "S.A. de C.V." ni abreviaturas).',
  CODIGO_POSTAL_NO_COINCIDE:
    'El código postal no coincide con el domicilio fiscal que el SAT tiene para ese RFC. Usa el ' +
    'de tu constancia de situación fiscal.',
  REGIMEN_NO_CORRESPONDE:
    'El régimen fiscal no corresponde al que el SAT tiene registrado para ese RFC. Revisa tu ' +
    'constancia de situación fiscal.',
  USO_CFDI_NO_APLICA:
    'El SAT no acepta ese uso de la factura con tu régimen fiscal. Elige otro uso.',
} as const satisfies Partial<Record<CodigoErrorTimbrado, string>>;

/** Lo que se dice cuando el PAC rechaza por algo que no está en la tabla. */
export const MENSAJE_RECHAZO_GENERICO =
  'El SAT no aceptó la factura con estos datos. Revísalos contra tu constancia de situación ' +
  'fiscal; si todo está bien, pide tu factura en el restaurante.';

const conocido = (
  codigo: keyof typeof MENSAJES_SAT,
  campo: CampoReceptorSat,
): ErrorSatConocido => ({ codigo, campo, mensaje: MENSAJES_SAT[codigo] });

/**
 * Matriz de errores del Anexo 20 (CFDI 4.0) que tocan al receptor. SUPUESTO NO VALIDADO: la
 * numeración es la publicada por el SAT; F2-190 la confirma con respuestas reales.
 */
export const CODIGOS_SAT: Readonly<Record<string, ErrorSatConocido>> = {
  // "El campo Rfc del receptor … no se encuentra en la lista de RFC inscritos no cancelados".
  CFDI40144: conocido('RFC_NO_INSCRITO', 'rfc'),
  // "El campo Nombre del receptor, debe pertenecer al nombre asociado al RFC …".
  CFDI40145: conocido('NOMBRE_NO_COINCIDE', 'razonSocial'),
  // "El campo DomicilioFiscalReceptor del receptor, debe pertenecer al … RFC …".
  CFDI40147: conocido('CODIGO_POSTAL_NO_COINCIDE', 'cp'),
  // "El campo RegimenFiscalReceptor, debe corresponder con el tipo de persona / el RFC …".
  CFDI40157: conocido('REGIMEN_NO_CORRESPONDE', 'regimenFiscal'),
  CFDI40158: conocido('REGIMEN_NO_CORRESPONDE', 'regimenFiscal'),
  // "El campo UsoCFDI … debe corresponder con el tipo de persona / el régimen del receptor".
  CFDI40161: conocido('USO_CFDI_NO_APLICA', 'usoCfdi'),
  CFDI40162: conocido('USO_CFDI_NO_APLICA', 'usoCfdi'),
};

/**
 * Por el atributo que cita el mensaje. El orden importa: `RegimenFiscalReceptor` y
 * `DomicilioFiscalReceptor` van antes que el `Nombre`/`Rfc` genéricos del receptor.
 */
const POR_ATRIBUTO: ReadonlyArray<{ patron: RegExp; error: ErrorSatConocido }> = [
  {
    patron: /DomicilioFiscalReceptor|TaxZipCode/i,
    error: conocido('CODIGO_POSTAL_NO_COINCIDE', 'cp'),
  },
  {
    patron: /RegimenFiscalReceptor|Receiver\.FiscalRegime/i,
    error: conocido('REGIMEN_NO_CORRESPONDE', 'regimenFiscal'),
  },
  { patron: /UsoCFDI|CfdiUse/i, error: conocido('USO_CFDI_NO_APLICA', 'usoCfdi') },
  {
    patron: /(campo|atributo)\s+Nombre\s+del\s+receptor|Receiver\.Name/i,
    error: conocido('NOMBRE_NO_COINCIDE', 'razonSocial'),
  },
  {
    patron: /lista\s+de\s+RFC\s+inscritos|RFC\s+del\s+receptor|Receiver\.Rfc/i,
    error: conocido('RFC_NO_INSCRITO', 'rfc'),
  },
];

/** El error conocido que describe el texto del PAC, o null si no está en la tabla. */
export function errorSatConocido(texto: string): ErrorSatConocido | null {
  for (const m of texto.matchAll(/CFDI40\d{3}/g)) {
    const porCodigo = CODIGOS_SAT[m[0]];
    if (porCodigo) return porCodigo;
  }
  return POR_ATRIBUTO.find((r) => r.patron.test(texto))?.error ?? null;
}

/**
 * Los códigos del puerto que describen un dato del RECEPTOR que se corrige en el portal, y el
 * campo que lo corrige. Lo usa la emisión para contestar 400 con `campos`.
 */
export const CAMPO_DE_ERROR: Readonly<Partial<Record<CodigoErrorTimbrado, CampoReceptorSat>>> = {
  RFC_NO_INSCRITO: 'rfc',
  NOMBRE_NO_COINCIDE: 'razonSocial',
  CODIGO_POSTAL_NO_COINCIDE: 'cp',
  REGIMEN_NO_CORRESPONDE: 'regimenFiscal',
  USO_CFDI_NO_APLICA: 'usoCfdi',
};
