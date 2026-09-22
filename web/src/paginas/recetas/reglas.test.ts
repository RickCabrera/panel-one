import { describe, expect, it } from 'vitest';

import type { ProductoReceta, SucursalConsumo } from '../../api/tipos';
import {
  conSigno,
  filtrarRecetas,
  motivoSucursal,
  nombreProducto,
  sentidoVariacion,
  textoPorcentaje,
  vacioConsumo,
  vacioRecetas,
} from './reglas';

// Reglas puras de la vista de Recetas (F2-125).

const suc = (p: Partial<SucursalConsumo> = {}): SucursalConsumo => ({
  sucursalId: 's1',
  sucursal: 'Centro',
  recetasRecibidas: 3,
  catalogoProductos: true,
  polizasRecibidas: 5,
  calculada: true,
  productosExplotados: 2,
  ...p,
});

describe('sentido y formato de la variación', () => {
  it('faltante, sobrante, sin diferencia y sin lectura, en texto', () => {
    expect(sentidoVariacion({ variacion: '0.087' })).toBe('Faltante');
    expect(sentidoVariacion({ variacion: '-2.000' })).toBe('Sobrante');
    expect(sentidoVariacion({ variacion: '0.000' })).toBe('Sin diferencia');
    expect(sentidoVariacion({ variacion: null })).toBe('Sin lectura');
  });

  it('el signo siempre visible y el % con su signo tipográfico', () => {
    expect(conSigno('0.087')).toBe('+0.087');
    expect(conSigno('-2.000')).toBe('−2');
    expect(conSigno('0.000')).toBe('0');
    expect(textoPorcentaje('-5.6')).toBe('−5.6 %');
    expect(textoPorcentaje('2.8')).toBe('2.8 %');
    expect(textoPorcentaje(null)).toBe('—');
  });
});

describe('motivoSucursal()', () => {
  it('dice por qué una sucursal no se calcula, o se calcula sin real', () => {
    expect(motivoSucursal(suc({ catalogoProductos: false }))).toContain('catálogo de productos');
    expect(motivoSucursal(suc({ recetasRecibidas: 0 }))).toContain('F2-241');
    expect(motivoSucursal(suc({ polizasRecibidas: 0 }))).toContain('sólo el teórico');
    expect(motivoSucursal(suc())).toBeNull();
  });
});

describe('estados vacíos', () => {
  it('sin ninguna sucursal calculable, con la razón de cada una', () => {
    const v = vacioConsumo({
      sucursales: [suc({ calculada: false, recetasRecibidas: 0 })],
      filas: [],
      aparte: [],
    });
    expect(v.tipo).toBe('sin-calculo');
    expect(v.tipo === 'sin-calculo' && v.porque[0]).toContain('Centro');
  });

  it('calculable pero sin nada en el periodo', () => {
    expect(vacioConsumo({ sucursales: [suc()], filas: [], aparte: [] }).tipo).toBe('periodo-vacio');
  });

  it('recetas: vacío si ninguna sucursal mandó recetas', () => {
    expect(
      vacioRecetas({
        sucursales: [
          { sucursalId: 's1', sucursal: 'Centro', recetasRecibidas: 0, catalogoProductos: true },
        ],
        productos: [],
        total: 0,
        truncado: false,
      }),
    ).toMatchObject({ tipo: 'sin-recetas', porque: 'Centro todavía no ha mandado recetas.' });
  });
});

describe('productos', () => {
  const p = (nombre: string | null, clave: string | null, id: string) =>
    ({ nombre, clave, productoOrigenSrId: id }) as ProductoReceta;

  it('un producto fuera del catálogo se nombra por su id', () => {
    expect(nombreProducto(p(null, null, 'P99'))).toBe('Producto P99 (no está en el catálogo)');
  });

  it('la búsqueda va por nombre, clave o id, sin mayúsculas', () => {
    const lista = [p('Arrachera', 'A-1', 'P6'), p('Taco', 'T-1', 'P1'), p(null, null, 'P99')];
    expect(filtrarRecetas(lista, 'ARRA').map((x) => x.productoOrigenSrId)).toEqual(['P6']);
    expect(filtrarRecetas(lista, 't-1').map((x) => x.productoOrigenSrId)).toEqual(['P1']);
    expect(filtrarRecetas(lista, 'p99').map((x) => x.productoOrigenSrId)).toEqual(['P99']);
    expect(filtrarRecetas(lista, '  ')).toHaveLength(3);
  });
});
