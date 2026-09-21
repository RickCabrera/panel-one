import { describe, expect, it } from 'vitest';

import { BOM, ErrorCsv, nombreCsv } from '../../csv/csv';
import { comparativoACsv, porDiaACsv, topACsv } from './csv';

/** Filas sin el BOM y sin el CRLF final. */
function filas(csv: string): string[] {
  expect(csv.startsWith(BOM)).toBe(true);
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(BOM.length).replace(/\r\n$/, '').split('\r\n');
}

describe('CSV de ventas por día', () => {
  it('una fila por día, importes exactos y sin fila de totales', () => {
    const csv = porDiaACsv([
      { dia: '2026-09-01', venta: '1234.5', cuentas: 3 },
      { dia: '2026-09-02', venta: '0.00', cuentas: 0 },
      { dia: '2026-09-03', venta: '-12.30', cuentas: 1 },
    ]);
    expect(filas(csv)).toEqual([
      'Día,Venta,Cuentas',
      '2026-09-01,1234.50,3',
      '2026-09-02,0.00,0',
      '2026-09-03,-12.30,1',
    ]);
  });

  it('un importe o un día ilegible detiene el archivo', () => {
    expect(() => porDiaACsv([{ dia: '2026-09-01', venta: '1e3', cuentas: 1 }])).toThrow(ErrorCsv);
    expect(() => porDiaACsv([{ dia: '=1+1', venta: '1.00', cuentas: 1 }])).toThrow(ErrorCsv);
  });
});

describe('CSV del comparativo', () => {
  it('sucursal, venta, tickets, ticket promedio (vacío si null) y comensales', () => {
    const csv = comparativoACsv([
      {
        sucursalId: 'a',
        nombre: 'Centro, "Norte"',
        venta: '1000.00',
        cuentas: 3,
        ticketPromedio: '333.33',
        comensales: 7,
      },
      {
        sucursalId: 'b',
        nombre: '=HYPERLINK("x")',
        venta: '0.00',
        cuentas: 0,
        ticketPromedio: null,
        comensales: 0,
      },
    ]);
    expect(filas(csv)).toEqual([
      'Sucursal,Venta,Tickets,Ticket promedio,Comensales',
      '"Centro, ""Norte""",1000.00,3,333.33,7',
      `"'=HYPERLINK(""x"")",0.00,0,,0`,
    ]);
  });

  it('un ticket promedio ilegible detiene el archivo', () => {
    expect(() =>
      comparativoACsv([
        {
          sucursalId: 'a',
          nombre: 'A',
          venta: '1.00',
          cuentas: 1,
          ticketPromedio: 'x',
          comensales: 0,
        },
      ]),
    ).toThrow(/ticket promedio/);
  });
});

describe('CSV del top productos', () => {
  it('posición, producto protegido contra fórmulas, importe y cantidad', () => {
    const csv = topACsv([
      { producto: 'Tacos al pastor', importe: '5230.00', cantidad: '120.000' },
      { producto: '+Salsa extra', importe: '15.5', cantidad: '31.000' },
      { producto: '@SUM(A1)', importe: '1.00', cantidad: '0.500' },
    ]);
    expect(filas(csv)).toEqual([
      'Posición,Producto,Importe,Cantidad',
      '1,Tacos al pastor,5230.00,120.000',
      "2,'+Salsa extra,15.50,31.000",
      "3,'@SUM(A1),1.00,0.500",
    ]);
  });

  it('una cantidad o un importe ilegible detiene el archivo', () => {
    expect(() => topACsv([{ producto: 'x', importe: '1.00', cantidad: '=1' }])).toThrow(ErrorCsv);
    expect(() => topACsv([{ producto: 'x', importe: '$1', cantidad: '1.000' }])).toThrow(ErrorCsv);
  });
});

describe('nombreCsv', () => {
  it('prefijo, rango y sucursal sin acentos', () => {
    expect(nombreCsv('ventas-por-dia', '2026-09-01', '2026-09-20')).toBe(
      'ventas-por-dia_2026-09-01_2026-09-20.csv',
    );
    expect(nombreCsv('top-productos-por-importe', '2026-09-01', '2026-09-20', 'Plaza Ñuñoa')).toBe(
      'top-productos-por-importe_2026-09-01_2026-09-20_plaza-nunoa.csv',
    );
  });
});
