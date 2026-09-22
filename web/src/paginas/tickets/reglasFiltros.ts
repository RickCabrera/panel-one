import {
  importesInvertidos,
  limpiarImporte,
  type Canceladas,
  type FiltrosTickets,
} from '../../filtros/tickets';
import { etiquetaForma } from '../inicio/formasPago';

/** Reglas del panel de filtros de Tickets (F2-222), fuera del componente para probarlas solas. */

export const ETIQUETA_CANCELADAS: Readonly<Record<Canceladas, string>> = {
  incluir: 'Incluir canceladas',
  excluir: 'Sin canceladas',
  solo: 'Sólo canceladas',
};

/** Los filtros aplicados, como texto corto para la lista de "activos". */
export function activos(
  filtros: FiltrosTickets,
): Array<{ llave: keyof FiltrosTickets; texto: string }> {
  const lista: Array<{ llave: keyof FiltrosTickets; texto: string }> = [];
  if (filtros.mesero) lista.push({ llave: 'mesero', texto: `Mesero: ${filtros.mesero}` });
  if (filtros.mesa) lista.push({ llave: 'mesa', texto: `Mesa: ${filtros.mesa}` });
  if (filtros.forma) lista.push({ llave: 'forma', texto: `Pago: ${etiquetaForma(filtros.forma)}` });
  if (filtros.importeMin)
    lista.push({ llave: 'importeMin', texto: `Desde $${filtros.importeMin}` });
  if (filtros.importeMax)
    lista.push({ llave: 'importeMax', texto: `Hasta $${filtros.importeMax}` });
  if (filtros.canceladas !== 'incluir') {
    lista.push({ llave: 'canceladas', texto: ETIQUETA_CANCELADAS[filtros.canceladas] });
  }
  if (filtros.producto) lista.push({ llave: 'producto', texto: `Producto: ${filtros.producto}` });
  return lista;
}

/** El error de validación del borrador, o null si se puede aplicar. */
export function errorDe(borrador: FiltrosTickets): string | null {
  for (const [importe, nombre] of [
    [borrador.importeMin, 'mínimo'],
    [borrador.importeMax, 'máximo'],
  ] as const) {
    if (importe.trim() && !limpiarImporte(importe)) {
      return `El importe ${nombre} debe ser una cantidad en pesos con hasta 2 decimales (p. ej. 150 o 99.50).`;
    }
  }
  if (
    importesInvertidos(limpiarImporte(borrador.importeMin), limpiarImporte(borrador.importeMax))
  ) {
    return 'El importe mínimo no puede ser mayor que el máximo.';
  }
  return null;
}
