import { describe, expect, it } from 'vitest';

import { ACENTO_POR_DEFECTO, aplicarAcento, leerAcento } from './acento';

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

describe('aplicarAcento', () => {
  it('pone --color-acento en la raíz', () => {
    const raiz = document.createElement('div');
    aplicarAcento('#123456', raiz);
    expect(raiz.style.getPropertyValue('--color-acento')).toBe('#123456');
  });
});
