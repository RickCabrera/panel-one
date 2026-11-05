import { describe, expect, it } from 'vitest';

import {
  duracionTurno,
  elegirTurno,
  leerTurno,
  leerVista,
  momento,
  nombreCorte,
  queryDeTurnos,
  sentidoDiferencia,
} from './reglas';

describe('cortes: reglas', () => {
  it('momento: en la zona de la sucursal, no en UTC', () => {
    expect(momento('America/Mexico_City', '2026-10-22T20:05:00.000Z')).toBe('22/10/2026 14:05');
    expect(momento('America/Tijuana', '2026-10-22T06:30:00.000Z')).toBe('21/10/2026 23:30');
  });

  it('nombreCorte: con y sin estación', () => {
    expect(nombreCorte({ turnoSr: '7', estacion: 'CAJA1' })).toBe('Turno 7 · CAJA1');
    expect(nombreCorte({ turnoSr: '8', estacion: null })).toBe('Turno 8');
  });

  it('duracionTurno: cerrado contra su cierre, abierto contra ahora', () => {
    const apertura = '2026-10-19T15:00:00.000Z';
    expect(duracionTurno(apertura, '2026-10-22T20:05:00.000Z', 0)).toBe('3 d 5 h');
    expect(duracionTurno(apertura, null, Date.parse('2026-10-19T19:12:00.000Z'))).toBe(
      '4 h 12 min',
    );
    expect(duracionTurno(apertura, null, Date.parse('2026-10-19T15:25:59.000Z'))).toBe('25 min');
    // Un reloj desfasado no da negativo.
    expect(duracionTurno(apertura, null, Date.parse('2026-10-19T14:00:00.000Z'))).toBe('0 min');
  });

  it('sentidoDiferencia: sobrante, faltante, cuadra o sin dato', () => {
    expect(sentidoDiferencia('740.00')).toBe('sobrante');
    expect(sentidoDiferencia('-12.50')).toBe('faltante');
    expect(sentidoDiferencia('0.00')).toBe('cuadra');
    expect(sentidoDiferencia(null)).toBeNull();
    expect(sentidoDiferencia('abc')).toBeNull();
  });
});

describe('turnos en la URL (UI-01)', () => {
  const p = (q: string) => new URLSearchParams(q);

  it('leerTurno: ?turno= manda; el ?corte= viejo sólo si no hay uno nuevo', () => {
    expect(leerTurno(p('turno=a'))).toBe('a');
    expect(leerTurno(p('corte=b'))).toBe('b');
    expect(leerTurno(p('corte=b&turno=a'))).toBe('a');
    expect(leerTurno(p('empresa=e'))).toBeNull();
  });

  it('elegirTurno: escribe ?turno=, borra el viejo ?corte= y respeta lo demás', () => {
    expect(elegirTurno(p('empresa=e&corte=b'), 'a').toString()).toBe('empresa=e&turno=a');
    expect(elegirTurno(p('empresa=e&turno=a&corte=b'), null).toString()).toBe('empresa=e');
  });

  it('queryDeTurnos: el query de /cortes tal cual, con corte → turno', () => {
    expect(queryDeTurnos(p('empresa=e&periodo=hoy&corte=b')).toString()).toBe(
      'empresa=e&periodo=hoy&turno=b',
    );
    expect(queryDeTurnos(p('turno=a&corte=b')).toString()).toBe('turno=a');
    expect(queryDeTurnos(p('')).toString()).toBe('');
  });

  it('leerVista: sólo ?ver=abiertos cambia la vista; lo demás es "del periodo"', () => {
    expect(leerVista(p('ver=abiertos'))).toBe('abiertos');
    expect(leerVista(p(''))).toBe('periodo');
    expect(leerVista(p('ver=todo'))).toBe('periodo');
  });
});
