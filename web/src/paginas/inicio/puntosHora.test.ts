import { describe, expect, it } from 'vitest';

import type { VentaHora } from '../../api/tipos';
import { ticketPorHora } from './puntosHora';

const fila = (hora: number, venta: string, cuentas: number): VentaHora => ({
  hora,
  venta,
  cuentas,
});

describe('ticketPorHora (UI-05): la tendencia del ticket por hora', () => {
  it('sin ninguna hora con cuentas no hay tendencia', () => {
    expect(ticketPorHora([])).toEqual([]);
    expect(ticketPorHora([fila(9, '0.00', 0), fila(10, '0.00', 0)])).toEqual([]);
  });

  it('divide la venta de cada hora entre sus cuentas, en orden de hora', () => {
    expect(ticketPorHora([fila(14, '900.00', 3), fila(13, '500.00', 2)])).toEqual([250, 300]);
  });

  it('una hora sin cuentas en medio es hueco (null), no un cero; las vacías de los extremos no se dibujan', () => {
    const filas = [
      fila(8, '0.00', 0),
      fila(9, '200.00', 2),
      fila(10, '0.00', 0),
      fila(11, '450.00', 3),
      fila(12, '0.00', 0),
    ];
    expect(ticketPorHora(filas)).toEqual([100, null, 150]);
  });

  it('una hora que falta en medio también es hueco', () => {
    expect(ticketPorHora([fila(9, '100.00', 1), fila(11, '300.00', 1)])).toEqual([100, null, 300]);
  });

  it('un importe ilegible es hueco', () => {
    expect(ticketPorHora([fila(9, '100.00', 1), fila(10, 'x', 2), fila(11, '50.00', 1)])).toEqual([
      100,
      null,
      50,
    ]);
  });
});
