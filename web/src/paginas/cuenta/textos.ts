import type { EstadoEnvioReporte, TipoReporte } from '../../api/tipos';

/** Textos de los reportes por correo (F2-141). */

export const NOMBRE_REPORTE: Record<TipoReporte, string> = {
  diario: 'Resumen diario',
  semanal: 'Resumen semanal',
};

export const NOMBRE_ESTADO_ENVIO: Record<EstadoEnvioReporte, string> = {
  enviando: 'Enviándose (o se interrumpió; no se reintenta)',
  enviado: 'Enviado',
  fallido: 'Falló; se reintenta hoy',
  descartado: 'No se envió',
};

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** `"2026-09-21"` → `"21 sep 2026"`: fecha de calendario, sin zona. */
export function fechaReporte(dia: string): string {
  const [a, m, d] = dia.split('-');
  return `${Number(d)} ${MESES[Number(m) - 1]} ${a}`;
}

export function periodoLegible(tipo: TipoReporte, periodo: string): string {
  return tipo === 'diario' ? fechaReporte(periodo) : `semana del ${fechaReporte(periodo)}`;
}
