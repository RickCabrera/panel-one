/**
 * LA paleta del panel (F2-211): el único lugar del código donde se escribe un color.
 * La regla de lint de `eslint.config.mjs` prohíbe hex y clases de la paleta de
 * Tailwind (`text-slate-500`, `bg-white`...) en todo `src/` salvo este archivo.
 *
 * Cada token tiene un valor por ESTILO de marca (UI-06: «Noche», el de por defecto, y
 * «Clásico», la v3) y por tema (claro u oscuro). `aplicarTema()` (tema.ts) los pone como
 * variables CSS en `:root` (`--fondo`, `--tinta`...) e `index.css` las expone a
 * Tailwind como `bg-fondo`, `text-tinta`, `border-linea`... Cambiar de tema o de estilo es
 * cambiar los valores, no los componentes.
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

/**
 * UI-06: el estilo de la marca. Se combina con el tema (claro / oscuro / sistema):
 * - `noche`: negro con morado y vidrio (el de por defecto). En claro sólo se aclaran el fondo del
 *   contenido y las tarjetas; el lateral, la barra de arriba, la de abajo, el hero y el login
 *   siguen negros.
 * - `clasico`: la v3 (UI-05), el morado de marca, sin cambios.
 */
export type Estilo = 'noche' | 'clasico';
export const ESTILOS: readonly Estilo[] = ['noche', 'clasico'];
export const ESTILO_POR_DEFECTO: Estilo = 'noche';

/** El negro de la marca (UI-06): el lateral de «Noche» y la muestra del selector de estilo. */
export const NEGRO_MARCA = '#08070b';

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
  // UI-05 (v3): el «hero» del Inicio y del login. Es SIEMPRE el morado de marca con un
  // degradado hacia el violeta, como las secciones moradas de la landing; su texto es claro y
  // la cifra principal va en arena. Sus tokens no siguen al tema de las superficies.
  hero: '#2c1533',
  'hero-fin': '#4a2470',
  'hero-borde': '#2c1533',
  'hero-tinta': '#f6eee6',
  'hero-tenue': '#d3c0d9',
  'hero-cifra': '#efd9b6',
  'hero-sube': '#8ee6b4',
  'hero-baja': '#ffb4ac',
  'hero-rejilla': '#ffffff1f',
  // Brillo violeta (con alfa) para el hover y el foco de las tarjetas y el halo del «en vivo».
  brillo: '#6d3fc02e',
  // El filo de luz arriba de cada tarjeta (sombra interior de 1 px, con alfa en oscuro).
  resalte: '#ffffff',
  // UI-06: el vidrio de «Noche» (ver index.css, `.vidrio*`). En «Clásico» las clases de vidrio no
  // pintan nada (sus reglas sólo aplican con `data-estilo="noche"`); estos valores son los de una
  // superficie opaca por si algo los lee.
  vidrio: '#ffffff',
  'vidrio-fuerte': '#ffffff',
  'vidrio-barra': '#ffffff',
  'vidrio-borde': '#f1edf7',
  'vidrio-brillo': '#ffffff00',
  resplandor: '#ffffff00',
  // Las muestras del selector de estilo: el color de cada estilo, igual en todos.
  'muestra-noche': '#08070b',
  'muestra-clasico': '#2c1533',
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
  // En oscuro el hero sube un escalón y lleva borde: si no, se pierde contra las tarjetas.
  hero: '#3d1c4f',
  'hero-fin': '#241029',
  'hero-borde': '#5a3570',
  'hero-tinta': '#f6eee6',
  'hero-tenue': '#d3c0d9',
  'hero-cifra': '#efd9b6',
  'hero-sube': '#8ee6b4',
  'hero-baja': '#ffb4ac',
  'hero-rejilla': '#ffffff1f',
  brillo: '#926fd040',
  resalte: '#ffffff14',
  vidrio: '#2c1533',
  'vidrio-fuerte': '#2c1533',
  'vidrio-barra': '#2c1533',
  'vidrio-borde': '#34193d',
  'vidrio-brillo': '#ffffff00',
  resplandor: '#ffffff00',
  'muestra-noche': '#08070b',
  'muestra-clasico': '#2c1533',
};

/*
 * UI-06 · «Noche»: negro con morado. Los estados, el semáforo y las series no cambian (son
 * semánticos); cambian las superficies, la tinta, el lateral, el hero y el vidrio.
 *
 * Lo que va en NEGRO en los dos temas (el lateral, la barra de arriba, la de abajo del celular,
 * el hero del Inicio y el login) usa los tokens `lateral-*` y `hero-*`, que valen lo mismo en
 * claro y en oscuro, o la «zona oscura» (`zonaOscura` en tema.ts), que dentro de un marco negro
 * pone los valores de NOCHE_OSCURO aunque el tema sea claro.
 *
 * Los tokens con alfa (`vidrio*`, `hero`, `hero-fin`, `resplandor`) se miden en paleta.test.ts
 * contra el color que resulta al componerlos sobre el peor fondo que puede quedar detrás.
 */
const NOCHE_COMUN = {
  lateral: NEGRO_MARCA,
  'lateral-borde': '#1d1926',
  'lateral-realce': '#191522',
  'lateral-tinta': '#f4ece4',
  'lateral-tenue': '#b5abc4',
  // El hero: casi negro con un fondo violeta que sube desde la esquina; translúcido para que el
  // resplandor de atrás se adivine (vidrio), pero lo bastante opaco para verse negro en claro.
  hero: '#1f1535f0',
  'hero-fin': '#08070bf5',
  'hero-borde': '#ffffff1f',
  'hero-tinta': '#f6eee6',
  'hero-tenue': '#cdc0d6',
  'hero-cifra': '#efd9b6',
  'hero-sube': '#8ee6b4',
  'hero-baja': '#ffb4ac',
  'hero-rejilla': '#ffffff1a',
  // La barra de arriba y la de abajo: vidrio negro, casi opaco (por debajo pasan tarjetas blancas
  // en claro y el texto claro de la barra tiene que seguir leyéndose).
  'vidrio-barra': '#0b0910e6',
  'muestra-noche': '#08070b',
  'muestra-clasico': '#2c1533',
} as const;

const NOCHE_CLARO: Record<Token, string> = {
  ...CLARO,
  // El contenido se aclara (un gris lavanda muy suave, no blanco puro) y la tinta es casi negra.
  fondo: '#f3f1f6',
  superficie: '#ffffff',
  realce: '#eeebf3',
  'realce-fuerte': '#e2dee9',
  'linea-suave': '#ebe8f0',
  linea: '#e0dce7',
  'linea-fuerte': '#c8c2d3',
  tinta: '#15111c',
  'tinta-medio': '#2b2534',
  'tinta-suave': '#463f51',
  'tinta-tenue': '#5a5265',
  rejilla: '#e2dee9',
  velo: '#08070b99',
  sombra: '#15111c1f',
  ...NOCHE_COMUN,
  brillo: '#6d3fc02e',
  resalte: '#ffffff',
  // Vidrio claro: blanco translúcido; el borde es una línea oscura muy tenue (una clara no se ve
  // sobre el fondo claro) y el brillo de arriba, blanco.
  vidrio: '#ffffffb8',
  'vidrio-fuerte': '#ffffffeb',
  'vidrio-borde': '#15111c14',
  'vidrio-brillo': '#ffffffcc',
  resplandor: '#6d3fc024',
};

const NOCHE_OSCURO: Record<Token, string> = {
  ...OSCURO,
  // Casi negro con un tinte violeta mínimo (no gris, no azul marino).
  fondo: '#0b0910',
  superficie: '#16121e',
  realce: '#1f1a29',
  'realce-fuerte': '#2a2436',
  'linea-suave': '#1e1a27',
  linea: '#2a2436',
  'linea-fuerte': '#433b52',
  tinta: '#f5f2f8',
  'tinta-medio': '#e7e2ee',
  'tinta-suave': '#cdc6d9',
  'tinta-tenue': '#aba2bc',
  rejilla: '#221d2c',
  velo: '#000000b3',
  sombra: '#00000080',
  ...NOCHE_COMUN,
  brillo: '#926fd040',
  resalte: '#ffffff17',
  // Vidrio oscuro: la superficie translúcida, borde claro de 1 px con poca opacidad y un brillo
  // blanco muy tenue arriba.
  vidrio: '#16121ebf',
  'vidrio-fuerte': '#16121eeb',
  'vidrio-borde': '#ffffff17',
  'vidrio-brillo': '#ffffff12',
  resplandor: '#6d3fc040',
};

export const PALETAS: Record<Estilo, Record<Tema, Record<Token, string>>> = {
  noche: { claro: NOCHE_CLARO, oscuro: NOCHE_OSCURO },
  clasico: { claro: CLARO, oscuro: OSCURO },
};

/** La paleta del estilo «Clásico» (la v3), la de antes de UI-06. */
export const PALETA: Record<Tema, Record<Token, string>> = PALETAS.clasico;

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
