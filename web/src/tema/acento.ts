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
import type { ColorAcento } from '../api/tipos';
import {
  ACENTO_POR_DEFECTO,
  ACENTOS_PLATAFORMA,
  BLANCO,
  NEGRO,
  PALETAS,
  SUPERFICIES,
  type Estilo,
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

/**
 * Los tokens del acento para un tema (y un estilo de marca, UI-06: por omisión el «Clásico»).
 * `acento` debe venir ya validado (`leerAcento`).
 */
export function derivarAcento(
  acento: string,
  tema: Tema,
  estilo: Estilo = 'clasico',
): Record<TokenAcento, string> {
  const base = normalizarHex(acento);
  const fondos = SUPERFICIES.map((s) => PALETAS[estilo][tema][s]);
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

/** Las claves de color que acepta la plataforma, en el orden de la pantalla de Ajustes. */
export const CLAVES_ACENTO = Object.keys(ACENTOS_PLATAFORMA) as ColorAcento[];

export function esColorAcento(valor: unknown): valor is ColorAcento {
  return typeof valor === 'string' && (CLAVES_ACENTO as readonly string[]).includes(valor);
}

/**
 * Membresías: el acento que se ve. El color GLOBAL de la plataforma (la clave que manda
 * `GET /sistema`) si hay uno válido; si no, el del build (`VITE_COLOR_ACENTO`).
 */
export function acentoEfectivo(clave: unknown, respaldo: string = ACENTO_DESPLIEGUE): string {
  return esColorAcento(clave) ? ACENTOS_PLATAFORMA[clave].hex : respaldo;
}

/**
 * La última clave global vista en ESTE navegador: con ella `main.tsx` pinta el color correcto
 * antes de que conteste `/sistema` (sin destello del color del build). Comodidad por
 * navegador: sin storage, o con basura, vale el del build.
 */
const CLAVE_ACENTO_GLOBAL = 'monitor.acento.global';

export function leerAcentoGuardado(): ColorAcento | null {
  try {
    const valor = window.localStorage.getItem(CLAVE_ACENTO_GLOBAL);
    return esColorAcento(valor) ? valor : null;
  } catch {
    return null;
  }
}

export function guardarAcentoVisto(clave: ColorAcento | null): void {
  try {
    if (clave === null) window.localStorage.removeItem(CLAVE_ACENTO_GLOBAL);
    else window.localStorage.setItem(CLAVE_ACENTO_GLOBAL, clave);
  } catch {
    // Sin storage: el color llega con /sistema, sólo sin la memoria del arranque.
  }
}
