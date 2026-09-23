/** Qué cambió en la sucursal con el lote de ingesta. */
export interface CambiosIngesta {
  /** Llegó (y se guardó) al menos un snapshot de mesas. */
  mesas: boolean;
  /** Llegó (y se guardó) al menos un cheque. */
  cheques: boolean;
}

/** El evento `ingesta` del socket: SÓLO un aviso, nunca datos (ver `docs/tiempo-real.md`). */
export interface AvisoIngesta extends CambiosIngesta {
  sucursalId: string;
}

/**
 * El aviso de "la sucursal mandó datos nuevos" (F2-142). La ingesta lo llama DESPUÉS de que sus
 * transacciones confirmaron; lo implementa el gateway del socket. Clase abstracta para que sea
 * el token de inyección y los tests la puedan reemplazar.
 */
export abstract class AvisosTiempoReal {
  abstract avisarIngesta(empresaId: string, sucursalId: string, cambios: CambiosIngesta): void;
}
