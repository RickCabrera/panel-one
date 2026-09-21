import type { Sucursal } from '../api/tipos';

/**
 * El periodo del panel, en la URL (`?periodo=&desde=&hasta=`) igual que el alcance:
 * un enlace copiado abre el mismo periodo y "atrás" deshace el cambio.
 *
 * Todas las fechas son DÍAS LOCALES `YYYY-MM-DD`, que es lo que recibe la API: ella
 * corta cada sucursal en su propia zona. Lo único que decide el front es qué día es
 * "hoy", y eso se calcula en la zona de la sucursal, nunca en la del navegador ni en
 * UTC (a las 21:00 en CDMX, en UTC ya es mañana).
 */
export const PARAM_PERIODO = 'periodo';
export const PARAM_DESDE = 'desde';
export const PARAM_HASTA = 'hasta';

/** El tope de la API (`MAX_DIAS_RANGO`), contado igual que ella: inclusivo. */
export const MAX_DIAS_RANGO = 366;

/** Zona de presentación del producto (CLAUDE.md). */
export const ZONA_PRESENTACION = 'America/Mexico_City';

export type TipoPeriodo = 'hoy' | 'semana' | 'mes' | 'mes-anterior' | 'rango';

export const TIPOS_PERIODO: readonly { tipo: TipoPeriodo; nombre: string }[] = [
  { tipo: 'hoy', nombre: 'Hoy' },
  { tipo: 'semana', nombre: 'Esta semana' },
  { tipo: 'mes', nombre: 'Este mes' },
  { tipo: 'mes-anterior', nombre: 'Mes anterior' },
  { tipo: 'rango', nombre: 'Rango' },
];

export interface Periodo {
  tipo: TipoPeriodo;
  /** Sólo en `rango`: lo que dice la URL, todavía sin validar. */
  desde?: string;
  hasta?: string;
}

export interface Rango {
  desde: string;
  hasta: string;
}

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_DIA = 86_400_000;

/** `YYYY-MM-DD` → ms UTC de su medianoche; `null` si no es un día real (31 de febrero). */
function aMs(dia: string): number | null {
  const partes = DIA.exec(dia);
  if (!partes) return null;
  const [anio, mes, d] = [Number(partes[1]), Number(partes[2]), Number(partes[3])];
  const ms = Date.UTC(anio, mes - 1, d);
  const fecha = new Date(ms);
  if (
    fecha.getUTCFullYear() !== anio ||
    fecha.getUTCMonth() !== mes - 1 ||
    fecha.getUTCDate() !== d
  ) {
    return null;
  }
  return ms;
}

/** Aritmética de calendario: no hay zona aquí, sólo días. */
function aDia(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** El día local de `ahora` en `zona`. */
export function hoyEn(zona: string, ahora: Date): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(ahora);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)?.value ?? '';
  return `${valor('year')}-${valor('month')}-${valor('day')}`;
}

/** `hh:mm` (24 h) de un instante, en `zona`. */
export function horaEn(zona: string, instante: number): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: zona,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(instante));
}

/**
 * La zona que decide qué día es "hoy": la de la sucursal elegida; con "Todas", la
 * que compartan todas; y si no comparten una, la de presentación.
 *
 * DECISION PROVISIONAL (nocturno): con sucursales en zonas distintas no existe un
 * solo "hoy". Se toma America/Mexico_City (la zona de presentación): entre la
 * medianoche de CDMX y la de Tijuana, "Hoy" ya es el día nuevo y Tijuana sale en
 * cero hasta que le llegue. Lo tiene que confirmar Ricardo (docs/nocturno-log.md).
 */
export function zonaDelPanel(
  sucursal: Sucursal | undefined,
  sucursales: readonly Sucursal[] | undefined,
): string {
  if (sucursal) return sucursal.zonaHoraria;
  const zonas = new Set((sucursales ?? []).map((s) => s.zonaHoraria));
  if (zonas.size === 1) return [...zonas][0];
  return ZONA_PRESENTACION;
}

export function leerPeriodo(parametros: URLSearchParams): Periodo {
  const tipo = parametros.get(PARAM_PERIODO);
  if (tipo === 'rango') {
    return {
      tipo,
      desde: parametros.get(PARAM_DESDE) ?? '',
      hasta: parametros.get(PARAM_HASTA) ?? '',
    };
  }
  const conocido = TIPOS_PERIODO.find((t) => t.tipo === tipo);
  return { tipo: conocido ? conocido.tipo : 'hoy' };
}

/** Escribe el periodo sobre los parámetros actuales (conserva empresa y sucursal). */
export function escribirPeriodo(previos: URLSearchParams, periodo: Periodo): URLSearchParams {
  const nuevos = new URLSearchParams(previos);
  nuevos.delete(PARAM_DESDE);
  nuevos.delete(PARAM_HASTA);
  if (periodo.tipo === 'hoy') {
    nuevos.delete(PARAM_PERIODO);
  } else {
    nuevos.set(PARAM_PERIODO, periodo.tipo);
  }
  if (periodo.tipo === 'rango') {
    nuevos.set(PARAM_DESDE, periodo.desde ?? '');
    nuevos.set(PARAM_HASTA, periodo.hasta ?? '');
  }
  return nuevos;
}

/** El error de un rango a mano, o `null` si la API lo va a aceptar. */
export function errorDeRango(desde: string, hasta: string): string | null {
  const inicio = aMs(desde);
  const fin = aMs(hasta);
  if (inicio === null || fin === null) return 'Elige una fecha de inicio y una de fin válidas.';
  const dias = (fin - inicio) / MS_DIA + 1;
  if (dias < 1) return 'La fecha de inicio no puede ser posterior a la de fin.';
  if (dias > MAX_DIAS_RANGO) return `El rango no puede pasar de ${MAX_DIAS_RANGO} días.`;
  return null;
}

/**
 * Los días que consulta un periodo, dado el día local de hoy. Semana = de lunes a
 * hoy. Un rango inválido → `null`: no se consulta.
 */
export function rangoDe(periodo: Periodo, hoy: string): Rango | null {
  const msHoy = aMs(hoy);
  if (msHoy === null) return null;
  const fecha = new Date(msHoy);
  const anio = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth();

  switch (periodo.tipo) {
    case 'hoy':
      return { desde: hoy, hasta: hoy };
    case 'semana': {
      const desdeLunes = (fecha.getUTCDay() + 6) % 7;
      return { desde: aDia(msHoy - desdeLunes * MS_DIA), hasta: hoy };
    }
    case 'mes':
      return { desde: aDia(Date.UTC(anio, mes, 1)), hasta: hoy };
    case 'mes-anterior':
      // Date.UTC normaliza: mes -1 de enero es diciembre del año anterior, y el día
      // 0 del mes actual es el último del anterior.
      return { desde: aDia(Date.UTC(anio, mes - 1, 1)), hasta: aDia(Date.UTC(anio, mes, 0)) };
    case 'rango': {
      const desde = periodo.desde ?? '';
      const hasta = periodo.hasta ?? '';
      return errorDeRango(desde, hasta) === null ? { desde, hasta } : null;
    }
  }
}

export function incluyeHoy(rango: Rango, hoy: string): boolean {
  // `YYYY-MM-DD` se ordena igual como texto que como fecha.
  return rango.desde <= hoy && hoy <= rango.hasta;
}
