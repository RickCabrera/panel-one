import { Prisma } from '@prisma/client';

import {
  ALFABETO_CODIGO,
  CODIGO_EJEMPLO,
  esCodigoValido,
  esFacturable,
  estadoPublico,
  expiracionDe,
  generarCodigo,
  LONGITUD_CODIGO,
  MENSAJE_ESTADO,
  normalizarCodigo,
  REGEX_CODIGO,
} from './codigo';

// La lógica pura del código corto de facturación (F2-101): formato, normalización, expiración en
// la zona de la sucursal y el estado que se le dice al público.

const CDMX = 'America/Mexico_City';
const TIJUANA = 'America/Tijuana';
const D = (v: string) => new Prisma.Decimal(v);

describe('formato del código', () => {
  it('el alfabeto son 32 símbolos únicos, A–Z y 2–9 sin O, 0, I ni 1', () => {
    expect(ALFABETO_CODIGO).toHaveLength(32);
    expect(new Set(ALFABETO_CODIGO).size).toBe(32);
    for (const ambiguo of ['O', '0', 'I', '1']) expect(ALFABETO_CODIGO).not.toContain(ambiguo);
    for (const c of ALFABETO_CODIGO) expect(c).toMatch(/^[A-Z2-9]$/);
    // La regex acepta exactamente el alfabeto: cada símbolo, y nada fuera de él.
    for (const c of ALFABETO_CODIGO) expect(REGEX_CODIGO.test(c.repeat(9))).toBe(true);
    for (const c of 'OI01abc-_ Ñ') expect(REGEX_CODIGO.test(c.repeat(9))).toBe(false);
  });

  it('el código del ticket de ejemplo de la ficha, 7JQRECP3U, valida el formato elegido', () => {
    expect(CODIGO_EJEMPLO).toBe('7JQRECP3U');
    expect(esCodigoValido(CODIGO_EJEMPLO)).toBe(true);
  });

  it.each([
    ['con O', '7JQRECP3O'],
    ['con 0', '7JQRECP30'],
    ['con I', '7JQRECPI3'],
    ['con 1', '7JQRECP31'],
    ['8 caracteres', '7JQRECP3'],
    ['10 caracteres', '7JQRECP3UU'],
    ['minúsculas sin normalizar', '7jqrecp3u'],
    ['con guion', '7JQR-CP3U'],
    ['vacío', ''],
  ])('rechaza un código %s', (_caso, codigo) => {
    expect(esCodigoValido(codigo)).toBe(false);
  });

  it('2 000 códigos generados cumplen el formato y usan todo el alfabeto', () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const c = generarCodigo();
      expect(c).toHaveLength(LONGITUD_CODIGO);
      expect(esCodigoValido(c)).toBe(true);
      for (const x of c) vistos.add(x);
    }
    expect(vistos.size).toBe(32);
  });

  it('generarCodigo usa el azar inyectado: n = 32 y cada índice mapea a su símbolo', () => {
    const pedidos: number[] = [];
    let i = 0;
    const c = generarCodigo((n) => {
      pedidos.push(n);
      return [29, 8, 14, 15, 4, 2, 13, 25, 18][i++];
    });
    expect(pedidos).toEqual(Array(9).fill(32));
    expect(c).toBe(CODIGO_EJEMPLO);
  });

  it('normalizar: sin espacios alrededor y en mayúsculas; no "corrige" O por 0', () => {
    expect(normalizarCodigo('  7jqrecp3u \n')).toBe('7JQRECP3U');
    expect(normalizarCodigo('7jqrecp3o')).toBe('7JQRECP3O');
    expect(esCodigoValido(normalizarCodigo('7jqrecp3o'))).toBe(false);
  });
});

describe('expiracionDe()', () => {
  it('fin de mes: el primer instante del mes siguiente en la zona de la SUCURSAL', () => {
    // 15 de septiembre 14:00 CDMX → 1 de octubre 00:00 CDMX = 06:00 UTC.
    expect(
      expiracionDe(new Date('2026-09-15T20:00:00Z'), CDMX, { regla: 'fin_de_mes' }).toISOString(),
    ).toBe('2026-10-01T06:00:00.000Z');
  });

  it('fin de mes: un cierre a las 23:30 del último día local (ya es el mes siguiente en UTC) vence al mes siguiente, no dos meses después', () => {
    const cierre = new Date('2026-10-01T05:30:00Z'); // 30 de septiembre 23:30 en CDMX
    expect(expiracionDe(cierre, CDMX, { regla: 'fin_de_mes' }).toISOString()).toBe(
      '2026-10-01T06:00:00.000Z',
    );
    // El mismo instante en UTC sería 1 de octubre: la zona del servidor no manda.
    expect(expiracionDe(cierre, 'UTC', { regla: 'fin_de_mes' }).toISOString()).toBe(
      '2026-11-01T00:00:00.000Z',
    );
  });

  it('fin de mes: diciembre vence el 1 de enero del año siguiente', () => {
    expect(
      expiracionDe(new Date('2026-12-20T18:00:00Z'), CDMX, { regla: 'fin_de_mes' }).toISOString(),
    ).toBe('2027-01-01T06:00:00.000Z');
  });

  it('fin de mes con horario de verano (Tijuana, UTC−7 en octubre → UTC−8 en noviembre)', () => {
    expect(
      expiracionDe(new Date('2026-10-20T20:00:00Z'), TIJUANA, {
        regla: 'fin_de_mes',
      }).toISOString(),
    ).toBe('2026-11-01T07:00:00.000Z');
    expect(
      expiracionDe(new Date('2026-11-20T20:00:00Z'), TIJUANA, {
        regla: 'fin_de_mes',
      }).toISOString(),
    ).toBe('2026-12-01T08:00:00.000Z');
  });

  it('días: hasta el final del día N local después del cierre', () => {
    // 30 de septiembre 23:30 CDMX + 3 días → vence el 4 de octubre 00:00 CDMX.
    expect(
      expiracionDe(new Date('2026-10-01T05:30:00Z'), CDMX, {
        regla: 'dias',
        dias: 3,
      }).toISOString(),
    ).toBe('2026-10-04T06:00:00.000Z');
    // Cruza el año.
    expect(
      expiracionDe(new Date('2026-12-31T18:00:00Z'), CDMX, {
        regla: 'dias',
        dias: 1,
      }).toISOString(),
    ).toBe('2027-01-02T06:00:00.000Z');
  });

  it('días fuera de 1..366, o una zona inválida, lanzan', () => {
    const t = new Date('2026-09-15T20:00:00Z');
    expect(() => expiracionDe(t, CDMX, { regla: 'dias', dias: 0 })).toThrow(RangeError);
    expect(() => expiracionDe(t, CDMX, { regla: 'dias', dias: 367 })).toThrow(RangeError);
    expect(() => expiracionDe(t, CDMX, { regla: 'dias', dias: 1.5 })).toThrow(RangeError);
    expect(() => expiracionDe(t, 'Zona/Inventada', { regla: 'fin_de_mes' })).toThrow(RangeError);
  });
});

describe('esFacturable()', () => {
  const base = { cerradoAt: new Date('2026-09-15T20:00:00Z'), cancelado: false, total: D('1') };
  it('cerrado, no cancelado y total > 0: sí', () => {
    expect(esFacturable(base)).toBe(true);
  });
  it.each([
    ['abierto', { cerradoAt: null }],
    ['cancelado', { cancelado: true }],
    ['en $0', { total: D('0') }],
    ['negativo', { total: D('-10') }],
  ])('%s: no', (_caso, cambio) => {
    expect(esFacturable({ ...base, ...cambio })).toBe(false);
  });
});

describe('estadoPublico()', () => {
  const expiraAt = new Date('2026-10-01T06:00:00Z');
  const antes = expiraAt.getTime() - 1;
  const justo = expiraAt.getTime();
  const vivo = { cancelado: false };

  it('pendiente antes de expira_at; expirado desde expira_at (exclusivo)', () => {
    expect(estadoPublico({ estado: 'pendiente', expiraAt }, vivo, antes)).toBe('pendiente');
    expect(estadoPublico({ estado: 'pendiente', expiraAt }, vivo, justo)).toBe('expirado');
  });

  it('expirado guardado es expirado aunque su fecha no haya pasado', () => {
    expect(estadoPublico({ estado: 'expirado', expiraAt }, vivo, antes)).toBe('expirado');
  });

  it('facturado y en_global mandan sobre la cancelación y la expiración', () => {
    for (const estado of ['facturado', 'en_global'] as const) {
      expect(estadoPublico({ estado, expiraAt }, { cancelado: true }, justo + 1)).toBe(estado);
    }
  });

  it('cuenta cancelada: cancelado, aun vencido', () => {
    expect(estadoPublico({ estado: 'pendiente', expiraAt }, { cancelado: true }, antes)).toBe(
      'cancelado',
    );
    expect(estadoPublico({ estado: 'pendiente', expiraAt }, { cancelado: true }, justo)).toBe(
      'cancelado',
    );
  });

  it('cada estado tiene su mensaje en español, distinto de los demás', () => {
    const mensajes = Object.values(MENSAJE_ESTADO);
    expect(Object.keys(MENSAJE_ESTADO).sort()).toEqual(
      ['cancelado', 'en_global', 'expirado', 'facturado', 'pendiente'].sort(),
    );
    expect(new Set(mensajes).size).toBe(mensajes.length);
  });
});
