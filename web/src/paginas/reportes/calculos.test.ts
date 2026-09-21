import { describe, expect, it } from 'vitest';

import type { VentaSucursal } from '../../api/tipos';
import {
  cantidadLegible,
  dividirRedondeado,
  etiquetaDia,
  totalComparativo,
  totalDe,
  totalPorDia,
} from './calculos';

const suc = (p: Partial<VentaSucursal>): VentaSucursal => ({
  sucursalId: 's',
  nombre: 'S',
  venta: '0.00',
  cuentas: 0,
  ticketPromedio: null,
  comensales: 0,
  ...p,
});

describe('totales de los reportes', () => {
  it('suma en centavos exactos, también más allá de 2^53 centavos', () => {
    // 90,071,992,547,409.93 + 0.01 + 0.07: en float no da exacto.
    const filas = [
      { venta: '90071992547409.93', cuentas: 1 },
      { venta: '0.01', cuentas: 1 },
      { venta: '0.07', cuentas: 2 },
    ];
    expect(totalDe(filas)).toEqual({ venta: 9007199254741001n, cuentas: 4 });
  });

  it('0.1 + 0.2 da 0.30 exacto', () => {
    expect(
      totalPorDia([
        { dia: '2026-09-01', venta: '0.10', cuentas: 1 },
        { dia: '2026-09-02', venta: '0.20', cuentas: 1 },
      ]).venta,
    ).toBe(30n);
  });

  it('una fila ilegible deja el total en null, nunca una suma parcial ni $0.00', () => {
    const t = totalDe([
      { venta: '100.00', cuentas: 1 },
      { venta: '12,00', cuentas: 1 },
    ]);
    expect(t.venta).toBeNull();
    expect(t.cuentas).toBe(2);
  });

  it('comparativo: ticket promedio del TOTAL, mitad lejos de cero como la API', () => {
    const t = totalComparativo([
      suc({ venta: '100.00', cuentas: 1, comensales: 2 }),
      suc({ venta: '33.45', cuentas: 1, comensales: 3 }),
    ]);
    // 133.45 / 2 = 66.725 → 66.73 (igual que el test de F1-032 en la API).
    expect(t).toEqual({ venta: 13345n, cuentas: 2, ticketPromedio: 6673n, comensales: 5 });
  });

  it('comparativo sin cuentas: promedio null; con una venta ilegible, también', () => {
    expect(totalComparativo([suc({})]).ticketPromedio).toBeNull();
    expect(totalComparativo([suc({ venta: 'x', cuentas: 3 })]).ticketPromedio).toBeNull();
  });

  it('dividirRedondeado: mitad lejos de cero, con signo, y null sin divisor', () => {
    expect(dividirRedondeado(5n, 2)).toBe(3n);
    expect(dividirRedondeado(4n, 3)).toBe(1n);
    expect(dividirRedondeado(-5n, 2)).toBe(-3n);
    expect(dividirRedondeado(100n, 0)).toBeNull();
  });
});

describe('formato', () => {
  it('el día es de calendario: no se mueve con la zona del navegador', () => {
    expect(etiquetaDia('2026-09-01')).toMatch(/1/);
    expect(etiquetaDia('2026-09-01')).toMatch(/sep/i);
    expect(etiquetaDia('no-es-dia')).toBe('no-es-dia');
  });

  it('cantidad sin ceros de relleno y sin pasar por float', () => {
    expect(cantidadLegible('3.000')).toBe('3');
    expect(cantidadLegible('12.500')).toBe('12.5');
    expect(cantidadLegible('0.125')).toBe('0.125');
    expect(cantidadLegible('10')).toBe('10');
    expect(cantidadLegible('100.000')).toBe('100');
    expect(cantidadLegible('abc')).toBe('abc');
  });
});
