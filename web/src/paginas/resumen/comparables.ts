import type { Rango, TipoPeriodo } from '../../filtros/periodo';

/**
 * Contra qué se compara cada cifra del Resumen (F2-220). "Un número sin referencia no dice
 * nada", y una referencia que no está a la misma altura dice algo falso: a las 14:00 el día
 * de hoy lleva medio día y el de la semana pasada va completo.
 *
 * Por eso, cuando el periodo llega hasta hoy, la base se corta con `alturaAl`: el instante
 * actual, truncado al minuto. La API convierte ESE instante a la hora local de CADA sucursal
 * y corta su último día ahí (`api/src/scope/consulta-ventas.ts`). El front no decide la hora
 * de nadie: con CDMX y Tijuana, la base de Tijuana se corta una hora antes en su reloj, que
 * es lo que Tijuana lleva hoy. Lo único que sigue saliendo de la zona del panel es qué día
 * es "hoy" (`zonaDelPanel`, la decisión provisional ya existente de `filtros/periodo.ts`).
 *
 * DECISION PROVISIONAL (nocturno): justo por eso, con sucursales en zonas distintas, en la
 * hora en que el día local de una sucursal no es el "hoy" del panel (Tijuana entre las 00:00
 * y la 01:00 de CDMX) su Δ no está a la misma altura. Ver `alturaAl` en
 * `api/src/scope/consulta-ventas.ts` y docs/nocturno-log.md (F2-220).
 */
export interface Comparable {
  rango: Rango;
  /** Sólo cuando la base se corta a la misma altura. */
  alturaAl?: string;
  /** Cómo se nombra la base en pantalla ("el mismo día de la semana pasada"). */
  etiqueta: string;
}

const MS_DIA = 86_400_000;
const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

function aMs(dia: string): number {
  const partes = DIA.exec(dia);
  if (!partes) throw new Error(`Día inválido: ${dia}`);
  return Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
}

function aDia(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function mover(dia: string, dias: number): string {
  return aDia(aMs(dia) + dias * MS_DIA);
}

/** El instante actual truncado al minuto, en ISO UTC: la llave de caché dura un minuto. */
export function alturaDe(ahora: Date): string {
  const ms = ahora.getTime();
  return new Date(ms - (((ms % 60_000) + 60_000) % 60_000)).toISOString();
}

/** Hoy contra el mismo día de la semana pasada, a la misma hora local de cada sucursal. */
export function comparableDelDia(hoy: string, ahora: Date): Comparable {
  const dia = mover(hoy, -7);
  return {
    rango: { desde: dia, hasta: dia },
    alturaAl: alturaDe(ahora),
    etiqueta: 'el mismo día de la semana pasada a esta hora',
  };
}

/**
 * Del 1 a hoy contra el mismo tramo del mes anterior. Si el día de hoy no existe en el mes
 * anterior (31 de marzo contra febrero), la base es el mes anterior completo y no se corta:
 * ya terminó antes de "esta altura".
 */
export function comparableDelMes(hoy: string, ahora: Date): { actual: Rango; base: Comparable } {
  const ms = aMs(hoy);
  const fecha = new Date(ms);
  const anio = fecha.getUTCFullYear();
  const mes = fecha.getUTCMonth();
  const dia = fecha.getUTCDate();
  const ultimoAnterior = new Date(Date.UTC(anio, mes, 0)).getUTCDate();
  const desde = aDia(Date.UTC(anio, mes - 1, 1));
  const actual = { desde: aDia(Date.UTC(anio, mes, 1)), hasta: hoy };
  if (dia > ultimoAnterior) {
    return {
      actual,
      base: {
        rango: { desde, hasta: aDia(Date.UTC(anio, mes, 0)) },
        etiqueta: 'el mes anterior completo',
      },
    };
  }
  return {
    actual,
    base: {
      rango: { desde, hasta: aDia(Date.UTC(anio, mes - 1, dia)) },
      alturaAl: alturaDe(ahora),
      etiqueta: 'el mes anterior a la misma altura',
    },
  };
}

/**
 * La base del periodo elegido en la cabecera.
 * - hoy → el mismo día de la semana pasada, a esta hora.
 * - semana (lunes a hoy) → los mismos días de la semana pasada, a esta hora.
 * - mes → el mes anterior a la misma altura.
 * - mes anterior → el mes previo a ése, completo.
 * - rango → los mismos N días inmediatamente anteriores; se corta a esta hora sólo si el
 *   rango termina hoy. Un rango que termina en el futuro no se corta: esos días no tienen
 *   ventas todavía y la base va completa (se documenta, no se adivina).
 */
export function periodoComparable(
  tipo: TipoPeriodo,
  rango: Rango,
  hoy: string,
  ahora: Date,
): Comparable {
  switch (tipo) {
    case 'hoy':
      return comparableDelDia(hoy, ahora);
    case 'semana':
      return {
        rango: { desde: mover(rango.desde, -7), hasta: mover(rango.hasta, -7) },
        alturaAl: alturaDe(ahora),
        etiqueta: 'la semana pasada a la misma altura',
      };
    case 'mes':
      return comparableDelMes(hoy, ahora).base;
    case 'mes-anterior': {
      const fecha = new Date(aMs(rango.desde));
      const anio = fecha.getUTCFullYear();
      const mes = fecha.getUTCMonth();
      return {
        rango: {
          desde: aDia(Date.UTC(anio, mes - 1, 1)),
          hasta: aDia(Date.UTC(anio, mes, 0)),
        },
        etiqueta: 'el mes previo completo',
      };
    }
    case 'rango': {
      const dias = (aMs(rango.hasta) - aMs(rango.desde)) / MS_DIA + 1;
      const base = { desde: mover(rango.desde, -dias), hasta: mover(rango.desde, -1) };
      const etiqueta = dias === 1 ? 'el día anterior' : `los ${dias} días anteriores`;
      return rango.hasta === hoy
        ? { rango: base, alturaAl: alturaDe(ahora), etiqueta: `${etiqueta} a la misma altura` }
        : { rango: base, etiqueta };
    }
  }
}
