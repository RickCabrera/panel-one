import type { FormaPago } from '../../api/tipos';

/**
 * Nombre visible de cada forma de pago, en la leyenda de la dona de Inicio (y en
 * donde se vuelva a necesitar). Completo, nunca abreviado: la tarjeta existe para
 * distinguir tarjeta de transferencia, y truncados salían los dos como `T…`
 * (revisión del 21/09, F2-203). `formasPago.test.ts` fija que no se repiten.
 */
export const NOMBRE_FORMA: Readonly<Record<FormaPago, string>> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  transferencia: 'Transferencia',
  otro: 'Otro',
};

export function etiquetaForma(forma: FormaPago): string {
  return NOMBRE_FORMA[forma];
}
