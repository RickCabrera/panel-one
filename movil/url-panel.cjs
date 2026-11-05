'use strict';

// La URL del panel que carga la app. Vive aparte (CommonJS sin dependencias) para que la use
// capacitor.config.ts al armar y la pruebe `node --test` sin compilar nada.
//
// Por defecto es la de producción en Railway. Para un dominio propio se arma con
// YC_URL_PANEL=https://panel.ejemplo.mx (en CI: la variable del repo YC_URL_PANEL).

const URL_PANEL_POR_DEFECTO = 'https://web-production-730b5.up.railway.app';

/**
 * Normaliza y valida la URL del panel: sólo https, sin usuario/contraseña, sin query ni fragmento,
 * y siempre terminada en `/` (el origen del panel). Lanza si la URL no sirve: un APK que apunta a
 * http o a una URL mal escrita no debe armarse.
 *
 * @param {string | undefined} valor lo que traiga YC_URL_PANEL (vacío o undefined = el de Railway)
 * @returns {string} p. ej. "https://web-production-730b5.up.railway.app/"
 */
function resolverUrlPanel(valor) {
  const crudo = (valor ?? '').trim() || URL_PANEL_POR_DEFECTO;
  let url;
  try {
    url = new URL(crudo);
  } catch {
    throw new Error(`YC_URL_PANEL no es una URL válida: "${crudo}"`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(`YC_URL_PANEL debe ser https (cleartext está apagado): "${crudo}"`);
  }
  if (url.username || url.password) {
    throw new Error('YC_URL_PANEL no puede llevar usuario ni contraseña');
  }
  if (url.search || url.hash) {
    throw new Error(`YC_URL_PANEL no puede llevar query ni fragmento: "${crudo}"`);
  }
  // El panel y su API (/api) viven en la raíz del mismo origen: la cookie de sesión es
  // SameSite=Strict con Path=/api/auth. Una ruta debajo del origen no tiene sentido aquí.
  if (url.pathname !== '/' && url.pathname !== '') {
    throw new Error(`YC_URL_PANEL debe ser el origen del panel, sin ruta: "${crudo}"`);
  }
  return `${url.origin}/`;
}

/**
 * La página de respaldo (www/index.html) que Capacitor muestra cuando la carga del panel falla.
 * Recibe el panel en `?panel=` para que el botón "Reintentar" sepa a dónde volver sin que haya
 * que generar ningún archivo al armar.
 *
 * @param {string} urlPanel la salida de resolverUrlPanel
 */
function rutaDeRespaldo(urlPanel) {
  return `index.html?panel=${encodeURIComponent(urlPanel)}`;
}

module.exports = { URL_PANEL_POR_DEFECTO, resolverUrlPanel, rutaDeRespaldo };
