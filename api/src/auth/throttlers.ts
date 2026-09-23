import { SkipThrottle, type ThrottlerOptions } from '@nestjs/throttler';

import { THROTTLER_AGENTE } from '../agentes/throttle-agente';

/**
 * Throttlers por IP de las rutas de usuario. Todos se registran en el mismo
 * `ThrottlerModule.forRoot` (AuthModule) y un `ThrottlerGuard` aplica TODOS los
 * registrados salvo los que la ruta salte con `@SkipThrottle`: cada ruta con guard
 * salta explícitamente los que no son suyos (login, refresh, cuenta y
 * `@AutenticacionAgente()`).
 */
export const THROTTLER_LOGIN = 'login';
export const THROTTLER_LOGIN_HORA = 'login-hora';
export const THROTTLER_REFRESH = 'refresh';
export const THROTTLER_RESET = 'reset';
export const THROTTLER_BAJA = 'baja-reportes';
export const THROTTLER_CODIGO = 'codigo-facturacion';
export const THROTTLER_PORTAL = 'portal-facturacion';
export const THROTTLER_FACTURAS_PORTAL = 'facturas-portal';
export const THROTTLER_PRUEBA_PUSH = 'prueba-push';

/** `POST /auth/login` y `POST /cuenta/password`: 5 intentos por minuto por IP. */
export const OPCIONES_THROTTLER_LOGIN: ThrottlerOptions = {
  name: THROTTLER_LOGIN,
  ttl: 60_000,
  limit: 5,
};

/**
 * `POST /auth/refresh` y `POST /auth/logout` (F1-093): 30 por minuto por IP,
 * con un contador por ruta (un logout no gasta refresh). La SPA refresca una vez por pestaña
 * cada ~15 min (al vencer el access) y al abrir; 30 deja holgura a una oficina con
 * varias personas detrás de la misma IP y corta a quien lo martille.
 */
export const OPCIONES_THROTTLER_REFRESH: ThrottlerOptions = {
  name: THROTTLER_REFRESH,
  ttl: 60_000,
  limit: 30,
};

/**
 * `POST /auth/login` y `POST /cuenta/password`, ADEMÁS del de 5/min (F2-203): 30
 * por hora por IP. Con sólo el de minuto, alguien paciente probaba 7 200
 * contraseñas al día desde una IP. Cuenta todo intento (también los buenos: la
 * librería no distingue fallos), así que una oficina detrás de una misma IP tiene
 * 30 inicios de sesión por hora entre todos; con sesiones de 7 días eso sobra.
 */
export const OPCIONES_THROTTLER_LOGIN_HORA: ThrottlerOptions = {
  name: THROTTLER_LOGIN_HORA,
  ttl: 3_600_000,
  limit: 30,
};

/**
 * `POST /usuarios/:id/password` (F2-203): 10 por minuto por IP. Es ruta de
 * admin autenticado, pero un token de admin robado no debe poder restablecer
 * contraseñas en ráfaga.
 */
export const OPCIONES_THROTTLER_RESET: ThrottlerOptions = {
  name: THROTTLER_RESET,
  ttl: 60_000,
  limit: 10,
};

/**
 * `POST /reportes/baja` (F2-141): 10 por minuto por IP. Es pública (el enlace del correo
 * funciona sin sesión) y el token es una firma de 256 bits: esto no protege el token, corta
 * a quien martille la ruta.
 */
export const OPCIONES_THROTTLER_BAJA: ThrottlerOptions = {
  name: THROTTLER_BAJA,
  ttl: 60_000,
  limit: 10,
};

/**
 * `GET /facturacion/codigo/:codigo` (F2-101): 10 por minuto por IP. Es pública (el portal de
 * autofactura la llama sin sesión) y el código es la credencial: el límite es lo que vuelve
 * inútil probar códigos al azar (32^9 combinaciones a 10 por minuto).
 */
export const OPCIONES_THROTTLER_CODIGO: ThrottlerOptions = {
  name: THROTTLER_CODIGO,
  ttl: 60_000,
  limit: 10,
};

/**
 * `GET /facturacion/portal/:slug` y su logo (F2-103): 60 por minuto por IP. Públicas, sin datos
 * de nadie (nombre de la sucursal y su marca); el límite sólo corta a quien las martille.
 */
export const OPCIONES_THROTTLER_PORTAL: ThrottlerOptions = {
  name: THROTTLER_PORTAL,
  ttl: 60_000,
  limit: 60,
};

/**
 * `POST /facturacion/portal/:slug/facturas` (F2-103): 5 por minuto por IP. Pública y es la que
 * (con F2-104) gasta un folio del PAC: una persona factura un ticket en un intento o dos.
 */
export const OPCIONES_THROTTLER_FACTURAS_PORTAL: ThrottlerOptions = {
  name: THROTTLER_FACTURAS_PORTAL,
  ttl: 60_000,
  limit: 5,
};

/**
 * `POST /cuenta/notificaciones/prueba` (F2-146): 5 por minuto por IP. Cada llamada es un POST
 * nuestro a un servicio de push de terceros; nadie necesita más de una prueba cada pocos
 * segundos.
 */
export const OPCIONES_THROTTLER_PRUEBA_PUSH: ThrottlerOptions = {
  name: THROTTLER_PRUEBA_PUSH,
  ttl: 60_000,
  limit: 5,
};

/** Todos los throttlers registrados en `AuthModule`. Uno nuevo va aquí. */
export const THROTTLERS = [
  THROTTLER_LOGIN,
  THROTTLER_LOGIN_HORA,
  THROTTLER_REFRESH,
  THROTTLER_RESET,
  THROTTLER_BAJA,
  THROTTLER_CODIGO,
  THROTTLER_PORTAL,
  THROTTLER_FACTURAS_PORTAL,
  THROTTLER_PRUEBA_PUSH,
  THROTTLER_AGENTE,
] as const;
export type NombreThrottler = (typeof THROTTLERS)[number];

/**
 * `@SkipThrottle` de todos los cubos MENOS los de la ruta. En v6 un `ThrottlerGuard`
 * aplica todos los registrados: con esto, un cubo nuevo queda saltado solo en las
 * rutas que no lo nombran, en vez de depender de acordarse de tocarlas todas.
 */
export function SoloThrottlers(...propios: NombreThrottler[]) {
  return SkipThrottle(
    Object.fromEntries(THROTTLERS.filter((t) => !propios.includes(t)).map((t) => [t, true])),
  );
}
