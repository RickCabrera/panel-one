/**
 * Puerto de notificaciones push (F2-146, regla 1 de la Ronda 2). El servicio de push es
 * de terceros (FCM, Mozilla, WNS, Apple): el negocio habla con esta interfaz y nunca con
 * una implementación. `PUSH_IMPL` elige cuál (`adaptadores/config.ts`).
 */

/** Lo que el navegador entrega al suscribirse (`PushSubscription.toJSON()`). */
export interface DispositivoDestino {
  endpoint: string;
  /** Llave pública ECDH P-256 del navegador, base64url (65 bytes sin comprimir). */
  p256dh: string;
  /** Secreto de autenticación del navegador, base64url (16 bytes). */
  auth: string;
}

/**
 * El cuerpo que recibe el service worker (`web/src/pwa/sw-logica.ts`). `url` es SIEMPRE
 * una ruta relativa del panel: el service worker no abre otro origen.
 */
export interface MensajePush {
  titulo: string;
  cuerpo: string;
  url: string;
  /** Misma etiqueta = la notificación nueva reemplaza a la anterior en el dispositivo. */
  etiqueta: string;
}

export type UrgenciaPush = 'very-low' | 'low' | 'normal' | 'high';

export interface OpcionesPush {
  /** Segundos que el servicio de push guarda el mensaje si el dispositivo está apagado. */
  ttlS: number;
  urgencia: UrgenciaPush;
}

/**
 * `entregado`: el servicio de push lo aceptó (201). `caducado`: la suscripción ya no
 * existe (404/410) y el dispositivo se debe borrar. Cualquier otra falla LANZA.
 */
export type ResultadoPush = 'entregado' | 'caducado';

export interface PuertoPush {
  /** La llave pública VAPID que el navegador usa al suscribirse; null si no hay llaves. */
  readonly clavePublica: string | null;
  enviar(
    destino: DispositivoDestino,
    mensaje: MensajePush,
    opciones: OpcionesPush,
  ): Promise<ResultadoPush>;
}
