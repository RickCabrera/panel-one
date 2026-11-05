import { useCallback, useSyncExternalStore } from 'react';

/**
 * UI-04: por debajo de `md` (768 px de Tailwind) el panel es la versión de celular: barra
 * inferior, cabecera compacta y hojas en vez de cajón. Es la MISMA frontera que `md:`, con
 * `.98` para no traslaparse con `(min-width: 768px)` en pantallas con píxeles fraccionarios.
 *
 * Se decide en JS y no sólo con clases porque cambia QUÉ se monta (la barra o el lateral):
 * con las dos montadas y una escondida por CSS, cada enlace del menú existiría dos veces para
 * el lector de pantalla y para el orden de Tab. Sin `matchMedia` (navegador viejo): escritorio.
 */
export const MEDIA_MOVIL = '(max-width: 767.98px)';
/** Tableta (md a lg): la cabecera de escritorio con la operación en vivo compacta. */
export const MEDIA_HASTA_LG = '(max-width: 1023.98px)';

/** Si la consulta de medios se cumple, siguiendo sus cambios (girar, redimensionar). */
export function useMedia(consulta: string): boolean {
  const suscribir = useCallback(
    (avisar: () => void) => {
      const media = window.matchMedia?.(consulta);
      if (!media) return () => {};
      media.addEventListener('change', avisar);
      return () => media.removeEventListener('change', avisar);
    },
    [consulta],
  );
  const leer = () => window.matchMedia?.(consulta).matches ?? false;
  return useSyncExternalStore(suscribir, leer, () => false);
}

export function useEsMovil(): boolean {
  return useMedia(MEDIA_MOVIL);
}
