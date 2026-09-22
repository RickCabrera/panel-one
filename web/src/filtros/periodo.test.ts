import { describe, expect, it } from 'vitest';

import { SUCURSAL_A1, SUCURSAL_A2 } from '../test/apiFalsa';
import {
  errorDeRango,
  escribirPeriodo,
  horaEn,
  hoyEn,
  incluyeHoy,
  leerPeriodo,
  rangoDe,
  zonaDelPanel,
} from './periodo';

describe('hoyEn', () => {
  // 2026-09-21 03:30 UTC = 20-sep 21:30 en CDMX (UTC-6) y 20:30 en Tijuana (UTC-7).
  const noche = new Date('2026-09-21T03:30:00Z');

  it('es el día de la ZONA, no el de UTC', () => {
    expect(hoyEn('America/Mexico_City', noche)).toBe('2026-09-20');
    expect(hoyEn('America/Tijuana', noche)).toBe('2026-09-20');
    expect(hoyEn('UTC', noche)).toBe('2026-09-21');
  });

  it('cambia de día a la medianoche de la sucursal', () => {
    const medianocheCdmx = new Date('2026-09-21T06:00:00Z');
    expect(hoyEn('America/Mexico_City', medianocheCdmx)).toBe('2026-09-21');
    expect(hoyEn('America/Tijuana', medianocheCdmx)).toBe('2026-09-20');
  });
});

describe('horaEn', () => {
  it('da hh:mm de 24 h en la zona', () => {
    expect(horaEn('America/Mexico_City', Date.parse('2026-09-21T03:05:00Z'))).toBe('21:05');
    expect(horaEn('America/Mexico_City', Date.parse('2026-09-21T06:07:00Z'))).toBe('00:07');
  });
});

describe('zonaDelPanel', () => {
  it('con sucursal elegida, la suya', () => {
    expect(zonaDelPanel(SUCURSAL_A2, [SUCURSAL_A1, SUCURSAL_A2])).toBe('America/Tijuana');
  });

  it('con "Todas" en una sola zona, ésa', () => {
    const dosTijuana = [SUCURSAL_A2, { ...SUCURSAL_A1, zonaHoraria: 'America/Tijuana' }];
    expect(zonaDelPanel(undefined, dosTijuana)).toBe('America/Tijuana');
  });

  it('con "Todas" en zonas distintas, o sin lista, la de presentación', () => {
    expect(zonaDelPanel(undefined, [SUCURSAL_A1, SUCURSAL_A2])).toBe('America/Mexico_City');
    expect(zonaDelPanel(undefined, undefined)).toBe('America/Mexico_City');
  });
});

describe('rangoDe', () => {
  it('hoy', () => {
    expect(rangoDe({ tipo: 'hoy' }, '2026-09-20')).toEqual({
      desde: '2026-09-20',
      hasta: '2026-09-20',
    });
  });

  it('esta semana empieza el lunes', () => {
    // 2026-09-20 es domingo; 2026-09-14 lunes.
    expect(rangoDe({ tipo: 'semana' }, '2026-09-20')).toEqual({
      desde: '2026-09-14',
      hasta: '2026-09-20',
    });
    expect(rangoDe({ tipo: 'semana' }, '2026-09-14')).toEqual({
      desde: '2026-09-14',
      hasta: '2026-09-14',
    });
    // Cruza de mes y de año.
    expect(rangoDe({ tipo: 'semana' }, '2027-01-01')).toEqual({
      desde: '2026-12-28',
      hasta: '2027-01-01',
    });
  });

  it('este mes', () => {
    expect(rangoDe({ tipo: 'mes' }, '2026-09-20')).toEqual({
      desde: '2026-09-01',
      hasta: '2026-09-20',
    });
  });

  it('mes anterior, completo, también de enero a diciembre y en febrero bisiesto', () => {
    expect(rangoDe({ tipo: 'mes-anterior' }, '2026-09-20')).toEqual({
      desde: '2026-08-01',
      hasta: '2026-08-31',
    });
    expect(rangoDe({ tipo: 'mes-anterior' }, '2027-01-15')).toEqual({
      desde: '2026-12-01',
      hasta: '2026-12-31',
    });
    expect(rangoDe({ tipo: 'mes-anterior' }, '2028-03-01')).toEqual({
      desde: '2028-02-01',
      hasta: '2028-02-29',
    });
  });

  it('un rango válido pasa tal cual y uno inválido no se consulta', () => {
    expect(
      rangoDe({ tipo: 'rango', desde: '2026-08-01', hasta: '2026-08-10' }, '2026-09-20'),
    ).toEqual({ desde: '2026-08-01', hasta: '2026-08-10' });
    expect(
      rangoDe({ tipo: 'rango', desde: '2026-08-10', hasta: '2026-08-01' }, '2026-09-20'),
    ).toBeNull();
    expect(rangoDe({ tipo: 'rango', desde: '', hasta: '' }, '2026-09-20')).toBeNull();
  });
});

describe('errorDeRango', () => {
  it('cuenta los días inclusivos igual que la API: 366 pasa, 367 no', () => {
    expect(errorDeRango('2026-01-01', '2027-01-01')).toBeNull(); // 366 días
    expect(errorDeRango('2026-01-01', '2027-01-02')).toMatch(/366 días/); // 367
  });

  it('un solo día es válido; al revés no', () => {
    expect(errorDeRango('2026-09-20', '2026-09-20')).toBeNull();
    expect(errorDeRango('2026-09-21', '2026-09-20')).toMatch(/posterior/);
  });

  it('fechas que no existen o mal escritas', () => {
    expect(errorDeRango('2026-02-30', '2026-03-01')).toMatch(/válidas/);
    expect(errorDeRango('2026-9-1', '2026-09-20')).toMatch(/válidas/);
    expect(errorDeRango('', '2026-09-20')).toMatch(/válidas/);
  });
});

describe('incluyeHoy', () => {
  it('sólo si hoy cae dentro, bordes incluidos', () => {
    expect(incluyeHoy({ desde: '2026-09-01', hasta: '2026-09-20' }, '2026-09-20')).toBe(true);
    expect(incluyeHoy({ desde: '2026-09-20', hasta: '2026-09-20' }, '2026-09-20')).toBe(true);
    expect(incluyeHoy({ desde: '2026-08-01', hasta: '2026-08-31' }, '2026-09-20')).toBe(false);
    expect(incluyeHoy({ desde: '2026-09-21', hasta: '2026-09-30' }, '2026-09-20')).toBe(false);
  });
});

describe('periodo en la URL', () => {
  it('sin periodo, o con uno desconocido, es hoy', () => {
    expect(leerPeriodo(new URLSearchParams())).toEqual({ tipo: 'hoy' });
    expect(leerPeriodo(new URLSearchParams('periodo=siglo'))).toEqual({ tipo: 'hoy' });
  });

  it('lee el rango con sus fechas sin validar', () => {
    expect(leerPeriodo(new URLSearchParams('periodo=rango&desde=2026-08-01&hasta=x'))).toEqual({
      tipo: 'rango',
      desde: '2026-08-01',
      hasta: 'x',
    });
  });

  it('escribe el periodo y conserva el alcance', () => {
    const previos = new URLSearchParams('empresa=e&sucursal=s&periodo=rango&desde=a&hasta=b');
    expect(escribirPeriodo(previos, { tipo: 'mes' }).toString()).toBe(
      'empresa=e&sucursal=s&periodo=mes',
    );
    expect(escribirPeriodo(previos, { tipo: 'hoy' }).toString()).toBe('empresa=e&sucursal=s');
    const rango = escribirPeriodo(new URLSearchParams('empresa=e'), {
      tipo: 'rango',
      desde: '2026-08-01',
      hasta: '2026-08-31',
    });
    expect(leerPeriodo(rango)).toEqual({ tipo: 'rango', desde: '2026-08-01', hasta: '2026-08-31' });
    expect(rango.get('empresa')).toBe('e');
  });

  it('un periodo nuevo vuelve a la página 1 y no toca lo demás (F2-212)', () => {
    const previos = new URLSearchParams('empresa=e&pagina=4&folio=A1');
    const nuevos = escribirPeriodo(previos, { tipo: 'mes' });
    expect(nuevos.has('pagina')).toBe(false);
    expect(nuevos.get('folio')).toBe('A1');
    expect(nuevos.get('empresa')).toBe('e');
    // No muta los parámetros que recibe.
    expect(previos.get('pagina')).toBe('4');
  });
});
