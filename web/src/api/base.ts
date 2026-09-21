/**
 * Prefijo de la API. Siempre mismo origen: el proxy de Vite en local y Caddy en
 * producción quitan `/api` antes de llegar a Nest (ver `vite.config.ts`).
 */
export const BASE_API = '/api';
