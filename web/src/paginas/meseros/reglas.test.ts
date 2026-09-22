import { describe, expect, it } from 'vitest';

import type { FilaRendimientoMesero } from '../../api/tipos';
import { comparar, cuadra, estadoCatalogo, estadoFila, llaveFila, posicionTexto } from './reglas';

// Reglas puras de Meseros (F2-231). Valores escritos a mano.

function fila(p: Partial<FilaRendimientoMesero> = {}): FilaRendimientoMesero {
  return {
    sucursalId: 's1',
    sucursal: 'Centro',
    mesero: 'Ana López',
    textosPos: ['Ana López'],
    cruce: 'catalogo',
    catalogo: {
      id: 'm1',
      clave: 'M01',
      nombre: 'Ana López',
      activo: true,
      activoPos: true,
      vistoAt: '2026-09-20T12:00:00Z',
    },
    venta: '100.00',
    cuentas: 1,
    ticketPromedio: '100.00',
    comensales: 2,
    cuentasConComensales: 1,
    propina: '0.00',
    descuentos: { monto: '0.00', cuentas: 0 },
    cancelados: { cuentas: 0, monto: '0.00' },
    minutosPromedio: null,
    cuentasConDuracion: 0,
    posicion: 1,
    ...p,
  };
}

describe('estado del mesero', () => {
  it('distingue activo, baja en el POS, desaparecido y SIN DATO (nunca "Activo" sin dato)', () => {
    expect(estadoCatalogo({ activo: true, activoPos: true })).toBe('Activo en el POS');
    expect(estadoCatalogo({ activo: true, activoPos: false })).toBe('Dado de baja en el POS');
    expect(estadoCatalogo({ activo: false, activoPos: true })).toBe('Ya no aparece en el POS');
    expect(estadoCatalogo({ activo: true, activoPos: null })).toBe('En el POS (sin dato de baja)');
  });

  it('dice por qué una fila no se ligó con el catálogo', () => {
    expect(estadoFila(fila({ cruce: 'sin-catalogo', catalogo: null }))).toBe(
      'No está en el catálogo',
    );
    expect(estadoFila(fila({ cruce: 'ambiguo', catalogo: null }))).toBe(
      'Nombre repetido en el catálogo',
    );
    expect(estadoFila(fila({ cruce: 'sin-sincronizar', catalogo: null }))).toBe(
      'Catálogo sin sincronizar',
    );
    expect(estadoFila(fila({ cruce: 'catalogo-incompleto', catalogo: null }))).toBe(
      'Catálogo incompleto',
    );
    expect(estadoFila(fila({ cruce: 'sin-mesero', mesero: null, catalogo: null }))).toBe(
      'Cuentas sin mesero',
    );
  });
});

describe('comparar contra el promedio de la sucursal', () => {
  it('diferencia en % con signo y sentido en palabras', () => {
    expect(comparar('150.00', '100.00')).toEqual({ texto: '+50.0 %', sentido: 'arriba' });
    expect(comparar('75.25', '80.10')).toEqual({ texto: '−6.1 %', sentido: 'abajo' });
    expect(comparar('2', '1.8')).toEqual({ texto: '+11.1 %', sentido: 'arriba' });
    expect(comparar('45.3', '45.3')).toEqual({ texto: '0.0 %', sentido: 'igual' });
  });

  it('redondea sin flotantes: 1/3 = 33.3 %, 2/3 = 66.7 %', () => {
    expect(comparar('4', '3')).toEqual({ texto: '+33.3 %', sentido: 'arriba' });
    expect(comparar('5', '3')).toEqual({ texto: '+66.7 %', sentido: 'arriba' });
    // 0.1 + 0.2 no es 0.3 en flotante; aquí sí.
    expect(comparar('0.30', '0.30')).toEqual({ texto: '0.0 %', sentido: 'igual' });
  });

  it('sin promedio, promedio cero o valor ilegible: no hay comparación', () => {
    expect(comparar('10.00', null)).toEqual({ texto: null, sentido: null });
    expect(comparar(null, '10.00')).toEqual({ texto: null, sentido: null });
    expect(comparar('10.00', '0.00')).toEqual({ texto: null, sentido: null });
    expect(comparar('abc', '10.00')).toEqual({ texto: null, sentido: null });
  });
});

describe('cuadre y llaves', () => {
  it('Σ venta de las filas contra la venta del periodo, en centavos exactos', () => {
    const filas = [fila({ venta: '0.10' }), fila({ venta: '0.20', mesero: null })];
    expect(cuadra({ venta: '0.30', filas })).toBe(true);
    expect(cuadra({ venta: '0.31', filas })).toBe(false);
    expect(cuadra({ venta: '0.30', filas: [fila({ venta: 'x' })] })).toBeNull();
  });

  it('posición "n de m" y llave estable', () => {
    expect(posicionTexto(2, 5)).toBe('2 de 5');
    expect(posicionTexto(null, 5)).toBeNull();
    expect(llaveFila(fila())).toBe('c|m1');
    expect(llaveFila(fila({ catalogo: null, mesero: null }))).toBe('t|s1|\u0000');
    expect(llaveFila(fila({ catalogo: null, mesero: 'Otro' }))).toBe('t|s1|Otro');
  });
});
