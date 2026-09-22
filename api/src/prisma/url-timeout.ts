/**
 * `statement_timeout` de las consultas de la app en NUESTRA base (F2-203). Los
 * agregados de ventas ya corren con su `SET LOCAL` de 5 s (`TIMEOUT_CONSULTA_MS`),
 * que dentro de su transacción manda sobre éste. Todo lo demás (detalle de
 * tickets, mesas, administración, ingesta) iba sin tope: una consulta atorada
 * ocupaba una conexión del pool para siempre.
 *
 * 15 s y no 5: la ingesta escribe lotes enteros en una transacción y cada
 * sentencia de un lote grande tiene que caber holgada. Una lectura normal de la
 * app tarda milisegundos.
 *
 * Va en la URL de conexión (`options=-c statement_timeout=...`, que Prisma 6.19
 * pasa al servidor al abrir cada conexión; comprobado con `SHOW statement_timeout`)
 * y sólo para el cliente de la app: `prisma migrate` y los seeds leen
 * `DATABASE_URL` tal cual y no heredan el tope.
 */
export const STATEMENT_TIMEOUT_APP_MS = 15_000;

/**
 * `url` con `-c statement_timeout=<ms>` agregado a su parámetro `options`. Si ya
 * trae un `options` (p. ej. `-c search_path=x`), se combina en el mismo; si ya
 * fija un `statement_timeout`, la URL manda y se deja igual.
 */
export function urlConTimeout(url: string, ms: number = STATEMENT_TIMEOUT_APP_MS): string {
  const u = new URL(url);
  const opciones = u.searchParams.get('options');
  if (opciones !== null && /statement_timeout/.test(opciones)) {
    return url;
  }
  const nueva = `-c statement_timeout=${ms}`;
  u.searchParams.set('options', opciones ? `${opciones} ${nueva}` : nueva);
  return u.toString();
}
