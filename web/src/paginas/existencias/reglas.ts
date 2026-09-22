import type {
  AlmacenExistencias,
  EstadoExistencia,
  Existencias,
  FilaExistencia,
} from '../../api/tipos';
import { fechaHoraEn, fechaParaTabla } from '../tickets/formato';

/**
 * Reglas PURAS de la vista de Existencias (F2-121): textos del semáforo, filtro por KPI,
 * almacenes del selector, estados vacíos y la hora de la lectura en la zona de la sucursal.
 * Nada de números inventados: lo que el API no trae se dice.
 */

export const TEXTO_ESTADO: Record<EstadoExistencia, string> = {
  sin_existencia: 'Sin existencia',
  bajo_minimo: 'Bajo mínimo',
  sobre_maximo: 'Sobre máximo',
  ok: 'En rango',
  sin_limites: 'Sin mínimo ni máximo',
  sin_lectura: 'Sin lectura del artículo',
};

/** Clase del punto del semáforo. Siempre va acompañado de `TEXTO_ESTADO`, nunca sólo color. */
export const COLOR_ESTADO: Record<EstadoExistencia, string> = {
  sin_existencia: 'bg-semaforo-rojo',
  bajo_minimo: 'bg-semaforo-alerta',
  sobre_maximo: 'bg-semaforo-sin-dato',
  ok: 'bg-semaforo-ok',
  sin_limites: 'bg-semaforo-sin-dato',
  sin_lectura: 'bg-semaforo-sin-dato',
};

/** Los KPIs que también filtran la tabla al hacer clic. `todos` = sin filtro de estado. */
export type FiltroEstado = 'todos' | 'bajo_minimo' | 'sin_existencia' | 'sin_lectura';

export function filtrarPorEstado(
  filas: readonly FilaExistencia[],
  filtro: FiltroEstado,
): FilaExistencia[] {
  if (filtro === 'todos') return [...filas];
  return filas.filter((f) => f.estado === filtro);
}

/** Valor de un `<select>` de almacén: sucursal y almacén juntos (un almacén es de una sucursal). */
export function valorAlmacen(a: { sucursalId: string; almacenOrigenSrId: string }): string {
  return JSON.stringify([a.sucursalId, a.almacenOrigenSrId]);
}

export function leerValorAlmacen(
  valor: string,
): { sucursalId: string; almacenOrigenSrId: string } | null {
  try {
    const v: unknown = JSON.parse(valor);
    if (Array.isArray(v) && v.length === 2 && v.every((x) => typeof x === 'string')) {
      return { sucursalId: v[0] as string, almacenOrigenSrId: v[1] as string };
    }
  } catch {
    // Un valor que no es nuestro: sin filtro.
  }
  return null;
}

/** El nombre visible de un almacén: el del catálogo, o su id del POS dicho como tal. */
export function nombreAlmacen(a: { almacen: string | null; almacenOrigenSrId: string }): string {
  return a.almacen ?? `Almacén ${a.almacenOrigenSrId} (sin catálogo)`;
}

export function nombreInsumo(f: FilaExistencia): string {
  return f.insumo ?? `Insumo ${f.insumoOrigenSrId} (sin catálogo)`;
}

/** "22/09/2026 09:30" en la zona de la SUCURSAL, nunca la del navegador. */
export function horaLectura(zona: string, instante: string): string {
  const { fecha, hora } = fechaHoraEn(zona, instante);
  return `${fechaParaTabla(fecha)} ${hora}`;
}

export type Vacio = { tipo: 'con-datos' } | { tipo: 'sin-lectura'; porque: string; falta: string };

/**
 * ¿Hay algo que mostrar? Si NINGUNA sucursal del alcance ha mandado existencias, la vista lo
 * dice (y por qué) en vez de pintar $0.00. Con que una haya mandado, se muestra lo que hay y las
 * demás salen en el aviso de `sucursalesSinLectura`.
 */
export function vacio(r: Existencias): Vacio {
  if (r.sucursales.some((s) => s.almacenesLeidos > 0) || r.filas.length > 0) {
    return { tipo: 'con-datos' };
  }
  return {
    tipo: 'sin-lectura',
    porque:
      r.sucursales.length === 1
        ? `${r.sucursales[0].sucursal} todavía no ha mandado existencias de ningún almacén.`
        : 'Ninguna sucursal ha mandado todavía existencias de sus almacenes.',
    falta:
      'Las manda el agente de cada sucursal cada 30 minutos, cuando tenga el lector de inventario ' +
      'de SoftRestaurant (F2-241). Mientras tanto no hay valor ni semáforo que mostrar.',
  };
}

/** Sucursales del alcance que no han mandado ninguna foto (para el aviso). */
export function sucursalesSinLectura(r: Existencias): string[] {
  return r.sucursales.filter((s) => s.almacenesLeidos === 0).map((s) => s.sucursal);
}

/** Almacenes cuya última lectura va atrasada (recibida hace más de 90 min). */
export function almacenesAtrasados(r: Existencias): AlmacenExistencias[] {
  return r.almacenes.filter((a) => a.atrasada);
}

/** "" → null; lo demás, tal cual (el API valida el formato y responde 400 si no). */
export function vacioANulo(v: string): string | null {
  const t = v.trim();
  return t === '' ? null : t;
}
