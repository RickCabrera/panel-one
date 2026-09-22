import { describe, expect, it } from 'vitest';

import { estadoProducto, precioTexto } from './textos';

describe('estadoProducto', () => {
  it('desaparecer de la sincronización pesa más que el estado del POS', () => {
    expect(estadoProducto({ activo: false, activoPos: true })).toBe('Ya no aparece en el POS');
    expect(estadoProducto({ activo: false, activoPos: false })).toBe('Ya no aparece en el POS');
  });

  it('baja en el POS, vigente, y nulo (el POS no lo reporta) cuenta como vigente', () => {
    expect(estadoProducto({ activo: true, activoPos: false })).toBe('Baja en el POS');
    expect(estadoProducto({ activo: true, activoPos: true })).toBe('Vigente');
    expect(estadoProducto({ activo: true, activoPos: null })).toBe('Vigente');
  });
});

describe('precioTexto', () => {
  it('nulo es "Sin precio", no $0.00; el cero real sí es $0.00', () => {
    expect(precioTexto(null)).toBe('Sin precio');
    expect(precioTexto('0.00')).toBe('$0.00');
    expect(precioTexto('1234.50')).toBe('$1,234.50');
  });
});
