import type { EstadoAgenteSucursal } from '../../api/tipos';
import { edadEfectiva, UMBRAL_DESCONEXION_S } from '../mesas/reglas';

/**
 * Estado de los agentes (F1-061). El API da edades (reloj del servidor); los
 * umbrales viven aquí.
 *
 * Desconectado = más de `UMBRAL_DESCONEXION_S` (3 intervalos de 30 s = 90 s) sin
 * contacto: el MISMO umbral del Monitor de Mesas y el que pide F1-025 ("3 intervalos
 * sin heartbeat"). Ojo: eso son 90 s desde el último contacto, más que el "< 1 min"
 * del AC de F1-061; es una decisión abierta para Ricardo (ver el log).
 */
export type EstadoAgente = 'conectado' | 'desconectado' | 'sin-reporte';

/** Backlog F1-061: badge si alguna sucursal lleva > 10 min sin reportar. */
export const UMBRAL_ALERTA_S = 10 * 60;

export function estadoAgente(edadContacto: number | null): EstadoAgente {
  if (edadContacto === null) return 'sin-reporte';
  return edadContacto > UMBRAL_DESCONEXION_S ? 'desconectado' : 'conectado';
}

/**
 * La edad de una edad del API AHORA: la que dio el servidor más lo que lleva la
 * respuesta en el navegador. `respuestaAt` tiene que ser el `dataUpdatedAt` de la
 * última respuesta BUENA: si el API se cae, la edad sigue creciendo y el agente pasa
 * solo a desconectado, en vez de quedarse con la última respuesta como si fuera viva.
 */
export function edadAhora(
  edadApi: number | null,
  respuestaAt: number,
  ahora: number,
): number | null {
  return edadApi === null ? null : edadEfectiva(edadApi, respuestaAt, ahora);
}

/**
 * Las sucursales que llevan MÁS de 10 min sin reportar.
 *
 * DECISION PROVISIONAL (nocturno): una sucursal que NUNCA ha reportado no cuenta.
 * Una sucursal recién dada de alta, sin agente instalado todavía, dejaría el badge
 * prendido para siempre y el badge dejaría de significar algo. En la tabla sí sale,
 * como "Sin reporte". Anotado en el log de F1-061 para que Ricardo decida.
 */
export function sinReportar(
  filas: readonly EstadoAgenteSucursal[],
  respuestaAt: number,
  ahora: number,
): EstadoAgenteSucursal[] {
  return filas.filter((f) => {
    const edad = edadAhora(f.edadContactoSegundos, respuestaAt, ahora);
    return edad !== null && edad > UMBRAL_ALERTA_S;
  });
}
