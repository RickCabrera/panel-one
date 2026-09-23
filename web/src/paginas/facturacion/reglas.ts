import type { RegimenFiscal } from '../../api/tipos';

/**
 * Reglas puras de la vista de datos fiscales (F2-100): la vigencia del CSD y su alerta, los
 * formatos del SAT que se validan antes de mandar, y el paso de un archivo a base64.
 */

/** Faltan MENOS de estos días para que venza: alerta. */
export const DIAS_ALERTA_CSD = 30;
const DIA_MS = 24 * 60 * 60 * 1000;

export type EstadoVigencia =
  { tipo: 'vigente'; dias: number } | { tipo: 'por_vencer'; dias: number } | { tipo: 'vencido' };

/**
 * La vigencia del CSD a partir de su metadata: días COMPLETOS que faltan (hacia abajo). Faltan
 * 30 días exactos = sin alerta; un instante menos = alerta; en el instante de vencer, vencido.
 */
export function estadoVigencia(vigenteHasta: string, ahora: Date): EstadoVigencia {
  const faltan = Date.parse(vigenteHasta) - ahora.getTime();
  if (!(faltan > 0)) return { tipo: 'vencido' };
  const dias = Math.floor(faltan / DIA_MS);
  return faltan < DIAS_ALERTA_CSD * DIA_MS
    ? { tipo: 'por_vencer', dias }
    : { tipo: 'vigente', dias };
}

/** "vence en 1 día" / "vence en 29 días" / "vence en menos de un día". */
export function textoDias(dias: number): string {
  if (dias === 0) return 'vence en menos de un día';
  return `vence en ${dias} día${dias === 1 ? '' : 's'}`;
}

/** Una fecha (UTC) como la lee una persona en México: "12 de octubre de 2026". */
export function fechaLarga(iso: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: 'America/Mexico_City',
    dateStyle: 'long',
  }).format(new Date(iso));
}

export const normalizarRfc = (rfc: string) => rfc.trim().toLocaleUpperCase('es-MX');

const RFC_GENERICOS = ['XAXX010101000', 'XEXX010101000'];

/** Moral (12) o física (13) según el formato del SAT; null si no tiene forma de RFC. */
export function tipoPersona(rfc: string): 'moral' | 'fisica' | null {
  const r = normalizarRfc(rfc);
  if (/^[A-ZÑ&]{3}\d{6}[A-Z0-9]{3}$/.test(r)) return 'moral';
  if (/^[A-ZÑ&]{4}\d{6}[A-Z0-9]{3}$/.test(r)) return 'fisica';
  return null;
}

/** Los regímenes que aplican al RFC escrito; con un RFC incompleto, todos. */
export function regimenesPara(rfc: string, regimenes: readonly RegimenFiscal[]): RegimenFiscal[] {
  const tipo = tipoPersona(rfc);
  if (tipo === null) return [...regimenes];
  return regimenes.filter((r) => (tipo === 'moral' ? r.moral : r.fisica));
}

export interface FormPerfil {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  cp: string;
  serie: string;
}

/** Errores campo por campo, en español, antes de mandar (el api valida lo mismo). */
export function erroresPerfil(
  f: FormPerfil,
  regimenes: readonly RegimenFiscal[],
): Partial<Record<keyof FormPerfil, string>> {
  const e: Partial<Record<keyof FormPerfil, string>> = {};
  const tipo = tipoPersona(f.rfc);
  if (tipo === null) {
    e.rfc = 'El RFC debe tener 12 caracteres (persona moral) o 13 (persona física).';
  } else if (RFC_GENERICOS.includes(normalizarRfc(f.rfc))) {
    e.rfc = 'Un RFC genérico no puede ser el emisor.';
  }
  if (f.razonSocial.trim() === '') e.razonSocial = 'Escribe la razón social.';
  if (f.regimenFiscal === '') {
    e.regimenFiscal = 'Elige el régimen fiscal.';
  } else if (tipo !== null && regimenes.length > 0) {
    const r = regimenes.find((x) => x.clave === f.regimenFiscal);
    if (!r || !(tipo === 'moral' ? r.moral : r.fisica)) {
      e.regimenFiscal = `Ese régimen no aplica a persona ${tipo === 'moral' ? 'moral' : 'física'}.`;
    }
  }
  if (!/^\d{5}$/.test(f.cp.trim())) e.cp = 'El código postal lleva 5 dígitos.';
  if (!/^[A-Za-z0-9]{1,25}$/.test(f.serie.trim())) {
    e.serie = 'La serie lleva de 1 a 25 letras o números.';
  }
  return e;
}

/** Tope de cada archivo del CSD (el mismo del api). */
export const MAX_BYTES_ARCHIVO_CSD = 16 * 1024;

/** Un archivo en base64, sin cabecera `data:`. */
export function aBase64(bytes: ArrayBuffer): string {
  const u8 = new Uint8Array(bytes);
  let binario = '';
  for (let i = 0; i < u8.length; i += 0x8000) {
    binario += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  }
  return btoa(binario);
}

// --- F2-103: el portal de autofactura de cada sucursal ------------------------------------

/** Tope del logo del portal (el api repite la regla con sus bytes). */
export const MAX_BYTES_LOGO = 200 * 1024;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** Sugerencia de enlace a partir del nombre: "Sucursal Centro" → "centro". */
export function sugerirSlug(nombre: string): string {
  const base = nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\bsucursal\b/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return base.length >= 3 ? base : `${base}-portal`.replace(/^-/, '');
}

/** El mismo formato que exige el api (y un CHECK de la base). */
export function errorSlug(slug: string): string | null {
  if (slug.length < 3 || slug.length > 40 || !SLUG.test(slug)) {
    return 'De 3 a 40 caracteres: minúsculas, números y guiones entre palabras.';
  }
  return null;
}
