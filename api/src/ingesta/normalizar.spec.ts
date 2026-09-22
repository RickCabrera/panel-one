import { FormaPago, Prisma } from '@prisma/client';

import { chequeCanonico, type ChequeComparable } from './canonico';
import {
  CANTIDAD,
  DINERO,
  ISO_CON_ZONA,
  cantidad,
  derivarFormaPago,
  dinero,
  fechaUtc,
  jsonCanonico,
} from './normalizar';

const D = (v: string) => new Prisma.Decimal(v);

describe('normalizar (F1-031)', () => {
  describe('dinero()', () => {
    it.each([
      ['0.125', '0.13'],
      ['-0.125', '-0.13'],
      ['10.005', '10.01'],
      ['116.6667', '116.67'],
      ['0.1249', '0.12'],
      ['25.5', '25.50'],
      ['0', '0.00'],
      ['9999999999.994', '9999999999.99'],
    ])('redondea %s a %s (mitad lejos de cero, como NUMERIC de Postgres)', (entrada, esperado) => {
      expect(dinero(entrada)?.toFixed(2)).toBe(esperado);
    });

    it.each(['9999999999.995', '9999999999.9999', '-9999999999.9999'])(
      '%s ya no cabe en NUMERIC(12,2) al redondear: null (el evento se rechaza sin reintento)',
      (entrada) => {
        expect(dinero(entrada)).toBeNull();
      },
    );
  });

  it.each(['125.50', '-3', '0.1234', '1234567890.12'])('DINERO acepta %s', (v) => {
    expect(DINERO.test(v)).toBe(true);
  });

  it.each(['1e5', '1,000.00', '12.34567', '12345678901', ' 12', '12.', '.5', ''])(
    'DINERO rechaza %p',
    (v) => {
      expect(DINERO.test(v)).toBe(false);
    },
  );

  it('CANTIDAD acepta hasta 3 decimales y 9 enteros, y cantidad() no redondea', () => {
    expect(CANTIDAD.test('1.500')).toBe(true);
    expect(CANTIDAD.test('1.5001')).toBe(false);
    expect(CANTIDAD.test('1234567890')).toBe(false);
    expect(cantidad('1.5').toFixed(3)).toBe('1.500');
  });

  it.each([
    ['2026-09-20T19:00:00Z', '2026-09-20T19:00:00.000Z'],
    ['2026-09-20T19:00:00.5-06:00', '2026-09-21T01:00:00.500Z'],
    ['2026-09-20T19:00:00.1234567+00:00', '2026-09-20T19:00:00.123Z'],
  ])('fecha con zona %s → UTC %s (milisegundos)', (entrada, utc) => {
    expect(ISO_CON_ZONA.test(entrada)).toBe(true);
    expect(fechaUtc(entrada).toISOString()).toBe(utc);
  });

  it.each([
    '2026-09-20T19:00:00',
    '2026-09-20 19:00:00Z',
    '2026-09-20',
    '2026-09-20T19:00:00-0600',
  ])('rechaza la fecha sin zona o fuera de formato %p', (v) => {
    expect(ISO_CON_ZONA.test(v)).toBe(false);
  });

  it('derivarFormaPago: siempre `otro` hasta que F1-032 traiga el catálogo', () => {
    expect(derivarFormaPago('EFECTIVO')).toBe(FormaPago.otro);
    expect(derivarFormaPago('TARJETA VISA')).toBe(FormaPago.otro);
  });

  it('jsonCanonico ordena las llaves, también anidadas', () => {
    expect(jsonCanonico({ b: 1, a: [{ d: 2, c: 3 }] })).toBe('{"a":[{"c":3,"d":2}],"b":1}');
  });

  describe('chequeCanonico()', () => {
    const base: ChequeComparable = {
      folio: '1',
      abiertoAt: new Date('2026-09-20T19:00:00.000Z'),
      cerradoAt: null,
      mesa: null,
      mesero: null,
      comensales: null,
      clienteOrigenSrId: null,
      subtotal: D('10.5'),
      impuestos: D('0'),
      descuentos: D('0'),
      propina: D('0'),
      total: D('10.5'),
      cancelado: false,
      partidas: [
        {
          producto: 'x',
          categoria: null,
          cantidad: D('1'),
          precioUnit: D('10.5'),
          total: D('10.5'),
          modificadores: [{ precio: '0.00', nombre: 'm' }],
        },
      ],
      pagos: [
        { forma: FormaPago.otro, formaRaw: 'A', monto: D('5') },
        { forma: FormaPago.otro, formaRaw: 'B', monto: D('5.5') },
      ],
    };

    it('"10.5" y "10.50", llaves de jsonb reordenadas y pagos en otro orden: el mismo cheque', () => {
      const igual: ChequeComparable = {
        ...base,
        subtotal: D('10.50'),
        total: D('10.500'),
        partidas: [
          {
            ...base.partidas[0],
            cantidad: D('1.000'),
            modificadores: [{ nombre: 'm', precio: '0.00' }],
          },
        ],
        pagos: [...base.pagos].reverse(),
      };
      expect(chequeCanonico(igual)).toBe(chequeCanonico(base));
    });

    it('un centavo, un milisegundo o el orden de las partidas sí lo cambian', () => {
      expect(chequeCanonico({ ...base, total: D('10.51') })).not.toBe(chequeCanonico(base));
      expect(chequeCanonico({ ...base, abiertoAt: new Date('2026-09-20T19:00:00.001Z') })).not.toBe(
        chequeCanonico(base),
      );
      const dos = [base.partidas[0], { ...base.partidas[0], producto: 'y' }];
      expect(chequeCanonico({ ...base, partidas: dos })).not.toBe(
        chequeCanonico({ ...base, partidas: [...dos].reverse() }),
      );
    });

    it('F2-232: poner, cambiar o quitar el cliente lo cambia (el reenvío lo reescribe)', () => {
      const conCliente = chequeCanonico({ ...base, clienteOrigenSrId: 'SR-17' });
      expect(conCliente).not.toBe(chequeCanonico(base));
      expect(chequeCanonico({ ...base, clienteOrigenSrId: 'SR-18' })).not.toBe(conCliente);
      expect(chequeCanonico({ ...base, clienteOrigenSrId: 'SR-17' })).toBe(conCliente);
    });
  });
});
