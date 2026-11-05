import type { ConceptoCuadre, ResumenCorte } from '../../api/tipos';
import { aCentavos } from '../../dinero/dinero';
import { fechaHoraEn, fechaParaTabla } from '../tickets/formato';

/**
 * UI-01: la vista se llama "Turnos" en la interfaz y vive en `/turnos`; `/cortes` (la ruta del
 * MVP) redirige aquí conservando el query. La API y el modelo siguen siendo `cortes`.
 */
export const RUTA_TURNOS = '/turnos';

/** El parámetro de la URL con el turno abierto en el detalle (`/turnos?turno=<id>`). */
export const PARAM_TURNO = 'turno';
/** El del MVP (`/cortes?corte=<id>`): se sigue aceptando para que un enlace viejo abra. */
export const PARAM_CORTE_VIEJO = 'corte';

/** El turno elegido: `?turno=`, o el viejo `?corte=` si no hay uno nuevo. */
export function leerTurno(parametros: URLSearchParams): string | null {
  return parametros.get(PARAM_TURNO) ?? parametros.get(PARAM_CORTE_VIEJO);
}

/** Elige (o cierra con `null`) el turno del detalle. Siempre escribe el param nuevo. */
export function elegirTurno(previos: URLSearchParams, id: string | null): URLSearchParams {
  const nuevos = new URLSearchParams(previos);
  nuevos.delete(PARAM_CORTE_VIEJO);
  if (id === null) nuevos.delete(PARAM_TURNO);
  else nuevos.set(PARAM_TURNO, id);
  return nuevos;
}

/** El query de `/cortes?…` llevado a `/turnos?…`: todo igual, `corte` pasa a `turno`. */
export function queryDeTurnos(previos: URLSearchParams): URLSearchParams {
  const viejo = previos.get(PARAM_CORTE_VIEJO);
  const nuevos = new URLSearchParams(previos);
  nuevos.delete(PARAM_CORTE_VIEJO);
  if (viejo !== null && !nuevos.has(PARAM_TURNO)) nuevos.set(PARAM_TURNO, viejo);
  return nuevos;
}

/** `?ver=abiertos`: sólo los turnos abiertos ahora, sin importar el periodo. Sin él, del periodo. */
export const PARAM_VISTA = 'ver';
export const VISTA_ABIERTOS = 'abiertos';
export type VistaTurnos = 'periodo' | typeof VISTA_ABIERTOS;

export function leerVista(parametros: URLSearchParams): VistaTurnos {
  return parametros.get(PARAM_VISTA) === VISTA_ABIERTOS ? VISTA_ABIERTOS : 'periodo';
}

export const TEXTO_CONCEPTO: Record<ConceptoCuadre, string> = {
  efectivo: 'Efectivo',
  tarjeta: 'Tarjeta',
  vales: 'Vales',
  credito: 'Crédito',
  total: 'Total',
};

/** "22/10/2026 14:05" en la zona de la SUCURSAL del corte, nunca la del navegador. */
export function momento(zona: string, instante: string): string {
  const f = fechaHoraEn(zona, instante);
  return `${fechaParaTabla(f.fecha)} ${f.hora}`;
}

/** Lo que se dice de un turno de antes de que el agente mandara turnos (`posiblementeIncompleto`). */
export const TEXTO_INCOMPLETO =
  'Turno anterior a la actualización: la venta puede estar incompleta.';

/** "Turno 7 · CAJA1": cómo se nombra un turno en la lista y en el detalle. */
export function nombreCorte(c: Pick<ResumenCorte, 'turnoSr' | 'estacion'>): string {
  return c.estacion ? `Turno ${c.turnoSr} · ${c.estacion}` : `Turno ${c.turnoSr}`;
}

/** Cuánto lleva o duró el turno: "3 d 5 h", "4 h 12 min", "25 min". */
export function duracionTurno(aperturaAt: string, cierreAt: string | null, ahora: number): string {
  const fin = cierreAt === null ? ahora : Date.parse(cierreAt);
  const minutos = Math.max(0, Math.floor((fin - Date.parse(aperturaAt)) / 60_000));
  const dias = Math.floor(minutos / 1440);
  const horas = Math.floor((minutos % 1440) / 60);
  const resto = minutos % 60;
  if (dias > 0) return `${dias} d ${horas} h`;
  if (horas > 0) return `${horas} h ${resto} min`;
  return `${resto} min`;
}

/**
 * Cómo leer una diferencia del cuadre (declarado − cobrado): positiva = el cajero declaró
 * DE MÁS (sobrante), negativa = declaró de menos (faltante). `null` sin comparación.
 */
export function sentidoDiferencia(
  diferencia: string | null,
): 'sobrante' | 'faltante' | 'cuadra' | null {
  if (diferencia === null) return null;
  const centavos = aCentavos(diferencia);
  if (centavos === null) return null;
  if (centavos > 0n) return 'sobrante';
  if (centavos < 0n) return 'faltante';
  return 'cuadra';
}
