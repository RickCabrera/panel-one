import {
  diaSemana,
  HORA_ENVIO,
  horaLocal,
  periodoDiario,
  periodoSemanal,
  reportesQueTocan,
  zonaDeEmpresa,
} from './calendario';

describe('calendario de reportes (F2-141)', () => {
  it('la zona de la empresa es la que más sucursales activas comparten', () => {
    expect(zonaDeEmpresa(['America/Tijuana', 'America/Mexico_City', 'America/Mexico_City'])).toBe(
      'America/Mexico_City',
    );
    // Empate: la primera en orden alfabético, sin importar el orden de llegada.
    expect(zonaDeEmpresa(['America/Tijuana', 'America/Cancun'])).toBe('America/Cancun');
    expect(zonaDeEmpresa(['America/Cancun', 'America/Tijuana'])).toBe('America/Cancun');
    expect(zonaDeEmpresa([])).toBe('America/Mexico_City');
  });

  it('hora local: CDMX sin horario de verano, Tijuana con él', () => {
    // 22-sep-2026 13:00Z: CDMX (UTC−6) 07:00; Tijuana en verano (UTC−7) 06:00.
    const t = Date.parse('2026-09-22T13:00:00Z');
    expect(horaLocal(t, 'America/Mexico_City')).toBe(7);
    expect(horaLocal(t, 'America/Tijuana')).toBe(6);
    // Medianoche local es 0, no 24.
    expect(horaLocal(Date.parse('2026-09-22T06:00:00Z'), 'America/Mexico_City')).toBe(0);
  });

  it('día de la semana ISO', () => {
    expect(diaSemana('2026-09-21')).toBe(1); // lunes
    expect(diaSemana('2026-09-27')).toBe(7); // domingo
  });

  it('el diario reporta ayer; el semanal la semana lun..dom anterior', () => {
    expect(periodoDiario('2026-09-01')).toEqual({
      tipo: 'diario',
      periodo: '2026-08-31',
      desde: '2026-08-31',
      hasta: '2026-08-31',
    });
    const semana = {
      tipo: 'semanal',
      periodo: '2026-09-14',
      desde: '2026-09-14',
      hasta: '2026-09-20',
    };
    expect(periodoSemanal('2026-09-21')).toEqual(semana); // lunes
    expect(periodoSemanal('2026-09-27')).toEqual(semana); // domingo de la misma semana
  });

  it(`antes de las ${HORA_ENVIO}:00 locales no toca nada; desde ahí, el diario (y el lunes, el semanal)`, () => {
    const cdmx = 'America/Mexico_City';
    // Martes 22-sep: 06:59 y 07:00 CDMX.
    expect(reportesQueTocan(Date.parse('2026-09-22T12:59:59Z'), cdmx)).toEqual([]);
    expect(reportesQueTocan(Date.parse('2026-09-22T13:00:00Z'), cdmx).map((p) => p.tipo)).toEqual([
      'diario',
    ]);
    // Lunes 21-sep 07:00 CDMX: los dos.
    expect(
      reportesQueTocan(Date.parse('2026-09-21T13:00:00Z'), cdmx).map((p) => [p.tipo, p.periodo]),
    ).toEqual([
      ['diario', '2026-09-20'],
      ['semanal', '2026-09-14'],
    ]);
    // 23:59 local del martes todavía es "hoy": sigue tocando el de ayer.
    expect(reportesQueTocan(Date.parse('2026-09-23T05:59:00Z'), cdmx)[0].periodo).toBe(
      '2026-09-21',
    );
  });

  it('el mismo instante toca en CDMX y todavía no en Tijuana', () => {
    const t = Date.parse('2026-09-22T13:30:00Z');
    expect(reportesQueTocan(t, 'America/Mexico_City')).toHaveLength(1);
    expect(reportesQueTocan(t, 'America/Tijuana')).toHaveLength(0);
    expect(reportesQueTocan(Date.parse('2026-09-22T14:00:00Z'), 'America/Tijuana')).toHaveLength(1);
  });
});
