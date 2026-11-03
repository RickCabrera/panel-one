import { FormaPago, Prisma } from '@prisma/client';

import { desglosarFormas, diaSiguiente, limitesLocales, promedio } from './cortes';

const D = (v: string) => new Prisma.Decimal(v);

describe('cortes: lo puro (MVP de cortes)', () => {
  it('diaSiguiente cruza meses y años sin zona', () => {
    expect(diaSiguiente('2026-10-31')).toBe('2026-11-01');
    expect(diaSiguiente('2026-12-31')).toBe('2027-01-01');
    expect(diaSiguiente('2028-02-28')).toBe('2028-02-29');
  });

  it('limitesLocales corta en la medianoche de la zona de la sucursal, no en UTC', () => {
    // CDMX es UTC−6 todo el año desde 2022; Tijuana es UTC−7 en octubre (horario de verano).
    expect(limitesLocales('2026-10-22', '2026-10-22', 'America/Mexico_City')).toEqual({
      inicio: new Date('2026-10-22T06:00:00.000Z'),
      fin: new Date('2026-10-23T06:00:00.000Z'),
    });
    expect(limitesLocales('2026-10-01', '2026-10-31', 'America/Tijuana')).toEqual({
      inicio: new Date('2026-10-01T07:00:00.000Z'),
      // El horario de verano termina el 1-nov a las 02:00: su medianoche sigue en UTC−7.
      fin: new Date('2026-11-01T07:00:00.000Z'),
    });
  });

  it('promedio: null sin divisor, nunca "0.00"; mitad lejos de cero', () => {
    expect(promedio(D('0'), 0)).toBeNull();
    expect(promedio(D('415.50'), 2)).toBe('207.75');
    expect(promedio(D('10.00'), 3)).toBe('3.33');
    expect(promedio(D('0.05'), 2)).toBe('0.03');
  });

  it('desglosarFormas aplica el catálogo; lo que no está suma en otro y se lista aparte', () => {
    const r = desglosarFormas(
      [
        { formaRaw: 'EFECTIVO', monto: D('260') },
        { formaRaw: 'TARJETA VISA', monto: D('115.5') },
        { formaRaw: 'CORTESIA RARA', monto: D('40') },
        { formaRaw: 'ZZZ', monto: D('40') },
      ],
      new Map([
        ['EFECTIVO', FormaPago.efectivo],
        ['TARJETA VISA', FormaPago.tarjeta],
      ]),
    );
    expect(r.formas).toEqual([
      { forma: 'efectivo', monto: '260.00' },
      { forma: 'tarjeta', monto: '115.50' },
      { forma: 'transferencia', monto: '0.00' },
      { forma: 'otro', monto: '80.00' },
    ]);
    // Empate en monto: por texto.
    expect(r.sinCatalogo).toEqual([
      { formaRaw: 'CORTESIA RARA', monto: '40.00' },
      { formaRaw: 'ZZZ', monto: '40.00' },
    ]);
    expect(r.total.toFixed(2)).toBe('455.50');
  });

  it('desglosarFormas sin pagos: las cuatro formas en cero', () => {
    const r = desglosarFormas([], new Map());
    expect(r.formas.map((f) => f.monto)).toEqual(['0.00', '0.00', '0.00', '0.00']);
    expect(r.sinCatalogo).toEqual([]);
  });
});
