import type { ThrottlerOptions } from '@nestjs/throttler';

/**
 * Throttlers por IP de las rutas de usuario. Todos se registran en el mismo
 * `ThrottlerModule.forRoot` (AuthModule) y un `ThrottlerGuard` aplica TODOS los
 * registrados salvo los que la ruta salte con `@SkipThrottle`: cada ruta con guard
 * salta explícitamente los que no son suyos (login, refresh, cuenta y
 * `@AutenticacionAgente()`).
 */
export const THROTTLER_LOGIN = 'login';
export const THROTTLER_REFRESH = 'refresh';

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
