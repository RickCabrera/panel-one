/**
 * Configuración de auth leída del entorno. El arranque TRUENA si falta algo: una
 * API que firma tokens con un secreto vacío o de relleno es peor que una API caída.
 */
export interface AuthConfig {
  accessSecret: string;
  refreshSecret: string;
  /** `secure` en la cookie de refresh: sólo viaja por HTTPS. */
  cookieSegura: boolean;
}

/** Access token: 15 min. */
export const ACCESS_TTL_SEGUNDOS = 15 * 60;
/** Refresh token: 7 días. */
export const REFRESH_TTL_SEGUNDOS = 7 * 24 * 60 * 60;

export const COOKIE_REFRESH = 'monitor_refresh';
/** La cookie sólo se manda a las rutas de auth, no a cada request de datos. */
export const COOKIE_REFRESH_PATH = '/auth';

const LONGITUD_MINIMA = 32;

function secreto(nombre: string, entorno: NodeJS.ProcessEnv): string {
  const valor = entorno[nombre];
  if (!valor || valor.length < LONGITUD_MINIMA) {
    throw new Error(
      `${nombre} es obligatorio y debe tener al menos ${LONGITUD_MINIMA} caracteres.`,
    );
  }
  return valor;
}

export function leerAuthConfig(entorno: NodeJS.ProcessEnv = process.env): AuthConfig {
  const accessSecret = secreto('JWT_ACCESS_SECRET', entorno);
  const refreshSecret = secreto('JWT_REFRESH_SECRET', entorno);
  if (accessSecret === refreshSecret) {
    // Con el mismo secreto, un refresh token firmado vale como access y viceversa.
    throw new Error('JWT_ACCESS_SECRET y JWT_REFRESH_SECRET tienen que ser distintos.');
  }
  return {
    accessSecret,
    refreshSecret,
    cookieSegura: entorno.NODE_ENV === 'production',
  };
}

export const AUTH_CONFIG = Symbol('AUTH_CONFIG');
