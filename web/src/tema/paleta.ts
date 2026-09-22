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

/** Acento de fábrica (VITE_COLOR_ACENTO sin definir o no válido). */
export const ACENTO_POR_DEFECTO = '#0f766e';

/** Los extremos hacia los que se ajusta el acento, y el texto sobre él. */
export const BLANCO = '#ffffff';
export const NEGRO = '#000000';

export type Tema = 'claro' | 'oscuro';

const CLARO = {
  // Superficies
  fondo: '#f8fafc',
  superficie: '#ffffff',
  realce: '#f1f5f9',
  'realce-fuerte': '#e2e8f0',
  // Líneas (bordes y divisores)
  'linea-suave': '#f1f5f9',
  linea: '#e2e8f0',
  'linea-fuerte': '#cbd5e1',
  // Texto, de más a menos énfasis. `tinta-tenue` es más oscura que slate-500: ésa
  // quedaba en 4.34:1 sobre `realce` y no pasaba.
  tinta: '#0f172a',
  'tinta-medio': '#334155',
  'tinta-suave': '#475569',
  'tinta-tenue': '#556275',
  // Estados
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
  'semaforo-alerta': '#d97706',
  'semaforo-rojo': '#dc2626',
  'semaforo-sin-dato': '#7c8799',
  // Gráficas (la serie 1 es el acento)
  'serie-2': '#6366f1',
  'serie-3': '#d97706',
  'serie-4': '#64748b',
  rejilla: '#e2e8f0',
  // Velo detrás de los diálogos (con alfa)
  velo: '#0f172a80',
} as const;

export type Token = keyof typeof CLARO;

const OSCURO: Record<Token, string> = {
  fondo: '#0b1120',
  superficie: '#131c2e',
  realce: '#1e293b',
  'realce-fuerte': '#334155',
  'linea-suave': '#1e293b',
  linea: '#2b3647',
  'linea-fuerte': '#475569',
  tinta: '#f1f5f9',
  'tinta-medio': '#e2e8f0',
  'tinta-suave': '#cbd5e1',
  'tinta-tenue': '#a3b1c6',
  peligro: '#fca5a5',
  'peligro-fondo': '#3b1219',
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
  'semaforo-sin-dato': '#7b8aa0',
  'serie-2': '#818cf8',
  'serie-3': '#fbbf24',
  'serie-4': '#94a3b8',
  rejilla: '#2b3647',
  velo: '#000000a0',
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
