import type { MesaMonitor } from './reglas';

/**
 * La cuenta que está abierta en el modal de detalle (F1-051). No es una copia de la
 * mesa: se vuelve a buscar en cada poll, así el modal muestra lo mismo que el grid
 * (partidas nuevas, minutos que avanzan) sin pedir nada nuevo al API.
 */
export interface Seleccion {
  sucursalId: string;
  folio: string | null;
  mesa: string | null;
  abiertoAt: number | null;
  clave: string;
  /** `dataUpdatedAt` de la respuesta en la que se eligió. */
  respuestaAt: number;
  /** "Mesa 12 · Centro": el título del modal, aunque la cuenta desaparezca. */
  titulo: string;
}

export function seleccionDe(m: MesaMonitor, respuestaAt: number, titulo: string): Seleccion {
  return {
    sucursalId: m.sucursalId,
    folio: m.folio,
    mesa: m.mesa,
    abiertoAt: m.abiertoAt,
    clave: m.clave,
    respuestaAt,
    titulo,
  };
}

/**
 * La mesa seleccionada en el monitor de ahora, o `null` si ya no está (se cerró, o su
 * sucursal dejó de mostrarse en vivo).
 *
 * - En la MISMA respuesta en que se eligió, la `clave` la identifica sin duda.
 * - En una respuesta nueva, con folio: sucursal + folio; un folio repetido es ambiguo.
 * - Sin folio, la `clave` lleva la posición en el snapshot, que se corre cuando se
 *   cierra otra cuenta: sólo vale si coinciden número de mesa y hora de apertura, y
 *   sin hora de apertura no hay con qué confirmarlo. Mejor "ya no aparece" que otra
 *   cuenta bajo el mismo título.
 */
export function buscarSeleccion(
  mesas: readonly MesaMonitor[],
  respuestaAt: number,
  sel: Seleccion | null,
): MesaMonitor | null {
  if (sel === null) return null;
  const porClave = mesas.find((m) => m.clave === sel.clave && m.sucursalId === sel.sucursalId);
  if (respuestaAt === sel.respuestaAt) return porClave ?? null;
  if (sel.folio !== null) {
    const iguales = mesas.filter((m) => m.sucursalId === sel.sucursalId && m.folio === sel.folio);
    return iguales.length === 1 ? iguales[0] : null;
  }
  if (
    !porClave ||
    sel.abiertoAt === null ||
    porClave.folio !== null ||
    porClave.mesa !== sel.mesa ||
    porClave.abiertoAt !== sel.abiertoAt
  ) {
    return null;
  }
  return porClave;
}
