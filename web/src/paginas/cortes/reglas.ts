import type { ConceptoCuadre, ResumenCorte } from '../../api/tipos';
import { aCentavos } from '../../dinero/dinero';
import { fechaHoraEn, fechaParaTabla } from '../tickets/formato';

/** El parámetro de la URL con el corte abierto en el detalle (`/cortes?corte=<id>`). */
export const PARAM_CORTE = 'corte';

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

/** Lo que se dice de un corte de antes de que el agente mandara turnos (`posiblementeIncompleto`). */
export const TEXTO_INCOMPLETO =
  'Corte anterior a la actualización: la venta puede estar incompleta.';

/** "Turno 7 · CAJA1": cómo se nombra un corte en la lista y en el detalle. */
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
