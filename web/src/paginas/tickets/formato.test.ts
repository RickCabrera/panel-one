import { describe, expect, it } from 'vitest';

import { SUCURSAL_A2 } from '../../test/apiFalsa';
import { SUCURSALES, ticket } from './fixtures';
import { cantidad, fechaHoraDe, fechaParaTabla, formasDePago } from './formato';

describe('fechaHoraDe', () => {
  it('usa la zona de la sucursal del ticket, no UTC', () => {
    expect(fechaHoraDe(ticket(), SUCURSALES)).toEqual({ fecha: '2026-09-20', hora: '21:30' });
    expect(fechaHoraDe(ticket({ sucursalId: SUCURSAL_A2.id }), SUCURSALES)).toEqual({
      fecha: '2026-09-20',
      hora: '20:30',
    });
  });

  it('cancelado sin cierre → la apertura', () => {
    const t = ticket({ cerradoAt: null, abiertoAt: '2026-09-21T06:00:00.000Z' });
    expect(fechaHoraDe(t, SUCURSALES)).toEqual({ fecha: '2026-09-21', hora: '00:00' });
  });

  it('sucursal desconocida → null, nunca otra zona', () => {
    expect(fechaHoraDe(ticket({ sucursalId: 'otra' }), SUCURSALES)).toBeNull();
  });

  it('medianoche sale como 00, no 24', () => {
    const t = ticket({ cerradoAt: '2026-09-21T06:00:00.000Z' });
    expect(fechaHoraDe(t, SUCURSALES)?.hora).toBe('00:00');
  });
});

describe('formato de tabla', () => {
  it('fecha dd/mm/aaaa', () => {
    expect(fechaParaTabla('2026-09-01')).toBe('01/09/2026');
  });

  it('formas de pago con el texto de SR, sin repetir', () => {
    expect(
      formasDePago([
        { formaRaw: 'EFECTIVO', forma: 'efectivo', monto: '1.00' },
        { formaRaw: 'VALES', forma: 'otro', monto: '1.00' },
        { formaRaw: 'EFECTIVO', forma: 'efectivo', monto: '2.00' },
      ]),
    ).toBe('EFECTIVO + VALES');
    expect(formasDePago([])).toBe('');
  });

  it('cantidades sin ceros de relleno y sin pasar por float', () => {
    expect(cantidad('2.000')).toBe('2');
    expect(cantidad('0.250')).toBe('0.25');
    expect(cantidad('-1.500')).toBe('-1.5');
    expect(cantidad('10')).toBe('10');
    expect(cantidad('123456789.001')).toBe('123456789.001');
    expect(cantidad('raro')).toBe('raro');
  });
});
