import type { PagoTicket, Sucursal, Ticket } from '../../api/tipos';

/**
 * El instante que ubica al ticket: su cierre, o su apertura si es un cancelado que
 * nunca se cerró (el mismo criterio con el que la API los ordena).
 */
export function momentoDe(ticket: Ticket): string {
  return ticket.cerradoAt ?? ticket.abiertoAt;
}

export interface FechaHora {
  /** `YYYY-MM-DD`: ISO, para que Excel en México no lo lea como mes/día. */
  fecha: string;
  /** `hh:mm`, 24 h. */
  hora: string;
}

/**
 * Fecha y hora LOCALES de un instante UTC en la zona de la sucursal. Nunca la zona
 * del navegador ni UTC: un ticket de las 21:30 en CDMX ya es "mañana" en UTC.
 */
export function fechaHoraEn(zona: string, instante: string): FechaHora {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(instante));
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return {
    fecha: `${valor('year')}-${valor('month')}-${valor('day')}`,
    hora: `${valor('hour')}:${valor('minute')}`,
  };
}

/**
 * La fecha y hora de un ticket en SU sucursal. Si la sucursal no está en la lista
 * de `/sucursales` no hay zona confiable: `null` ("Sin dato"), nunca la del
 * navegador ni UTC.
 */
export function fechaHoraDe(
  ticket: Ticket,
  sucursales: ReadonlyMap<string, Sucursal>,
): FechaHora | null {
  const sucursal = sucursales.get(ticket.sucursalId);
  return sucursal ? fechaHoraEn(sucursal.zonaHoraria, momentoDe(ticket)) : null;
}

/** `2026-09-20` → `20/09/2026`, sólo para la tabla (el CSV va en ISO). */
export function fechaParaTabla(fecha: string): string {
  const [anio, mes, dia] = fecha.split('-');
  return `${dia}/${mes}/${anio}`;
}

/**
 * Las formas de pago de un ticket con el texto de SR (`formaRaw`), sin repetir y en
 * el orden en que llegaron: `"EFECTIVO + TARJETA DE CREDITO"`. Sin pagos → `""`.
 *
 * DECISION PROVISIONAL (nocturno): se muestra el texto crudo de SR, no el ENUM
 * derivado del catálogo (`forma`), porque es lo que el gerente ve en el POS y
 * porque un texto sin catálogo saldría como un "otro" que no dice nada. Si Ricardo
 * prefiere el ENUM, sólo cambia esta función (docs/nocturno-log.md, F1-042).
 */
export function formasDePago(pagos: readonly PagoTicket[]): string {
  return [...new Set(pagos.map((p) => p.formaRaw))].join(' + ');
}

/**
 * `"2.000"` → `"2"`, `"0.250"` → `"0.25"`. Operación de texto: una cantidad
 * nunca pasa por float. Lo que no parezca un decimal se devuelve tal cual.
 */
export function cantidad(texto: string): string {
  const partes = /^(-?\d+)(?:\.(\d*))?$/.exec(texto.trim());
  if (!partes) return texto;
  const decimales = (partes[2] ?? '').replace(/0+$/, '');
  return decimales ? `${partes[1]}.${decimales}` : partes[1];
}
