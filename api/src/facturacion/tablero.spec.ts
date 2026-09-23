import { Prisma } from '@prisma/client';

import { completar, HORAS, mesesDelRango, normalizarBusqueda, tasaDe } from './tablero';

// Reglas puras del tablero de facturación (F2-106).

const D = (v: string) => new Prisma.Decimal(v);

describe('tasaDe()', () => {
  it('4 decimales, mitad LEJOS de cero (no bancario)', () => {
    // 1/32 = 0.03125 → 0.0313 (el bancario daría 0.0312).
    expect(tasaDe(D('1.00'), D('32.00'))).toBe('0.0313');
    expect(tasaDe(D('2350.00'), D('3406.78'))).toBe('0.6898');
    expect(tasaDe(D('850.00'), D('1000.00'))).toBe('0.8500');
  });

  it('sin venta positiva no hay tasa (null, nunca "0.0000")', () => {
    expect(tasaDe(D('0.00'), D('0.00'))).toBeNull();
    expect(tasaDe(D('10.00'), D('-5.00'))).toBeNull();
    expect(tasaDe(D('0.00'), D('100.00'))).toBe('0.0000');
  });

  it('puede pasar de 1 (se facturó un ticket de otro periodo) y no se recorta', () => {
    expect(tasaDe(D('150.00'), D('100.00'))).toBe('1.5000');
  });
});

describe('mesesDelRango()', () => {
  it('todos los meses que toca, en orden, cruzando el año', () => {
    expect(mesesDelRango('2026-11-15', '2027-02-01')).toEqual([
      '2026-11',
      '2026-12',
      '2027-01',
      '2027-02',
    ]);
    expect(mesesDelRango('2026-09-01', '2026-09-30')).toEqual(['2026-09']);
  });
});

describe('completar()', () => {
  it('rellena con ceros de verdad las claves sin CFDI', () => {
    expect(
      completar(['2026-09', '2026-10'], [{ clave: '2026-10', facturado: '5', num_cfdi: 1 }]),
    ).toEqual([
      { clave: '2026-09', facturado: '0.00', cfdis: 0 },
      { clave: '2026-10', facturado: '5.00', cfdis: 1 },
    ]);
    expect(completar(HORAS, [])).toHaveLength(24);
  });

  it('una clave fuera de la serie es un error nuestro: truena en vez de perderla', () => {
    expect(() => completar([0, 1], [{ clave: 7, facturado: '1', num_cfdi: 1 }])).toThrow(
      /fuera de la serie/,
    );
  });
});

describe('normalizarBusqueda()', () => {
  it('sin espacios alrededor, en mayúsculas; vacío = sin búsqueda', () => {
    expect(normalizarBusqueda('  eku9003 ')).toBe('EKU9003');
    expect(normalizarBusqueda('   ')).toBeNull();
    expect(normalizarBusqueda(undefined)).toBeNull();
  });
});
