/**
 * Color de acento. Se configura por despliegue con `VITE_COLOR_ACENTO` y se valida
 * como hex: el valor termina dentro de una variable CSS, y sin validar sería una
 * puerta para meter CSS arbitrario.
 *
 * El acento de relleno (`bg-acento`) es el mismo en los dos temas. Lo que cambia por
 * tema son sus DERIVADOS (F2-211), calculados aquí para que cualquier acento
 * configurado siga siendo legible: `acento-texto` (≥ 4.5:1 contra toda superficie),
 * `acento-borde` (≥ 3:1: bordes activos, anillos de foco y la serie 1 de las
 * gráficas, WCAG 1.4.11) y `sobre-acento` (blanco o negro, lo que más contraste
 * dé sobre el relleno).
 */
import { ajustarContraste, contraste, normalizarHex } from './contraste';
import {
  ACENTO_POR_DEFECTO,
  BLANCO,
  NEGRO,
  PALETA,
  SUPERFICIES,
  type Tema,
  type TokenAcento,
} from './paleta';

export { ACENTO_POR_DEFECTO };

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function leerAcento(valor: string | undefined): string {
  const limpio = valor?.trim() ?? '';
  return HEX.test(limpio) ? limpio : ACENTO_POR_DEFECTO;
}

/** El acento de este despliegue, ya validado. */
export const ACENTO_DESPLIEGUE = leerAcento(
  import.meta.env.VITE_COLOR_ACENTO as string | undefined,
);

/** Los tokens del acento para un tema. `acento` debe venir ya validado (`leerAcento`). */
export function derivarAcento(acento: string, tema: Tema): Record<TokenAcento, string> {
  const base = normalizarHex(acento);
  const fondos = SUPERFICIES.map((s) => PALETA[tema][s]);
  // En claro se oscurece hacia negro; en oscuro se aclara hacia blanco.
  const destino = tema === 'claro' ? NEGRO : BLANCO;
  const borde = ajustarContraste(base, destino, fondos, 3);
  return {
    acento: base,
    'acento-texto': ajustarContraste(base, destino, fondos, 4.5),
    'acento-borde': borde,
    'sobre-acento': contraste(BLANCO, base) >= contraste(NEGRO, base) ? BLANCO : NEGRO,
    'serie-1': borde,
  };
}
