import type { MesaViva } from './reglas';

/**
 * Orden y filtro del Monitor de mesas (F2-223). Viven en la URL (`?orden=&estado=`,
 * propios de la vista: NO van en `PARAMS_VISTA`) y además se recuerdan por usuario, para
 * que entrar desde el menú (que sólo lleva alcance y periodo) conserve el criterio.
 * Precedencia: URL válida > lo guardado válido > el default.
 */
export const PARAM_ORDEN = 'orden';
export const PARAM_ESTADO = 'estado';

export const ORDENES = ['mesa', 'antiguedad', 'importe'] as const;
export type OrdenMesas = (typeof ORDENES)[number];

export const ESTADOS = ['todas', 'atencion', 'sin-imprimir'] as const;
export type EstadoMesas = (typeof ESTADOS)[number];

export const ORDEN_DEFAULT: OrdenMesas = 'mesa';
export const ESTADO_DEFAULT: EstadoMesas = 'todas';

export const TEXTO_ORDEN: Record<OrdenMesas, string> = {
  mesa: 'Mesa',
  antiguedad: 'Antigüedad',
  importe: 'Importe',
};

export const TEXTO_ESTADO: Record<EstadoMesas, string> = {
  todas: 'Todas',
  atencion: 'Sólo atención',
  'sin-imprimir': 'Sólo sin imprimir',
};

export function leerOrden(v: unknown): OrdenMesas | null {
  return typeof v === 'string' && (ORDENES as readonly string[]).includes(v)
    ? (v as OrdenMesas)
    : null;
}

export function leerEstado(v: unknown): EstadoMesas | null {
  return typeof v === 'string' && (ESTADOS as readonly string[]).includes(v)
    ? (v as EstadoMesas)
    : null;
}

export interface CriterioMesas {
  orden: OrdenMesas;
  estado: EstadoMesas;
}

const clave = (usuarioId: string) => `monitor-mesas:${usuarioId}`;

/** Lo guardado para este usuario; cada campo inválido o ilegible es `null`. */
export function leerPreferencia(usuarioId: string): {
  orden: OrdenMesas | null;
  estado: EstadoMesas | null;
} {
  try {
    const crudo = window.localStorage.getItem(clave(usuarioId));
    if (!crudo) return { orden: null, estado: null };
    const valor: unknown = JSON.parse(crudo);
    if (valor === null || typeof valor !== 'object') return { orden: null, estado: null };
    const v = valor as Record<string, unknown>;
    return { orden: leerOrden(v.orden), estado: leerEstado(v.estado) };
  } catch {
    return { orden: null, estado: null };
  }
}

export function guardarPreferencia(usuarioId: string, criterio: CriterioMesas): void {
  try {
    window.localStorage.setItem(clave(usuarioId), JSON.stringify(criterio));
  } catch {
    // Sin storage el criterio dura lo que la URL; no es motivo para romper el monitor.
  }
}

/** URL válida > guardado válido > default, campo por campo. */
export function resolverCriterio(
  parametros: URLSearchParams,
  guardado: { orden: OrdenMesas | null; estado: EstadoMesas | null },
): CriterioMesas {
  return {
    orden: leerOrden(parametros.get(PARAM_ORDEN)) ?? guardado.orden ?? ORDEN_DEFAULT,
    estado: leerEstado(parametros.get(PARAM_ESTADO)) ?? guardado.estado ?? ESTADO_DEFAULT,
  };
}

/**
 * Ordena SIN depender del reloj: la antigüedad se mide con la apertura en el reloj del
 * navegador (`MesaViva.apertura`), que no cambia al avanzar la hora. La más vieja
 * primero; el importe, el mayor primero. Lo que no se puede medir ("Sin dato") va al
 * final, y los empates conservan el orden por mesa (el `sort` es estable).
 */
export function ordenarMesas(mesas: readonly MesaViva[], orden: OrdenMesas): MesaViva[] {
  const copia = [...mesas];
  if (orden === 'antiguedad') {
    copia.sort((a, b) => nulosAlFinal(a.apertura, b.apertura, (x, y) => x - y));
  } else if (orden === 'importe') {
    copia.sort((a, b) => nulosAlFinal(a.total, b.total, (x, y) => (x > y ? -1 : x < y ? 1 : 0)));
  }
  return copia;
}

function nulosAlFinal<T>(a: T | null, b: T | null, comparar: (x: T, y: T) => number): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return comparar(a, b);
}

/**
 * Filtra por estado. `atencion` son las `claves` que requieren atención a esta hora (las
 * calcula quien tiene el reloj); una mesa sin hora de apertura no entra: no se sabe.
 * `sin-imprimir` es `impreso === false`; un `null` tampoco entra.
 */
export function filtrarMesas(
  mesas: readonly MesaViva[],
  estado: EstadoMesas,
  enAtencion: ReadonlySet<string>,
): MesaViva[] {
  if (estado === 'atencion') return mesas.filter((m) => enAtencion.has(m.clave));
  if (estado === 'sin-imprimir') return mesas.filter((m) => m.impreso === false);
  return [...mesas];
}
