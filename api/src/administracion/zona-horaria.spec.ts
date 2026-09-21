import { esZonaIana } from './zona-horaria';

describe('esZonaIana (F1-060)', () => {
  // Las zonas de México, y las que usan el seed y las fixtures: si el ICU del
  // Node del CI no las lista, no se podría dar de alta una sucursal real.
  it.each([
    'America/Mexico_City',
    'America/Tijuana',
    'America/Cancun',
    'America/Monterrey',
    'America/Merida',
    'America/Chihuahua',
    'America/Hermosillo',
    'America/Mazatlan',
    'America/Bahia_Banderas',
    'America/Matamoros',
  ])('acepta %s', (zona) => {
    expect(esZonaIana(zona)).toBe(true);
  });

  // Offsets: Postgres los lee con el signo POSIX invertido en AT TIME ZONE.
  it.each(['+05:00', '-06:00', 'UTC-6', 'GMT-6', 'America/Nowhere', 'america/tijuana', '', ' '])(
    'rechaza %j',
    (zona) => {
      expect(esZonaIana(zona)).toBe(false);
    },
  );

  it.each([null, undefined, 5, {}])('rechaza lo que no es texto: %p', (valor) => {
    expect(esZonaIana(valor)).toBe(false);
  });
});
