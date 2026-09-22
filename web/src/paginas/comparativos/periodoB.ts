import { errorDeRango, type Rango, type TipoPeriodo } from '../../filtros/periodo';
import { periodoComparable, type Comparable } from '../resumen/comparables';

/**
 * El periodo B de Comparativos (F2-140): contra qué se compara el periodo A, que es el de la
 * cabecera. Vive en la URL con parámetros PROPIOS de la vista (`b`, `bdesde`, `bhasta`), que no
 * están en `PARAMS_VISTA`: no viajan a otras vistas.
 *
 * - `comparable` (default): el mismo periodo comparable del Resumen (`periodoComparable`), con
 *   su corte "a la misma altura" (`alturaAl`) cuando toca.
 * - `mes-anterior`: el mes calendario anterior al mes en que EMPIEZA A, completo y sin corte.
 *   Con A = "Este mes" (u "Hoy", o "Esta semana" dentro del mes) es exactamente el rango de
 *   "Mes anterior" en Inicio.
 * - `rango`: dos fechas libres, días completos y sin corte. Un rango inválido se explica y no
 *   se consulta, igual que el de la cabecera.
 */
export const PARAM_B = 'b';
export const PARAM_B_DESDE = 'bdesde';
export const PARAM_B_HASTA = 'bhasta';

export type ModoB = 'comparable' | 'mes-anterior' | 'rango';

export const MODOS_B: readonly { modo: ModoB; nombre: string }[] = [
  { modo: 'comparable', nombre: 'Periodo comparable' },
  { modo: 'mes-anterior', nombre: 'Mes anterior a A' },
  { modo: 'rango', nombre: 'Otro rango' },
];

export interface SeleccionB {
  modo: ModoB;
  /** Sólo en `rango`: lo que dice la URL, todavía sin validar. */
  desde?: string;
  hasta?: string;
}

export type ResultadoB = { ok: true; comparable: Comparable } | { ok: false; error: string };

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

function aDia(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function leerB(parametros: URLSearchParams): SeleccionB {
  const modo = parametros.get(PARAM_B);
  if (modo === 'rango') {
    return {
      modo,
      desde: parametros.get(PARAM_B_DESDE) ?? '',
      hasta: parametros.get(PARAM_B_HASTA) ?? '',
    };
  }
  return { modo: modo === 'mes-anterior' ? modo : 'comparable' };
}

/** Escribe B sobre los parámetros actuales. El default (`comparable`) no deja rastro en la URL. */
export function escribirB(previos: URLSearchParams, b: SeleccionB): URLSearchParams {
  const nuevos = new URLSearchParams(previos);
  nuevos.delete(PARAM_B_DESDE);
  nuevos.delete(PARAM_B_HASTA);
  if (b.modo === 'comparable') {
    nuevos.delete(PARAM_B);
    return nuevos;
  }
  nuevos.set(PARAM_B, b.modo);
  if (b.modo === 'rango') {
    nuevos.set(PARAM_B_DESDE, b.desde ?? '');
    nuevos.set(PARAM_B_HASTA, b.hasta ?? '');
  }
  return nuevos;
}

/** El mes calendario anterior al mes de `dia`, completo. */
export function mesAnteriorA(dia: string): { rango: Rango; nombre: string } {
  const partes = DIA.exec(dia);
  if (!partes) throw new Error(`Día inválido: ${dia}`);
  const anio = Number(partes[1]);
  const mes = Number(partes[2]) - 1;
  const inicio = new Date(Date.UTC(anio, mes - 1, 1));
  return {
    // Date.UTC normaliza: el mes -1 de enero es diciembre del año anterior, y el día 0 del
    // mes de A es el último del anterior.
    rango: { desde: aDia(inicio.getTime()), hasta: aDia(Date.UTC(anio, mes, 0)) },
    nombre: `${MESES[inicio.getUTCMonth()]} de ${inicio.getUTCFullYear()}`,
  };
}

/** Los días concretos de B (y su corte, si lo lleva) para un periodo A ya resuelto. */
export function resolverB(
  b: SeleccionB,
  tipoA: TipoPeriodo,
  rangoA: Rango,
  hoy: string,
  ahora: Date,
): ResultadoB {
  switch (b.modo) {
    case 'comparable':
      return { ok: true, comparable: periodoComparable(tipoA, rangoA, hoy, ahora) };
    case 'mes-anterior': {
      const { rango, nombre } = mesAnteriorA(rangoA.desde);
      return {
        ok: true,
        comparable: { rango, etiqueta: `el mes anterior a A (${nombre}, completo)` },
      };
    }
    case 'rango': {
      const desde = b.desde ?? '';
      const hasta = b.hasta ?? '';
      const error = errorDeRango(desde, hasta);
      if (error !== null) return { ok: false, error };
      return {
        ok: true,
        comparable: {
          rango: { desde, hasta },
          etiqueta: `del ${desde} al ${hasta} (días completos)`,
        },
      };
    }
  }
}
