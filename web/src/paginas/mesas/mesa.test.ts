import { describe, expect, it } from 'vitest';

import { leerMesa } from './mesa';

describe('leerMesa: la forma provisional del snapshot (esquema-sr.md §5)', () => {
  it('lee una mesa completa', () => {
    expect(
      leerMesa({
        mesa: '12',
        mesero: 'Mesero Uno',
        folio: 'A-123',
        abiertoAt: '2026-09-20T19:00:00Z',
        total: '350.50',
        comensales: 4,
        impreso: false,
        partidas: [
          { producto: 'Guacamole', cantidad: '2.000' },
          { producto: 'Arrachera', cantidad: 0.75 },
        ],
      }),
    ).toEqual({
      mesa: '12',
      mesero: 'Mesero Uno',
      folio: 'A-123',
      abiertoAt: Date.UTC(2026, 8, 20, 19, 0, 0),
      total: 35050n,
      comensales: 4,
      impreso: false,
      partidas: [
        { producto: 'Guacamole', cantidad: '2' },
        { producto: 'Arrachera', cantidad: '0.75' },
      ],
    });
  });

  it('el total acepta número (misma regla que "Venta en vivo")', () => {
    expect(leerMesa({ total: 1200 }).total).toBe(120000n);
    expect(leerMesa({ total: 99.9 }).total).toBe(9990n);
  });

  it('un número de mesa numérico se lee como texto', () => {
    expect(leerMesa({ mesa: 7 }).mesa).toBe('7');
  });

  it('lo ilegible es null, nunca 0 ni un valor inventado', () => {
    expect(
      leerMesa({
        mesa: '  ',
        mesero: 5n,
        abiertoAt: '2026-09-20 19:00:00', // sin zona: se leería en la del navegador
        total: '12.345',
        comensales: 2.5,
        impreso: 'no',
        partidas: 'Guacamole',
      }),
    ).toEqual({
      mesa: null,
      mesero: null,
      folio: null,
      abiertoAt: null,
      total: null,
      comensales: null,
      impreso: null,
      partidas: null,
    });
  });

  it('acepta abiertoAt con desfase explícito', () => {
    expect(leerMesa({ abiertoAt: '2026-09-20T13:00:00-06:00' }).abiertoAt).toBe(
      Date.UTC(2026, 8, 20, 19, 0, 0),
    );
  });

  it('una partida rara no tumba la mesa', () => {
    expect(
      leerMesa({ partidas: [null, { producto: 'Flan', cantidad: '-1' }, 3] }).partidas,
    ).toEqual([
      { producto: null, cantidad: null },
      { producto: 'Flan', cantidad: null },
      { producto: null, cantidad: null },
    ]);
  });

  it('sin campos, todo es null', () => {
    expect(leerMesa({})).toEqual({
      mesa: null,
      mesero: null,
      folio: null,
      abiertoAt: null,
      total: null,
      comensales: null,
      impreso: null,
      partidas: null,
    });
  });
});
