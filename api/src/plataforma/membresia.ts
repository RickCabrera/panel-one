import { EstadoSuscripcion, PeriodicidadPlan, Prisma } from '@prisma/client';

/**
 * Reglas de membresía del panel de plataforma, como funciones PURAS (sin base ni reloj): las usan
 * el login, el panel y los tests con el mismo resultado.
 *
 * Fechas de CALENDARIO: `inicio`, `vencimiento`, `fecha_pago` y el periodo cubierto son días
 * (`@db.Date`). Prisma las entrega como `Date` a la medianoche UTC de ese día; aquí se manejan
 * igual (`Date` UTC 00:00) o como texto `AAAA-MM-DD`. "Hoy" es el día en America/Mexico_City
 * (la zona de la plataforma, que es quien cobra), NUNCA el del servidor.
 */
export const ZONA_PLATAFORMA = 'America/Mexico_City';

/** El estado que ve todo el mundo: el guardado, más `vencida`, que se CALCULA al leer. */
export type EstadoEfectivo = 'prueba' | 'activa' | 'vencida' | 'suspendida' | 'cancelada';
export const ESTADOS_EFECTIVOS: readonly EstadoEfectivo[] = [
  'prueba',
  'activa',
  'vencida',
  'suspendida',
  'cancelada',
];

/** La mensualidad del mes en curso, como la pinta la pantalla de Pagos. */
export type EstadoPagoMes = 'pagado' | 'pendiente' | 'vencido';

const DIA_MS = 86_400_000;
const ISO_DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

/** `AAAA-MM-DD` del día UTC de una fecha de calendario (`Date` a medianoche UTC). */
export function textoDia(dia: Date): string {
  return dia.toISOString().slice(0, 10);
}

/** `AAAA-MM-DD` → `Date` a medianoche UTC. Lanza si no es un día real (2026-02-30). */
export function diaDeTexto(texto: string): Date {
  const p = ISO_DIA.exec(texto);
  if (!p) throw new Error(`Fecha de calendario inválida: "${texto}".`);
  const fecha = new Date(Date.UTC(+p[1], +p[2] - 1, +p[3]));
  if (textoDia(fecha) !== texto) throw new Error(`Fecha de calendario inválida: "${texto}".`);
  return fecha;
}

/** ¿Es `AAAA-MM-DD` un día que existe? */
export function esDiaValido(texto: string): boolean {
  try {
    diaDeTexto(texto);
    return true;
  } catch {
    return false;
  }
}

/** El día de HOY en la zona de la plataforma, como fecha de calendario. */
export function hoyPlataforma(ahoraMs: number): Date {
  const texto = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA_PLATAFORMA,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(ahoraMs));
  return diaDeTexto(texto);
}

export function sumarDias(dia: Date, dias: number): Date {
  return new Date(dia.getTime() + dias * DIA_MS);
}

/**
 * `dia` + `meses`, conservando el día del mes; si el mes destino es más corto, el último día
 * (31 ene + 1 mes = 28/29 feb). Con días de corte 1..28 eso nunca pasa, pero un vencimiento
 * capturado a mano sí puede caer en 29..31.
 */
export function sumarMeses(dia: Date, meses: number): Date {
  const anio = dia.getUTCFullYear();
  const mes = dia.getUTCMonth() + meses;
  const ultimo = new Date(Date.UTC(anio, mes + 1, 0)).getUTCDate();
  return new Date(Date.UTC(anio, mes, Math.min(dia.getUTCDate(), ultimo)));
}

/** Meses que cubre un periodo del plan. */
export function mesesPorPeriodo(periodicidad: PeriodicidadPlan): number {
  return periodicidad === PeriodicidadPlan.anual ? 12 : 1;
}

/** El siguiente día de corte ESTRICTAMENTE después de `hoy` (el primer vencimiento por omisión). */
export function siguienteCorte(hoy: Date, diaCorte: number): Date {
  const esteMes = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), diaCorte));
  return esteMes.getTime() > hoy.getTime() ? esteMes : sumarMeses(esteMes, 1);
}

export interface SuscripcionParaEstado {
  estado: EstadoSuscripcion;
  vencimiento: Date;
  diasGracia: number;
  /**
   * Plan de $0.00 (p. ej. el "Plan inicial" de la migración): no se cobra, así que NUNCA queda
   * `vencida` ni muestra aviso de pago. Ausente = de pago.
   */
  gratuita?: boolean;
}

/** El último día en que todavía no está vencida: vencimiento + días de gracia. */
export function fechaLimite(s: SuscripcionParaEstado): Date {
  return sumarDias(s.vencimiento, s.diasGracia);
}

/**
 * El estado efectivo. `vencida` se CALCULA al leer: una suscripción en `prueba` o `activa` cuyo
 * vencimiento + gracia ya pasó (hoy > límite). No hay job diario que la escriba: así nunca hay
 * una fila "atrasada" porque el job no corrió, y registrar un pago la "desvence" en el acto.
 * `suspendida` y `cancelada` son las guardadas: NUNCA las pone el sistema solo.
 */
export function estadoEfectivo(s: SuscripcionParaEstado, hoy: Date): EstadoEfectivo {
  if (s.estado === EstadoSuscripcion.suspendida || s.estado === EstadoSuscripcion.cancelada) {
    return s.estado;
  }
  if (s.gratuita) return s.estado;
  return hoy.getTime() > fechaLimite(s).getTime() ? 'vencida' : s.estado;
}

/**
 * ¿El estado GUARDADO deja fuera a los usuarios de la empresa? Sólo `suspendida` y `cancelada`.
 * `vencida` NO bloquea (entran y ven el aviso de pago pendiente), y la ingesta del agente nunca
 * mira esto.
 */
export function bloqueaAcceso(estado: EstadoSuscripcion | null | undefined): boolean {
  return estado === EstadoSuscripcion.suspendida || estado === EstadoSuscripcion.cancelada;
}

/** El mensaje que ve el usuario de una empresa bloqueada, en el login y en el refresh. */
export function mensajeBloqueo(estado: EstadoSuscripcion): string {
  return estado === EstadoSuscripcion.cancelada
    ? 'Tu cuenta está cancelada. Contacta a soporte.'
    : 'Tu cuenta está suspendida. Contacta a soporte.';
}

/**
 * La mensualidad del mes de `hoy`: `vencido` si el estado efectivo es `vencida`; `pagado` si el
 * vencimiento ya pasó el corte de este mes (la mensualidad de este mes está cubierta);
 * `pendiente` en otro caso (el corte de este mes todavía no se paga, pero está en plazo).
 */
export function estadoPagoMes(
  s: SuscripcionParaEstado & { diaCorte: number },
  hoy: Date,
): EstadoPagoMes {
  // Un plan de $0 no debe nada: su mensualidad cuenta como pagada.
  if (s.gratuita) return 'pagado';
  if (estadoEfectivo(s, hoy) === 'vencida') return 'vencido';
  const corte = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), s.diaCorte));
  return s.vencimiento.getTime() > corte.getTime() ? 'pagado' : 'pendiente';
}

/** El mensaje del 409 por el límite de sucursales del plan, para quien lo provocó. */
export function mensajeLimiteSucursales(
  esGlobal: boolean,
  plan: string,
  limite: number,
  activas: number,
): string {
  const cupo = limite === 1 ? '1 sucursal activa' : `${limite} sucursales activas`;
  if (esGlobal) {
    return (
      `El plan ${plan} permite ${cupo} y esta empresa ya tiene ${activas}. ` +
      'Para hacerlo de todos modos, confírmalo (forzarLimite).'
    );
  }
  return `Tu plan (${plan}) permite ${cupo}. Para agregar más, contacta a soporte.`;
}

/** ¿El plan es de $0.00? (precio en texto o Decimal de Prisma). */
export function esGratuito(precioMensual: Prisma.Decimal | string): boolean {
  return new Prisma.Decimal(precioMensual).isZero();
}

/** Primer y último día (inclusive) del mes de `hoy`. */
export function mesDe(hoy: Date): { desde: Date; hasta: Date } {
  const desde = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth(), 1));
  const hasta = new Date(Date.UTC(hoy.getUTCFullYear(), hoy.getUTCMonth() + 1, 0));
  return { desde, hasta };
}
