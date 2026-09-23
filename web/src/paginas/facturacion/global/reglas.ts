import type {
  EstadoPeriodoGlobal,
  PeriodicidadGlobal,
  ResumenPeriodoGlobal,
} from '../../../api/tipos';
import { fechaHoraEn, fechaParaTabla } from '../../tickets/formato';

/**
 * Reglas puras de la pestaña "Factura global" (F2-108). Las fechas se dicen en la zona de la
 * SUCURSAL, nunca en la del navegador.
 */

export const PERIODICIDADES: readonly { valor: PeriodicidadGlobal; texto: string }[] = [
  { valor: 'mensual', texto: 'Mensual' },
  { valor: 'semanal', texto: 'Semanal' },
  { valor: 'diaria', texto: 'Diaria' },
];

export const TEXTO_ESTADO: Readonly<Record<EstadoPeriodoGlobal, string>> = {
  lista: 'Lista para emitir',
  esperando: 'Esperando',
  en_curso: 'En curso',
  fuera_de_plazo: 'Fuera de plazo',
};

/** Una fecha (instante UTC) como `dd/mm/aaaa` en la zona de la sucursal. */
export function fechaEn(zona: string, instante: string): string {
  return fechaParaTabla(fechaHoraEn(zona, instante).fecha);
}

/**
 * Por qué un periodo está como está, en español y con qué hacer. Nunca un `0` mudo: un periodo sin
 * tickets para la global dice por qué.
 */
export function explicacionPeriodo(p: ResumenPeriodoGlobal, zona: string): string {
  const tickets = p.tickets === 1 ? '1 ticket' : `${p.tickets} tickets`;
  switch (p.estado) {
    case 'lista':
      return p.globalesPrevias > 0
        ? `Complementaria: este periodo ya tiene ${
            p.globalesPrevias === 1
              ? 'una factura global'
              : `${p.globalesPrevias} facturas globales`
          }; ${tickets} ${p.tickets === 1 ? 'llegó' : 'llegaron'} después o ${
            p.tickets === 1 ? 'quedó' : 'quedaron'
          } fuera. Revísalo antes de emitir otra.`
        : `${tickets} que nadie facturó a tiempo. Ya se puede emitir su factura global.`;
    case 'esperando':
      return (
        `El periodo terminó, pero ${
          p.vigentes === 1
            ? 'un ticket todavía se puede'
            : `${p.vigentes} tickets todavía se pueden`
        } facturar en el portal` +
        (p.vigentesHasta ? ` (hasta el ${fechaEn(zona, p.vigentesHasta)})` : '') +
        '. La factura global espera a que venza ese plazo.'
      );
    case 'en_curso':
      return p.vigentes > 0
        ? `El periodo no ha terminado; ${
            p.vigentes === 1 ? 'un ticket' : `${p.vigentes} tickets`
          } todavía se pueden facturar en el portal.`
        : 'El periodo no ha terminado.';
    case 'fuera_de_plazo':
      return (
        `${tickets} sin factura, pero el SAT ya no acepta una factura global de ese año (sólo del ` +
        'año en curso o del anterior). Revísalo con tu contador.'
      );
  }
}

/** ¿Se puede emitir desde aquí? Sólo un periodo `lista`. */
export const sePuedeEmitir = (p: { estado: EstadoPeriodoGlobal }) => p.estado === 'lista';

/** c_FormaPago → texto. */
export const FORMA_PAGO_TEXTO: Readonly<Record<string, string>> = {
  '01': 'Efectivo (01)',
  '03': 'Transferencia (03)',
  '04': 'Tarjeta (04)',
};
