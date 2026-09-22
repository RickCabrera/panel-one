import { describe, expect, it } from 'vitest';

import type { Kardex, Movimientos } from '../../api/tipos';
import {
  cantidadConSigno,
  cuadreDe,
  leerTipo,
  sentido,
  sucursalesSinMovimientos,
  TEXTO_TIPO,
  vacio,
} from './reglas';

// Reglas puras de Movimientos (F2-122). Textos y cifras escritos a mano.

const movs = (p: Partial<Movimientos> = {}): Movimientos => ({
  movimientos: [],
  total: 0,
  pagina: 1,
  porPagina: 50,
  sucursales: [
    {
      sucursalId: 's1',
      sucursal: 'Centro',
      zonaHoraria: 'America/Mexico_City',
      polizasRecibidas: 3,
    },
    { sucursalId: 's2', sucursal: 'Tijuana', zonaHoraria: 'America/Tijuana', polizasRecibidas: 0 },
  ],
  almacenes: [],
  ...p,
});

const kardex = (p: Partial<Kardex> = {}): Kardex => ({
  sucursalId: 's1',
  sucursal: 'Centro',
  zonaHoraria: 'America/Mexico_City',
  almacenOrigenSrId: 'ALM1',
  almacen: 'General',
  insumoOrigenSrId: 'I1',
  insumo: 'Harina',
  clave: 'HAR',
  unidad: 'kg',
  polizasRecibidas: 5,
  saldoInicial: '7.500',
  movimientos: [],
  saldoFinal: '12.000',
  entradas: '5.000',
  salidas: '0.500',
  corteExistencia: '2026-09-03T12:00:00.000Z',
  existencia: '12.500',
  saldoAlCorte: '12.500',
  diferencia: '0.000',
  cuadra: true,
  ...p,
});

describe('reglas de Movimientos (F2-122)', () => {
  it('el tipo sin traducir se dice, no se esconde; un tipo ajeno no filtra', () => {
    expect(TEXTO_TIPO.otro).toBe('Otro (sin traducir)');
    expect(leerTipo('merma')).toBe('merma');
    expect(leerTipo('salida')).toBeNull();
    expect(leerTipo('')).toBeNull();
  });

  it('la cantidad lleva SIEMPRE su signo y su sentido en palabras', () => {
    expect(['5.000', '-2.500', '0.000'].map(cantidadConSigno)).toEqual(['+5', '−2.5', '0']);
    expect(['5.000', '-2.500', '0.000'].map(sentido)).toEqual([
      'Entrada',
      'Salida',
      'Sin movimiento',
    ]);
  });

  it('ninguna sucursal con pólizas: lo dice y explica qué falta (F2-241)', () => {
    const v = vacio(
      movs({
        sucursales: [
          {
            sucursalId: 's2',
            sucursal: 'Tijuana',
            zonaHoraria: 'America/Tijuana',
            polizasRecibidas: 0,
          },
        ],
      }),
      false,
    );
    expect(v).toEqual({
      tipo: 'sin-movimientos',
      porque: 'Tijuana todavía no ha mandado movimientos de inventario.',
      falta: expect.stringContaining('F2-241'),
    });
  });

  it('con pólizas pero sin movimientos en el periodo o el filtro: lo dice distinto', () => {
    expect(vacio(movs(), false)).toEqual({
      tipo: 'periodo-vacio',
      porque: 'No hay movimientos en el periodo elegido.',
    });
    expect(vacio(movs(), true)).toMatchObject({ porque: expect.stringContaining('filtros') });
    expect(vacio(movs({ total: 3 }), false)).toEqual({ tipo: 'con-datos' });
    expect(sucursalesSinMovimientos(movs())).toEqual(['Tijuana']);
  });

  it('el cuadre del kardex en palabras: cuadra, diferencia o sin con qué comparar', () => {
    expect(cuadreDe(kardex(), '03/09/2026 06:00')).toEqual({
      tipo: 'cuadra',
      texto: 'Cuadra con la existencia leída el 03/09/2026 06:00: 12.5.',
    });
    expect(
      cuadreDe(
        kardex({ existencia: '3.000', saldoAlCorte: '4.000', diferencia: '-1.000', cuadra: false }),
        '03/09/2026 06:00',
      ),
    ).toEqual({
      tipo: 'diferencia',
      texto:
        'La existencia leída el 03/09/2026 06:00 es 3, pero los movimientos hasta ese corte ' +
        'suman 4: diferencia de −1.',
    });
    expect(cuadreDe(kardex({ polizasRecibidas: 0, cuadra: null }), null).tipo).toBe('sin-comparar');
    expect(
      cuadreDe(kardex({ existencia: null, cuadra: null, diferencia: null }), '03/09/2026 06:00'),
    ).toEqual({
      tipo: 'sin-comparar',
      texto: expect.stringContaining('Sin lectura de existencias'),
    });
  });
});
