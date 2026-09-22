import { Prisma } from '@prisma/client';

import {
  margen,
  resultadoSucursal,
  resultadoTotal,
  type CifrasSucursal,
} from './estado-resultados';

// Parte PURA del estado de resultados (F2-126). Literales calculados a mano.

const d = (v: string) => new Prisma.Decimal(v);
const txt = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2));

const base: CifrasSucursal = {
  sucursalId: 's1',
  sucursal: 'Centro',
  cuentas: 10,
  venta: d('11600.00'),
  ventaNeta: d('10000.00'),
  calculada: true,
  motivo: null,
  importesTeoricos: [d('2500.25'), d('1499.75')],
  productosSinCosto: 0,
  ventaSinCosto: d('0'),
  gastos: d('3000.00'),
  compras: d('9999.99'),
};

describe('resultadoSucursal', () => {
  it('costo completo: venta neta − costo − gastos, márgenes sobre la venta neta, compras aparte', () => {
    const r = resultadoSucursal(base);
    // costo = 2500.25 + 1499.75 = 4000.00; bruta = 10000 − 4000 = 6000; operación = 6000 − 3000.
    expect(txt(r.costo.importe)).toBe('4000.00');
    expect(r.costo.completo).toBe(true);
    expect(txt(r.utilidadBruta)).toBe('6000.00');
    expect(txt(r.utilidadOperacion)).toBe('3000.00');
    expect(r.margenBruto!.toFixed(1)).toBe('60.0');
    expect(r.margenOperacion!.toFixed(1)).toBe('30.0');
    expect(r.utilidadSobrestimada).toBe(false);
    // Las compras viajan, pero la utilidad no las toca.
    expect(txt(r.compras)).toBe('9999.99');
    expect(r.sinVentas).toBe(false);
  });

  it('un insumo sin costo deja el costo INCOMPLETO y la utilidad marcada sobrestimada', () => {
    const r = resultadoSucursal({ ...base, importesTeoricos: [d('2500.25'), null, null] });
    expect(txt(r.costo.importe)).toBe('2500.25');
    expect(r.costo).toMatchObject({ completo: false, insumosSinCosto: 2, productosSinCosto: 0 });
    expect(txt(r.utilidadBruta)).toBe('7499.75');
    expect(r.utilidadSobrestimada).toBe(true);
  });

  it('un producto vendido sin receta también la marca, con su importe de partidas aparte', () => {
    const r = resultadoSucursal({ ...base, productosSinCosto: 2, ventaSinCosto: d('812.345') });
    expect(r.costo).toMatchObject({ completo: false, insumosSinCosto: 0, productosSinCosto: 2 });
    expect(r.costo.ventaSinCosto.toFixed(2)).toBe('812.35');
    // La venta sin costo NO se resta de nada.
    expect(txt(r.utilidadBruta)).toBe('6000.00');
    expect(r.utilidadSobrestimada).toBe(true);
  });

  it('con ventas y NO calculable: costo y utilidades nulos con motivo, nunca 0', () => {
    const r = resultadoSucursal({
      ...base,
      calculada: false,
      motivo: 'sin_catalogo_productos',
      importesTeoricos: [],
    });
    expect(r.costo.importe).toBeNull();
    expect([r.utilidadBruta, r.utilidadOperacion, r.margenBruto, r.margenOperacion]).toEqual([
      null,
      null,
      null,
      null,
    ]);
    expect(r.motivo).toBe('sin_catalogo_productos');
    expect(r.utilidadSobrestimada).toBe(false);
  });

  it('sin ventas: costo 0 aunque no sea calculable, operación = −gastos, márgenes nulos', () => {
    const r = resultadoSucursal({
      ...base,
      cuentas: 0,
      venta: d('0'),
      ventaNeta: d('0'),
      calculada: false,
      motivo: 'sin_recetas',
      importesTeoricos: [],
    });
    expect(txt(r.costo.importe)).toBe('0.00');
    expect(r.costo.completo).toBe(true);
    expect(txt(r.utilidadBruta)).toBe('0.00');
    expect(txt(r.utilidadOperacion)).toBe('-3000.00');
    expect([r.margenBruto, r.margenOperacion]).toEqual([null, null]);
    expect(r.sinVentas).toBe(true);
    expect(r.motivo).toBeNull();
  });
});

describe('resultadoTotal', () => {
  const a = resultadoSucursal(base);
  const incompleta = resultadoSucursal({
    ...base,
    sucursalId: 's2',
    sucursal: 'Norte',
    importesTeoricos: [d('1000.00'), null],
  });
  const sinVentas = resultadoSucursal({
    ...base,
    sucursalId: 's3',
    sucursal: 'Sur',
    cuentas: 0,
    venta: d('0'),
    ventaNeta: d('0'),
    importesTeoricos: [],
    gastos: d('500.00'),
  });

  it('suma las sucursales, INCLUYE los gastos de la que no vendió y hereda la marca', () => {
    const t = resultadoTotal([a, incompleta, sinVentas]);
    expect(txt(t.ventaNeta)).toBe('20000.00');
    expect(txt(t.costo.importe)).toBe('5000.00');
    expect(txt(t.gastos)).toBe('6500.00');
    // 20000 − 5000 − 6500.
    expect(txt(t.utilidadOperacion)).toBe('8500.00');
    expect(t.margenOperacion!.toFixed(1)).toBe('42.5');
    expect(t.costo).toMatchObject({ completo: false, insumosSinCosto: 1 });
    expect(t.utilidadSobrestimada).toBe(true);
    expect(t.sucursalesSinCalculo).toEqual([]);
    expect(t.cuentas).toBe(20);
  });

  it('si una sucursal con ventas no se pudo calcular, el total de costo y utilidades es nulo', () => {
    const nula = resultadoSucursal({
      ...base,
      sucursalId: 's4',
      sucursal: 'Oriente',
      calculada: false,
      motivo: 'sin_recetas',
      importesTeoricos: [],
    });
    const t = resultadoTotal([a, nula]);
    expect([t.costo.importe, t.utilidadBruta, t.utilidadOperacion]).toEqual([null, null, null]);
    expect(t.sucursalesSinCalculo).toEqual(['Oriente']);
    // Lo que sí se sabe, se sigue sumando.
    expect(txt(t.ventaNeta)).toBe('20000.00');
    expect(txt(t.gastos)).toBe('6000.00');
  });

  it('sin sucursales: todo en cero y sin ventas', () => {
    const t = resultadoTotal([]);
    expect([txt(t.ventaNeta), txt(t.costo.importe), txt(t.utilidadOperacion)]).toEqual([
      '0.00',
      '0.00',
      '0.00',
    ]);
    expect(t.sinVentas).toBe(true);
  });
});

describe('margen', () => {
  it('a 1 decimal mitad lejos de cero; nulo sin venta o sin utilidad', () => {
    expect(margen(d('1'), d('3'))!.toFixed(1)).toBe('33.3');
    expect(margen(d('-0.0005'), d('100'))!.toFixed(1)).toBe('0.0');
    expect(margen(d('-2'), d('3'))!.toFixed(1)).toBe('-66.7');
    expect(margen(null, d('3'))).toBeNull();
    expect(margen(d('1'), d('0'))).toBeNull();
  });
});
