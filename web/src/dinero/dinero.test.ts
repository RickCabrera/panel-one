import { describe, expect, it } from 'vitest';

import { aCentavos, formatearPesos, paraGrafica, pesos, porcentaje, sumar } from './dinero';

describe('aCentavos', () => {
  it('lee el texto de la API a centavos exactos', () => {
    expect(aCentavos('1234.50')).toBe(123450n);
    expect(aCentavos('1234.5')).toBe(123450n);
    expect(aCentavos('7')).toBe(700n);
    expect(aCentavos('0.05')).toBe(5n);
    expect(aCentavos('-12.30')).toBe(-1230n);
    expect(aCentavos(' 10.00 ')).toBe(1000n);
  });

  it('rechaza lo que no es un importe de hasta 2 decimales', () => {
    for (const malo of ['', 'abc', '1.234', '1,000.00', '1e3', '.5', '5.', 'NaN', '--1']) {
      expect(aCentavos(malo), malo).toBeNull();
    }
  });

  it('no pierde centavos en importes grandes (más allá de lo exacto en float)', () => {
    expect(aCentavos('90071992547409.93')).toBe(9007199254740993n);
  });
});

describe('sumar', () => {
  it('es exacta: 0.10 + 0.20 da 0.30, no 0.30000000000000004', () => {
    const total = sumar([aCentavos('0.10')!, aCentavos('0.20')!]);
    expect(total).toBe(30n);
    expect(formatearPesos(total)).toBe('$0.30');
  });

  it('no redondea importes grandes: la suma no pasa por float ni "arreglando" centavos', () => {
    // 90,071,992,547,409.93 + 0.01 no se puede representar exacto en un double.
    const total = sumar([aCentavos('90071992547409.93')!, aCentavos('0.01')!]);
    expect(total).toBe(9007199254740994n);
    expect(formatearPesos(total)).toBe('$90,071,992,547,409.94');
    expect(sumar([aCentavos('90071992547409.93')!, aCentavos('0.02')!])).toBe(9007199254740995n);
  });

  it('de nada es cero', () => {
    expect(sumar([])).toBe(0n);
  });
});

describe('formatearPesos', () => {
  it('agrupa miles y siempre lleva 2 decimales', () => {
    expect(formatearPesos(0n)).toBe('$0.00');
    expect(formatearPesos(5n)).toBe('$0.05');
    expect(formatearPesos(123450n)).toBe('$1,234.50');
    expect(formatearPesos(100000000n)).toBe('$1,000,000.00');
    expect(formatearPesos(9007199254740993n)).toBe('$90,071,992,547,409.93');
  });

  it('pone el signo antes del $', () => {
    expect(formatearPesos(-1230n)).toBe('-$12.30');
  });
});

describe('pesos', () => {
  it('formatea el texto de la API y dice cuando no es un importe', () => {
    expect(pesos('1234.5')).toBe('$1,234.50');
    expect(pesos('basura')).toBe('Importe inválido');
  });
});

describe('porcentaje', () => {
  it('un decimal, redondeando a la mitad hacia arriba', () => {
    expect(porcentaje(1n, 3n)).toBe('33.3 %');
    expect(porcentaje(2n, 3n)).toBe('66.7 %');
    expect(porcentaje(1n, 8n)).toBe('12.5 %');
    expect(porcentaje(1n, 1600n)).toBe('0.1 %'); // 0.0625 % → 0.1
    expect(porcentaje(3n, 3n)).toBe('100.0 %');
    expect(porcentaje(0n, 3n)).toBe('0.0 %');
  });

  it('sin total no hay porcentaje', () => {
    expect(porcentaje(0n, 0n)).toBeNull();
    expect(porcentaje(5n, 0n)).toBeNull();
  });
});

describe('paraGrafica', () => {
  it('da el número en pesos, sólo para dibujar', () => {
    expect(paraGrafica(123450n)).toBe(1234.5);
  });
});
