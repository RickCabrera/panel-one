import type { VentaHora } from '../../api/tipos';
import { aCentavos, formatearPesos, paraGrafica } from '../../dinero/dinero';
import { leerAcento } from '../../tema/acento';

/** El mismo acento que `main.tsx` pone en `:root` (SVG no lee bien `var()` en atributos). */
export const ACENTO = leerAcento(import.meta.env.VITE_COLOR_ACENTO as string | undefined);

export interface PuntoHora {
  hora: number;
  etiqueta: string;
  /** Sólo para la posición del punto. `null` = importe ilegible: hueco en la línea. */
  valor: number | null;
  /** Lo que se lee: el importe exacto, formateado desde el texto de la API, o "Sin dato". */
  texto: string;
  cuentas: number;
}

/**
 * Las 24 horas, en orden. La API ya manda las 24 con cero donde no hubo cierres; si
 * alguna faltara, su cero también es real (no hubo cierres), así que se rellena.
 *
 * Una hora que SÍ viene pero con un importe que no se puede leer no es cero: queda
 * `valor: null` (la línea se corta ahí) y "Sin dato" (F1-094).
 */
export function datosPorHora(filas: readonly VentaHora[]): PuntoHora[] {
  return Array.from({ length: 24 }, (_, hora) => {
    const fila = filas.find((f) => f.hora === hora);
    const centavos = fila ? aCentavos(fila.venta) : 0n;
    return {
      hora,
      etiqueta: `${String(hora).padStart(2, '0')}:00`,
      valor: centavos === null ? null : paraGrafica(centavos),
      texto: centavos === null ? 'Sin dato' : formatearPesos(centavos),
      cuentas: fila?.cuentas ?? 0,
    };
  });
}

export const COLORES_FORMA = [ACENTO, '#6366f1', '#f59e0b', '#94a3b8'];
