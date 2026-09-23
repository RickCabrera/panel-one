import { instanteDesdeLocal } from '../comun/fechas';

/**
 * Reglas puras de la conciliación con el PAC (F2-110b): los plazos y el lector de la fecha de
 * timbrado de un XML. Sin base y sin red. Las usan `EscrituraFacturacion` (bajo candado) y
 * `ConciliacionPacService`.
 *
 * DECISION PROVISIONAL (nocturno) en los tres plazos (docs/esquema-sr.md §2 "Conciliación con el
 * PAC (F2-110b)"; se validan en F2-190):
 * - `EDAD_MINIMA_MS`: una reserva o un CFDI más nuevo NO se toca. Puede haber una llamada al PAC en
 *   vuelo (tope HTTP 30 s) y el PAC puede tardar en listar lo que acaba de timbrar.
 * - `RECLAMO_MS`: un CFDI que una vuelta reclamó no lo vuelve a tomar otra antes (el candado en
 *   base y la rotación). También es la separación MÍNIMA entre las dos búsquedas vacías que exige
 *   liberar una reserva.
 * - `VENTANA_SIN_CONFIRMAR_MS`: una cancelación `sin_confirmar` que el PAC sigue viendo vigente
 *   después de esto se da por no registrada (se borra, como antes de F2-110b a los 10 min).
 */
export const EDAD_MINIMA_MS = 15 * 60 * 1000;
export const RECLAMO_MS = 15 * 60 * 1000;
export const VENTANA_SIN_CONFIRMAR_MS = 7 * 24 * 3600 * 1000;

/** Cuántos elementos de cada tipo revisa una vuelta (los más viejos primero). */
export const LIMITE_POR_TIPO = 50;

/** ¿Una reserva (o un CFDI) ya tiene la edad para que la conciliación la toque? */
export function tieneEdad(desde: Date, ahora: Date): boolean {
  return ahora.getTime() - desde.getTime() >= EDAD_MINIMA_MS;
}

/** Lo que se dice de una búsqueda por folio que NO encontró la reserva. */
export type TrasBusquedaVacia = 'anotar' | 'liberar' | 'esperar';

/**
 * Liberar una reserva exige DOS búsquedas vacías separadas al menos `RECLAMO_MS`: la primera sólo se
 * anota; la segunda libera si ya pasó el plazo desde la primera (si no, se espera).
 */
export function trasBusquedaVacia(primeraVacia: Date | null, ahora: Date): TrasBusquedaVacia {
  if (primeraVacia === null) return 'anotar';
  return ahora.getTime() - primeraVacia.getTime() >= RECLAMO_MS ? 'liberar' : 'esperar';
}

/** ¿Venció la ventana de una cancelación `sin_confirmar`? */
export function ventanaVencida(solicitadaAt: Date, ahora: Date): boolean {
  return ahora.getTime() - solicitadaAt.getTime() >= VENTANA_SIN_CONFIRMAR_MS;
}

const FECHA_TIMBRADO = /<tfd:TimbreFiscalDigital\b[^>]*\bFechaTimbrado="([^"]+)"/;

/**
 * La `FechaTimbrado` del Timbre Fiscal Digital de un XML, como instante UTC. El Anexo 20 la escribe
 * en hora LOCAL del lugar de expedición sin offset: se lee en la zona de la sucursal, nunca en la
 * del servidor. Null si no está o no se puede leer.
 */
export function fechaTimbradoDeXml(xml: string, zonaHoraria: string): Date | null {
  const m = FECHA_TIMBRADO.exec(xml);
  return m ? instanteDesdeLocal(m[1], zonaHoraria) : null;
}

/**
 * La fecha con que se confirma una reserva que el PAC sí timbró: la que diga el PAC, si no la del
 * XML, y si no la de la reserva (el `Fecha` que se mandó al PAC ES la de la reserva, así que el
 * timbre no puede ser anterior).
 * DECISION PROVISIONAL (nocturno): el último respaldo es la fecha de la RESERVA; el mes en que cuenta
 * el folio podría diferir del real si el timbre llegó en otro día. Se valida en F2-190.
 */
export function fechaDeConfirmacion(
  delPac: Date | null,
  xml: string | null,
  zonaHoraria: string,
  reservadaAt: Date,
): Date {
  return delPac ?? (xml !== null ? fechaTimbradoDeXml(xml, zonaHoraria) : null) ?? reservadaAt;
}

/** Cómo terminó una vuelta de conciliación: por tipo, y lo que requiere a una persona. */
export interface ResumenConciliacion {
  reservas: { revisadas: number; confirmadas: number; liberadas: number; enEspera: number };
  cancelaciones: { revisadas: number; canceladas: number; descartadas: number };
  sustituciones: { revisadas: number; cerradas: number };
  archivos: { revisados: number; recuperados: number };
  /** Elementos donde el PAC falló o contestó algo que no permite decidir: se reintentan solos. */
  fallidas: number;
  /**
   * Serie-folio de las reservas que se confirmaron aunque el PAC ya las reporta canceladas (o en
   * cancelación): existen ante el SAT, pero su cancelación no pasó por aquí. Se revisan a mano.
   */
  requierenRevision: string[];
}

export function resumenVacio(): ResumenConciliacion {
  return {
    reservas: { revisadas: 0, confirmadas: 0, liberadas: 0, enEspera: 0 },
    cancelaciones: { revisadas: 0, canceladas: 0, descartadas: 0 },
    sustituciones: { revisadas: 0, cerradas: 0 },
    archivos: { revisados: 0, recuperados: 0 },
    fallidas: 0,
    requierenRevision: [],
  };
}

/** ¿La vuelta cambió algo (para loguear sólo entonces)? */
export function huboCambios(r: ResumenConciliacion): boolean {
  return (
    r.reservas.confirmadas +
      r.reservas.liberadas +
      r.cancelaciones.canceladas +
      r.cancelaciones.descartadas +
      r.sustituciones.cerradas +
      r.archivos.recuperados +
      r.fallidas >
    0
  );
}
