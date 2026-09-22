import { describe, expect, it } from 'vitest';

import { delta, deltaImporte, diferenciaEnPesos, porcentajeDeCambio } from './delta';

describe('porcentajeDeCambio', () => {
  it('a un decimal, con signo, redondeando la mitad lejos de cero', () => {
    expect(porcentajeDeCambio(110n, 100n)).toBe('+10.0 %');
    expect(porcentajeDeCambio(90n, 100n)).toBe('-10.0 %');
    expect(porcentajeDeCambio(100n, 100n)).toBe('0.0 %');
    // 1/3 = 33.33… → 33.3; 2/3 = 66.66… → 66.7.
    expect(porcentajeDeCambio(400n, 300n)).toBe('+33.3 %');
    expect(porcentajeDeCambio(500n, 300n)).toBe('+66.7 %');
    // Exactamente a la mitad (1/2000 = 0.05 %) → 0.1 %; hacia abajo también se aleja del cero.
    expect(porcentajeDeCambio(20001n, 20000n)).toBe('0.0 %');
    expect(porcentajeDeCambio(2001n, 2000n)).toBe('+0.1 %');
    expect(porcentajeDeCambio(1999n, 2000n)).toBe('-0.1 %');
    // Una caída a cero es -100 %, y eso sí es cierto.
    expect(porcentajeDeCambio(0n, 5000n)).toBe('-100.0 %');
  });
});

describe('delta', () => {
  it('sin base (cero o negativa) no hay porcentaje: nunca "+100 %"', () => {
    expect(delta(5000n, 0n, 'sin ventas antes.')).toEqual({
      tipo: 'sinBase',
      razon: 'sin ventas antes.',
    });
    expect(delta(5000n, -100n, 'sin ventas antes.').tipo).toBe('sinBase');
  });

  it('un dato ilegible no se compara', () => {
    expect(delta(null, 100n, 'x')).toEqual({
      tipo: 'sinBase',
      razon: 'Algún importe no se pudo leer.',
    });
    expect(delta(100n, null, 'x').tipo).toBe('sinBase');
  });

  it('con base, diferencia y porcentaje', () => {
    expect(delta(12_000n, 10_000n, 'x')).toEqual({
      tipo: 'cambio',
      diferencia: 2_000n,
      porcentaje: '+20.0 %',
    });
  });
});

describe('deltaImporte', () => {
  it('una base sin cuentas es "—" aunque su venta diga 0.00', () => {
    expect(deltaImporte('150.00', '0.00', 0, 'sin ventas en la semana pasada.')).toEqual({
      tipo: 'sinBase',
      razon: 'sin ventas en la semana pasada.',
    });
  });

  it('promedio null (sin divisor) no se compara', () => {
    expect(deltaImporte('150.00', null, 3, 'r').tipo).toBe('sinBase');
    expect(deltaImporte(null, '100.00', 3, 'r').tipo).toBe('sinBase');
  });

  it('importes de la API en centavos exactos, sin float', () => {
    expect(deltaImporte('0.30', '0.10', 1, 'r')).toEqual({
      tipo: 'cambio',
      diferencia: 20n,
      porcentaje: '+200.0 %',
    });
    expect(deltaImporte('abc', '0.10', 1, 'r').tipo).toBe('sinBase');
  });
});

describe('diferenciaEnPesos', () => {
  it('con signo delante del $', () => {
    expect(diferenciaEnPesos(123_450n)).toBe('+$1,234.50');
    expect(diferenciaEnPesos(-2_000n)).toBe('-$20.00');
    expect(diferenciaEnPesos(0n)).toBe('$0.00');
  });
});
