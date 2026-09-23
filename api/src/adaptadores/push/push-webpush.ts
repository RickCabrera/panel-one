import webpush from 'web-push';

import { motivoEndpointInvalido } from './endpoint';
import type {
  DispositivoDestino,
  MensajePush,
  OpcionesPush,
  PuertoPush,
  ResultadoPush,
} from './puerto';

/** Tope de espera por envío: un servicio de push que no contesta no cuelga la vuelta. */
export const TIMEOUT_PUSH_MS = 10_000;

export interface LlavesVapid {
  publica: string;
  privada: string;
  /** `mailto:` o `https:`: el contacto que ve el servicio de push si abusamos. */
  sujeto: string;
}

/** La parte de `web-push` que se usa: inyectable para que el test no dependa del módulo global. */
export type EnviarWebPush = typeof webpush.sendNotification;

/**
 * Push REAL (F2-146) con `web-push`: cifra el cuerpo (RFC 8291, `aes128gcm`) con las
 * llaves del navegador y firma la petición con VAPID (RFC 8292). Las llaves privadas
 * nunca salen de este objeto ni de un mensaje de error.
 *
 * El contrato (qué cabeceras, qué JWT, qué cuerpo cifrado) lo fija
 * `push.contrato.spec.ts`: arma la petición exacta con `generateRequestDetails` de la misma
 * librería, verifica la firma VAPID y DESCIFRA el cuerpo con las llaves de un navegador
 * generado en el test. Sin red.
 */
export class PushWebPush implements PuertoPush {
  readonly clavePublica: string;

  constructor(
    private readonly llaves: LlavesVapid,
    private readonly hostsExtra: readonly string[],
    private readonly enviarWebPush: EnviarWebPush = webpush.sendNotification.bind(webpush),
  ) {
    this.clavePublica = llaves.publica;
  }

  async enviar(
    destino: DispositivoDestino,
    mensaje: MensajePush,
    opciones: OpcionesPush,
  ): Promise<ResultadoPush> {
    // Otra vez aquí, justo antes de salir a la red: una fila guardada antes de que cambiara
    // la lista no pasa. Se trata como caducada: el dispositivo se borra y no se reintenta.
    if (motivoEndpointInvalido(destino.endpoint, this.hostsExtra) !== null) return 'caducado';
    let status: unknown;
    try {
      await this.enviarWebPush(
        { endpoint: destino.endpoint, keys: { p256dh: destino.p256dh, auth: destino.auth } },
        JSON.stringify(mensaje),
        {
          vapidDetails: {
            subject: this.llaves.sujeto,
            publicKey: this.llaves.publica,
            privateKey: this.llaves.privada,
          },
          TTL: opciones.ttlS,
          urgency: opciones.urgencia,
          contentEncoding: 'aes128gcm',
          timeout: TIMEOUT_PUSH_MS,
        },
      );
      return 'entregado';
    } catch (error) {
      status = (error as { statusCode?: unknown }).statusCode;
    }
    if (status === 404 || status === 410) return 'caducado';
    // Fuera del catch y SIN el error original como `cause`: su cuerpo y sus cabeceras pueden
    // traer el endpoint completo, que no va a un log.
    throw new Error(
      `El servicio de push rechazó el envío${typeof status === 'number' ? ` (HTTP ${status})` : ''}.`,
    );
  }
}
