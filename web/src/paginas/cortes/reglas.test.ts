import { describe, expect, it } from 'vitest';

import { duracionTurno, momento, nombreCorte, sentidoDiferencia } from './reglas';

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
