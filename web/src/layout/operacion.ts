import type { MesasSucursal } from '../api/tipos';
import { armarMonitor, type Frescura } from '../paginas/mesas/reglas';

/**
 * El indicador de operación en vivo de la cabecera (F2-212), a partir de la MISMA
 * respuesta de `/mesas/abiertas` que usa el Monitor y con sus mismas reglas
 * (`armarMonitor`): una sucursal "reporta" si está conectada (último snapshot de hace
 * ≤ 90 s, reloj del servidor más lo que lleva la respuesta en el navegador).
 *
 * La hora es la de `kpis.ultimaLectura` (regla F1-094: la lectura más vieja de las que
 * reportan), la misma que el KPI "Última lectura" del Monitor, para que cabecera y
 * monitor nunca digan horas distintas. Sin ninguna sucursal reportando NO hay hora:
 * una hora vieja junto a un punto se lee como "en vivo".
 *
 * El conteo es del alcance elegido: con una sucursal en el selector es "1 de 1" o
 * "0 de 1", aunque las otras de la empresa sí reporten.
 */
export type Operacion =
  | { estado: 'consultando' }
  | { estado: 'sin-sucursales' }
  /** `total` es null si la consulta falló sin haber respondido nunca. */
  | { estado: 'sin-lectura'; total: number | null }
  | {
      estado: 'en-vivo';
      frescura: Exclude<Frescura, 'desconectada'>;
      recibidoAt: number;
      reportando: number;
      total: number;
    };

export function operacionDe(
  filas: readonly MesasSucursal[] | undefined,
  respuestaAt: number,
  ahora: number,
  fallo = false,
): Operacion {
  if (filas === undefined)
    return fallo ? { estado: 'sin-lectura', total: null } : { estado: 'consultando' };
  if (filas.length === 0) return { estado: 'sin-sucursales' };
  const monitor = armarMonitor(filas, respuestaAt, ahora);
  const reportando = monitor.sucursales.filter((s) => s.estado === 'conectada').length;
  const lectura = monitor.kpis.ultimaLectura;
  if (reportando === 0 || lectura === null || lectura.frescura === 'desconectada') {
    return { estado: 'sin-lectura', total: filas.length };
  }
  return {
    estado: 'en-vivo',
    frescura: lectura.frescura,
    recibidoAt: lectura.recibidoAt,
    reportando,
    total: filas.length,
  };
}

/**
 * `useConReloj` compara con `Object.is`: el estado se codifica en un texto para que el
 * indicador sólo se vuelva a pintar cuando algo visible cambia, no cada pulso.
 */
export function codificar(operacion: Operacion): string {
  return JSON.stringify(operacion);
}

export function decodificar(texto: string): Operacion {
  return JSON.parse(texto) as Operacion;
}

export function textoSucursales(reportando: number, total: number): string {
  return total === 1
    ? `${reportando} de 1 sucursal reportando`
    : `${reportando} de ${total} sucursales reportando`;
}
