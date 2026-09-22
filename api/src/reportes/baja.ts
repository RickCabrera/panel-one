import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * El enlace de baja de los reportes (F2-141): funciona SIN sesión, así que el token es la
 * única credencial. Es `<suscripcionId>.<firma>`, con la firma = HMAC-SHA256 de la
 * suscripción con la llave de `ReportesConfig.claveBaja`, en base64url.
 *
 * Sólo sirve para APAGAR reportes de esa suscripción: no da acceso a ningún dato. No
 * caduca (un correo de hace un mes tiene que poder darse de baja); se invalida si se rota
 * `JWT_ACCESS_SECRET`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function firma(clave: Buffer, suscripcionId: string): Buffer {
  return createHmac('sha256', clave).update(`suscripcion:${suscripcionId}`).digest();
}

export function tokenBaja(clave: Buffer, suscripcionId: string): string {
  return `${suscripcionId}.${firma(clave, suscripcionId).toString('base64url')}`;
}

/** El id de la suscripción si el token es auténtico; null si no (forma rara o firma mala). */
export function verificarTokenBaja(clave: Buffer, token: string): string | null {
  const punto = token.indexOf('.');
  if (punto < 0) return null;
  const id = token.slice(0, punto);
  const recibida = token.slice(punto + 1);
  if (!UUID.test(id) || !/^[A-Za-z0-9_-]{43}$/.test(recibida)) return null;
  const esperada = firma(clave, id);
  const dada = Buffer.from(recibida, 'base64url');
  if (dada.length !== esperada.length || !timingSafeEqual(dada, esperada)) return null;
  return id;
}
