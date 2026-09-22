import { describe, expect, it } from 'vitest';

import type { VentaSucursal } from '../../api/tipos';
import {
  armarFilas,
  deltaDe,
  ordenar,
  valor,
  type Cifras,
  type FilaComparada,
  type Orden,
} from './matriz';

function suc(
  id: string,
  nombre: string,
  venta: string,
  cuentas: number,
  comensales = cuentas * 2,
): VentaSucursal {
  const ticket = cuentas === 0 ? null : (Number(venta) / cuentas).toFixed(2);
  return { sucursalId: id, nombre, venta, cuentas, ticketPromedio: ticket, comensales };
}

function cif(venta: string, cuentas: number, ticket: string | null, comensales: number): Cifras {
  return { venta, cuentas, ticketPromedio: ticket, comensales };
}

function fila(id: string, nombre: string, a: Cifras | null, b: Cifras | null): FilaComparada {
  return { id, nombre, a, b };
}

const ids = (xs: { fila: FilaComparada }[]) => xs.map((x) => x.fila.id);
const posiciones = (xs: { posicion: number | null }[]) => xs.map((x) => x.posicion);

describe('armarFilas', () => {
  it('empareja por id en el orden de A; lo que sólo trae B va al final', () => {
    const a = [suc('1', 'Centro', '100.00', 1), suc('2', 'Norte', '0.00', 0)];
    const b = [
      suc('2', 'Norte', '50.00', 1),
      suc('3', 'Sur', '10.00', 1),
      suc('1', 'Centro', '80.00', 2),
    ];
    const filas = armarFilas(a, b);
    expect(filas.map((f) => [f.id, f.a?.venta ?? null, f.b?.venta ?? null])).toEqual([
      ['1', '100.00', '80.00'],
      ['2', '0.00', '50.00'],
      ['3', null, '10.00'],
    ]);
  });
});

describe('valor y deltaDe: sin datos no es cero', () => {
  it('sin cuentas, ninguna métrica tiene valor (ni la venta en 0.00)', () => {
    const vacia = cif('0.00', 0, null, 0);
    for (const m of ['venta', 'cuentas', 'ticketPromedio', 'comensales'] as const) {
      expect(valor(vacia, m)).toBeNull();
      expect(valor(null, m)).toBeNull();
    }
    expect(valor(cif('10.50', 3, '3.50', 0), 'comensales')).toBe(0n);
    expect(valor(cif('10.50', 3, '3.50', 0), 'venta')).toBe(1050n);
  });

  it('A sin cuentas y B con cuentas: Δ "—", no −100 %', () => {
    const d = deltaDe({ a: cif('0.00', 0, null, 0), b: cif('500.00', 5, '100.00', 9) }, 'venta');
    expect(d).toEqual({ tipo: 'sinBase', razon: 'Sin cuentas en el periodo A.' });
  });

  it('B sin cuentas: Δ "—", no +100 %', () => {
    const d = deltaDe({ a: cif('500.00', 5, '100.00', 9), b: cif('0.00', 0, null, 0) }, 'cuentas');
    expect(d).toEqual({ tipo: 'sinBase', razon: 'Sin cuentas en el periodo B.' });
  });

  it('comensales en 0 en B con cuentas: Δ "—" con su razón', () => {
    const d = deltaDe(
      { a: cif('10.00', 1, '10.00', 2), b: cif('10.00', 1, '10.00', 0) },
      'comensales',
    );
    expect(d).toEqual({ tipo: 'sinBase', razon: 'Sin comensales registrados en el periodo B.' });
  });

  it('Δ exacto en centavos y en enteros', () => {
    const f = { a: cif('1100.00', 11, '100.00', 20), b: cif('1000.00', 8, '125.00', 20) };
    expect(deltaDe(f, 'venta')).toEqual({
      tipo: 'cambio',
      diferencia: 10000n,
      porcentaje: '+10.0 %',
    });
    expect(deltaDe(f, 'cuentas')).toEqual({
      tipo: 'cambio',
      diferencia: 3n,
      porcentaje: '+37.5 %',
    });
    expect(deltaDe(f, 'ticketPromedio')).toEqual({
      tipo: 'cambio',
      diferencia: -2500n,
      porcentaje: '-20.0 %',
    });
    expect(deltaDe(f, 'comensales')).toEqual({
      tipo: 'cambio',
      diferencia: 0n,
      porcentaje: '0.0 %',
    });
  });
});

describe('ordenar (ranking)', () => {
  const filas = [
    fila('a', 'Centro', cif('300.00', 3, '100.00', 6), cif('200.00', 2, '100.00', 4)), // +50 %
    fila('b', 'Norte', cif('500.00', 10, '50.00', 0), cif('1000.00', 10, '100.00', 0)), // −50 %
    fila('c', 'Sur', cif('0.00', 0, null, 0), cif('100.00', 1, '100.00', 2)), // sin A
    fila('d', 'Este', cif('100.00', 1, '100.00', 2), cif('0.00', 0, null, 0)), // sin B
  ];

  it('por una métrica de A: de mayor a menor; sin datos en A al final y sin número', () => {
    const r = ordenar(filas, 'venta');
    expect(ids(r)).toEqual(['b', 'a', 'd', 'c']);
    expect(posiciones(r)).toEqual([1, 2, 3, null]);
  });

  it('los criterios de A no excluyen a quien no tiene B (la exclusión de B no se filtra)', () => {
    for (const orden of ['venta', 'cuentas', 'ticketPromedio', 'comensales'] as Orden[]) {
      const d = ordenar(filas, orden).find((x) => x.fila.id === 'd');
      expect(d?.posicion).not.toBeNull();
    }
  });

  it('comensales en 0 cuenta como 0 (se pinta como Inicio), no como fuera', () => {
    const r = ordenar(filas, 'comensales');
    expect(ids(r)).toEqual(['a', 'd', 'b', 'c']);
    expect(posiciones(r)).toEqual([1, 2, 3, null]);
  });

  it('por Δ % de venta: sin A o sin B quedan fuera, al final y por nombre', () => {
    const r = ordenar(filas, 'deltaVenta');
    expect(ids(r)).toEqual(['a', 'b', 'd', 'c']);
    expect(posiciones(r)).toEqual([1, 2, null, null]);
  });

  it('Δ % compara porcentajes, no diferencias: bases distintas', () => {
    // x: +100 sobre 1000 = +10 %; y: +50 sobre 100 = +50 %. Por diferencia ganaría x.
    const r = ordenar(
      [
        fila('x', 'Grande', cif('1100.00', 1, null, 0), cif('1000.00', 1, null, 0)),
        fila('y', 'Chica', cif('150.00', 1, null, 0), cif('100.00', 1, null, 0)),
      ],
      'deltaVenta',
    );
    expect(ids(r)).toEqual(['y', 'x']);
  });

  it('Δ % con signos mixtos y empate exacto (desempata por nombre)', () => {
    const r = ordenar(
      [
        fila('p', 'Pino', cif('90.00', 1, null, 0), cif('100.00', 1, null, 0)), // −10 %
        fila('q', 'Álamo', cif('180.00', 1, null, 0), cif('200.00', 1, null, 0)), // −10 %
        fila('r', 'Roble', cif('100.00', 1, null, 0), cif('100.00', 1, null, 0)), // 0 %
        fila('s', 'Sauce', cif('101.00', 1, null, 0), cif('100.00', 1, null, 0)), // +1 %
      ],
      'deltaVenta',
    );
    expect(ids(r)).toEqual(['s', 'r', 'q', 'p']);
    expect(posiciones(r)).toEqual([1, 2, 3, 4]);
  });

  it('empate en una métrica de A: por nombre y luego por id; el mismo orden siempre', () => {
    const r = ordenar(
      [
        fila('2', 'Beta', cif('10.00', 1, null, 0), null),
        fila('1', 'Beta', cif('10.00', 1, null, 0), null),
        fila('0', 'Alfa', cif('10.00', 1, null, 0), null),
      ],
      'venta',
    );
    expect(ids(r)).toEqual(['0', '1', '2']);
  });

  it('un importe ilegible no entra al ranking de venta', () => {
    const r = ordenar(
      [
        fila('m', 'Mala', cif('x', 1, null, 0), null),
        fila('n', 'Buena', cif('1.00', 1, null, 0), null),
      ],
      'venta',
    );
    expect(ids(r)).toEqual(['n', 'm']);
    expect(posiciones(r)).toEqual([1, null]);
  });
});
