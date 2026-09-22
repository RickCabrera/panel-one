import { Prisma } from '@prisma/client';

import { diferenciaDe, totalesDe, type RenglonConteo } from './conteos';

// F2-123, la parte pura del reporte de diferencias. Literales escritos a mano.

const d = (v: string) => new Prisma.Decimal(v);
const r = (
  teorico: string | null,
  costo: string | null,
  contado: string | null,
): RenglonConteo => ({
  teorico: teorico === null ? null : d(teorico),
  costoPromedio: costo === null ? null : d(costo),
  contado: contado === null ? null : d(contado),
});
const texto = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(3));
const pesos = (v: Prisma.Decimal | null) => (v === null ? null : v.toFixed(2));

describe('diferenciaDe', () => {
  it('faltante: contado < teórico da unidades e importe negativos', () => {
    const x = diferenciaDe(r('12.500', '30.00', '10.000'));
    expect(x.estado).toBe('con_diferencia');
    expect(texto(x.unidades)).toBe('-2.500');
    expect(pesos(x.importe)).toBe('-75.00');
  });

  it('sobrante: contado > teórico da unidades e importe positivos', () => {
    const x = diferenciaDe(r('3.000', '19.99', '4.250'));
    expect(texto(x.unidades)).toBe('1.250');
    // 1.25 × 19.99 = 24.9875 → 24.99 (mitad lejos de cero)
    expect(pesos(x.importe)).toBe('24.99');
  });

  it('el importe redondea mitad lejos de cero también en negativo', () => {
    // −0.125 × 0.10 = −0.0125 → −0.01
    expect(pesos(diferenciaDe(r('1.125', '0.10', '1.000')).importe)).toBe('-0.01');
    // −0.5 × 0.01 = −0.005 → −0.01 (no −0.00 ni 0.00)
    expect(pesos(diferenciaDe(r('1.500', '0.01', '1.000')).importe)).toBe('-0.01');
  });

  it('contado igual al teórico: cuadra, con cero exacto', () => {
    const x = diferenciaDe(r('7.000', '12.00', '7'));
    expect(x.estado).toBe('cuadra');
    expect(pesos(x.importe)).toBe('0.00');
  });

  it('teórico negativo (existencia negativa en SR): la diferencia se calcula contra él', () => {
    const x = diferenciaDe(r('-2.000', '10.00', '0'));
    expect(texto(x.unidades)).toBe('2.000');
    expect(pesos(x.importe)).toBe('20.00');
  });

  it('sin contar NUNCA es 0: no hay diferencia ni importe', () => {
    expect(diferenciaDe(r('5.000', '10.00', null))).toEqual({
      estado: 'sin_contar',
      unidades: null,
      importe: null,
    });
  });

  it('sin teórico (no venía en la foto): contado, pero no comparable', () => {
    expect(diferenciaDe(r(null, null, '3.000'))).toEqual({
      estado: 'sin_teorico',
      unidades: null,
      importe: null,
    });
  });

  it('un importe que no cabe en NUMERIC(12,2) no se inventa', () => {
    const x = diferenciaDe(r('0', '99999999.99', '999999.000'));
    expect(x.estado).toBe('con_diferencia');
    expect(x.importe).toBeNull();
  });
});

describe('totalesDe', () => {
  it('los totales son la Σ de los importes YA redondeados de cada renglón', () => {
    // Tres renglones de −0.005 cada uno: redondeados son −0.01 × 3 = −0.03. Recalcular desde
    // las unidades daría −0.015 → −0.02, y el total no cuadraría con las filas.
    const renglones = [
      r('1.500', '0.01', '1.000'),
      r('1.500', '0.01', '1.000'),
      r('1.500', '0.01', '1.000'),
    ].map(diferenciaDe);
    const t = totalesDe(renglones);
    expect(t.faltante).toBe('-0.03');
    expect(t.neto).toBe('-0.03');
  });

  it('separa faltante, sobrante y neto, y cuenta cada estado aparte', () => {
    const renglones = [
      r('12.500', '30.00', '10.000'), // −75.00
      r('3.000', '19.99', '4.250'), // +24.99
      r('7.000', '12.00', '7.000'), // cuadra
      r('5.000', '10.00', null), // sin contar
      r(null, null, '3.000'), // sin teórico
      r('0', '99999999.99', '999999.000'), // sin valuar
    ].map(diferenciaDe);
    expect(totalesDe(renglones)).toEqual({
      articulos: 6,
      contados: 5,
      sinContar: 1,
      sinTeorico: 1,
      conDiferencia: 3,
      sinValuar: 1,
      faltante: '-75.00',
      sobrante: '24.99',
      neto: '-50.01',
    });
  });

  it('sin renglones: todo en cero, sin inventar diferencias', () => {
    expect(totalesDe([])).toEqual({
      articulos: 0,
      contados: 0,
      sinContar: 0,
      sinTeorico: 0,
      conDiferencia: 0,
      sinValuar: 0,
      faltante: '0.00',
      sobrante: '0.00',
      neto: '0.00',
    });
  });
});
