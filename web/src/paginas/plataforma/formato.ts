import type { EstadoMembresia, EstadoPagoMes, MetodoPago } from '../../api/tipos';

/**
 * Presentación del panel de plataforma. Las fechas de calendario (`AAAA-MM-DD`: vencimientos,
 * fechas de pago) se pintan TAL CUAL el día que son, sin zona (se formatean en UTC para que el
 * navegador no las corra un día). Los instantes (último acceso, bitácora) se pintan en
 * America/Mexico_City.
 */
export const ZONA_PLATAFORMA = 'America/Mexico_City';

const DIA = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

const INSTANTE = new Intl.DateTimeFormat('es-MX', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZone: ZONA_PLATAFORMA,
});

const MES = new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** `2026-11-03` → `3 nov 2026`. */
export function fechaDia(dia: string): string {
  const fecha = new Date(`${dia}T00:00:00Z`);
  return Number.isNaN(fecha.getTime()) ? dia : DIA.format(fecha).replace('.', '');
}

/** ISO → `31 oct 2026, 10:15 a.m.` en hora de CDMX. */
export function fechaHora(iso: string): string {
  const fecha = new Date(iso);
  return Number.isNaN(fecha.getTime()) ? iso : INSTANTE.format(fecha).replace('.', '');
}

/** `2026-11` → `noviembre de 2026`. */
export function mesLargo(mes: string): string {
  const fecha = new Date(`${mes}-01T00:00:00Z`);
  return Number.isNaN(fecha.getTime()) ? mes : MES.format(fecha);
}

/** El día de hoy en CDMX como `AAAA-MM-DD` (para la fecha de pago por omisión). */
export function hoyEnPlataforma(ahora = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_PLATAFORMA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(ahora);
}

export function plural(n: number, uno: string, varios: string): string {
  return `${n} ${n === 1 ? uno : varios}`;
}

/** "1 sucursal, 2 agentes, 3 usuarios" (la fila de Clientes). */
export function resumenCliente(c: {
  sucursales: number;
  agentesConectados: number;
  usuarios: number;
}) {
  return [
    plural(c.sucursales, 'sucursal', 'sucursales'),
    plural(c.agentesConectados, 'agente conectado', 'agentes conectados'),
    plural(c.usuarios, 'usuario', 'usuarios'),
  ].join(', ');
}

export const TEXTO_ESTADO: Record<EstadoMembresia | 'sin_suscripcion', string> = {
  activa: 'Activo',
  prueba: 'En prueba',
  vencida: 'Vencido',
  suspendida: 'Suspendido',
  cancelada: 'Cancelado',
  sin_suscripcion: 'Sin plan',
};

export const TEXTO_PAGO: Record<EstadoPagoMes, string> = {
  pagado: 'Pagado',
  pendiente: 'Pendiente',
  vencido: 'Vencido',
};

export const TEXTO_METODO: Record<MetodoPago, string> = {
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  otro: 'Otro',
};

/** Lo que dice la bitácora de cada acción, en español de persona. */
export const TEXTO_ACCION: Record<string, string> = {
  'cliente.crear': 'Dio de alta al cliente',
  'cliente.editar': 'Editó los datos del cliente',
  'cliente.suspender': 'Suspendió al cliente',
  'cliente.reactivar': 'Reactivó al cliente',
  'cliente.cancelar': 'Canceló al cliente',
  'suscripcion.crear': 'Asignó un plan',
  'suscripcion.cambiar_plan': 'Cambió el plan',
  'suscripcion.editar': 'Editó la suscripción',
  'pago.registrar': 'Registró un pago',
  'pago.anular': 'Anuló un pago',
  'plan.crear': 'Creó un plan',
  'plan.editar': 'Editó un plan',
  'plan.borrar': 'Borró un plan',
  'admin.crear': 'Agregó un administrador',
  'admin.editar': 'Editó un administrador',
  'admin.desactivar': 'Desactivó un administrador',
  'admin.reactivar': 'Reactivó un administrador',
  'admin.convertir_cuenta': 'Convirtió una cuenta de cliente en administrador',
  'ajustes.editar': 'Cambió los ajustes globales',
  'sucursal.forzar_limite': 'Pasó el límite de sucursales del plan',
};
