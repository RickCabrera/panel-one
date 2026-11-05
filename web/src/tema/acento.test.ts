import { describe, expect, it } from 'vitest';

import { ACENTO_POR_DEFECTO, derivarAcento, leerAcento } from './acento';
import { contraste } from './contraste';
import { ESTILOS, PALETA, PALETAS, SUPERFICIES, type Tema } from './paleta';

describe('leerAcento', () => {
  it.each(['#abc', '#0F766E', '#123456'])('acepta el hex %j', (valor) => {
    expect(leerAcento(valor)).toBe(valor);
  });

  it.each([
    undefined,
    '',
    'red',
    '#12345',
    '#1234567',
    'abc',
    '#fff; background: url(x)',
    'var(--otro)',
  ])('cae al de fábrica con %j', (valor) => {
    expect(leerAcento(valor)).toBe(ACENTO_POR_DEFECTO);
  });
});

// F2-211: el acento se configura por despliegue; cualquier valor, hasta uno absurdo,
// tiene que dejar texto, bordes y foco legibles en los dos temas (UI-06: y en los dos estilos).
const CASOS = ESTILOS.flatMap((estilo) =>
  (['claro', 'oscuro'] as Tema[]).map((tema) => [estilo, tema] as const),
);

describe.each(CASOS)('derivarAcento, estilo %s, tema %s', (estilo, tema) => {
  const fondos = SUPERFICIES.map((s) => PALETAS[estilo][tema][s]);

  it.each([ACENTO_POR_DEFECTO, '#ffff00', '#111111', '#ffffff', '#000000', '#777', '#ff00ff'])(
    'con %s: texto ≥ 4.5, borde ≥ 3 contra toda superficie, y texto sobre el relleno ≥ 4.5',
    (acento) => {
      const d = derivarAcento(acento, tema, estilo);
      for (const fondo of fondos) {
        expect(contraste(d['acento-texto'], fondo)).toBeGreaterThanOrEqual(4.5);
        expect(contraste(d['acento-borde'], fondo)).toBeGreaterThanOrEqual(3);
      }
      expect(contraste(d['sobre-acento'], d.acento)).toBeGreaterThanOrEqual(4.5);
      expect(d['serie-1']).toBe(d['acento-borde']);
    },
  );

  it('el relleno es el acento configurado, igual en los dos temas', () => {
    expect(derivarAcento('#ABC', tema, estilo).acento).toBe('#aabbcc');
  });
});

it('un acento que ya pasa no se toca; uno que no, se ajusta lo justo', () => {
  expect(derivarAcento('#0b5750', 'claro', 'clasico')['acento-texto']).toBe('#0b5750');
  // UI-02: el de fábrica (violeta de Yo Controlo) ya pasa en claro y no se toca.
  expect(derivarAcento(ACENTO_POR_DEFECTO, 'claro', 'clasico')['acento-texto']).toBe(
    ACENTO_POR_DEFECTO,
  );
  // El verde azulado de antes queda en 4.18:1 sobre `realce-fuerte`: un paso de 5 % hacia negro.
  const VERDE_AZULADO = '#0f766e';
  const ajustado = derivarAcento(VERDE_AZULADO, 'claro', 'clasico')['acento-texto'];
  expect(ajustado).not.toBe(VERDE_AZULADO);
  expect(contraste(VERDE_AZULADO, PALETA.claro['realce-fuerte'])).toBeLessThan(4.5);
  expect(ajustado).toBe('#0e7069');
});
