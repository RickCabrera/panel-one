import { describe, expect, it } from 'vitest';

import type { VentaPorArea } from '../../api/tipos';
import { ErrorCsv } from '../../csv/csv';
import { areasACsv, ENCABEZADOS_AREAS, nombreCsvAreas } from './csv';

// El CSV de Áreas y canales (F2-233). Valores escritos a mano.

const lineas = (csv: string) => {
  expect(csv.startsWith('﻿')).toBe(true);
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(1).split('\r\n').slice(0, -1);
};

const R: VentaPorArea = {
  venta: '215.50',
  cuentas: 4,
  areas: [
    {
      sucursalId: 's1',
      sucursal: 'Centro',
      areaOrigenSrId: 'A01',
      areaId: 'a1',
      clave: 'C',
      nombre: '=Terraza',
      cruce: 'catalogo',
      activo: false,
      canal: 'comedor',
      venta: '150.50',
      cuentas: 2,
    },
    {
      sucursalId: 's2',
      sucursal: 'Norte',
      areaOrigenSrId: 'X9',
      areaId: null,
      clave: null,
      nombre: null,
      cruce: 'sin-catalogo',
      activo: null,
      canal: null,
      venta: '15.00',
      cuentas: 1,
    },
  ],
  sinArea: { venta: '50.00', cuentas: 1 },
  canales: [{ canal: 'comedor', venta: '150.50', cuentas: 2 }],
  sinCanal: { venta: '15.00', cuentas: 1 },
  catalogo: [],
};

describe('areasACsv (F2-233)', () => {
  it('una fila por área con su canal, y al final "sin clasificar": suman la venta UNA vez', () => {
    const l = lineas(areasACsv(R));
    expect(l[0]).toBe(ENCABEZADOS_AREAS.join(','));
    expect(l).toHaveLength(4);
    // Anti-inyección en el nombre del POS.
    expect(l[1]).toBe("Centro,'=Terraza,A01,Ya no está en el POS,Comedor,150.50,2");
    expect(l[2]).toBe('Norte,Área X9 del POS,X9,No está en el catálogo del POS,Sin asignar,15.00,1');
    expect(l[3]).toBe(',Sin clasificar (la cuenta no trae área),,,,50.00,1');
    // 150.50 + 15.00 + 50.00 = 215.50: sin filas por canal que la sumarían dos veces.
    expect(l.some((x) => x.startsWith('Comedor'))).toBe(false);
  });

  it('sin cuentas sin área no escribe un renglón en cero', () => {
    const l = lineas(areasACsv({ ...R, sinArea: { venta: '0.00', cuentas: 0 } }));
    expect(l).toHaveLength(3);
  });

  it('un importe ilegible detiene el archivo: nunca se escribe un $0.00 inventado', () => {
    expect(() => areasACsv({ ...R, sinArea: { venta: 'NaN', cuentas: 1 } })).toThrow(ErrorCsv);
  });

  it('nombre del archivo con periodo y sucursal', () => {
    expect(nombreCsvAreas({ desde: '2026-09-01', hasta: '2026-09-15' }, 'Plaza Ñuñoa')).toBe(
      'areas-canales_2026-09-01_2026-09-15_plaza-nunoa.csv',
    );
  });
});
