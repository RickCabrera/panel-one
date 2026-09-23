import type { ReceptorCfdi, RegimenFiscal, UsoCfdi } from '../../../api/tipos';
import { erroresReceptor, type ErroresReceptor } from '../../portal/reglas';

/**
 * Reglas puras de las emisiones del administrador (F2-107): factura sin ticket y refacturación.
 * Repiten las del api (`api/src/facturacion/cfdi.ts#totalManual` y `portal.ts#validarReceptor` con
 * correo opcional) para contestar al instante; la que manda es la del api.
 */

/** Hasta 6 enteros y 2 decimales: la misma regex del api. El total NUNCA pasa por `number`. */
const TOTAL = /^\d{1,6}(\.\d{1,2})?$/;
export const MENSAJE_TOTAL =
  'El total va en pesos con hasta dos decimales (p. ej. 1234.50), mayor que cero y menor que ' +
  '1,000,000.';

/** ¿Es un total válido? Mayor que cero comparando DÍGITOS (sin convertir a número). */
export function totalValido(texto: string): boolean {
  const t = texto.trim();
  return TOTAL.test(t) && /[1-9]/.test(t);
}

export type ErroresFactura = ErroresReceptor & { total?: string };

export interface FormReceptor {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  cp: string;
  usoCfdi: string;
  email: string;
}

export const FORM_RECEPTOR_VACIO: FormReceptor = {
  rfc: '',
  razonSocial: '',
  regimenFiscal: '',
  cp: '',
  usoCfdi: '',
  email: '',
};

/** El formulario a partir del receptor con que se timbró (precarga de la refacturación). */
export function formDeReceptor(r: ReceptorCfdi): FormReceptor {
  return { ...r, email: r.email ?? '' };
}

export function erroresReceptorAdmin(
  r: FormReceptor,
  regimenes: readonly RegimenFiscal[],
  usos: readonly UsoCfdi[],
): ErroresReceptor {
  return erroresReceptor(r, regimenes, usos, { emailOpcional: true });
}

/** El receptor que se manda al api: RFC en mayúsculas, recortado, sin correo si va vacío. */
export function receptorParaApi(r: FormReceptor): ReceptorCfdi {
  const email = r.email.trim();
  return {
    rfc: r.rfc.trim().toLocaleUpperCase('es-MX'),
    razonSocial: r.razonSocial.trim(),
    regimenFiscal: r.regimenFiscal,
    cp: r.cp.trim(),
    usoCfdi: r.usoCfdi,
    email: email.length > 0 ? email : null,
  };
}

const CAMPOS: readonly (keyof ErroresFactura)[] = [
  'rfc',
  'razonSocial',
  'regimenFiscal',
  'cp',
  'usoCfdi',
  'email',
  'total',
];

/** Los `campos` de un 400 del api (receptor y total), si vienen. */
export function camposFacturaDelApi(cuerpo: unknown): ErroresFactura | null {
  if (typeof cuerpo !== 'object' || cuerpo === null || !('campos' in cuerpo)) return null;
  const campos = (cuerpo as { campos: unknown }).campos;
  if (typeof campos !== 'object' || campos === null) return null;
  const e: ErroresFactura = {};
  for (const clave of CAMPOS) {
    const m = (campos as Record<string, unknown>)[clave];
    if (typeof m === 'string') e[clave] = m;
  }
  return Object.keys(e).length > 0 ? e : null;
}

/** Una llave de solicitud nueva para una captura (idempotencia del api). */
export function nuevaSolicitud(): string {
  return crypto.randomUUID();
}
