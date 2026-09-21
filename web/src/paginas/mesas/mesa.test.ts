import { describe, expect, it } from 'vitest';

import { leerMesa, PROFUNDIDAD_MAX_MODIFICADORES } from './mesa';

/** Lo que el modal agrega a cada partida, cuando no viene nada de eso. */
const SIN_DETALLE = { categoria: null, precioUnit: null, total: null, modificadores: [] };
const ILEGIBLE = {
  producto: null,
  cantidad: null,
  categoria: null,
  precioUnit: null,
  total: null,
  modificadores: null,
};

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
        { producto: 'Guacamole', cantidad: '2', ...SIN_DETALLE },
        { producto: 'Arrachera', cantidad: '0.75', ...SIN_DETALLE },
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
    ).toEqual([ILEGIBLE, { producto: 'Flan', cantidad: null, ...SIN_DETALLE }, ILEGIBLE]);
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

describe('leerMesa: el detalle de cada partida (F1-051)', () => {
  const partida = (p: Record<string, unknown>) => leerMesa({ partidas: [p] }).partidas![0];

  it('lee categoría, precio unitario, total y modificadores', () => {
    expect(
      partida({
        producto: 'Hamburguesa',
        categoria: 'Platos fuertes',
        cantidad: '2',
        precioUnit: '150.00',
        total: 320,
        modificadores: [
          { nombre: 'Queso extra', precio: '10.00' },
          { nombre: 'Sin cebolla', precio: '0.00' },
        ],
      }),
    ).toEqual({
      producto: 'Hamburguesa',
      categoria: 'Platos fuertes',
      cantidad: '2',
      precioUnit: 15000n,
      total: 32000n,
      modificadores: [
        { nombre: 'Queso extra', precio: 1000n, modificadores: [], truncado: false },
        // $0.00 es un precio legible (0n), no "Sin dato".
        { nombre: 'Sin cebolla', precio: 0n, modificadores: [], truncado: false },
      ],
    });
  });

  it('el total de la partida nunca se calcula con cantidad × precio', () => {
    const p = partida({ producto: 'Refresco', cantidad: '3', precioUnit: '35.00' });
    expect(p.precioUnit).toBe(3500n);
    expect(p.total).toBeNull();
  });

  it('modificadores anidados: modificador de modificador, con la misma llave', () => {
    const p = partida({
      producto: 'Paquete',
      modificadores: [
        {
          nombre: 'Bebida: limonada',
          precio: '0.00',
          modificadores: [
            {
              nombre: 'Sin hielo',
              precio: 0,
              modificadores: [{ nombre: 'Vaso grande', precio: '5.00' }],
            },
          ],
        },
      ],
    });
    expect(p.modificadores).toEqual([
      {
        nombre: 'Bebida: limonada',
        precio: 0n,
        truncado: false,
        modificadores: [
          {
            nombre: 'Sin hielo',
            precio: 0n,
            truncado: false,
            modificadores: [
              { nombre: 'Vaso grande', precio: 500n, modificadores: [], truncado: false },
            ],
          },
        ],
      },
    ]);
  });

  it(`hasta ${PROFUNDIDAD_MAX_MODIFICADORES} niveles; más abajo se marca, no se esconde`, () => {
    // Una cadena de 6 niveles: m1 > m2 > … > m6.
    let cadena: Record<string, unknown> = { nombre: 'm6', precio: '1.00' };
    for (let n = 5; n >= 1; n--)
      cadena = { nombre: `m${n}`, precio: '1.00', modificadores: [cadena] };
    let m = partida({ modificadores: [cadena] }).modificadores![0];
    const nombres = [m.nombre];
    while (m.modificadores.length > 0) {
      m = m.modificadores[0];
      nombres.push(m.nombre);
    }
    expect(nombres).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(m.truncado).toBe(true);
  });

  it('en el último nivel sin hijos no hay nada truncado', () => {
    let cadena: Record<string, unknown> = { nombre: 'm4', precio: '1.00' };
    for (let n = 3; n >= 1; n--)
      cadena = { nombre: `m${n}`, precio: '1.00', modificadores: [cadena] };
    let m = partida({ modificadores: [cadena] }).modificadores![0];
    while (m.modificadores.length > 0) m = m.modificadores[0];
    expect(m.nombre).toBe('m4');
    expect(m.truncado).toBe(false);
  });

  it('un modificador en texto es su nombre, sin precio; uno basura es "Sin dato"', () => {
    expect(partida({ modificadores: ['Sin cebolla', 7, null, ['x']] }).modificadores).toEqual([
      { nombre: 'Sin cebolla', precio: null, modificadores: [], truncado: false },
      { nombre: null, precio: null, modificadores: [], truncado: false },
      { nombre: null, precio: null, modificadores: [], truncado: false },
      { nombre: null, precio: null, modificadores: [], truncado: false },
    ]);
  });

  it('modificadores ausentes = ninguno; presentes y que no son lista = "Sin dato"', () => {
    expect(partida({ producto: 'Flan' }).modificadores).toEqual([]);
    expect(partida({ producto: 'Flan', modificadores: 'queso' }).modificadores).toBeNull();
    // En un modificador, unos hijos ilegibles se marcan en vez de desaparecer.
    expect(
      partida({ modificadores: [{ nombre: 'Salsa', precio: '0.00', modificadores: 'x' }] })
        .modificadores,
    ).toEqual([{ nombre: 'Salsa', precio: 0n, modificadores: [], truncado: true }]);
  });

  it('importes ilegibles son null, nunca $0.00', () => {
    // 4 decimales (money de SR): el snapshot tiene que mandarlos a 2 (esquema-sr §5).
    const p = partida({
      precioUnit: '12.5000',
      total: 'abc',
      modificadores: [{ nombre: 'x', precio: NaN }],
    });
    expect(p.precioUnit).toBeNull();
    expect(p.total).toBeNull();
    expect(p.modificadores![0].precio).toBeNull();
  });
});
