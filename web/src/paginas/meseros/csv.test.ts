import { describe, expect, it } from 'vitest';

import type { FilaRendimientoMesero, RendimientoMeseros } from '../../api/tipos';
import { ErrorCsv } from '../../csv/csv';
import { ENCABEZADOS_MESEROS, meserosACsv, nombreCsvMeseros } from './csv';

// El CSV de Meseros (F2-231). Valores escritos a mano.

const lineas = (csv: string) => {
  expect(csv.startsWith('﻿')).toBe(true);
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(1).split('\r\n').slice(0, -1);
};

const base: FilaRendimientoMesero = {
  sucursalId: 's1',
  sucursal: 'Centro',
  mesero: '=Ana',
  textosPos: ['=Ana'],
  cruce: 'catalogo',
  catalogo: {
    id: 'm1',
    clave: 'M01',
    nombre: '=Ana',
    activo: true,
    activoPos: false,
    vistoAt: '2026-09-20T12:00:00Z',
  },
  venta: '150.50',
  cuentas: 2,
  ticketPromedio: '75.25',
  comensales: 4,
  cuentasConComensales: 2,
  propina: '5.00',
  descuentos: { monto: '10.00', cuentas: 1 },
  cancelados: { cuentas: 1, monto: '80.00' },
  minutosPromedio: '60.0',
  cuentasConDuracion: 1,
  posicion: 2,
};

function datos(filas: FilaRendimientoMesero[]): RendimientoMeseros {
  return {
    venta: '170.50',
    cuentas: 3,
    descuentos: { monto: '10.00', cuentas: 1 },
    cancelados: { cuentas: 1, monto: '80.00' },
    catalogoTruncado: false,
    sucursales: [
      {
        sucursalId: 's1',
        sucursal: 'Centro',
        catalogoSincronizado: true,
        meserosEnRanking: 3,
        venta: '170.50',
        cuentas: 3,
        promedio: {
          ventaPorMesero: null,
          cuentasPorMesero: null,
          propinaPorMesero: null,
          comensalesPorMesero: null,
          ticketPromedio: null,
          minutosPromedio: null,
        },
      },
    ],
    filas,
    sinVentas: [],
  };
}

const sinMesero: FilaRendimientoMesero = {
  ...base,
  mesero: null,
  textosPos: [],
  cruce: 'sin-mesero',
  catalogo: null,
  venta: '20.00',
  cuentas: 1,
  ticketPromedio: '20.00',
  comensales: 0,
  propina: '0.00',
  descuentos: { monto: '0.00', cuentas: 0 },
  cancelados: { cuentas: 0, monto: '0.00' },
  minutosPromedio: null,
  posicion: null,
};

describe('meserosACsv', () => {
  it('todas las filas (con "Sin mesero"), descuentos y cancelaciones en columnas propias', () => {
    const l = lineas(meserosACsv(datos([base, sinMesero])));
    expect(l[0]).toBe(ENCABEZADOS_MESEROS.join(','));
    expect(l).toHaveLength(3);
    // Anti-inyección en el nombre; la venta NO incluye el cancelado ni el descuento.
    expect(l[1]).toBe(
      "Centro,2,3,M01,'=Ana,Dado de baja en el POS,150.50,2,75.25,4,5.00,60.0,10.00,1,1,80.00",
    );
    expect(l[2]).toBe(
      'Centro,,,,Sin mesero,Cuentas sin mesero,20.00,1,20.00,0,0.00,,0.00,0,0,0.00',
    );
  });

  it('un importe ilegible detiene el archivo: nunca se escribe un $0.00 inventado', () => {
    expect(() => meserosACsv(datos([{ ...base, venta: 'NaN' }]))).toThrow(ErrorCsv);
  });

  it('nombre del archivo con periodo y sucursal', () => {
    expect(nombreCsvMeseros({ desde: '2026-09-01', hasta: '2026-09-15' }, 'Plaza Ñuñoa')).toBe(
      'meseros_2026-09-01_2026-09-15_plaza-nunoa.csv',
    );
    expect(nombreCsvMeseros({ desde: '2026-09-01', hasta: '2026-09-15' })).toBe(
      'meseros_2026-09-01_2026-09-15.csv',
    );
  });
});
