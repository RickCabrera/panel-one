import { createHash, randomBytes } from 'node:crypto';

/** Prefijo de toda API key de agente: la hace reconocible en un log o en un escáner de secretos. */
export const PREFIJO_API_KEY = 'msr_';

/** Bytes aleatorios de cada key: 256 bits de entropía. */
const BYTES_API_KEY = 32;

/** Header con el que el agente manda su key. */
export const HEADER_API_KEY = 'x-api-key';

/**
 * Una key nueva. Sale del servidor UNA sola vez, en la respuesta que la genera;
 * en la base sólo queda su hash.
 */
export function generarApiKey(): string {
  return PREFIJO_API_KEY + randomBytes(BYTES_API_KEY).toString('base64url');
}

/**
 * SHA-256 hex de la key. Determinista (sin sal) a propósito: la búsqueda es por
 * igualdad sobre el índice único `sucursales.api_key_hash`, y una key de 256
 * bits aleatorios no es una contraseña que se pueda adivinar por diccionario.
 * argon2 lleva sal y no permitiría buscar por el hash.
 */
export function hashApiKey(apiKey: string): string {
  return createHash('sha256').update(apiKey, 'utf8').digest('hex');
}
