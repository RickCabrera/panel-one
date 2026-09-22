import { useEffect } from 'react';

import { PREFIJO_TITULO_DEMO, TEXTO_MARCA_DEMO, useSistema } from './sistema';

/**
 * Marca del modo demo (F2-202): con `MODO_DEMO=1` en la API, una banda fija arriba de
 * TODAS las vistas (login y 404 incluidos, por eso vive en `Proveedores` y no en el
 * `Layout`) y el prefijo en el título de la pestaña. No se puede cerrar: una captura
 * del demo nunca debe poder pasar por datos reales.
 *
 * Si `/sistema` falla no hay marca: es la opción que no inventa. Una API caída ya la
 * dice el resto de la interfaz.
 */
export function MarcaDemo() {
  const { data } = useSistema();
  const demo = data?.modoDemo === true;

  useEffect(() => {
    if (!demo) return;
    // Hoy ninguna vista cambia el título; la que lo haga, que conserve este prefijo.
    const original = document.title;
    document.title = PREFIJO_TITULO_DEMO + original;
    return () => {
      document.title = original;
    };
  }, [demo]);

  if (!demo) return null;
  return (
    <div
      role="status"
      data-testid="marca-demo"
      className="sticky top-0 z-50 w-full border-b border-aviso-borde bg-aviso-fondo px-4 py-1.5 text-center text-sm font-semibold text-aviso"
    >
      {TEXTO_MARCA_DEMO}
      <span className="font-normal"> — no son ventas reales de ningún restaurante</span>
    </div>
  );
}
