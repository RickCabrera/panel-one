import type { MesasSucursal } from '../../api/tipos';
import { aCentavos, sumar } from '../../dinero/dinero';

export interface VentaEnVivo {
  /** Σ de las cuentas abiertas; `null` si alguna mesa no trae un `total` legible. */
  total: bigint | null;
  mesas: number;
  /** Sucursales con al menos un snapshot. */
  reportando: number;
  /** Nombres de las que nunca han mandado uno. */
  sinReporte: string[];
  /** El snapshot más viejo que entra en la suma, en segundos (reloj del servidor). */
  edadMaximaSegundos: number | null;
}

/**
 * DECISION PROVISIONAL (nocturno): la forma de cada mesa del snapshot NO está
 * fijada todavía (esquema-sr.md §5, SUPUESTO; la fijan F1-023/F1-050). Se supone un
 * campo `total` con el importe de la cuenta abierta, en texto decimal o número. Si
 * UNA sola mesa no lo trae legible, la tarjeta dice "Sin dato" en vez de una suma
 * parcial que parezca completa. El seed de F1-032 no trae snapshots: esto sólo se
 * ha probado con respuestas falsas (ventaEnVivo.test.ts, Inicio.test.tsx).
 *
 * La edad es `edadRecepcionSegundos` (reloj del servidor), no `edadSegundos` (reloj
 * de la PC del POS, que puede estar desfasado). Aquí sólo se muestra: la regla de
 * "sucursal desconectada" es de F1-050.
 */
export function ventaEnVivo(filas: readonly MesasSucursal[]): VentaEnVivo {
  const montos: bigint[] = [];
  let legible = true;
  let mesas = 0;
  let edadMaxima: number | null = null;
  const sinReporte: string[] = [];

  for (const fila of filas) {
    if (!fila.snapshot) {
      sinReporte.push(fila.nombre);
      continue;
    }
    edadMaxima = Math.max(edadMaxima ?? 0, fila.snapshot.edadRecepcionSegundos);
    for (const mesa of fila.snapshot.mesas) {
      mesas += 1;
      const monto = totalDe(mesa);
      if (monto === null) legible = false;
      else montos.push(monto);
    }
  }

  return {
    total: legible ? sumar(montos) : null,
    mesas,
    reportando: filas.length - sinReporte.length,
    sinReporte,
    edadMaximaSegundos: edadMaxima,
  };
}

export function totalDe(mesa: Record<string, unknown>): bigint | null {
  const total = mesa.total;
  if (typeof total === 'string') return aCentavos(total);
  if (typeof total === 'number' && Number.isFinite(total)) return aCentavos(String(total));
  return null;
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
