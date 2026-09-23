import { describe, expect, it } from 'vitest';

import type { VentaSucursal } from '../../api/tipos';
import {
  armarFilas,
  deltaDe,
  ordenar,
  sinTasa,
  sinUtilidad,
  TASA_SIN_LECTURA,
  TASA_SIN_VENTA,
  tasasDe,
  UTILIDAD_CORTADA,
  UTILIDAD_SIN_COSTO,
  UTILIDAD_SIN_LECTURA,
  utilidadesDe,
  valor,
  type Cifras,
  type FilaComparada,
  type Orden,
  type TasaFacturacion,
  type Utilidad,
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

function cif(
  venta: string,
  cuentas: number,
  ticket: string | null,
  comensales: number,
  utilidad: Utilidad = sinUtilidad(UTILIDAD_SIN_COSTO),
  tasa: TasaFacturacion = sinTasa(TASA_SIN_LECTURA),
): Cifras {
  return { venta, cuentas, ticketPromedio: ticket, comensales, utilidad, tasa };
}

const util = (importe: string, sobrestimada = false): Utilidad => ({
  importe,
  razon: null,
  sobrestimada,
});

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

describe('utilidad (F2-126)', () => {
  const base = {
    cuentas: 1,
    venta: '116.00',
    ventaNeta: '100.00',
    costo: {
      importe: '30.00' as string | null,
      completo: true,
      insumosSinCosto: 0,
      productosSinCosto: 0,
      ventaSinCosto: '0.00',
    },
    gastos: '10.00',
    compras: '0.00',
    utilidadBruta: '70.00' as string | null,
    utilidadOperacion: '60.00' as string | null,
    margenBruto: '70.0' as string | null,
    margenOperacion: '60.0' as string | null,
    utilidadSobrestimada: false,
    sinVentas: false,
  };
  const estado = {
    sucursales: [
      { ...base, sucursalId: '1', sucursal: 'Centro', motivo: null },
      {
        ...base,
        sucursalId: '2',
        sucursal: 'Norte',
        motivo: 'sin_recetas' as const,
        costo: { ...base.costo, importe: null, completo: false },
        utilidadBruta: null,
        utilidadOperacion: null,
        margenBruto: null,
        margenOperacion: null,
      },
      {
        ...base,
        sucursalId: '3',
        sucursal: 'Sur',
        motivo: null,
        utilidadOperacion: '12.34',
        utilidadSobrestimada: true,
      },
    ],
    // El total lo manda el API: nulo porque falta Norte. No se suma aquí.
    total: {
      ...base,
      sucursalesSinCalculo: ['Norte'],
      utilidadBruta: null,
      utilidadOperacion: null,
    },
    gastosPorCategoria: [],
  };

  it('utilidadesDe toma la de OPERACIÓN por sucursal y la del total, sin sumar', () => {
    const u = utilidadesDe(estado, UTILIDAD_SIN_LECTURA);
    expect(u.deSucursal('1')).toEqual({ importe: '60.00', razon: null, sobrestimada: false });
    expect(u.deSucursal('2')).toEqual(sinUtilidad(UTILIDAD_SIN_COSTO));
    expect(u.deSucursal('3')).toEqual({ importe: '12.34', razon: null, sobrestimada: true });
    // Una sucursal que el estado no trae: nula, nunca cero.
    expect(u.deSucursal('9')).toEqual(sinUtilidad(UTILIDAD_SIN_LECTURA));
    // Centro y Sur tienen utilidad, pero el total del API es nulo: no se suma aquí.
    expect(u.total).toEqual(sinUtilidad(UTILIDAD_SIN_COSTO));
  });

  it('sin estado (falló o B cortado): todas nulas con el porqué que se pase', () => {
    const u = utilidadesDe(undefined, UTILIDAD_CORTADA);
    expect(u.deSucursal('1')).toEqual(sinUtilidad(UTILIDAD_CORTADA));
    expect(u.total).toEqual(sinUtilidad(UTILIDAD_CORTADA));
  });

  it('armarFilas cuelga la utilidad de cada periodo de su sucursal', () => {
    const filas = armarFilas(
      [suc('1', 'Centro', '100.00', 1), suc('2', 'Norte', '50.00', 1)],
      [suc('1', 'Centro', '80.00', 1)],
      utilidadesDe(estado, UTILIDAD_SIN_LECTURA),
      utilidadesDe(undefined, UTILIDAD_CORTADA),
    );
    expect(filas.map((f) => [f.id, f.a?.utilidad.importe, f.b?.utilidad.razon ?? null])).toEqual([
      ['1', '60.00', UTILIDAD_CORTADA],
      ['2', null, null],
    ]);
  });

  it('valor: nula o sin cuentas = sin valor; una negativa sí es valor', () => {
    expect(valor(cif('10.00', 1, '10.00', 1), 'utilidad')).toBeNull();
    expect(valor(cif('0.00', 0, null, 0, util('-50.00')), 'utilidad')).toBeNull();
    expect(valor(cif('10.00', 1, '10.00', 1, util('-50.00')), 'utilidad')).toBe(-5000n);
  });

  it('deltaDe: nula en A o en B = "—" con el porqué de ese lado; base ≤ 0 = "—"', () => {
    const c = (u?: Utilidad) => cif('10.00', 1, '10.00', 1, u);
    expect(
      deltaDe(fila('1', 'x', c(util('10.00')), c(sinUtilidad(UTILIDAD_CORTADA))), 'utilidad'),
    ).toEqual({
      tipo: 'sinBase',
      razon: `Periodo B: ${UTILIDAD_CORTADA}`,
    });
    expect(deltaDe(fila('1', 'x', c(), c(util('10.00'))), 'utilidad')).toEqual({
      tipo: 'sinBase',
      razon: `Periodo A: ${UTILIDAD_SIN_COSTO}`,
    });
    expect(deltaDe(fila('1', 'x', c(util('10.00')), c(util('-1.00'))), 'utilidad').tipo).toBe(
      'sinBase',
    );
    expect(deltaDe(fila('1', 'x', c(util('150.00')), c(util('100.00'))), 'utilidad')).toEqual({
      tipo: 'cambio',
      diferencia: 5000n,
      porcentaje: '+50.0 %',
    });
  });

  it('ranking por utilidad de A: negativas debajo, nulas fuera y sin número', () => {
    const r = ordenar(
      [
        fila('1', 'Centro', cif('1.00', 1, '1.00', 1, util('-5.00')), null),
        fila('2', 'Norte', cif('1.00', 1, '1.00', 1), null),
        fila('3', 'Sur', cif('1.00', 1, '1.00', 1, util('7.00')), null),
      ],
      'utilidad',
    );
    expect(ids(r)).toEqual(['3', '1', '2']);
    expect(posiciones(r)).toEqual([1, 2, null]);
  });
});

describe('tasa de facturación (F2-106)', () => {
  const t = (valor: string | null): TasaFacturacion =>
    valor === null ? sinTasa(TASA_SIN_VENTA) : { valor, razon: null };
  const c = (tasa: TasaFacturacion) => cif('10.00', 1, '10.00', 1, undefined, tasa);

  it('se lee en diezmilésimas desde el texto de 4 decimales (sin float)', () => {
    expect(valor(c(t('0.6898')), 'tasaFacturacion')).toBe(6898n);
    expect(valor(c(t('1.2500')), 'tasaFacturacion')).toBe(12500n);
    expect(valor(c(t(null)), 'tasaFacturacion')).toBeNull();
    // Sin cuentas en el periodo no hay cifra, aunque la tasa viniera.
    expect(valor(cif('0.00', 0, null, 0, undefined, t('0.5000')), 'tasaFacturacion')).toBeNull();
  });

  it('Δ en el borde de redondeo: +1 diezmilésima sobre 0.2000 = +0.05 % → "+0.1 %"', () => {
    const d = deltaDe(fila('1', 'C', c(t('0.2001')), c(t('0.2000'))), 'tasaFacturacion');
    expect(d).toEqual({ tipo: 'cambio', diferencia: 1n, porcentaje: '+0.1 %' });
    const baja = deltaDe(fila('1', 'C', c(t('0.6773')), c(t('0.6898'))), 'tasaFacturacion');
    expect(baja).toEqual({ tipo: 'cambio', diferencia: -125n, porcentaje: '-1.8 %' });
  });

  it('sin tasa en un lado: "—" con el porqué de ese lado; base 0 sin Δ %', () => {
    expect(deltaDe(fila('1', 'C', c(t(null)), c(t('0.5000'))), 'tasaFacturacion')).toEqual({
      tipo: 'sinBase',
      razon: `Periodo A: ${TASA_SIN_VENTA}`,
    });
    expect(deltaDe(fila('1', 'C', c(t('0.5000')), c(t(null))), 'tasaFacturacion')).toEqual({
      tipo: 'sinBase',
      razon: `Periodo B: ${TASA_SIN_VENTA}`,
    });
    expect(deltaDe(fila('1', 'C', c(t('0.5000')), c(t('0.0000'))), 'tasaFacturacion').tipo).toBe(
      'sinBase',
    );
  });

  it('tasasDe: la del API por sucursal y total; sin tablero = nula con razón, nunca 0', () => {
    const sinTablero = tasasDe(undefined, TASA_SIN_LECTURA);
    expect(sinTablero.total).toEqual(sinTasa(TASA_SIN_LECTURA));
    expect(sinTablero.deSucursal('x')).toEqual(sinTasa(TASA_SIN_LECTURA));
    const suc = (id: string, tasa: string | null) => ({
      sucursalId: id,
      nombre: id,
      venta: '1.00',
      cuentas: 1,
      facturado: '0.00',
      cfdis: 0,
      global: { monto: '0.00', cfdis: 0 },
      cancelados: { monto: '0.00', cfdis: 0 },
      tasa,
    });
    const tasas = tasasDe(
      {
        ventas: { venta: '2.00', cuentas: 2 },
        facturado: { monto: '1.00', cfdis: 1 },
        global: { monto: '0.00', cfdis: 0 },
        cancelados: { monto: '0.00', cfdis: 0 },
        tasa: '0.5000',
        porFacturar: { cuentas: 0, monto: '0.00' },
        porSucursal: [suc('1', '1.0000'), suc('2', null)],
        porMes: [],
        porHora: [],
      },
      TASA_SIN_LECTURA,
    );
    expect(tasas.total).toEqual(t('0.5000'));
    expect(tasas.deSucursal('1')).toEqual(t('1.0000'));
    expect(tasas.deSucursal('2')).toEqual(sinTasa(TASA_SIN_VENTA));
    expect(tasas.deSucursal('3')).toEqual(sinTasa(TASA_SIN_LECTURA));
  });
});
