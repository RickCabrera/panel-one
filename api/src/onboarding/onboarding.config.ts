/**
 * Configuración del onboarding y de la landing (F2-147), sólo de variables de entorno.
 *
 * - `CONTACTO_DESTINO`: a qué buzón llega el formulario de contacto de la landing (sale por el
 *   `PuertoCorreo`: Brevo en producción, el falso en local). Sin ella, fuera de producción se usa
 *   un buzón local de relleno; EN producción el formulario responde 503 y el resto del api
 *   arranca igual.
 *   DECISION PROVISIONAL (nocturno): no tumbar el arranque del api entero por el formulario de
 *   la landing. El buzón real se conecta en F2-191.
 * - `AGENTE_URL_DESCARGA`: de dónde se baja el instalador del agente (el wizard y el checklist
 *   lo enlazan). Sin ella, la UI dice que el instalador lo entrega soporte. F2-143 (canal de
 *   versiones) la reemplazará por una URL firmada.
 *
 * Un valor MAL FORMADO en cualquiera de las dos truena el arranque nombrando la variable: no se
 * adivina, igual que en `adaptadores/config.ts`.
 */

export const CONTACTO_DESTINO_LOCAL = 'contacto@monitor.local';

export interface OnboardingConfig {
  /** Nulo = el formulario de contacto no tiene a dónde mandar (sólo en producción). */
  contactoDestino: string | null;
  descargaAgente: string | null;
}

export const ONBOARDING_CONFIG = Symbol('ONBOARDING_CONFIG');

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function vacio(valor: string | undefined): boolean {
  return valor === undefined || valor.trim() === '';
}

export function leerOnboardingConfig(entorno: NodeJS.ProcessEnv = process.env): OnboardingConfig {
  const produccion = entorno.NODE_ENV === 'production';

  let contactoDestino: string | null;
  if (vacio(entorno.CONTACTO_DESTINO)) {
    contactoDestino = produccion ? null : CONTACTO_DESTINO_LOCAL;
  } else {
    const valor = entorno.CONTACTO_DESTINO!.trim();
    if (!EMAIL.test(valor)) {
      throw new Error('CONTACTO_DESTINO no es un email válido.');
    }
    contactoDestino = valor;
  }

  let descargaAgente: string | null = null;
  if (!vacio(entorno.AGENTE_URL_DESCARGA)) {
    const valor = entorno.AGENTE_URL_DESCARGA!.trim();
    let url: URL;
    try {
      url = new URL(valor);
    } catch {
      throw new Error('AGENTE_URL_DESCARGA no es una URL válida.');
    }
    if (url.protocol !== 'https:') {
      throw new Error('AGENTE_URL_DESCARGA tiene que ser https.');
    }
    descargaAgente = url.toString();
  }

  return { contactoDestino, descargaAgente };
}
