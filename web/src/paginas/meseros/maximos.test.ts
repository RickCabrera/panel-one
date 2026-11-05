import { describe, expect, it } from 'vitest';

import { maximosPorSucursal } from './maximos';

interface Fila {
  sucursal: string;
  venta: bigint | null;
}

const maximos = (filas: Fila[]) =>
  maximosPorSucursal(
    filas,
    (f) => f.sucursal,
    (f) => f.venta,
  );

describe('maximosPorSucursal (UI-05)', () => {
  it('da el mayor de cada sucursal, por separado', () => {
    const m = maximos([
      { sucursal: 'a', venta: 100n },
      { sucursal: 'b', venta: 50n },
      { sucursal: 'a', venta: 300n },
      { sucursal: 'b', venta: 70n },
      { sucursal: 'a', venta: 200n },
    ]);
    expect(m.get('a')).toBe(300n);
    expect(m.get('b')).toBe(70n);
    expect(m.size).toBe(2);
  });

  it('ignora los valores ilegibles (null); una sucursal sólo con null no tiene máximo', () => {
    const m = maximos([
      { sucursal: 'a', venta: null },
      { sucursal: 'a', venta: 10n },
      { sucursal: 'c', venta: null },
    ]);
    expect(m.get('a')).toBe(10n);
    expect(m.has('c')).toBe(false);
  });

  it('sin filas, vacío', () => {
    expect(maximos([]).size).toBe(0);
  });
});
