/**
 * A dónde volver después del login. El valor viene de la URL (`?siguiente=`), así
 * que lo controla cualquiera que mande un enlace: sólo se aceptan rutas internas de
 * la SPA. Todo lo demás cae en `/`. Sin esto, `/login?siguiente=//evil.com` es un
 * open redirect con la cara de nuestro login.
 */

const RAIZ = '/';
const ORIGEN_FICTICIO = 'http://spa.invalid';
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f\s]/;
// eslint-disable-next-line no-control-regex
const CONTROL_AL_INICIO = /^[\x00-\x20\x7f]/;

function pareceExterna(ruta: string): boolean {
  return !ruta.startsWith('/') || ruta.startsWith('//') || ruta.startsWith('/\\');
}

export function destinoSeguro(valor: string | null | undefined): string {
  if (!valor) return RAIZ;
  // Espacios o controles en cualquier parte: el navegador los recorta o los ignora
  // al resolver la URL, y un " //evil.com" acaba siendo externo.
  if (CONTROL.test(valor)) return RAIZ;
  if (pareceExterna(valor)) return RAIZ;

  let decodificado: string;
  try {
    decodificado = decodeURIComponent(valor);
  } catch {
    return RAIZ;
  }
  // Decodificado sólo importa cómo EMPIEZA (`/%2F%2Fevil.com`); un `%20` dentro de
  // un filtro es legítimo.
  if (CONTROL_AL_INICIO.test(decodificado) || pareceExterna(decodificado)) return RAIZ;

  // Última red: resolverla como URL y exigir que no cambie de origen.
  let resuelta: URL;
  try {
    resuelta = new URL(valor, ORIGEN_FICTICIO);
  } catch {
    return RAIZ;
  }
  if (resuelta.origin !== ORIGEN_FICTICIO) return RAIZ;

  // Volver a /login ya autenticado es un bucle de redirecciones.
  if (resuelta.pathname === '/login' || resuelta.pathname.startsWith('/login/')) return RAIZ;

  return valor;
}

/** `/login?siguiente=...` para volver exactamente a esta vista, filtros incluidos. */
export function rutaLogin(destino: string): string {
  return destino === RAIZ ? '/login' : `/login?siguiente=${encodeURIComponent(destino)}`;
}
