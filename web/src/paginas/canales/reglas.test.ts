import { describe, expect, it } from 'vitest';

import type { CanalNegocio, MontoArea, VentaPorArea } from '../../api/tipos';
import { aCentavos, sumar } from '../../dinero/dinero';
import {
  decimasParaBarra,
  deltaTotal,
  filasMezcla,
  ladoTotal,
  puntosDeMezcla,
  SIN_B,
  SIN_CUENTAS_A,
  SIN_CUENTAS_B,
} from './reglas';

// Ventas por canal (F2-144), reglas puras. Cifras a mano en cada caso; la venta total del periodo
// es la Σ exacta de sus partes, como la manda `/ventas/por-area`.

function venta(
  canales: Array<[CanalNegocio, string, number]>,
  sinCanal: MontoArea = { venta: '0.00', cuentas: 0 },
  sinArea: MontoArea = { venta: '0.00', cuentas: 0 },
): VentaPorArea {
  const partes = [...canales.map(([, v]) => v), sinCanal.venta, sinArea.venta];
  const c = sumar(partes.map((v) => aCentavos(v)!));
  return {
    venta: `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`,
    cuentas: canales.reduce((n, [, , k]) => n + k, 0) + sinCanal.cuentas + sinArea.cuentas,
    areas: [],
    sinArea,
    canales: canales.map(([canal, v, cuentas]) => ({ canal, venta: v, cuentas })),
    sinCanal,
    catalogo: [],
  };
}

describe('puntosDeMezcla (Δ de mezcla exacto, un solo redondeo)', () => {
  it('no resta mezclas ya redondeadas: 1/3 contra 1/6 es +16.7 pp, no 33.3 − 16.7 = 16.6', () => {
    // A: 100.00 de 300.00 (33.33…%); B: 100.00 de 600.00 (16.66…%). Exacto: 16.666… → 16.7.
    expect(puntosDeMezcla(10000n, 30000n, 10000n, 60000n)).toBe('+16.7 pp');
    expect(puntosDeMezcla(10000n, 60000n, 10000n, 30000n)).toBe('-16.7 pp');
  });

  it('cero sin signo, y la mitad se redondea lejos de cero', () => {
    expect(puntosDeMezcla(5000n, 10000n, 10000n, 20000n)).toBe('0.0 pp');
    // 50.05 % − 50.00 % = 0.05 pp → 0.1
    expect(puntosDeMezcla(5005n, 10000n, 5000n, 10000n)).toBe('+0.1 pp');
    expect(puntosDeMezcla(5000n, 10000n, 5005n, 10000n)).toBe('-0.1 pp');
  });
});

describe('filasMezcla', () => {
  const a = venta(
    [
      ['comedor', '200.00', 2],
      ['domicilio', '100.00', 1],
    ],
    { venta: '0.00', cuentas: 0 },
    { venta: '50.00', cuentas: 1 },
  );
  const b = venta(
    [
      ['comedor', '300.00', 3],
      ['mostrador', '100.00', 2],
    ],
    { venta: '100.00', cuentas: 1 },
  );

  it('una fila por canal con cuentas en A o B (orden del enum) y los renglones aparte al final', () => {
    expect(filasMezcla(a, b).map((f) => f.llave)).toEqual([
      'comedor',
      'mostrador',
      'domicilio',
      'sin-canal',
      'sin-area',
    ]);
  });

  it('la mezcla es sobre la venta de SU periodo, y la Σ de las filas es la venta del periodo', () => {
    const filas = filasMezcla(a, b);
    const comedor = filas.find((f) => f.llave === 'comedor')!;
    // A: 200 / 350 = 57.14 %; B: 300 / 500 = 60.0 %.
    expect(comedor.a).toEqual({ venta: '200.00', cuentas: 2, mezcla: '57.1 %', ticket: '$100.00' });
    expect(comedor.b).toMatchObject({ venta: '300.00', mezcla: '60.0 %' });
    const sumaA = sumar(filas.flatMap((f) => (f.a ? [aCentavos(f.a.venta)!] : [])));
    const sumaB = sumar(filas.flatMap((f) => (f.b ? [aCentavos(f.b.venta)!] : [])));
    expect([sumaA, sumaB]).toEqual([aCentavos(a.venta), aCentavos(b.venta)]);
  });

  it('Δ de venta y de mezcla de un canal con cuentas en los dos periodos', () => {
    const comedor = filasMezcla(a, b).find((f) => f.llave === 'comedor')!;
    expect(comedor.deltaVenta).toEqual({ tipo: 'cambio', diferencia: -10000n, porcentaje: '-33.3 %' });
    // 200/350 − 300/500 = 57.142… − 60 = −2.857… → −2.9 pp
    expect(comedor.deltaMezcla).toEqual({ tipo: 'cambio', texto: '-2.9 pp' });
  });

  it('un canal sin cuentas en un periodo es "—" en ese periodo y no tiene Δ (nunca 0 ni ±100 %)', () => {
    const filas = filasMezcla(a, b);
    const mostrador = filas.find((f) => f.llave === 'mostrador')!;
    expect(mostrador.a).toBeNull();
    expect(mostrador.deltaVenta).toEqual({ tipo: 'sinBase', razon: SIN_CUENTAS_A });
    expect(mostrador.deltaMezcla).toEqual({ tipo: 'sinBase', razon: SIN_CUENTAS_A });
    const domicilio = filas.find((f) => f.llave === 'domicilio')!;
    expect(domicilio.b).toBeNull();
    expect(domicilio.deltaVenta).toEqual({ tipo: 'sinBase', razon: SIN_CUENTAS_B });
    expect(domicilio.deltaMezcla).toEqual({ tipo: 'sinBase', razon: SIN_CUENTAS_B });
  });

  it('sin periodo B (inválido) todas las columnas B son "—" con su porqué', () => {
    const filas = filasMezcla(a, null);
    expect(filas.map((f) => f.llave)).toEqual(['comedor', 'domicilio', 'sin-area']);
    expect(filas.every((f) => f.b === null)).toBe(true);
    expect(filas.every((f) => f.deltaVenta.tipo === 'sinBase' && f.deltaVenta.razon === SIN_B)).toBe(
      true,
    );
    expect(deltaTotal(a, null)).toEqual({ tipo: 'sinBase', razon: SIN_B });
  });

  it('un importe ilegible no se vuelve cero: la mezcla es null y el Δ lo dice', () => {
    const roto = { ...a, canales: [{ canal: 'comedor' as const, venta: 'abc', cuentas: 2 }] };
    const [comedor] = filasMezcla(roto, b);
    expect(comedor.a).toEqual({ venta: 'abc', cuentas: 2, mezcla: null, ticket: null });
    expect(comedor.deltaMezcla).toEqual({ tipo: 'sinBase', razon: 'Algún importe no se pudo leer.' });
  });

  it('el ticket promedio redondea la mitad hacia arriba, en centavos', () => {
    const t = venta([['comedor', '100.01', 2]]);
    expect(filasMezcla(t, null)[0].a?.ticket).toBe('$50.01');
    expect(filasMezcla(venta([['comedor', '100.00', 3]]), null)[0].a?.ticket).toBe('$33.33');
  });
});

describe('fila de total', () => {
  it('es la venta del periodo al 100 %, y sin cuentas no hay total ni Δ', () => {
    const a = venta([['comedor', '300.00', 3]]);
    const vacio = venta([]);
    expect(ladoTotal(a)).toEqual({ venta: '300.00', cuentas: 3, mezcla: '100.0 %', ticket: '$100.00' });
    expect(ladoTotal(vacio)).toBeNull();
    expect(deltaTotal(a, vacio)).toEqual({ tipo: 'sinBase', razon: 'Sin cuentas en el periodo B.' });
    expect(deltaTotal(vacio, a)).toEqual({ tipo: 'sinBase', razon: 'Sin cuentas en el periodo A.' });
    expect(deltaTotal(a, venta([['comedor', '200.00', 2]]))).toMatchObject({
      tipo: 'cambio',
      porcentaje: '+50.0 %',
    });
  });
});

describe('decimasParaBarra (sólo para dibujar)', () => {
  it('lee la mezcla, y lo ilegible o nulo es una barra vacía', () => {
    expect(decimasParaBarra('57.1 %')).toBe(571);
    expect(decimasParaBarra('100.0 %')).toBe(1000);
    expect(decimasParaBarra(null)).toBe(0);
    expect(decimasParaBarra('raro')).toBe(0);
  });
});
