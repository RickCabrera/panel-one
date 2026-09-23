/**
 * Registra el service worker de la PWA (F2-146). Sólo en el build de producción: en
 * `vite dev` no existe `/sw.js` y una caché estorbaría la recarga en caliente.
 *
 * Se registra DESPUÉS de `load`: la primera visita baja la app sin competir con el precache.
 */
export function registrarServiceWorker(
  produccion: boolean = import.meta.env.PROD,
  nav: Navigator = navigator,
  win: Pick<Window, 'addEventListener'> & { document: Pick<Document, 'readyState'> } = window,
): void {
  if (!produccion || !('serviceWorker' in nav)) return;
  const registrar = () => {
    nav.serviceWorker.register('/sw.js', { scope: '/' }).catch((error: unknown) => {
      // Sin service worker la app funciona igual (sin instalar ni avisos): no se interrumpe.
      console.warn('[pwa] No se pudo registrar el service worker:', error);
    });
  };
  if (win.document.readyState === 'complete') registrar();
  else win.addEventListener('load', registrar, { once: true });
}
