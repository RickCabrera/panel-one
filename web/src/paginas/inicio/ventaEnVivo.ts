import type { MesasSucursal } from '../../api/tipos';
import { armarMonitor, type EstadoSucursal } from '../mesas/reglas';

export interface VentaEnVivo {
  /**
   * Σ de las cuentas abiertas de las sucursales CONECTADAS; `null` si alguna de esas
   * mesas no trae un `total` legible (no hay suma parcial).
   */
  total: bigint | null;
  /** Mesas de las sucursales conectadas. */
  mesas: number;
  /** Sucursales con al menos un snapshot, conectadas o no. */
  reportando: number;
  /** Las que entran en la suma. */
  conectadas: number;
  /** Nombres de las que reportaron pero pasaron el umbral: NO se suman. */
  desconectadas: string[];
  /** Nombres de las que nunca han mandado uno. */
  sinReporte: string[];
  /** La lectura más vieja que entra en la suma, en segundos; `null` sin conectadas. */
  edadMaximaSegundos: number | null;
}

/**
 * La tarjeta "Venta en vivo" del Panel. Regla (F1-094): es EXACTAMENTE la cifra
 * "En curso" del Monitor de Mesas, porque se calcula con `armarMonitor`: una sucursal
 * cuyo snapshot pasó el umbral de desconexión (`mesas/reglas.ts`) no se suma en
 * ninguna de las dos vistas, y aquí se nombra como desconectada. `respuestaAt` es el
 * `dataUpdatedAt` de la consulta y `ahora` la hora del navegador: la edad sigue
 * creciendo entre consultas igual que en el Monitor.
 */
export function ventaEnVivo(
  filas: readonly MesasSucursal[],
  respuestaAt: number,
  ahora: number,
): VentaEnVivo {
  const { sucursales, kpis } = armarMonitor(filas, respuestaAt, ahora);
  const nombres = (estado: EstadoSucursal) =>
    sucursales.filter((s) => s.estado === estado).map((s) => s.nombre);
  const conectadas = nombres('conectada').length;
  const sinReporte = nombres('sin-reporte');
  return {
    total: kpis.enCurso,
    mesas: kpis.mesas,
    reportando: sucursales.length - sinReporte.length,
    conectadas,
    desconectadas: nombres('desconectada'),
    sinReporte,
    edadMaximaSegundos: kpis.ultimaLectura?.edadSegundos ?? null,
  };
}

/** "hace 3 min", "hace 2 h": la edad del dato, para que "en vivo" no engañe. */
export function edadLegible(segundos: number): string {
  if (segundos < 60) return 'hace menos de 1 min';
  const minutos = Math.floor(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.floor(minutos / 60);
  if (horas < 48) return `hace ${horas} h`;
  return `hace ${Math.floor(horas / 24)} días`;
}
