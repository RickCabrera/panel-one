import { describe, expect, it } from 'vitest';

import { SUCURSAL_A2 } from '../../test/apiFalsa';
import { SUCURSALES, ticket } from './fixtures';
import {
  cantidad,
  duracion,
  fechaHoraDe,
  fechaParaTabla,
  formasDePago,
  textoTiempoMesa,
  tiempoMesa,
} from './formato';

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

describe('tiempo de mesa (F2-222)', () => {
  it('apertura → cierre en minutos completos', () => {
    // La fixture abre a las 02:00Z y cierra a las 03:30Z.
    expect(tiempoMesa(ticket())).toEqual({ tipo: 'minutos', minutos: 90 });
    const casi = ticket({
      abiertoAt: '2026-09-21T03:00:00.000Z',
      cerradoAt: '2026-09-21T03:44:59.999Z',
    });
    expect(tiempoMesa(casi)).toEqual({ tipo: 'minutos', minutos: 44 });
  });

  it('sin cierre y cierre anterior a la apertura NO inventan una duración', () => {
    expect(tiempoMesa(ticket({ cerradoAt: null }))).toEqual({ tipo: 'sin-cierre' });
    const alReves = ticket({ abiertoAt: '2026-09-21T04:00:00.000Z' });
    expect(tiempoMesa(alReves)).toEqual({ tipo: 'invalido' });
    expect(textoTiempoMesa({ tipo: 'sin-cierre' })).toBe('Sin cierre');
    expect(textoTiempoMesa({ tipo: 'invalido' })).toBe('Sin dato');
  });

  it('formato: minutos, horas y horas con minutos', () => {
    expect(duracion(0)).toBe('0 min');
    expect(duracion(45)).toBe('45 min');
    expect(duracion(60)).toBe('1 h');
    expect(duracion(90)).toBe('1 h 30 min');
    expect(duracion(605)).toBe('10 h 5 min');
  });
});
