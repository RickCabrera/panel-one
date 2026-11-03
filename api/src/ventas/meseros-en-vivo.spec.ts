import { Prisma } from '@prisma/client';

import { nombreMesero, totalDeMesa, unirMeseros } from './meseros-en-vivo';

const D = (v: string) => new Prisma.Decimal(v);

describe('meseros en vivo: lo puro', () => {
  it('totalDeMesa lee "350.50" o un número; lo demás es sin dato (nunca 0)', () => {
    expect(totalDeMesa('350.50')?.toFixed(2)).toBe('350.50');
    expect(totalDeMesa(' 40 ')?.toFixed(2)).toBe('40.00');
    expect(totalDeMesa(12.5)?.toFixed(2)).toBe('12.50');
    for (const malo of ['x', '', '1e3', '1,000.00', null, undefined, Number.NaN, {}]) {
      expect(totalDeMesa(malo)).toBeNull();
    }
  });

  it('nombreMesero recorta; vacío o no-texto = sin mesero', () => {
    expect(nombreMesero('  Ana ')).toBe('Ana');
    expect(nombreMesero('   ')).toBeNull();
    expect(nombreMesero(7)).toBeNull();
  });

  it('une cobrado y en curso por (sucursal, mesero), ordena por total y rankea por sucursal', () => {
    const filas = unirMeseros(
      [
        { sucursalId: 's1', sucursal: 'Centro', mesero: 'Ana', venta: D('200'), cuentas: 2, comensales: 3 },
        { sucursalId: 's1', sucursal: 'Centro', mesero: 'Luis', venta: D('50'), cuentas: 1, comensales: 1 },
        { sucursalId: 's1', sucursal: 'Centro', mesero: null, venta: D('30'), cuentas: 1, comensales: 0 },
        // Sólo canceladas: nada cobrado ni en curso, no sale.
        { sucursalId: 's1', sucursal: 'Centro', mesero: 'Rosa', venta: D('0'), cuentas: 0, comensales: 0 },
      ],
      [
        {
          sucursalId: 's1',
          sucursal: 'Centro',
          mesas: [
            { mesero: 'Ana', total: '150.50', comensales: 3 },
            { mesero: ' Luis ', total: 40 },
            { mesero: 'Pedro', total: 'x' },
            { mesero: null, total: '10.00' },
          ],
        },
        { sucursalId: 's2', sucursal: 'Norte', mesas: [{ mesero: 'Ana', total: '300.00' }] },
      ],
    );
    expect(
      filas.map((f) => [
        f.sucursal,
        f.mesero,
        f.posicion,
        f.cobrado.toFixed(2),
        f.cuentas,
        f.mesasAbiertas,
        f.enCurso.toFixed(2),
        f.mesasSinTotal,
        f.comensalesEnMesa,
      ]),
    ).toEqual([
      ['Centro', 'Ana', 1, '200.00', 2, 1, '150.50', 0, 3],
      ['Norte', 'Ana', 1, '0.00', 0, 1, '300.00', 0, 0],
      ['Centro', 'Luis', 2, '50.00', 1, 1, '40.00', 0, 0],
      ['Centro', null, null, '30.00', 1, 1, '10.00', 0, 0],
      ['Centro', 'Pedro', 3, '0.00', 0, 1, '0.00', 1, 0],
    ]);
  });

  it('empate en total: gana el que más cobró; después por nombre', () => {
    const filas = unirMeseros(
      [
        { sucursalId: 's1', sucursal: 'C', mesero: 'Beto', venta: D('100'), cuentas: 1, comensales: 0 },
        { sucursalId: 's1', sucursal: 'C', mesero: 'Ale', venta: D('60'), cuentas: 1, comensales: 0 },
      ],
      [{ sucursalId: 's1', sucursal: 'C', mesas: [{ mesero: 'Ale', total: '40' }, { mesero: 'Zoe', total: '100' }] }],
    );
    expect(filas.map((f) => [f.mesero, f.posicion])).toEqual([
      ['Beto', 1],
      ['Ale', 2],
      ['Zoe', 3],
    ]);
  });
});
