import { describe, expect, it } from 'vitest';

import type { FilaVentaArea, VentaPorArea } from '../../api/tipos';
import {
  estadoArea,
  filasCanal,
  mapeoPorSucursal,
  motivoVacio,
  nombreArea,
  participacionArea,
  SIN_CANAL,
  SIN_CLASIFICAR,
  sinCatalogo,
  sumaCanales,
} from './reglas';

function fila(extra: Partial<FilaVentaArea> = {}): FilaVentaArea {
  return {
    sucursalId: 's1',
    sucursal: 'Centro',
    areaOrigenSrId: 'A01',
    areaId: 'a1',
    clave: null,
    nombre: 'Comedor',
    cruce: 'catalogo',
    activo: true,
    canal: 'comedor',
    venta: '100.00',
    cuentas: 1,
    ...extra,
  };
}

// Comedor 200.00 + Mostrador 100.00 + sin canal 0.01 + sin clasificar 99.99 = 400.00.
const R: VentaPorArea = {
  venta: '400.00',
  cuentas: 6,
  areas: [fila({ venta: '200.00', cuentas: 2 })],
  sinArea: { venta: '99.99', cuentas: 2 },
  canales: [
    { canal: 'comedor', venta: '200.00', cuentas: 2 },
    { canal: 'mostrador', venta: '100.00', cuentas: 1 },
  ],
  sinCanal: { venta: '0.01', cuentas: 1 },
  catalogo: [
    { sucursalId: 's1', sucursal: 'Centro', sincronizado: true },
    { sucursalId: 's2', sucursal: 'Norte', sincronizado: false },
  ],
};

describe('areas/reglas (F2-233)', () => {
  it('la tabla por canal lleva los dos renglones aparte, con su participación sobre la venta', () => {
    expect(filasCanal(R)).toEqual([
      { llave: 'comedor', nombre: 'Comedor', venta: '200.00', cuentas: 2, participacion: '50.0 %' },
      { llave: 'mostrador', nombre: 'Mostrador', venta: '100.00', cuentas: 1, participacion: '25.0 %' },
      { llave: 'sin-canal', nombre: SIN_CANAL, venta: '0.01', cuentas: 1, participacion: '0.0 %' },
      { llave: 'sin-area', nombre: SIN_CLASIFICAR, venta: '99.99', cuentas: 2, participacion: '25.0 %' },
    ]);
  });

  it('sin cuentas sin canal ni sin área, esos renglones no se pintan en cero', () => {
    const r = { ...R, sinArea: { venta: '0.00', cuentas: 0 }, sinCanal: { venta: '0.00', cuentas: 0 } };
    expect(filasCanal(r).map((f) => f.llave)).toEqual(['comedor', 'mostrador']);
  });

  it('Σ canales + sin canal + sin clasificar en centavos exactos; un importe ilegible da null', () => {
    expect(sumaCanales(R)).toBe(40000n);
    expect(sumaCanales({ ...R, sinCanal: { venta: 'x', cuentas: 1 } })).toBeNull();
  });

  it('participación nula con venta 0 o negativa (no hay porcentaje que decir)', () => {
    expect(participacionArea(fila(), { ...R, venta: '0.00' })).toBeNull();
    expect(participacionArea(fila(), { ...R, venta: '-5.00' })).toBeNull();
    expect(participacionArea(fila({ venta: '100.00' }), R)).toBe('25.0 %');
  });

  it('estado y nombre en palabras, nunca un área inventada', () => {
    expect(estadoArea(fila())).toBe('En el catálogo');
    expect(estadoArea(fila({ activo: false }))).toBe('Ya no está en el POS');
    expect(estadoArea(fila({ cruce: 'sin-catalogo', nombre: null }))).toBe(
      'No está en el catálogo del POS',
    );
    expect(estadoArea(fila({ cruce: 'sin-sincronizar' }))).toBe('Sucursal sin catálogo de áreas');
    expect(nombreArea(fila({ nombre: null, areaOrigenSrId: 'X9' }))).toBe('Área X9 del POS');
  });

  it('motivoVacio: sin cuentas, o todas sin área; null con un desglose real', () => {
    expect(motivoVacio({ ...R, cuentas: 0, venta: '0.00' })).toMatch(/No hubo cuentas/);
    expect(motivoVacio({ ...R, sinArea: { venta: '400.00', cuentas: 6 } })).toMatch(
      /Ninguna cuenta del periodo trae el área/,
    );
    expect(motivoVacio(R)).toBeNull();
  });

  it('sinCatalogo nombra las sucursales que nunca mandaron sus áreas', () => {
    expect(sinCatalogo(R)).toEqual(['Norte']);
  });

  it('mapeoPorSucursal agrupa y conserva las sucursales sin áreas', () => {
    const g = mapeoPorSucursal({
      sucursales: [
        { sucursalId: 's1', sucursal: 'Centro', ultimaCompletaAt: '2026-09-01T10:00:00.000Z' },
        { sucursalId: 's2', sucursal: 'Norte', ultimaCompletaAt: null },
      ],
      areas: [
        {
          id: 'a1',
          sucursalId: 's1',
          sucursal: 'Centro',
          origenSrId: 'A01',
          clave: null,
          nombre: 'Comedor',
          activo: true,
          activoPos: null,
          canal: null,
          canalActualizadoAt: null,
        },
      ],
      truncado: false,
    });
    expect(g.map((s) => [s.sucursal, s.areas.length])).toEqual([
      ['Centro', 1],
      ['Norte', 0],
    ]);
  });
});
