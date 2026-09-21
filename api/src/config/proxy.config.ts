/**
 * Cuántos proxies delante de la API se creen el `X-Forwarded-For` (`trust proxy`
 * de Express). De eso sale `req.ip`, y de `req.ip` los rate limits por IP (login,
 * refresh, cambio de contraseña).
 *
 * - `0` (default): no se confía en ningún proxy; `req.ip` es quien abrió el socket.
 *   Es lo conservador: sin proxy delante, confiar dejaría a cualquiera inventarse
 *   la IP con un header y saltarse el límite.
 * - `1`: producción detrás de Caddy (F1-002). Sin esto TODOS los usuarios comparten
 *   la IP del proxy y el login admite 5 intentos por minuto para el sistema entero.
 *
 * Un valor que no sea entero >= 0 TRUENA al arrancar: un límite mal puesto no se
 * nota hasta que alguien se lo salta.
 */
export function leerTrustProxy(entorno: NodeJS.ProcessEnv = process.env): number {
  const crudo = entorno.TRUST_PROXY_SALTOS?.trim();
  if (crudo === undefined || crudo === '') return 0;
  if (!/^\d{1,2}$/.test(crudo)) {
    throw new Error(`TRUST_PROXY_SALTOS debe ser un entero >= 0 (llegó "${crudo}").`);
  }
  return Number(crudo);
}
