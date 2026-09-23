import type { MensajePush, OpcionesPush } from '../adaptadores/push/puerto';
import { fechaCorta, formatoEntero, formatoPesos } from '../reportes/formato';
import type { Resumen } from '../ventas/agregados-ventas.service';

/**
 * El texto de cada notificación (F2-146). PURO: recibe lo ya leído y devuelve el mensaje.
 * Nada de cifras en las alertas; el resumen del día sí lleva la venta (DECISION PROVISIONAL
 * (nocturno), ver `docs/notificaciones.md`: se ve en la pantalla bloqueada).
 */

/** Dónde se ubica la alerta: nombres, no ids (los ids van sólo en la URL). */
export interface LugarAlerta {
  empresaId: string;
  empresa: string;
  sucursalId: string;
  sucursal: string;
}

export const OPCIONES_ALERTA: OpcionesPush = { ttlS: 60 * 60, urgencia: 'high' };
export const OPCIONES_FOLIOS: OpcionesPush = { ttlS: 24 * 60 * 60, urgencia: 'normal' };
export const OPCIONES_RESUMEN: OpcionesPush = { ttlS: 12 * 60 * 60, urgencia: 'normal' };

function numero(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null;
}

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** Minutos legibles: "14 min", "2 h 5 min". */
export function duracion(minutos: number): string {
  const m = Math.max(0, Math.floor(minutos));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto === 0 ? `${h} h` : `${h} h ${resto} min`;
}

/** `sucursal_sin_reporte`: `detalle` = `{nunca: true}` o `{nunca: false, edadSegundos}`. */
export function mensajeSucursalSinReporte(
  alertaId: string,
  lugar: LugarAlerta,
  detalle: unknown,
): MensajePush {
  const d = (detalle ?? {}) as Record<string, unknown>;
  const edad = numero(d.edadSegundos);
  const cuerpo =
    d.nunca === true || edad === null
      ? `${lugar.sucursal} (${lugar.empresa}) nunca ha reportado.`
      : `${lugar.sucursal} (${lugar.empresa}) no reporta desde hace ${duracion(edad / 60)}.`;
  return {
    titulo: 'Sucursal sin reportar',
    cuerpo,
    url: `/alertas?${query({ empresa: lugar.empresaId, sucursal: lugar.sucursalId })}`,
    etiqueta: `alerta-${alertaId}`,
  };
}

/** `mesa_abierta`: `detalle` = `{folio, mesa, minutos}`. */
export function mensajeMesaAbierta(
  alertaId: string,
  lugar: LugarAlerta,
  detalle: unknown,
): MensajePush {
  const d = (detalle ?? {}) as Record<string, unknown>;
  const mesa = texto(d.mesa);
  const minutos = numero(d.minutos);
  const quien = mesa ? `Mesa ${mesa}` : 'Una mesa';
  const cuanto =
    minutos === null ? 'abierta demasiado tiempo' : `abierta hace ${duracion(minutos)}`;
  return {
    titulo: `${quien} ${cuanto}`,
    cuerpo: `${lugar.sucursal} (${lugar.empresa})`,
    url: `/mesas?${query({ empresa: lugar.empresaId, sucursal: lugar.sucursalId })}`,
    etiqueta: `alerta-${alertaId}`,
  };
}

export interface SaldoFoliosBajo {
  estado: 'bajo' | 'agotado';
  disponible: number;
  vigenteTotal: number;
  umbralPct: number;
}

export function mensajeFoliosBajo(s: SaldoFoliosBajo): MensajePush {
  return {
    titulo: s.estado === 'agotado' ? 'Se acabaron los folios' : 'Saldo de folios bajo',
    cuerpo:
      s.estado === 'agotado'
        ? 'No quedan folios: la emisión de facturas está detenida hasta cargar un paquete.'
        : `Quedan ${formatoEntero(s.disponible)} de ${formatoEntero(s.vigenteTotal)} folios ` +
          `(umbral ${s.umbralPct} %).`,
    url: '/facturacion?tab=folios',
    etiqueta: 'folios-bajo',
  };
}

/**
 * El resumen de cierre del día. Sin cuentas NO dice "$0.00": dice que no llegó nada y qué
 * revisar (regla de estados vacíos de la Ronda 2).
 */
export function mensajeCierreDia(
  empresa: { id: string; nombre: string },
  dia: string,
  r: Pick<Resumen, 'venta' | 'cuentas' | 'ticketPromedio'>,
): MensajePush {
  const base = {
    url: `/?${query({ empresa: empresa.id, periodo: 'rango', desde: dia, hasta: dia })}`,
    etiqueta: `cierre-${empresa.id}-${dia}`,
  };
  if (r.cuentas === 0) {
    return {
      ...base,
      titulo: `${empresa.nombre}: sin ventas del ${fechaCorta(dia)}`,
      cuerpo:
        'No recibimos cuentas cerradas de ese día. Si el restaurante abrió, revisa que las ' +
        'sucursales estén conectadas.',
    };
  }
  const partes = [
    `Venta ${formatoPesos(r.venta)}`,
    `${formatoEntero(r.cuentas)} ${r.cuentas === 1 ? 'cuenta' : 'cuentas'}`,
  ];
  if (r.ticketPromedio !== null) partes.push(`ticket prom. ${formatoPesos(r.ticketPromedio)}`);
  return {
    ...base,
    titulo: `${empresa.nombre}: cierre del ${fechaCorta(dia)}`,
    cuerpo: partes.join(' · '),
  };
}

export const MENSAJE_PRUEBA: MensajePush = {
  titulo: 'Notificación de prueba',
  cuerpo: 'Si ves esto, las notificaciones del monitor llegan a este dispositivo.',
  url: '/cuenta',
  etiqueta: 'prueba',
};
export const OPCIONES_PRUEBA: OpcionesPush = { ttlS: 5 * 60, urgencia: 'normal' };
