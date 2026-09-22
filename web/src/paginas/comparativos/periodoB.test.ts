import { describe, expect, it } from 'vitest';

import { rangoDe } from '../../filtros/periodo';
import { escribirB, leerB, mesAnteriorA, resolverB } from './periodoB';

// Lunes 21-sep-2026, 14:30:30 en CDMX.
const AHORA = new Date('2026-09-21T20:30:30Z');
const ALTURA = '2026-09-21T20:30:00.000Z';
const HOY = '2026-09-21';

describe('leerB / escribirB', () => {
  it('sin parámetro (o con basura) es "comparable"', () => {
    expect(leerB(new URLSearchParams(''))).toEqual({ modo: 'comparable' });
    expect(leerB(new URLSearchParams('b=otro'))).toEqual({ modo: 'comparable' });
    expect(leerB(new URLSearchParams('b=mes-anterior'))).toEqual({ modo: 'mes-anterior' });
    expect(leerB(new URLSearchParams('b=rango&bdesde=2026-01-01&bhasta=2026-01-31'))).toEqual({
      modo: 'rango',
      desde: '2026-01-01',
      hasta: '2026-01-31',
    });
    expect(leerB(new URLSearchParams('b=rango'))).toEqual({ modo: 'rango', desde: '', hasta: '' });
  });

  it('conserva lo demás de la URL y "comparable" no deja rastro', () => {
    const previos = new URLSearchParams('empresa=e&periodo=mes&b=rango&bdesde=x&bhasta=y');
    expect(escribirB(previos, { modo: 'comparable' }).toString()).toBe('empresa=e&periodo=mes');
    expect(escribirB(previos, { modo: 'mes-anterior' }).toString()).toBe(
      'empresa=e&periodo=mes&b=mes-anterior',
    );
    expect(
      escribirB(previos, { modo: 'rango', desde: '2026-01-01', hasta: '2026-01-31' }).toString(),
    ).toBe('empresa=e&periodo=mes&b=rango&bdesde=2026-01-01&bhasta=2026-01-31');
  });
});

describe('mesAnteriorA', () => {
  it('es el mes calendario anterior al del día, completo', () => {
    expect(mesAnteriorA('2026-09-21')).toEqual({
      rango: { desde: '2026-08-01', hasta: '2026-08-31' },
      nombre: 'agosto de 2026',
    });
    expect(mesAnteriorA('2026-07-01').rango).toEqual({ desde: '2026-06-01', hasta: '2026-06-30' });
  });

  it('enero → diciembre del año anterior; marzo → febrero con su último día real', () => {
    expect(mesAnteriorA('2027-01-15')).toEqual({
      rango: { desde: '2026-12-01', hasta: '2026-12-31' },
      nombre: 'diciembre de 2026',
    });
    expect(mesAnteriorA('2028-03-31').rango).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' });
  });
});

describe('resolverB', () => {
  const esteMes = rangoDe({ tipo: 'mes' }, HOY)!;

  it('comparable: el periodo comparable del Resumen, con su corte a la misma altura', () => {
    const r = resolverB({ modo: 'comparable' }, 'mes', esteMes, HOY, AHORA);
    expect(r).toEqual({
      ok: true,
      comparable: {
        rango: { desde: '2026-08-01', hasta: '2026-08-21' },
        alturaAl: ALTURA,
        etiqueta: 'el mes anterior a la misma altura',
      },
    });
  });

  it('AC: A = "Este mes", B = "Mes anterior a A" es exactamente "Mes anterior" de Inicio', () => {
    const r = resolverB({ modo: 'mes-anterior' }, 'mes', esteMes, HOY, AHORA);
    expect(r.ok && r.comparable.rango).toEqual(rangoDe({ tipo: 'mes-anterior' }, HOY));
    expect(r.ok && r.comparable.alturaAl).toBeUndefined();
    expect(r.ok && r.comparable.etiqueta).toBe('el mes anterior a A (agosto de 2026, completo)');
  });

  it('mes anterior depende de A, no de hoy: A = julio (rango) → junio', () => {
    const r = resolverB(
      { modo: 'mes-anterior' },
      'rango',
      { desde: '2026-07-10', hasta: '2026-07-20' },
      HOY,
      AHORA,
    );
    expect(r.ok && r.comparable.rango).toEqual({ desde: '2026-06-01', hasta: '2026-06-30' });
  });

  it('A = "Mes anterior" → B es el mes previo a ése (dos meses atrás), nombrado', () => {
    const agosto = rangoDe({ tipo: 'mes-anterior' }, HOY)!;
    const r = resolverB({ modo: 'mes-anterior' }, 'mes-anterior', agosto, HOY, AHORA);
    expect(r.ok && r.comparable.rango).toEqual({ desde: '2026-07-01', hasta: '2026-07-31' });
    expect(r.ok && r.comparable.etiqueta).toContain('julio de 2026');
  });

  it('rango libre: días completos, sin corte; inválido o invertido se explica', () => {
    const ok = resolverB(
      { modo: 'rango', desde: '2026-01-01', hasta: '2026-01-31' },
      'mes',
      esteMes,
      HOY,
      AHORA,
    );
    expect(ok).toEqual({
      ok: true,
      comparable: {
        rango: { desde: '2026-01-01', hasta: '2026-01-31' },
        etiqueta: 'del 2026-01-01 al 2026-01-31 (días completos)',
      },
    });
    const invertido = resolverB(
      { modo: 'rango', desde: '2026-02-01', hasta: '2026-01-01' },
      'mes',
      esteMes,
      HOY,
      AHORA,
    );
    expect(invertido).toEqual({
      ok: false,
      error: 'La fecha de inicio no puede ser posterior a la de fin.',
    });
    expect(resolverB({ modo: 'rango', desde: '', hasta: '' }, 'mes', esteMes, HOY, AHORA).ok).toBe(
      false,
    );
  });
});
