import { describe, expect, it } from 'vitest';

import { alturaDe, comparableDelDia, comparableDelMes, periodoComparable } from './comparables';

// 2026-09-21 20:30:59.999 UTC = lunes 21-sep 14:30 en CDMX.
const AHORA = new Date('2026-09-21T20:30:59.999Z');
const ALTURA = '2026-09-21T20:30:00.000Z';

describe('alturaDe', () => {
  it('trunca al minuto, en UTC: la llave de caché dura un minuto', () => {
    expect(alturaDe(AHORA)).toBe(ALTURA);
    expect(alturaDe(new Date('2026-09-21T20:30:00.000Z'))).toBe(ALTURA);
    expect(alturaDe(new Date('2026-09-21T20:31:00.001Z'))).toBe('2026-09-21T20:31:00.000Z');
  });
});

describe('comparableDelDia', () => {
  it('hoy contra el mismo día de la semana pasada, cortado a esta hora', () => {
    expect(comparableDelDia('2026-09-21', AHORA)).toEqual({
      rango: { desde: '2026-09-14', hasta: '2026-09-14' },
      alturaAl: ALTURA,
      etiqueta: 'el mismo día de la semana pasada a esta hora',
    });
  });

  it('cruza de mes y de año sin zona de por medio', () => {
    expect(comparableDelDia('2026-03-03', AHORA).rango).toEqual({
      desde: '2026-02-24',
      hasta: '2026-02-24',
    });
    expect(comparableDelDia('2027-01-05', AHORA).rango.desde).toBe('2026-12-29');
  });
});

describe('comparableDelMes', () => {
  it('del 1 a hoy contra el mismo tramo del mes anterior, cortado a esta hora', () => {
    expect(comparableDelMes('2026-09-21', AHORA)).toEqual({
      actual: { desde: '2026-09-01', hasta: '2026-09-21' },
      base: {
        rango: { desde: '2026-08-01', hasta: '2026-08-21' },
        alturaAl: ALTURA,
        etiqueta: 'el mes anterior a la misma altura',
      },
    });
  });

  it('el 31 de marzo contra febrero: febrero completo y sin corte (ya terminó)', () => {
    expect(comparableDelMes('2026-03-31', AHORA).base).toEqual({
      rango: { desde: '2026-02-01', hasta: '2026-02-28' },
      etiqueta: 'el mes anterior completo',
    });
    // Bisiesto: el 29 de marzo de 2028 sí existe en febrero.
    expect(comparableDelMes('2028-03-29', AHORA).base.rango).toEqual({
      desde: '2028-02-01',
      hasta: '2028-02-29',
    });
    expect(comparableDelMes('2028-03-29', AHORA).base.alturaAl).toBe(ALTURA);
    expect(comparableDelMes('2028-03-30', AHORA).base.alturaAl).toBeUndefined();
  });

  it('en enero, la base es diciembre del año anterior', () => {
    expect(comparableDelMes('2027-01-15', AHORA)).toEqual({
      actual: { desde: '2027-01-01', hasta: '2027-01-15' },
      base: {
        rango: { desde: '2026-12-01', hasta: '2026-12-15' },
        alturaAl: ALTURA,
        etiqueta: 'el mes anterior a la misma altura',
      },
    });
  });
});

describe('periodoComparable', () => {
  const hoy = '2026-09-21';

  it('hoy → el mismo día de la semana pasada', () => {
    expect(periodoComparable('hoy', { desde: hoy, hasta: hoy }, hoy, AHORA)).toEqual(
      comparableDelDia(hoy, AHORA),
    );
  });

  it('esta semana (lunes a hoy) → los mismos días de la semana pasada, a esta hora', () => {
    // Jueves 24: la semana va del lunes 21 al jueves 24.
    expect(
      periodoComparable(
        'semana',
        { desde: '2026-09-21', hasta: '2026-09-24' },
        '2026-09-24',
        AHORA,
      ),
    ).toEqual({
      rango: { desde: '2026-09-14', hasta: '2026-09-17' },
      alturaAl: ALTURA,
      etiqueta: 'la semana pasada a la misma altura',
    });
  });

  it('este mes → el mes anterior a la misma altura', () => {
    expect(periodoComparable('mes', { desde: '2026-09-01', hasta: hoy }, hoy, AHORA)).toEqual(
      comparableDelMes(hoy, AHORA).base,
    );
  });

  it('mes anterior → el previo a ése, completo y sin corte', () => {
    expect(
      periodoComparable('mes-anterior', { desde: '2026-08-01', hasta: '2026-08-31' }, hoy, AHORA),
    ).toEqual({
      rango: { desde: '2026-07-01', hasta: '2026-07-31' },
      etiqueta: 'el mes previo completo',
    });
    expect(
      periodoComparable(
        'mes-anterior',
        { desde: '2026-01-01', hasta: '2026-01-31' },
        '2026-02-10',
        AHORA,
      ).rango,
    ).toEqual({ desde: '2025-12-01', hasta: '2025-12-31' });
  });

  it('rango que termina hoy → los N días anteriores, cortados a esta hora', () => {
    expect(periodoComparable('rango', { desde: '2026-09-15', hasta: hoy }, hoy, AHORA)).toEqual({
      rango: { desde: '2026-09-08', hasta: '2026-09-14' },
      alturaAl: ALTURA,
      etiqueta: 'los 7 días anteriores a la misma altura',
    });
  });

  it('rango en el pasado → los N días anteriores, completos', () => {
    expect(
      periodoComparable('rango', { desde: '2026-09-10', hasta: '2026-09-10' }, hoy, AHORA),
    ).toEqual({ rango: { desde: '2026-09-09', hasta: '2026-09-09' }, etiqueta: 'el día anterior' });
  });

  it('rango que termina en el futuro → no se corta (documentado)', () => {
    const c = periodoComparable('rango', { desde: '2026-09-20', hasta: '2026-09-25' }, hoy, AHORA);
    expect(c.rango).toEqual({ desde: '2026-09-14', hasta: '2026-09-19' });
    expect(c.alturaAl).toBeUndefined();
  });
});
