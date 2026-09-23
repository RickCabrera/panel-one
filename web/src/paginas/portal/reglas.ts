import type {
  EstadoCodigoFacturacion,
  ReceptorPortal,
  RegimenFiscal,
  UsoCfdi,
} from '../../api/tipos';
import { contraste } from '../../tema/contraste';
import { BLANCO, NEGRO } from '../../tema/paleta';

/**
 * Reglas puras del portal público de autofactura (F2-103). La validación del receptor repite
 * la del api (`api/src/facturacion/portal.ts#validarReceptor`) para contestar al instante; la
 * que manda es la del api, y sus errores se pintan igual, campo por campo. Los catálogos llegan
 * del api (`GET /facturacion/catalogos-sat`): aquí no se copia ninguno.
 */

export type CampoReceptor = keyof ReceptorPortal;
export type ErroresReceptor = Partial<Record<CampoReceptor, string>>;

export const RECEPTOR_VACIO: ReceptorPortal = {
  rfc: '',
  razonSocial: '',
  regimenFiscal: '',
  cp: '',
  usoCfdi: '',
  email: '',
};

const RFC_GENERICOS = ['XAXX010101000', 'XEXX010101000'];
/** La forma del SAT (Anexo 20): la misma regex del api. */
const RFC_SAT = /^[A-ZÑ&]{3,4}\d{2}(0[1-9]|1[012])(0[1-9]|[12]\d|3[01])[A-Z0-9]{2}[0-9A]$/;
const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const normalizarRfc = (rfc: string) => rfc.trim().toLocaleUpperCase('es-MX');

/** El código como lo teclea alguien: sin espacios y en mayúsculas (9 de A–Z y 2–9). */
export const normalizarCodigo = (texto: string) => texto.replace(/\s+/g, '').toUpperCase();
export const esCodigoValido = (codigo: string) => /^[A-HJ-NP-Z2-9]{9}$/.test(codigo);

/** Moral (12) o física (13); null si todavía no tiene la forma del SAT. */
export function tipoPersona(rfc: string): 'moral' | 'fisica' | null {
  const r = normalizarRfc(rfc);
  if (!RFC_SAT.test(r)) return null;
  return r.length === 12 ? 'moral' : 'fisica';
}

/** Los regímenes que aplican al RFC escrito; con un RFC incompleto, todos. */
export function regimenesPara(rfc: string, regimenes: readonly RegimenFiscal[]): RegimenFiscal[] {
  const tipo = tipoPersona(rfc);
  if (tipo === null) return [...regimenes];
  return regimenes.filter((r) => (tipo === 'moral' ? r.moral : r.fisica));
}

/** Los usos que el SAT acepta con ese régimen (y tipo de persona); sin régimen, ninguno. */
export function usosPara(rfc: string, regimen: string, usos: readonly UsoCfdi[]): UsoCfdi[] {
  if (!regimen) return [];
  const tipo = tipoPersona(rfc);
  return usos.filter(
    (u) =>
      u.regimenes.includes(regimen) && (tipo === null || (tipo === 'moral' ? u.moral : u.fisica)),
  );
}

/**
 * Todos los errores a la vez, uno por campo, con los MISMOS textos que el api (así da igual
 * quién lo detecte).
 */
export function erroresReceptor(
  r: ReceptorPortal,
  regimenes: readonly RegimenFiscal[],
  usos: readonly UsoCfdi[],
): ErroresReceptor {
  const e: ErroresReceptor = {};
  const rfc = normalizarRfc(r.rfc);
  const tipo = tipoPersona(rfc);
  if (rfc.length === 0) e.rfc = 'Escribe tu RFC.';
  else if (RFC_GENERICOS.includes(rfc)) {
    e.rfc =
      'Ese es el RFC genérico de público en general: una factura a tu nombre necesita tu RFC.';
  } else if (tipo === null) {
    e.rfc =
      'El RFC no tiene la forma correcta: 12 caracteres (empresa) o 13 (persona física), como ' +
      'aparece en tu constancia de situación fiscal.';
  }

  const razon = r.razonSocial.trim();
  if (razon.length === 0) {
    e.razonSocial = 'Escribe tu nombre o razón social tal como está en tu constancia.';
  } else if (razon.length > 254) {
    e.razonSocial = 'El nombre o razón social admite hasta 254 caracteres.';
  }

  const regimen = regimenes.find((x) => x.clave === r.regimenFiscal);
  if (!regimen) e.regimenFiscal = 'Elige tu régimen fiscal.';
  else if (tipo !== null && !(tipo === 'moral' ? regimen.moral : regimen.fisica)) {
    e.regimenFiscal =
      tipo === 'moral'
        ? 'Ese régimen es de persona física y tu RFC es de empresa (persona moral).'
        : 'Ese régimen es de persona moral y tu RFC es de persona física.';
  }

  if (!/^\d{5}$/.test(r.cp.trim()))
    e.cp = 'El código postal de tu domicilio fiscal tiene 5 dígitos.';

  const uso = usos.find((x) => x.clave === r.usoCfdi);
  if (!uso) e.usoCfdi = 'Elige el uso que le darás a la factura.';
  else if (
    regimen &&
    tipo !== null &&
    e.regimenFiscal === undefined &&
    !usosPara(rfc, r.regimenFiscal, usos).some((u) => u.clave === uso.clave)
  ) {
    e.usoCfdi = 'Ese uso no aplica a tu régimen fiscal. Elige otro de la lista.';
  }

  const email = r.email.trim();
  if (email.length === 0) e.email = 'Escribe el correo al que te enviaremos la factura.';
  else if (email.length > 254 || !REGEX_EMAIL.test(email)) {
    e.email = 'El correo no tiene la forma correcta (p. ej. nombre@dominio.com).';
  }
  return e;
}

/** Los `campos` de un 400 del api, si vienen (sólo los que conoce el formulario). */
export function camposDelApi(cuerpo: unknown): ErroresReceptor | null {
  if (typeof cuerpo !== 'object' || cuerpo === null || !('campos' in cuerpo)) return null;
  const campos = (cuerpo as { campos: unknown }).campos;
  if (typeof campos !== 'object' || campos === null) return null;
  const e: ErroresReceptor = {};
  for (const clave of Object.keys(RECEPTOR_VACIO) as CampoReceptor[]) {
    const m = (campos as Record<string, unknown>)[clave];
    if (typeof m === 'string') e[clave] = m;
  }
  return Object.keys(e).length > 0 ? e : null;
}

/** El `estado` de un 409 del api, si viene. */
export function estadoDelApi(cuerpo: unknown): EstadoCodigoFacturacion | null {
  if (typeof cuerpo !== 'object' || cuerpo === null || !('estado' in cuerpo)) return null;
  const estado = (cuerpo as { estado: unknown }).estado;
  return typeof estado === 'string' && Object.hasOwn(QUE_HACER, estado)
    ? (estado as EstadoCodigoFacturacion)
    : null;
}

/**
 * Qué puede hacer el cliente con cada estado que no se factura. Nada de esto afirma algo que el
 * sistema no hizo: hoy no hay CFDI guardados ni correos enviados (F2-104/F2-105), así que un
 * `facturado` no dice "te la mandamos": dice a quién pedírsela.
 */
export const QUE_HACER: Readonly<Record<EstadoCodigoFacturacion, string>> = {
  pendiente: '',
  facturado:
    'Si no recibiste tu factura o necesitas otra copia, pídela en el restaurante con tu ticket.',
  en_global:
    'Las ventas que no se facturaron a tiempo se incluyen en la factura global del restaurante. ' +
    'Si necesitas una aclaración, pregunta en el restaurante.',
  expirado:
    'El restaurante ya no puede emitir la factura de este ticket en línea. Pregunta en el ' +
    'restaurante si todavía hay forma de hacerlo.',
  cancelado: 'Si pagaste esta cuenta, pide en el restaurante que revisen tu ticket.',
};

/**
 * Negro o blanco sobre el color de la marca, el que más contraste dé: la misma regla que
 * `sobre-acento` del tema (F2-211). El color ya viene validado por el api (CHECK `#rrggbb`); si
 * aun así no lo es, blanco.
 */
export function textoSobre(color: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return BLANCO;
  return contraste(BLANCO, color) >= contraste(NEGRO, color) ? BLANCO : NEGRO;
}

/** Las iniciales de la sucursal, para cuando no hay logo. */
export function iniciales(nombre: string): string {
  const palabras = nombre
    .split(/\s+/)
    .filter((p) => p.length > 0 && !/^(sucursal|de|del|la|el|los|las|y)$/i.test(p));
  const base = palabras.length > 0 ? palabras : nombre.split(/\s+/).filter(Boolean);
  return base
    .slice(0, 2)
    .map((p) => p[0]!.toLocaleUpperCase('es-MX'))
    .join('');
}

/** Fecha y hora del ticket en la zona de la sucursal: "15 de septiembre de 2026, 14:00". */
export function fechaTicket(iso: string, zona: string): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: zona,
    dateStyle: 'long',
    timeStyle: 'short',
  }).format(new Date(iso));
}

/**
 * El último día en que todavía se puede facturar. `expiraAt` es EXCLUSIVO: el día que se muestra
 * es el del instante anterior, en la zona de la sucursal.
 */
export function ultimoDia(expiraAt: string, zona: string): string {
  return new Intl.DateTimeFormat('es-MX', { timeZone: zona, dateStyle: 'long' }).format(
    new Date(Date.parse(expiraAt) - 1),
  );
}
