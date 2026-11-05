/**
 * UI-05 (v3): los botones de las vistas, en un solo lugar. Sólo tokens de la paleta.
 *
 * - `BOTON_SECUNDARIO`: la acción de apoyo de una vista (Refrescar, Exportar CSV...). Superficie
 *   con borde, se eleva un poco al pasar y se hunde al presionar.
 * - `BOTON_SEGMENTO`: una opción de un grupo de filtros (`aria-pressed`). Lo elegido lleva el
 *   relleno del acento Y su borde (no sólo color de relleno: WCAG 1.4.11, ver paleta.test.ts).
 */
export const BOTON_SECUNDARIO =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-linea-fuerte bg-superficie px-3 py-1.5 text-sm font-medium text-tinta-medio shadow-xs transition-[background-color,box-shadow,transform] duration-150 hover:bg-realce hover:text-tinta active:translate-y-px disabled:pointer-events-none disabled:opacity-50';

/** La acción principal de un formulario (Aplicar, Entrar, Guardar): el acento de la marca. */
export const BOTON_PRIMARIO =
  'inline-flex items-center justify-center gap-1.5 rounded-lg border border-acento-borde bg-acento px-3 py-1.5 text-sm font-semibold text-sobre-acento shadow-xs transition-[filter,box-shadow,transform] duration-150 hover:shadow-tarjeta-alta hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-acento-borde active:translate-y-px disabled:pointer-events-none disabled:opacity-50';

export const BOTON_SEGMENTO =
  'rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors duration-150 aria-pressed:border-acento-borde aria-pressed:bg-acento aria-pressed:text-sobre-acento aria-pressed:shadow-sm';

/** Lo que no está elegido en un segmento. */
export const SEGMENTO_LIBRE =
  'border-linea-fuerte bg-superficie text-tinta-medio hover:bg-realce hover:text-tinta';

/**
 * Control segmentado sobre un carril (Turnos, Tickets): el carril es `realce` y lo elegido sube
 * a la superficie con el borde del acento (≥ 3:1 contra el carril, `paleta.test.ts`).
 */
export const CARRIL_SEGMENTOS = 'inline-flex gap-1 rounded-xl bg-realce p-1';
export const OPCION_CARRIL =
  'rounded-lg border border-transparent px-3 py-1.5 text-sm font-medium text-tinta-medio transition-colors duration-150 hover:text-tinta aria-pressed:border-acento-borde aria-pressed:bg-superficie aria-pressed:text-tinta aria-pressed:shadow-sm focus-visible:outline-2 focus-visible:outline-acento-borde';

/** Un campo de texto o select de filtros: borde, sombra mínima y un halo violeta al enfocar. */
export const CAMPO =
  'w-full min-w-0 rounded-lg border border-linea-fuerte bg-superficie px-2.5 py-1.5 text-sm text-tinta shadow-xs transition-[border-color,box-shadow] duration-150 focus:border-acento-borde focus:ring-3 focus:ring-brillo focus:outline-none';
