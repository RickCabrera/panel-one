import { describe, expect, it } from 'vitest';

import type { VentaHoraDia, VentaMesero, VentaPorMesa } from '../../api/tipos';
import { BOM, ErrorCsv } from '../../csv/csv';
import { horaDiaACsv, mesasACsv, meserosACsv, nombreCsvAnalisis, productosACsv } from './csv';
import { ordenarMeseros } from './reglas';

const lineas = (csv: string) => {
  expect(csv.startsWith(BOM)).toBe(true);
  expect(csv.endsWith('\r\n')).toBe(true);
  return csv.slice(1).split('\r\n').slice(0, -1);
};

const ana: VentaMesero = {
  sucursalId: 's1',
  sucursal: 'Centro',
  mesero: '=Ana',
  venta: '322.00',
  cuentas: 2,
  ticketPromedio: '161.00',
  comensales: 2,
  cuentasConComensales: 1,
  propina: '20.00',
  descuentos: { monto: '10.00', cuentas: 1 },
  cancelados: { cuentas: 1, monto: '70.00' },
  minutosPromedio: null,
  cuentasConDuracion: 0,
};
const pedro: VentaMesero = {
  ...ana,
  mesero: null,
  venta: '0.00',
  cuentas: 0,
  ticketPromedio: null,
  comensales: 0,
  cuentasConComensales: 0,
  propina: '0.00',
  descuentos: { monto: '0.00', cuentas: 0 },
  cancelados: { cuentas: 2, monto: '12.50' },
};

describe('CSV de Análisis', () => {
  it('meseros: todas las filas en el orden del ranking, anti-inyección y vacío donde no hay dato', () => {
    const l = lineas(meserosACsv(ordenarMeseros([pedro, ana], 'ticketPromedio')));
    expect(l).toEqual([
      'Posición,Sucursal,Mesero,Venta,Cuentas,Ticket promedio,Comensales,Cuentas con comensales,Propina,Descuentos,Cuentas con descuento,Cancelaciones,Monto cancelado',
      "1,Centro,'=Ana,322.00,2,161.00,2,1,20.00,10.00,1,1,70.00",
      ',Centro,,0.00,0,,0,0,0.00,0.00,0,2,12.50',
    ]);
  });

  it('productos: el renglón de diferencia va al final y el desglose suma la venta', () => {
    const l = lineas(
      productosACsv({
        venta: '712.00',
        cuentas: 5,
        productos: [
          { producto: 'Taco', importe: '530.00', cantidad: '9.000' },
          { producto: 'Café, grande', importe: '45.00', cantidad: '1.000' },
        ],
        diferenciaCuentas: '137.00',
      }),
    );
    expect(l).toEqual([
      'Producto,Importe,Cantidad',
      'Taco,530.00,9.000',
      '"Café, grande",45.00,1.000',
      // Lleva comas: va entrecomillado.
      '"Diferencia entre el total de las cuentas y sus partidas (descuentos, impuestos y otros ajustes)",137.00,',
    ]);
  });

  it('un importe ilegible detiene el archivo (nunca escribe 0.00)', () => {
    expect(() =>
      productosACsv({
        venta: '1.00',
        cuentas: 1,
        productos: [{ producto: 'Taco', importe: 'NaN', cantidad: '1.000' }],
        diferenciaCuentas: '0.00',
      }),
    ).toThrow(ErrorCsv);
  });

  it('hora × día: 168 filas; sin ventas y fuera del periodo dejan la venta vacía, cero pesos no', () => {
    const celdas = [];
    for (let d = 1; d <= 7; d++) {
      for (let h = 0; h < 24; h++)
        celdas.push({ diaSemana: d, hora: h, venta: '0.00', cuentas: 0 });
    }
    celdas[14] = { diaSemana: 1, hora: 14, venta: '222.00', cuentas: 1 };
    celdas[24 + 9] = { diaSemana: 2, hora: 9, venta: '0.00', cuentas: 2 };
    const datos: VentaHoraDia = {
      celdas,
      diasEnRango: [1, 1, 0, 0, 0, 0, 0].map((dias, i) => ({ diaSemana: i + 1, dias })),
    };
    const l = lineas(horaDiaACsv(datos));
    expect(l).toHaveLength(169);
    expect(l[0]).toBe('Día,Hora,Venta,Cuentas,En el periodo');
    expect(l[1]).toBe('lunes,0,,0,sí');
    expect(l[15]).toBe('lunes,14,222.00,1,sí');
    expect(l[24 + 10]).toBe('martes,9,0.00,2,sí');
    expect(l[48 + 1]).toBe('miércoles,0,,0,no');
  });

  it('mesas: en el orden dado y con las cuentas sin mesa al final', () => {
    const datos: VentaPorMesa = {
      filas: [
        {
          sucursalId: 's1',
          sucursal: 'Centro',
          mesa: '5',
          cuentas: 2,
          venta: '322.00',
          minutosPromedio: '75.0',
          cuentasConDuracion: 2,
        },
        {
          sucursalId: 's1',
          sucursal: 'Centro',
          mesa: '7',
          cuentas: 1,
          venta: '40.00',
          minutosPromedio: null,
          cuentasConDuracion: 0,
        },
      ],
      sinMesa: { cuentas: 1, venta: '50.00' },
      global: {
        venta: '412.00',
        cuentas: 4,
        minutosPromedio: '50.0',
        cuentasConDuracion: 3,
        duracionesInvalidas: 1,
        mesas: 2,
        cuentasConMesa: 3,
        rotacion: '1.50',
      },
    };
    expect(lineas(mesasACsv(datos, datos.filas))).toEqual([
      'Sucursal,Mesa,Cuentas,Venta,Minutos promedio,Cuentas con duración',
      'Centro,5,2,322.00,75.0,2',
      'Centro,7,1,40.00,,0',
      ',Sin mesa,1,50.00,,',
    ]);
  });

  it('nombre con el bloque, el rango y la sucursal', () => {
    expect(
      nombreCsvAnalisis('hora-dia', { desde: '2026-09-01', hasta: '2026-09-21' }, 'Plaza Ñuñoa'),
    ).toBe('analisis-hora-dia_2026-09-01_2026-09-21_plaza-nunoa.csv');
    expect(nombreCsvAnalisis('meseros', { desde: '2026-09-01', hasta: '2026-09-01' })).toBe(
      'analisis-meseros_2026-09-01_2026-09-01.csv',
    );
  });
});
