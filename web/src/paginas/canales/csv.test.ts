import { describe, expect, it, vi } from 'vitest';

import type { VentaPorArea } from '../../api/tipos';
import { BOM, ErrorCsv, texto } from '../../csv/csv';
import { canalesACsv, ENCABEZADOS_CANALES, nombreCsvCanales } from './csv';

// CSV de Ventas por canal (F2-144): filas por canal + los renglones aparte, sin total, celdas
// vacías donde no hay datos.

// `texto` real, espiado: el CSV sale igual y se puede afirmar que cada nombre pasó por él.
vi.mock('../../csv/csv', async (original) => {
  const real = await original<typeof import('../../csv/csv')>();
  return { ...real, texto: vi.fn(real.texto) };
});

const base = (p: Partial<VentaPorArea>): VentaPorArea => ({
  venta: '0.00',
  cuentas: 0,
  areas: [],
  sinArea: { venta: '0.00', cuentas: 0 },
  canales: [],
  sinCanal: { venta: '0.00', cuentas: 0 },
  catalogo: [],
  ...p,
});

const A = base({
  venta: '350.00',
  cuentas: 4,
  canales: [
    { canal: 'comedor', venta: '200.00', cuentas: 2 },
    { canal: 'domicilio', venta: '100.00', cuentas: 1 },
  ],
  sinArea: { venta: '50.00', cuentas: 1 },
});
const B = base({
  venta: '500.00',
  cuentas: 5,
  canales: [{ canal: 'comedor', venta: '500.00', cuentas: 5 }],
});

describe('canalesACsv', () => {
  it('una fila por renglón, celdas vacías sin datos, sin fila de total, BOM y CRLF', () => {
    expect(canalesACsv(A, B)).toBe(
      BOM +
        [
          ENCABEZADOS_CANALES.join(','),
          'Comedor,200.00,57.1,2,500.00,100.0,5',
          'Domicilio,100.00,28.6,1,,,',
          'Sin clasificar (la cuenta no trae área),50.00,14.3,1,,,',
        ].join('\r\n') +
        '\r\n',
    );
  });

  it('sin periodo B, sus columnas quedan vacías', () => {
    expect(canalesACsv(A, null).split('\r\n')[1]).toBe('Comedor,200.00,57.1,2,,,');
  });

  it('cada nombre pasa por el escape compartido (`texto`), aunque sea nuestro', () => {
    vi.mocked(texto).mockClear();
    canalesACsv(A, B);
    expect(vi.mocked(texto).mock.calls.map(([v]) => v)).toEqual([
      'Comedor',
      'Domicilio',
      'Sin clasificar (la cuenta no trae área)',
    ]);
  });

  it('un importe ilegible detiene el archivo con su porqué, nunca escribe 0.00', () => {
    const roto = { ...A, canales: [{ canal: 'comedor' as const, venta: 'x', cuentas: 2 }] };
    expect(() => canalesACsv(roto, B)).toThrow(ErrorCsv);
    expect(() => canalesACsv(roto, B)).toThrow('Comedor trae un importe inválido en el periodo A ("x").');
  });
});

describe('nombreCsvCanales', () => {
  it('lleva los dos periodos y la sucursal saneada', () => {
    expect(
      nombreCsvCanales(
        { desde: '2026-09-01', hasta: '2026-09-21' },
        { desde: '2026-08-01', hasta: '2026-08-21' },
        'Plaza Ñuñoa',
      ),
    ).toBe('ventas-canal_2026-09-01_2026-09-21_vs_2026-08-01_2026-08-21_plaza-nunoa.csv');
    expect(nombreCsvCanales({ desde: '2026-09-01', hasta: '2026-09-21' }, null)).toBe(
      'ventas-canal_2026-09-01_2026-09-21.csv',
    );
  });

  it('una fecha rara no llega al nombre del archivo', () => {
    expect(() => nombreCsvCanales({ desde: '../x', hasta: '2026-09-21' }, null)).toThrow(ErrorCsv);
  });
});
