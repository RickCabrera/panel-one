import type { EstadoAgenteSucursal } from '../../api/tipos';

/** X.Y.Z, cada parte de 1 a 4 dígitos: lo mismo que valida el api (F2-143). */
export const FORMATO_VERSION = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** La versión X.Y.Z que reporta el heartbeat, sin el `+commit`. */
export function versionSinCommit(v: string | null): string | null {
  if (v === null) return null;
  const base = v.split('+')[0].trim();
  return FORMATO_VERSION.test(base) ? base : null;
}

export type EstadoActualizacionSucursal =
  'sin-bandera' | 'sin-version' | 'al-dia' | 'fallo' | 'pendiente';

/** En qué va la actualización de UNA sucursal, a partir de su fila del estado de agentes. */
export function estadoActualizacion(f: EstadoAgenteSucursal): EstadoActualizacionSucursal {
  if (!f.actualizacionAutomatica) return 'sin-bandera';
  if (f.versionObjetivo === null) return 'sin-version';
  if (versionSinCommit(f.versionAgente) === f.versionObjetivo) return 'al-dia';
  const r = f.actualizacion;
  if (r !== null && r.resultado === 'fallida' && r.version === f.versionObjetivo) return 'fallo';
  return 'pendiente';
}
