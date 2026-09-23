import type { CfdiFila, MotivoCancelacion, SolicitudCancelacion } from '../../../api/tipos';

/**
 * Reglas puras de la cancelación de una factura (F2-109). Repiten las del api
 * (`api/src/facturacion/cancelacion.ts#conflictoDeMotivo`) para contestar al instante; la que manda
 * es la del api (que además las mide bajo candado).
 */

/** c_MotivoCancelacion del SAT, con el texto que se muestra. */
export const TEXTO_MOTIVO: Readonly<Record<MotivoCancelacion, string>> = {
  '01': 'Comprobante emitido con errores con relación (se sustituye)',
  '02': 'Comprobante emitido con errores sin relación',
  '03': 'No se llevó a cabo la operación',
  '04': 'Operación nominativa relacionada en una factura global',
};

/** Los motivos que aplican: una global no se sustituye (sin 01); el 04 es SÓLO de una global. */
export function motivosPara(c: Pick<CfdiFila, 'origen'>): MotivoCancelacion[] {
  return c.origen === 'global' ? ['02', '03', '04'] : ['01', '02', '03'];
}

/**
 * ¿Se le ofrece "Cancelar"? Vigente y sin una solicitud abierta (una rechazada sí se puede volver a
 * pedir). Con una abierta se ofrece "Actualizar estado".
 */
export function puedeCancelar(c: Pick<CfdiFila, 'estado' | 'cancelacion'>): boolean {
  return c.estado === 'vigente' && (c.cancelacion === null || c.cancelacion.estado === 'rechazada');
}

/** ¿Tiene una solicitud de cancelación abierta (hay que consultar)? */
export function cancelacionAbierta(c: Pick<CfdiFila, 'estado' | 'cancelacion'>): boolean {
  return (
    c.estado === 'vigente' &&
    (c.cancelacion?.estado === 'solicitando' || c.cancelacion?.estado === 'en_proceso')
  );
}

export const MENSAJE_01_SIN_SUSTITUTO =
  'Para cancelar con motivo 01 primero hay que emitir la factura que la sustituye. Usa ' +
  '"Refacturar": emite el sustituto y después cancela ésta con motivo 01.';
export const MENSAJE_CON_SUSTITUTO =
  'Esta factura ya tiene un sustituto: sólo se cancela con motivo 01 (terminar la sustitución).';

/**
 * Lo que se mandaría al api con este motivo, o por qué no se puede continuar. Con motivo 01 el
 * UUID es el del sustituto que dejó la refacturación (vigente con la cancelación pendiente); sin
 * él, el formulario NO deja continuar.
 */
export function pedidoCancelacion(
  c: Pick<CfdiFila, 'origen' | 'sustituidoPor' | 'sustitucionPendiente'>,
  motivo: MotivoCancelacion | null,
): { ok: true; pedido: SolicitudCancelacion } | { ok: false; razon: string | null } {
  if (motivo === null) return { ok: false, razon: null };
  if (!motivosPara(c).includes(motivo)) {
    return { ok: false, razon: 'Ese motivo no aplica a esta factura.' };
  }
  const conSustituto = c.sustitucionPendiente && c.sustituidoPor !== null;
  if (motivo === '01') {
    return conSustituto
      ? { ok: true, pedido: { motivo, uuidSustitucion: c.sustituidoPor! } }
      : { ok: false, razon: MENSAJE_01_SIN_SUSTITUTO };
  }
  if (conSustituto) return { ok: false, razon: MENSAJE_CON_SUSTITUTO };
  return { ok: true, pedido: { motivo } };
}

/** El texto de una solicitud sin resolver, para la tabla. */
export function textoCancelacion(c: NonNullable<CfdiFila['cancelacion']>): string {
  switch (c.estado) {
    case 'en_proceso':
      return `Cancelación en proceso (motivo ${c.motivo}): espera la respuesta del receptor`;
    case 'solicitando':
      return `Cancelación sin confirmar (motivo ${c.motivo}): consulta su estado`;
    case 'rechazada':
      return `El receptor rechazó la cancelación (motivo ${c.motivo})`;
  }
}
