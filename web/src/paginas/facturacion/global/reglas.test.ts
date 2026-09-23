import { describe, expect, it } from 'vitest';

import type { ResumenPeriodoGlobal } from '../../../api/tipos';
import { explicacionPeriodo, fechaEn, sePuedeEmitir } from './reglas';

// Reglas puras de la pestaña "Factura global" (F2-108).

const BASE: ResumenPeriodoGlobal = {
  clave: '2026-08-01',
  ultimoDia: '2026-08-31',
  periodicidad: 'mensual',
  etiqueta: 'agosto de 2026',
  desde: '2026-08-01T06:00:00.000Z',
  hasta: '2026-09-01T06:00:00.000Z',
  periodicidadSat: '04',
  meses: '08',
  anio: 2026,
  estado: 'lista',
  tickets: 1,
  total: '10.00',
  vigentes: 0,
  vigentesHasta: null,
  globalesPrevias: 0,
};
const CDMX = 'America/Mexico_City';

describe('explicacionPeriodo', () => {
  it('lista: cuántos y que ya se puede; complementaria: que ya tiene una', () => {
    expect(explicacionPeriodo(BASE, CDMX)).toBe(
      '1 ticket que nadie facturó a tiempo. Ya se puede emitir su factura global.',
    );
    expect(explicacionPeriodo({ ...BASE, tickets: 3, globalesPrevias: 2 }, CDMX)).toBe(
      'Complementaria: este periodo ya tiene 2 facturas globales; 3 tickets llegaron después o ' +
        'quedaron fuera. Revísalo antes de emitir otra.',
    );
  });

  it('esperando: hasta cuándo, en la zona de la sucursal', () => {
    // 1 de octubre 00:00 en CDMX = 06:00 UTC; en Tijuana todavía es 30 de septiembre.
    const p = {
      ...BASE,
      estado: 'esperando' as const,
      vigentes: 1,
      vigentesHasta: '2026-10-01T06:00:00.000Z',
    };
    expect(explicacionPeriodo(p, CDMX)).toBe(
      'El periodo terminó, pero un ticket todavía se puede facturar en el portal (hasta el ' +
        '01/10/2026). La factura global espera a que venza ese plazo.',
    );
    expect(explicacionPeriodo(p, 'America/Tijuana')).toContain('(hasta el 30/09/2026)');
  });

  it('en curso y fuera de plazo', () => {
    expect(explicacionPeriodo({ ...BASE, estado: 'en_curso', tickets: 0 }, CDMX)).toBe(
      'El periodo no ha terminado.',
    );
    expect(explicacionPeriodo({ ...BASE, estado: 'fuera_de_plazo', tickets: 5 }, CDMX)).toMatch(
      /^5 tickets sin factura, pero el SAT ya no acepta/,
    );
  });

  it('sólo un periodo `lista` se puede emitir', () => {
    expect(sePuedeEmitir(BASE)).toBe(true);
    for (const estado of ['esperando', 'en_curso', 'fuera_de_plazo'] as const) {
      expect(sePuedeEmitir({ estado })).toBe(false);
    }
  });

  it('fechaEn corta el día en la zona dada', () => {
    expect(fechaEn(CDMX, '2026-09-01T05:30:00.000Z')).toBe('31/08/2026');
    expect(fechaEn('UTC', '2026-09-01T05:30:00.000Z')).toBe('01/09/2026');
  });
});
