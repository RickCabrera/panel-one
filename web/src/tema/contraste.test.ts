import { describe, expect, it } from 'vitest';

import {
  ajustarContraste,
  comoDeuteranopia,
  contraste,
  diferencia,
  mezclar,
  normalizarHex,
} from './contraste';

// Valores de referencia conocidos: si la aritmética se rompe, el test de la paleta
// podría pasar por las razones equivocadas.
describe('contraste (WCAG 2.x)', () => {
  it('blanco sobre negro es 21:1, y un color contra sí mismo 1:1', () => {
    expect(contraste('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contraste('#777777', '#777777')).toBe(1);
  });

  it('coincide con los valores publicados', () => {
    // slate-500 sobre blanco: 4.76; slate-500 sobre slate-100: 4.34 (por eso no se usa).
    expect(contraste('#64748b', '#ffffff')).toBeCloseTo(4.76, 2);
    expect(contraste('#64748b', '#f1f5f9')).toBeCloseTo(4.34, 2);
    expect(contraste('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });

  it('es simétrico', () => {
    expect(contraste('#0f766e', '#f8fafc')).toBe(contraste('#f8fafc', '#0f766e'));
  });
});

describe('diferencia (ΔE CIE76)', () => {
  it('blanco contra negro es 100; un color contra sí mismo, 0', () => {
    expect(diferencia('#ffffff', '#000000')).toBeCloseTo(100, 1);
    expect(diferencia('#dc2626', '#dc2626')).toBe(0);
  });

  it('rojo puro contra verde puro es ~170', () => {
    expect(diferencia('#ff0000', '#00ff00')).toBeCloseTo(170.6, 0);
  });
});

describe('comoDeuteranopia', () => {
  it('los grises no cambian', () => {
    expect(comoDeuteranopia('#808080')).toBe('#808080');
  });

  it('rojo y verde puros se acercan mucho', () => {
    const normal = diferencia('#ff0000', '#00ff00');
    expect(diferencia(comoDeuteranopia('#ff0000'), comoDeuteranopia('#00ff00'))).toBeLessThan(
      normal / 2,
    );
  });
});

describe('mezclar y ajustarContraste', () => {
  it('mezcla en proporción', () => {
    expect(mezclar('#000000', '#ffffff', 0)).toBe('#000000');
    expect(mezclar('#000000', '#ffffff', 1)).toBe('#ffffff');
    expect(mezclar('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('empuja hasta alcanzar el mínimo, y no más', () => {
    const ajustado = ajustarContraste('#aaaaaa', '#000000', ['#ffffff'], 4.5);
    expect(contraste(ajustado, '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(ajustarContraste('#333333', '#000000', ['#ffffff'], 4.5)).toBe('#333333');
  });

  it('expande los hex de 3 dígitos y rechaza lo que no es hex', () => {
    expect(normalizarHex('#ABC')).toBe('#aabbcc');
    expect(() => normalizarHex('red')).toThrow();
  });
});
