import type { ClienteHttp, PeticionHttp } from '../http';
import type { Adjunto, Destinatario, PlantillaCorreo, PuertoCorreo } from './puerto';

/*
 * Correo real: Brevo, API transaccional v3 (F2-202).
 *
 * SUPUESTO NO VALIDADO (se confirma en F2-191, Diurna, con la cuenta y el dominio
 * verificados): la ruta `POST /v3/smtp/email`, la cabecera `api-key` y los campos
 * `sender`, `to`, `subject`, `htmlContent`, `textContent`, `attachment[{name, content}]`
 * (contenido en base64) y `tags` salen de la documentación pública de Brevo. El test
 * de contrato fija lo que mandamos; F2-191 confirma que Brevo lo acepta.
 */

export const URL_BREVO = 'https://api.brevo.com/v3/smtp/email';

export function peticionBrevo(
  remitente: { email: string; nombre: string },
  destinatario: Destinatario,
  plantilla: PlantillaCorreo,
  adjuntos: Adjunto[],
): PeticionHttp {
  return {
    metodo: 'POST',
    url: URL_BREVO,
    cuerpo: {
      sender: { email: remitente.email, name: remitente.nombre },
      to: [
        destinatario.nombre
          ? { email: destinatario.email, name: destinatario.nombre }
          : { email: destinatario.email },
      ],
      subject: plantilla.asunto,
      htmlContent: plantilla.html,
      textContent: plantilla.texto,
      ...(adjuntos.length > 0
        ? {
            attachment: adjuntos.map((a) => ({
              name: a.nombre,
              content: a.contenido.toString('base64'),
            })),
          }
        : {}),
      tags: [plantilla.nombre],
    },
  };
}

export class CorreoBrevo implements PuertoCorreo {
  constructor(
    private readonly remitente: { email: string; nombre: string },
    private readonly http: ClienteHttp,
  ) {}

  async enviar(
    destinatario: Destinatario,
    plantilla: PlantillaCorreo,
    adjuntos: Adjunto[],
    // Sin `opciones`: la empresa no viaja a Brevo; la usará la bitácora de F2-105.
  ): Promise<{ id: string }> {
    const r = await this.http.enviar(
      peticionBrevo(this.remitente, destinatario, plantilla, adjuntos),
    );
    const cuerpo = (r.cuerpo ?? {}) as { messageId?: string; message?: string };
    if (r.status < 200 || r.status >= 300 || !cuerpo.messageId) {
      throw new Error(
        `El servicio de correo rechazó el envío (HTTP ${r.status})${cuerpo.message ? `: ${cuerpo.message}` : ''}.`,
      );
    }
    return { id: cuerpo.messageId };
  }
}
