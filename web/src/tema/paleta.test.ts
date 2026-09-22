import { describe, expect, it } from 'vitest';

import { derivarAcento } from './acento';
import { comoDeuteranopia, contraste, diferencia } from './contraste';
import {
  ACENTO_POR_DEFECTO,
  PALETA,
  SUPERFICIES,
  TOKENS,
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
 */

const TEMAS: Tema[] = ['claro', 'oscuro'];

type Cualquiera = Token | TokenAcento;
const colores = (tema: Tema): Record<Cualquiera, string> => ({
  ...PALETA[tema],
  ...derivarAcento(ACENTO_POR_DEFECTO, tema),
});

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
];

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

describe.each(TEMAS)('paleta, tema %s', (tema) => {
  const c = colores(tema);

  it('trae los mismos tokens que el otro tema', () => {
    expect(Object.keys(PALETA[tema]).sort()).toEqual([...TOKENS].sort());
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
