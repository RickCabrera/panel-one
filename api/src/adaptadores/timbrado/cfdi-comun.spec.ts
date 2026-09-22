import { fechaLocalCfdi, instanteDesdeLocal } from './cfdi-comun';

// La lectura de fechas del PAC NO puede depender de la zona del proceso (el VPS corre
// en UTC, la máquina de desarrollo en CDMX). Cada caso se corre también con TZ movida.
describe('Fechas del CFDI (F2-202)', () => {
  const tzOriginal = process.env.TZ;
  afterEach(() => {
    if (tzOriginal === undefined) delete process.env.TZ;
    else process.env.TZ = tzOriginal;
  });

  it.each(['UTC', 'America/Mexico_City', 'Asia/Tokyo'])(
    'hora local de CDMX → instante UTC, con el proceso en %s',
    (tz) => {
      process.env.TZ = tz;
      expect(instanteDesdeLocal('2026-09-21T20:20:05', 'America/Mexico_City')?.toISOString()).toBe(
        '2026-09-22T02:20:05.000Z',
      );
    },
  );

  it('respeta la zona de la sucursal (Tijuana, Cancún)', () => {
    expect(instanteDesdeLocal('2026-09-21T19:15:30', 'America/Tijuana')?.toISOString()).toBe(
      '2026-09-22T02:15:30.000Z',
    );
    expect(instanteDesdeLocal('2026-09-21T21:15:30', 'America/Cancun')?.toISOString()).toBe(
      '2026-09-22T02:15:30.000Z',
    );
  });

  it('cruza el cambio de horario (Tijuana, noviembre)', () => {
    // 1 nov 2026: Tijuana pasa de UTC-7 a UTC-8 a las 02:00 locales.
    expect(instanteDesdeLocal('2026-11-01T00:30:00', 'America/Tijuana')?.toISOString()).toBe(
      '2026-11-01T07:30:00.000Z',
    );
    expect(instanteDesdeLocal('2026-11-01T03:00:00', 'America/Tijuana')?.toISOString()).toBe(
      '2026-11-01T11:00:00.000Z',
    );
  });

  it('ida y vuelta con fechaLocalCfdi', () => {
    const instante = new Date('2026-03-15T18:45:12.000Z');
    for (const zona of ['America/Mexico_City', 'America/Tijuana', 'America/Hermosillo']) {
      expect(instanteDesdeLocal(fechaLocalCfdi(instante, zona), zona)?.toISOString()).toBe(
        instante.toISOString(),
      );
    }
  });

  it('si el texto trae zona, se respeta', () => {
    expect(instanteDesdeLocal('2026-09-21T20:20:05-06:00', 'America/Tijuana')?.toISOString()).toBe(
      '2026-09-22T02:20:05.000Z',
    );
    expect(instanteDesdeLocal('2026-09-22T02:20:05Z', 'America/Tijuana')?.toISOString()).toBe(
      '2026-09-22T02:20:05.000Z',
    );
  });

  it.each(['', 'ayer', '2026-09-21', '21/09/2026 20:20'])('%j no se puede leer → null', (t) => {
    expect(instanteDesdeLocal(t, 'America/Mexico_City')).toBeNull();
  });
});
