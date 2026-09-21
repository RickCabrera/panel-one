/**
 * Color de acento del tema claro. Se configura por despliegue con
 * `VITE_COLOR_ACENTO` y se valida como hex: el valor termina dentro de un
 * `style`, y sin validar sería una puerta para meter CSS arbitrario.
 */
export const ACENTO_POR_DEFECTO = '#0f766e';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function leerAcento(valor: string | undefined): string {
  const limpio = valor?.trim() ?? '';
  return HEX.test(limpio) ? limpio : ACENTO_POR_DEFECTO;
}

/** Pone `--color-acento` en `:root`; Tailwind lo usa vía `@theme` (bg-acento...). */
export function aplicarAcento(color: string, raiz: HTMLElement = document.documentElement): void {
  raiz.style.setProperty('--color-acento', color);
}
