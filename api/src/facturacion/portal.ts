/**
 * Reglas puras del portal público de autofactura (F2-103): el slug y la marca de cada sucursal,
 * el logo que se acepta, y la validación de los datos del receptor campo por campo. Sin base.
 */

import {
  esRfcValidoSat,
  normalizarRfc,
  REGIMENES_FISCALES,
  RFC_GENERICOS,
  regimenAplica,
  tipoPersona,
  USOS_CFDI,
  usoAplica,
} from './sat';

/** `centro`, `demo-norte-2`: minúsculas, dígitos y guiones sueltos entre palabras. */
const REGEX_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 40;
export const MENSAJE_SLUG =
  `El enlace del portal lleva de ${SLUG_MIN} a ${SLUG_MAX} caracteres: minúsculas, números y ` +
  'guiones entre palabras (p. ej. "centro" o "demo-norte").';

export function esSlugValido(slug: string): boolean {
  return slug.length >= SLUG_MIN && slug.length <= SLUG_MAX && REGEX_SLUG.test(slug);
}

/** `#0F766E` → `#0f766e`; null si no es un color hexadecimal de 6 dígitos. */
export function normalizarColor(texto: string): string | null {
  const c = texto.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(c) ? c : null;
}

/** El logo pesa como mucho esto (decodificado). La base lo repite en un CHECK. */
export const MAX_BYTES_LOGO = 200 * 1024;
export type TipoLogo = 'image/png' | 'image/jpeg' | 'image/webp';

/**
 * El tipo del logo por sus primeros bytes, no por lo que diga quien lo sube. SVG (y cualquier
 * otra cosa) se rechaza: un SVG puede llevar script y el logo se sirve en una ruta pública.
 */
export function tipoDeLogo(bytes: Buffer): TipoLogo | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(FIRMA_PNG)) return 'image/png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('latin1') === 'RIFF' &&
    bytes.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}
const FIRMA_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Los datos del receptor como llegan del portal (ya recortados por el DTO, sin validar). */
export interface ReceptorPortal {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  cp: string;
  usoCfdi: string;
  email: string;
}

export type CampoReceptor = keyof ReceptorPortal;
export type ErroresReceptor = Partial<Record<CampoReceptor, string>>;

export const RAZON_SOCIAL_MAX = 254;
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const EMAIL_MAX = 254;

/**
 * Valida TODOS los campos a la vez y devuelve un mensaje en español por campo con error (vacío =
 * todo bien). La web aplica las mismas reglas para contestar al instante, pero la que manda es
 * ésta. El RFC se valida ya normalizado (mayúsculas, sin espacios alrededor).
 */
export function validarReceptor(
  r: ReceptorPortal,
  /** F2-107: el administrador puede facturar sin correo (entonces no se envía). */
  opciones: { emailOpcional?: boolean } = {},
): ErroresReceptor {
  const errores: ErroresReceptor = {};
  const rfc = normalizarRfc(r.rfc);
  const tipo = tipoPersona(rfc);
  if (rfc.length === 0) {
    errores.rfc = 'Escribe tu RFC.';
  } else if (RFC_GENERICOS.includes(rfc)) {
    errores.rfc =
      'Ese es el RFC genérico de público en general: una factura a tu nombre necesita tu RFC.';
  } else if (!esRfcValidoSat(rfc) || tipo === null) {
    errores.rfc =
      'El RFC no tiene la forma correcta: 12 caracteres (empresa) o 13 (persona física), como ' +
      'aparece en tu constancia de situación fiscal.';
  }

  const razon = r.razonSocial.trim();
  if (razon.length === 0) {
    errores.razonSocial = 'Escribe tu nombre o razón social tal como está en tu constancia.';
  } else if (razon.length > RAZON_SOCIAL_MAX) {
    errores.razonSocial = `El nombre o razón social admite hasta ${RAZON_SOCIAL_MAX} caracteres.`;
  }

  const regimenExiste = REGIMENES_FISCALES.some((x) => x.clave === r.regimenFiscal);
  if (!regimenExiste) {
    errores.regimenFiscal = 'Elige tu régimen fiscal.';
  } else if (tipo !== null && !regimenAplica(r.regimenFiscal, tipo)) {
    errores.regimenFiscal =
      tipo === 'moral'
        ? 'Ese régimen es de persona física y tu RFC es de empresa (persona moral).'
        : 'Ese régimen es de persona moral y tu RFC es de persona física.';
  }

  if (!/^\d{5}$/.test(r.cp)) {
    errores.cp = 'El código postal de tu domicilio fiscal tiene 5 dígitos.';
  }

  const usoExiste = USOS_CFDI.some((x) => x.clave === r.usoCfdi);
  if (!usoExiste) {
    errores.usoCfdi = 'Elige el uso que le darás a la factura.';
  } else if (
    regimenExiste &&
    tipo !== null &&
    errores.regimenFiscal === undefined &&
    !usoAplica(r.usoCfdi, r.regimenFiscal, tipo)
  ) {
    errores.usoCfdi = 'Ese uso no aplica a tu régimen fiscal. Elige otro de la lista.';
  }

  const email = r.email.trim();
  if (email.length === 0) {
    if (!opciones.emailOpcional)
      errores.email = 'Escribe el correo al que te enviaremos la factura.';
  } else if (email.length > EMAIL_MAX || !REGEX_EMAIL.test(email)) {
    errores.email = 'El correo no tiene la forma correcta (p. ej. nombre@dominio.com).';
  }
  return errores;
}
