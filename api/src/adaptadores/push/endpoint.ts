import { isIP } from 'node:net';

/**
 * Qué URL de suscripción se acepta (F2-146). El api hace un POST a esa URL: sin esta
 * lista, cualquier usuario con sesión convierte al servidor en un cliente HTTP hacia
 * donde quiera (SSRF). Se valida al guardar el dispositivo Y otra vez en el adaptador
 * real, justo antes de mandar (una fila guardada antes de cambiar la lista no pasa).
 */

/**
 * Servicios de push de los navegadores. Una entrada que empieza con punto acepta
 * subdominios (`.notify.windows.com` acepta `wns2-by3p.notify.windows.com`, NO
 * `evilnotify.windows.com`); sin punto, el host exacto.
 */
export const HOSTS_PUSH_CONOCIDOS: readonly string[] = [
  'fcm.googleapis.com', // Chrome, Edge (Chromium), Android
  'updates.push.services.mozilla.com', // Firefox
  '.notify.windows.com', // Edge heredado / Windows
  '.push.apple.com', // Safari (web.push.apple.com)
];

/** Un endpoint real mide ~200 caracteres; 1 KB ya es sospechoso. */
export const LARGO_MAXIMO_ENDPOINT = 1024;

const NOMBRE_HOST =
  /^\.?(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * `PUSH_HOSTS_PERMITIDOS` (coma): hosts EXTRA para un servicio que no esté en la lista.
 * Sólo nombres de host (con punto inicial para subdominios): ni esquema, ni puerto, ni
 * IP. Un valor inválido TRUENA el arranque nombrando la variable.
 */
export function leerHostsExtra(valor: string | undefined): string[] {
  if (!valor) return [];
  return valor
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter((h) => h !== '')
    .map((h) => {
      if (!NOMBRE_HOST.test(h) || isIP(h.replace(/^\./, '')) !== 0) {
        throw new Error(
          `PUSH_HOSTS_PERMITIDOS: "${h}" no es un nombre de host (sin esquema, puerto ni IP).`,
        );
      }
      return h;
    });
}

function hostPermitido(host: string, permitidos: readonly string[]): boolean {
  return permitidos.some((p) => (p.startsWith('.') ? host.endsWith(p) : host === p));
}

/** null si el endpoint se acepta; si no, la razón (en español, para el 400). */
export function motivoEndpointInvalido(
  endpoint: string,
  hostsExtra: readonly string[] = [],
): string | null {
  if (endpoint.length > LARGO_MAXIMO_ENDPOINT) return 'La suscripción es demasiado larga.';
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return 'La suscripción no es una URL.';
  }
  if (url.protocol !== 'https:') return 'La suscripción tiene que ser https.';
  if (url.username !== '' || url.password !== '') return 'La suscripción no puede llevar usuario.';
  if (url.port !== '' && url.port !== '443') return 'La suscripción no puede llevar otro puerto.';
  const host = url.hostname.toLowerCase();
  if (isIP(host.replace(/^\[|\]$/g, '')) !== 0) return 'La suscripción no puede ser una IP.';
  if (!hostPermitido(host, [...HOSTS_PUSH_CONOCIDOS, ...hostsExtra])) {
    return 'La suscripción no es de un servicio de notificaciones conocido.';
  }
  return null;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

/** Bytes de un texto base64url, o null si no es base64url. */
export function bytesBase64Url(texto: string): number | null {
  if (!BASE64URL.test(texto) || texto.length % 4 === 1) return null;
  return Buffer.from(texto, 'base64url').length;
}

/** Las llaves del navegador: p256dh = punto P-256 sin comprimir (65 bytes, 0x04…), auth = 16. */
export function llavesValidas(p256dh: string, auth: string): boolean {
  if (bytesBase64Url(p256dh) !== 65 || bytesBase64Url(auth) !== 16) return false;
  return Buffer.from(p256dh, 'base64url')[0] === 0x04;
}
