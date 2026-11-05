import { describe, expect, it } from 'vitest';

import { derivarAcento } from './acento';
import { comoDeuteranopia, componer, contraste, diferencia, tieneAlfa } from './contraste';
import {
  ACENTO_POR_DEFECTO,
  ESTILOS,
  PALETAS,
  SUPERFICIES,
  TOKENS,
  type Estilo,
  type Tema,
  type Token,
  type TokenAcento,
} from './paleta';

/**
 * AC1 de F2-211: ninguna vista tiene texto bajo 4.5:1 en ninguno de los dos temas.
 *
 * Se mide sobre la PALETA, que es lo único que puede pintar texto: la regla de lint
 * `tema/sin-colores` prohíbe cualquier color fuera de `paleta.ts`. Así, si todo token
 * de texto pasa sobre toda superficie, ninguna vista puede quedar bajo el mínimo.
 *
 * UI-06: se mide en los DOS estilos de marca («Noche» y «Clásico») por cada tema. Los tokens con
 * alfa (el vidrio, el hero de «Noche») se miden sobre el color que resulta al componerlos con
 * cada fondo que puede quedar detrás: el peor caso manda.
 */

const TEMAS: Tema[] = ['claro', 'oscuro'];

type Cualquiera = Token | TokenAcento;
const colores = (estilo: Estilo, tema: Tema): Record<Cualquiera, string> => ({
  ...PALETAS[estilo][tema],
  ...derivarAcento(ACENTO_POR_DEFECTO, tema, estilo),
});

/** Lo que puede quedar detrás de algo que va sobre la página: el fondo, con o sin resplandor. */
const detrasDeLaPagina = (c: Record<Cualquiera, string>) => [
  c.fondo,
  componer(c.resplandor, c.fondo),
];

/** `color` como se ve sobre cada fondo de `detras` (si es opaco, él mismo). */
const sobre = (color: string, detras: string[]) =>
  tieneAlfa(color) ? detras.map((d) => componer(color, d)) : [color];

/** Los dos extremos del degradado del hero, ya compuestos sobre lo que hay detrás. */
const fondosHero = (c: Record<Cualquiera, string>) => [
  ...sobre(c.hero, detrasDeLaPagina(c)),
  ...sobre(c['hero-fin'], detrasDeLaPagina(c)),
];

/** Todo lo que se usa como color de TEXTO (`text-*`). */
const TEXTOS: Cualquiera[] = [
  'tinta',
  'tinta-medio',
  'tinta-suave',
  'tinta-tenue',
  'peligro',
  'aviso',
  'exito',
  'acento-texto',
];

/** Parejas texto/fondo que no son "texto sobre una superficie": insignias y botones. */
const PAREJAS: [Cualquiera, Cualquiera][] = [
  ['peligro', 'peligro-fondo'],
  ['aviso', 'aviso-fondo'],
  ['exito', 'exito-fondo'],
  ['sobre-acento', 'acento'],
  ['sobre-peligro', 'peligro-fuerte'],
  // UI-02: la barra lateral es del morado de marca en los dos temas. Su texto, el tenue (los
  // encabezados de sección) y el arena del logo, sobre el fondo y sobre el realce (hover).
  ['lateral-tinta', 'lateral'],
  ['lateral-tinta', 'lateral-realce'],
  ['lateral-tenue', 'lateral'],
  ['lateral-tenue', 'lateral-realce'],
  ['arena', 'lateral'],
];

/**
 * UI-05: el hero (Inicio y login) es un degradado: su texto se mide contra los DOS extremos, así
 * cualquier punto intermedio también pasa (en «Noche», compuestos sobre lo que hay detrás).
 */
const TEXTOS_HERO: Cualquiera[] = ['hero-tinta', 'hero-tenue', 'hero-cifra', 'hero-sube', 'hero-baja'];

/** Lo que no es texto pero da información: ≥ 3:1 contra la superficie (WCAG 1.4.11). */
const GRAFICOS: Cualquiera[] = [
  'semaforo-ok',
  'semaforo-alerta',
  'semaforo-rojo',
  'semaforo-sin-dato',
  'serie-1',
  'serie-2',
  'serie-3',
  'serie-4',
  'info',
  'acento-borde',
];

const SEMAFORO: Cualquiera[] = [
  'semaforo-ok',
  'semaforo-alerta',
  'semaforo-rojo',
  'semaforo-sin-dato',
];
const SERIES: Cualquiera[] = ['serie-1', 'serie-2', 'serie-3', 'serie-4'];

const pares = <T>(lista: T[]): [T, T][] =>
  lista.flatMap((a, i) => lista.slice(i + 1).map((b) => [a, b] as [T, T]));

const COMBINACIONES = ESTILOS.flatMap((estilo) => TEMAS.map((tema) => [estilo, tema] as const));

describe.each(COMBINACIONES)('paleta, estilo %s, tema %s', (estilo, tema) => {
  const c = colores(estilo, tema);

  it('trae los mismos tokens que los otros estilos y temas', () => {
    expect(Object.keys(PALETAS[estilo][tema]).sort()).toEqual([...TOKENS].sort());
  });

  it('sólo el vidrio, el hero de «Noche» y los velos llevan alfa: lo demás es opaco', () => {
    const conAlfa = TOKENS.filter((t) => tieneAlfa(c[t]));
    const permitidos: Token[] = [
      'velo',
      'sombra',
      'brillo',
      'resalte',
      'hero-rejilla',
      'hero',
      'hero-fin',
      'hero-borde',
      'vidrio',
      'vidrio-fuerte',
      'vidrio-barra',
      'vidrio-borde',
      'vidrio-brillo',
      'resplandor',
    ];
    expect(conAlfa.filter((t) => !permitidos.includes(t))).toEqual([]);
  });

  it.each(TEXTOS.flatMap((t) => SUPERFICIES.map((s) => [t, s] as const)))(
    'texto %s sobre %s: ≥ 4.5:1',
    (texto, fondo) => {
      expect(contraste(c[texto], c[fondo])).toBeGreaterThanOrEqual(4.5);
    },
  );

  it.each(PAREJAS)('texto %s sobre %s: ≥ 4.5:1', (texto, fondo) => {
    expect(contraste(c[texto], c[fondo])).toBeGreaterThanOrEqual(4.5);
  });

  // UI-02: los controles segmentados (periodo, tema, pestañas de Administración) van sobre un
  // carril `realce`; lo elegido se marca con el borde del acento, que tiene que verse contra ese
  // carril (WCAG 1.4.11). El relleno solo no basta: en oscuro el violeta queda en ~2.2:1.
  it('lo elegido de un control segmentado se ve contra su carril: acento-borde ≥ 3:1 sobre realce', () => {
    expect(contraste(c['acento-borde'], c.realce)).toBeGreaterThanOrEqual(3);
  });

  // UI-05: la línea de la gráfica por hora dentro del hero es arena; el halo del «en vivo» y
  // el semáforo de antigüedad usan los mismos tokens de siempre.
  it.each(TEXTOS_HERO)('texto %s sobre los dos extremos del hero: ≥ 4.5:1', (texto) => {
    for (const fondo of fondosHero(c)) {
      expect(contraste(c[texto], fondo)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('la línea de la gráfica del hero (arena) se ve contra los dos extremos del degradado: ≥ 3:1', () => {
    for (const fondo of fondosHero(c)) {
      expect(contraste(c['hero-cifra'], fondo)).toBeGreaterThanOrEqual(3);
    }
  });

  // El hero se distingue del fondo de la vista: por luminancia en claro y, en oscuro, porque
  // trae su borde propio, que tiene que verse contra el fondo (≥ 1.5:1, es un contorno, no dato).
  it('el hero se distingue del fondo de la vista', () => {
    const relleno = sobre(c.hero, [c.fondo])[0];
    const borde = sobre(c['hero-borde'], [relleno])[0];
    expect(
      Math.max(contraste(relleno, c.fondo), contraste(borde, c.fondo)),
    ).toBeGreaterThanOrEqual(1.5);
  });

  it.each(GRAFICOS)('%s se ve contra la superficie y el fondo: ≥ 3:1', (token) => {
    expect(contraste(c[token], c.superficie)).toBeGreaterThanOrEqual(3);
    expect(contraste(c[token], c.fondo)).toBeGreaterThanOrEqual(3);
  });

  // El semáforo de mesas no tiene otro canal que el color del borde: cada par de
  // estados tiene que distinguirse a la vista, y "sin dato" también del borde normal.
  it.each(pares([...SEMAFORO, 'linea' as Cualquiera]))(
    'semáforo: %s y %s se distinguen (ΔE ≥ 20)',
    (a, b) => {
      expect(diferencia(c[a], c[b])).toBeGreaterThanOrEqual(20);
    },
  );

  // Con deuteranopia el rojo y el verde se acercan; el umbral es menor, pero tienen
  // que seguir sin confundirse (se separan por luminosidad).
  it.each(pares(SEMAFORO))('semáforo con deuteranopia: %s y %s se distinguen (ΔE ≥ 10)', (a, b) => {
    expect(diferencia(comoDeuteranopia(c[a]), comoDeuteranopia(c[b]))).toBeGreaterThanOrEqual(10);
  });

  it.each(pares(SERIES))('dona: %s y %s se distinguen (ΔE ≥ 20)', (a, b) => {
    expect(diferencia(c[a], c[b])).toBeGreaterThanOrEqual(20);
  });
});

/*
 * UI-06 · el vidrio de «Noche». Cada superficie translúcida se compone sobre todo lo que puede
 * quedar detrás de ella, y el texto se mide contra el PEOR resultado.
 */
describe.each(TEMAS)('vidrio de «Noche», tema %s', (tema) => {
  const c = colores('noche', tema);
  const claro = colores('noche', 'claro');
  const oscuro = colores('noche', 'oscuro');

  // Tarjetas, paneles, filtros (y `vidrio-falso`: mesas, turnos, la tabla de Tickets): van sobre
  // la página, nunca sobre otro vidrio.
  const tarjeta = sobre(c.vidrio, detrasDeLaPagina(c));

  it.each(TEXTOS)('texto %s sobre una tarjeta de vidrio: ≥ 4.5:1', (texto) => {
    for (const fondo of tarjeta) expect(contraste(c[texto], fondo)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(GRAFICOS)('%s (semáforo, series, bordes) se ve sobre el vidrio: ≥ 3:1', (token) => {
    for (const fondo of tarjeta) expect(contraste(c[token], fondo)).toBeGreaterThanOrEqual(3);
  });

  // Modales y hojas: detrás puede haber CUALQUIER cosa (el velo encima de una tarjeta blanca, del
  // lateral negro...). Se miden contra los dos extremos: blanco y negro puros.
  it.each(TEXTOS)('texto %s sobre un modal de vidrio (detrás, de blanco a negro): ≥ 4.5:1', (texto) => {
    for (const fondo of sobre(c['vidrio-fuerte'], ['#ffffff', '#000000'])) {
      expect(contraste(c[texto], fondo)).toBeGreaterThanOrEqual(4.5);
    }
  });

  // La barra de arriba (zona oscura: tokens de NOCHE oscuro) y la de abajo (tokens `lateral-*`):
  // vidrio negro con el contenido de la página pasando por debajo. En claro, lo más claro que
  // pasa es una tarjeta blanca: el peor caso es blanco puro.
  const barra = sobre(oscuro['vidrio-barra'], [
    '#ffffff',
    ...SUPERFICIES.map((s) => claro[s]),
    ...SUPERFICIES.map((s) => oscuro[s]),
  ]);

  it.each<Cualquiera>([...TEXTOS, 'lateral-tinta', 'lateral-tenue', 'arena'])(
    'texto %s sobre la barra de vidrio negro (con lo más claro detrás): ≥ 4.5:1',
    (texto) => {
      for (const fondo of barra) {
        expect(contraste(oscuro[texto], fondo)).toBeGreaterThanOrEqual(4.5);
      }
    },
  );

  it('lo elegido en la barra (el borde del acento) se ve contra el vidrio negro: ≥ 3:1', () => {
    for (const fondo of barra) {
      expect(contraste(oscuro['acento-borde'], fondo)).toBeGreaterThanOrEqual(3);
    }
  });

  it('las barras, el lateral y el hero son negros también en claro', () => {
    for (const fondo of [...barra.slice(0, 1), claro.lateral, ...fondosHero(claro)]) {
      expect(contraste(fondo, '#000000')).toBeLessThan(1.6);
    }
  });
});
