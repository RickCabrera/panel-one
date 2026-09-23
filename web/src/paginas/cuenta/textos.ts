import type {
  EstadoEnvioReporte,
  PreferenciasPush,
  TipoNotificacion,
  TipoReporte,
} from '../../api/tipos';

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

// ---- Notificaciones push (F2-146) ----

export const COLUMNA_NOTIFICACION: Record<TipoNotificacion, keyof PreferenciasPush> = {
  mesa_abierta: 'mesaAbierta',
  sucursal_sin_reporte: 'sucursalSinReporte',
  folios_bajo: 'foliosBajo',
  cierre_dia: 'cierreDia',
};

export const TEXTO_NOTIFICACION: Record<TipoNotificacion, { nombre: string; detalle: string }> = {
  sucursal_sin_reporte: {
    nombre: 'Sucursal desconectada',
    detalle: 'Cuando una sucursal deja de reportar (10 min por defecto).',
  },
  mesa_abierta: {
    nombre: 'Mesa abierta demasiado tiempo',
    detalle: 'Cuando una cuenta pasa del límite de tu empresa (60 min por defecto).',
  },
  folios_bajo: {
    nombre: 'Saldo de folios bajo',
    detalle: 'Cuando los folios del PAC cruzan el umbral de la plataforma.',
  },
  cierre_dia: {
    nombre: 'Resumen de cierre del día',
    detalle: 'Cada mañana a las 7:00, la venta de ayer de cada empresa que ves.',
  },
};

/** Qué pasa con ESTE navegador y qué hacer. */
export const AVISO_DISPOSITIVO = {
  activo: 'Activas en este dispositivo: los avisos llegan aunque el panel esté cerrado.',
  inactivo:
    'Este dispositivo no recibe avisos. Actívalos para que lleguen aunque el panel esté cerrado.',
  sinClave:
    'El servidor todavía no tiene notificaciones configuradas (faltan sus llaves VAPID). Pídeselo a tu administrador.',
  'sin-soporte':
    'Este navegador no admite notificaciones. En iPhone o iPad, primero agrega el panel a la pantalla de inicio (Compartir → Agregar a inicio) y ábrelo desde ahí.',
  'sin-service-worker':
    'Este navegador todavía no termina de preparar la app. Recarga la página; si sigue así, las notificaciones no están disponibles en esta versión del panel.',
  bloqueado:
    'Bloqueaste las notificaciones de este sitio. Permítelas desde el candado de la barra de direcciones y recarga la página.',
} as const;
