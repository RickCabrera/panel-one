import { Prisma } from '@prisma/client';

import { armarKardex, cuadreDe, diaSiguiente, limitesDelRango } from './kardex';

// La parte pura del kardex (F2-122). Literales escritos a mano.

const d = (v: string) => new Prisma.Decimal(v);

describe('armarKardex() (F2-122)', () => {
  it('saldo corrido desde el inicial; una cancelada repite el saldo y no cuenta', () => {
    const k = armarKardex(d('10'), [
      { id: 'a', cantidad: d('5.5'), cancelada: false },
      { id: 'b', cantidad: d('-3.25'), cancelada: false },
      { id: 'c', cantidad: d('-100'), cancelada: true },
      { id: 'd', cantidad: d('0'), cancelada: false },
      { id: 'e', cantidad: d('-12.25'), cancelada: false },
    ]);
    expect(k.filas.map((f) => [f.id, f.saldo.toFixed(3)])).toEqual([
      ['a', '15.500'],
      ['b', '12.250'],
      ['c', '12.250'],
      ['d', '12.250'],
      ['e', '0.000'],
    ]);
    expect([k.saldoFinal.toFixed(3), k.entradas.toFixed(3), k.salidas.toFixed(3)]).toEqual([
      '0.000',
      '5.500',
      '15.500',
    ]);
  });

  it('sin movimientos en el rango, el saldo final es el inicial', () => {
    const k = armarKardex(d('-2'), []);
    expect([k.filas, k.saldoFinal.toFixed(3)]).toEqual([[], '-2.000']);
  });
});

describe('cuadreDe() (F2-122)', () => {
  it('cuadra cuando la existencia es el saldo al corte; si no, dice la diferencia', () => {
    expect(
      cuadreDe({ polizasRecibidas: 3, existencia: d('4.5'), saldoAlCorte: d('4.500') }),
    ).toEqual({ cuadra: true, diferencia: d('0') });
    const r = cuadreDe({ polizasRecibidas: 3, existencia: d('4'), saldoAlCorte: d('4.5') });
    expect([r.cuadra, r.diferencia?.toFixed(3)]).toEqual([false, '-0.500']);
  });

  it('sin movimientos recibidos o sin existencia leída NO inventa una diferencia', () => {
    for (const op of [
      { polizasRecibidas: 0, existencia: d('7'), saldoAlCorte: d('0') },
      { polizasRecibidas: 5, existencia: null, saldoAlCorte: d('0') },
      { polizasRecibidas: 5, existencia: d('7'), saldoAlCorte: null },
    ]) {
      expect(cuadreDe(op)).toEqual({ cuadra: null, diferencia: null });
    }
  });
});

describe('limitesDelRango() (F2-122)', () => {
  it('corta los días en la zona de la sucursal, no en la del servidor', () => {
    const cdmx = limitesDelRango('2026-09-01', '2026-09-02', 'America/Mexico_City');
    expect([cdmx.inicio.toISOString(), cdmx.fin.toISOString()]).toEqual([
      '2026-09-01T06:00:00.000Z',
      '2026-09-03T06:00:00.000Z',
    ]);
    const tijuana = limitesDelRango('2026-09-01', '2026-09-01', 'America/Tijuana');
    expect([tijuana.inicio.toISOString(), tijuana.fin.toISOString()]).toEqual([
      '2026-09-01T07:00:00.000Z',
      '2026-09-02T07:00:00.000Z',
    ]);
  });

  it('diaSiguiente cruza mes y año', () => {
    expect([diaSiguiente('2026-02-28'), diaSiguiente('2026-12-31')]).toEqual([
      '2026-03-01',
      '2027-01-01',
    ]);
  });
});
