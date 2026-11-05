/**
 * LA paleta del panel (F2-211): el único lugar del código donde se escribe un color.
 * La regla de lint de `eslint.config.mjs` prohíbe hex y clases de la paleta de
 * Tailwind (`text-slate-500`, `bg-white`...) en todo `src/` salvo este archivo.
 *
 * Cada token tiene un valor por tema. `aplicarTema()` (tema.ts) los pone como
 * variables CSS en `:root` (`--fondo`, `--tinta`...) e `index.css` las expone a
 * Tailwind como `bg-fondo`, `text-tinta`, `border-linea`... Cambiar de tema es cambiar
 * los valores, no los componentes.
 *
 * `paleta.test.ts` mide el contraste de cada pareja texto/fondo en los dos temas:
 * si cambias un valor y baja de 4.5:1, el test truena.
 *
 * Los tokens del ACENTO (`acento`, `acento-texto`, `acento-borde`, `sobre-acento`,
 * `serie-1`) no están aquí: salen del acento configurable del despliegue
 * (`VITE_COLOR_ACENTO`) en `acento.ts`, ajustados al contraste de cada tema.
 */

/**
 * Acento de fábrica (VITE_COLOR_ACENTO sin definir o no válido): el violeta interactivo de
 * Yo Controlo (UI-02). Botones, ítem activo, enlaces e interruptores. Ver docs/marca/README.md.
 */
export const ACENTO_POR_DEFECTO = '#6d3fc0';

/**
 * Membresías: los colores de interfaz que la plataforma puede elegir para TODOS los clientes
 * (Plataforma › Ajustes). La API guarda la CLAVE, nunca un hex: el valor sale sólo de aquí.
 * Cada uno pasa por `derivarAcento` como cualquier acento (texto y bordes legibles en los dos
 * temas).
 */
export const ACENTOS_PLATAFORMA = {
  naranja: { nombre: 'Naranja', hex: '#ea580c' },
  // UI-02: la clave `morado` ES el violeta de la marca (antes #7c3aed): quien ya la tenía
  // guardada pasa al de Yo Controlo sin migrar nada.
  morado: { nombre: 'Morado Yo Controlo', hex: ACENTO_POR_DEFECTO },
  azul_electrico: { nombre: 'Azul eléctrico', hex: '#2563eb' },
  verde_azulado: { nombre: 'Verde azulado', hex: '#14b8a6' },
  ambar_dorado: { nombre: 'Ámbar dorado', hex: '#f59e0b' },
  magenta: { nombre: 'Magenta', hex: '#db2777' },
  rojo: { nombre: 'Rojo', hex: '#dc2626' },
} as const;

/** Los extremos hacia los que se ajusta el acento, y el texto sobre él. */
export const BLANCO = '#ffffff';
export const NEGRO = '#000000';

export type Tema = 'claro' | 'oscuro';

const CLARO = {
  // Superficies: lavanda muy clara y blanco, con un tinte del morado de marca.
  fondo: '#f7f5fb',
  superficie: '#ffffff',
  realce: '#f1edf7',
  'realce-fuerte': '#e5deef',
  // Líneas (bordes y divisores)
  'linea-suave': '#f1edf7',
  linea: '#e5deef',
  'linea-fuerte': '#cdc2dd',
  // Texto, de más a menos énfasis: el morado de marca (#2c1533) y sus rebajados.
  tinta: '#2c1533',
  'tinta-medio': '#3e2a4b',
  'tinta-suave': '#54426a',
  'tinta-tenue': '#63527a',
  // Estados (semánticos: no siguen a la marca)
  peligro: '#b91c1c',
  'peligro-fondo': '#fef2f2',
  'peligro-borde': '#fca5a5',
  'peligro-fuerte': '#dc2626',
  'sobre-peligro': '#ffffff',
  aviso: '#92400e',
  'aviso-fondo': '#fef3c7',
  'aviso-borde': '#fcd34d',
  'aviso-fuerte': '#d97706',
  exito: '#046c4e',
  'exito-fondo': '#d1fae5',
  'exito-fuerte': '#059669',
  info: '#0284c7',
  // Semáforo del monitor de mesas: su ÚNICO canal visual es el color del borde.
  'semaforo-ok': '#059669',
  'semaforo-alerta': '#c96d05',
  'semaforo-rojo': '#dc2626',
  'semaforo-sin-dato': '#7c8799',
  // Gráficas (la serie 1 es el acento violeta; la 2 se aleja de él: verde azulado)
  'serie-2': '#0d8a7f',
  'serie-3': '#c96d05',
  'serie-4': '#64748b',
  rejilla: '#e5deef',
  // Velo detrás de los diálogos (con alfa)
  velo: '#2c153380',
  // Sombra suave de tarjetas y menús (con alfa), teñida del morado de marca.
  sombra: '#2c15331f',
  // Barra lateral: SIEMPRE el morado de marca, en los dos temas (es donde vive el logo arena).
  lateral: '#2c1533',
  'lateral-borde': '#40264c',
  'lateral-realce': '#3c2248',
  'lateral-tinta': '#f4ece4',
  'lateral-tenue': '#c3afc8',
  // El arena del logo: la marca sobre morado y el acento secundario (detalles, no texto largo).
  arena: '#e3cba8',
} as const;

export type Token = keyof typeof CLARO;

const OSCURO: Record<Token, string> = {
  // Superficies: el morado de marca y sus vecinos (nada de gris ni azul marino).
  fondo: '#1e0e24',
  superficie: '#2c1533',
  realce: '#3a1f45',
  'realce-fuerte': '#4a2b58',
  'linea-suave': '#34193d',
  linea: '#4a2b58',
  'linea-fuerte': '#6a4a7a',
  tinta: '#f6f0f4',
  'tinta-medio': '#ebe0ea',
  'tinta-suave': '#d6c6da',
  'tinta-tenue': '#bea9c5',
  peligro: '#fca5a5',
  'peligro-fondo': '#41141f',
  'peligro-borde': '#7f1d1d',
  'peligro-fuerte': '#dc2626',
  'sobre-peligro': '#ffffff',
  aviso: '#fcd34d',
  'aviso-fondo': '#3a2a0a',
  'aviso-borde': '#92400e',
  'aviso-fuerte': '#f59e0b',
  exito: '#6ee7b7',
  'exito-fondo': '#0b3325',
  'exito-fuerte': '#10b981',
  info: '#38bdf8',
  'semaforo-ok': '#34d399',
  'semaforo-alerta': '#fbbf24',
  'semaforo-rojo': '#f87171',
  'semaforo-sin-dato': '#8f8aa3',
  'serie-2': '#2dd4bf',
  'serie-3': '#fbbf24',
  'serie-4': '#a49cb0',
  rejilla: '#3a1f45',
  velo: '#0b040ea8',
  sombra: '#00000059',
  lateral: '#2c1533',
  'lateral-borde': '#40264c',
  'lateral-realce': '#3c2248',
  'lateral-tinta': '#f4ece4',
  'lateral-tenue': '#c3afc8',
  arena: '#e3cba8',
};

export const PALETA: Record<Tema, Record<Token, string>> = { claro: CLARO, oscuro: OSCURO };

export const TOKENS = Object.keys(CLARO) as Token[];

/** Tokens derivados del acento del despliegue (ver `acento.ts`). */
export const TOKENS_ACENTO = [
  'acento',
  'acento-texto',
  'acento-borde',
  'sobre-acento',
  'serie-1',
] as const;
export type TokenAcento = (typeof TOKENS_ACENTO)[number];

/** Fondos sobre los que puede ir texto en cualquier vista. */
export const SUPERFICIES = ['fondo', 'superficie', 'realce', 'realce-fuerte'] as const;
