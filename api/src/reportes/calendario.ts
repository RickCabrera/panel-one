import type { TipoReporte } from '@prisma/client';

import { diaLocal, restarDias } from '../alertas/observar';

/**
 * Cuándo toca cada reporte (F2-141). Todo es PURO: recibe el instante (del `Reloj`) y la
 * zona de la empresa, y no lee nada.
 */

/** Zona por omisión: la de una empresa sin sucursales activas. */
export const ZONA_POR_OMISION = 'America/Mexico_City';

/**
 * Hora local de envío en la zona de la empresa.
 *
 * DECISION PROVISIONAL (nocturno): fija a las 07:00 y no configurable por usuario. La ficha
 * pide "antes de las 9:00 hora local": a las 7 quedan dos horas de holgura para un tick que
 * falle o un reintento, y en cualquier zona de México el día anterior ya cerró en todas las
 * sucursales.
 */
export const HORA_ENVIO = 7;

/**
 * La zona de la empresa, a partir de las zonas de sus sucursales ACTIVAS.
 *
 * DECISION PROVISIONAL (nocturno): `empresas` no tiene zona propia. Se toma la que comparten
 * más sucursales activas; empate → la primera en orden alfabético (determinista); sin
 * sucursales → `America/Mexico_City`. Las cifras NO dependen de esto: cada sucursal corta
 * "ayer" en SU zona, igual que el panel. Esta zona sólo decide la hora de envío y qué día
 * es "ayer".
 */
export function zonaDeEmpresa(zonasSucursales: readonly string[]): string {
  const cuenta = new Map<string, number>();
  for (const z of zonasSucursales) cuenta.set(z, (cuenta.get(z) ?? 0) + 1);
  let mejor: string | null = null;
  for (const [zona, n] of [...cuenta.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    if (mejor === null || n > cuenta.get(mejor)!) mejor = zona;
  }
  return mejor ?? ZONA_POR_OMISION;
}

/** La hora local (0..23) de un instante en una zona IANA. */
export function horaLocal(instanteMs: number, zona: string): number {
  const texto = new Intl.DateTimeFormat('en-US', {
    timeZone: zona,
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instanteMs));
  return Number(texto);
}

/** Día de la semana ISO (1 = lunes … 7 = domingo) de una fecha AAAA-MM-DD de calendario. */
export function diaSemana(dia: string): number {
  const d = new Date(`${dia}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export interface PeriodoReporte {
  tipo: TipoReporte;
  /** Diario: el día reportado. Semanal: el lunes de la semana reportada. */
  periodo: string;
  /** Rango de días locales (inclusivo) que cubre el reporte. */
  desde: string;
  hasta: string;
}

/** El periodo diario que se reporta el día local `hoy`: ayer. */
export function periodoDiario(hoy: string): PeriodoReporte {
  const ayer = restarDias(hoy, 1);
  return { tipo: 'diario', periodo: ayer, desde: ayer, hasta: ayer };
}

/** El periodo semanal que se reporta el día local `hoy`: la semana (lun..dom) anterior a la de hoy. */
export function periodoSemanal(hoy: string): PeriodoReporte {
  const lunesDeHoy = restarDias(hoy, diaSemana(hoy) - 1);
  const lunes = restarDias(lunesDeHoy, 7);
  return { tipo: 'semanal', periodo: lunes, desde: lunes, hasta: restarDias(lunesDeHoy, 1) };
}

/**
 * Qué reportes tocan en el instante `ahoraMs` para una empresa en `zona`: nada antes de las
 * `HORA_ENVIO` locales; desde ahí y hasta el fin de ese día local, el diario (ayer) y, si es
 * lunes, el semanal. Nunca se recuperan días anteriores: el día que pasó sin envío, pasó.
 */
export function reportesQueTocan(ahoraMs: number, zona: string): PeriodoReporte[] {
  if (horaLocal(ahoraMs, zona) < HORA_ENVIO) return [];
  const hoy = diaLocal(ahoraMs, zona);
  const tocan = [periodoDiario(hoy)];
  if (diaSemana(hoy) === 1) tocan.push(periodoSemanal(hoy));
  return tocan;
}

/** El periodo que tocaría HOY para un tipo (vista previa), sin importar la hora. */
export function periodoDeHoy(ahoraMs: number, zona: string, tipo: TipoReporte): PeriodoReporte {
  const hoy = diaLocal(ahoraMs, zona);
  return tipo === 'diario' ? periodoDiario(hoy) : periodoSemanal(hoy);
}

export { diaLocal, restarDias };
