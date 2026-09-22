/**
 * Puerto de correo saliente (F2-202). Lo consumen F2-105 (entrega de la factura) y
 * F2-141 (reportes programados) inyectando `PUERTO_CORREO`. La plantilla llega YA
 * renderizada: armar el asunto y el cuerpo es de quien manda, no del puerto.
 */

export interface Destinatario {
  email: string;
  nombre?: string;
}

export interface PlantillaCorreo {
  /** Identificador estable de la plantilla (p. ej. "factura-emitida"), para rastrear. */
  nombre: string;
  asunto: string;
  html: string;
  texto: string;
}

export interface Adjunto {
  nombre: string;
  /** Tipo MIME, p. ej. "application/pdf". */
  tipo: string;
  contenido: Buffer;
}

export interface OpcionesCorreo {
  /** Empresa a la que pertenece el correo; ausente si no es de ninguna. */
  empresaId?: string;
}

export interface PuertoCorreo {
  enviar(
    destinatario: Destinatario,
    plantilla: PlantillaCorreo,
    adjuntos: Adjunto[],
    opciones?: OpcionesCorreo,
  ): Promise<{ id: string }>;
}
