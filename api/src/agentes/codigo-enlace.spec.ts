import {
  ALFABETO_ENLACE,
  claveIp,
  esCodigoEnlaceValido,
  formatearCodigoEnlace,
  generarCodigoEnlace,
  hashCodigoEnlace,
  leerUrlPublicaApi,
  normalizarCodigoEnlace,
} from './codigo-enlace';

describe('código de enlace (puro)', () => {
  it('el alfabeto tiene 32 símbolos y ninguno ambiguo (O, 0, I, 1)', () => {
    expect(ALFABETO_ENLACE).toHaveLength(32);
    expect(new Set(ALFABETO_ENLACE).size).toBe(32);
    for (const ambiguo of ['O', '0', 'I', '1']) expect(ALFABETO_ENLACE).not.toContain(ambiguo);
  });

  it('genera 8 símbolos del alfabeto, usando el azar que se le da', () => {
    expect(generarCodigoEnlace(() => 0)).toBe('AAAAAAAA');
    expect(generarCodigoEnlace((n) => n - 1)).toBe('99999999');
    const secuencia = [9, 29, 13, 26, 26, 24, 21, 14];
    let i = 0;
    expect(generarCodigoEnlace(() => secuencia[i++])).toBe('K7P442XQ');
    for (let k = 0; k < 200; k++) expect(esCodigoEnlaceValido(generarCodigoEnlace())).toBe(true);
  });

  it('con el azar real no repite en 2000 códigos (32^8 ≈ 10^12)', () => {
    const vistos = new Set(Array.from({ length: 2000 }, () => generarCodigoEnlace()));
    expect(vistos.size).toBe(2000);
  });

  it('se muestra con guión y se normaliza lo que alguien teclea', () => {
    expect(formatearCodigoEnlace('K7P442XQ')).toBe('K7P4-42XQ');
    expect(normalizarCodigoEnlace(' k7p4-42xq ')).toBe('K7P442XQ');
    expect(normalizarCodigoEnlace('K7P4 42XQ')).toBe('K7P442XQ');
    expect(normalizarCodigoEnlace('k-7-p-4-4-2-x-q')).toBe('K7P442XQ');
  });

  it.each([
    ['K7P442XQ', true],
    ['K7P442X', false],
    ['K7P442XQQ', false],
    ['K7P42X', false],
    ['O7P442XQ', false],
    ['K0P442XQ', false],
    ['KIP442XQ', false],
    ['K1P442XQ', false],
    ['K7P_42XQ', false],
    ['', false],
  ])('%s válido = %s', (codigo, valido) => {
    expect(esCodigoEnlaceValido(codigo)).toBe(valido);
  });

  it('el hash es SHA-256 hex, determinista y distinto del de una API key del mismo texto', () => {
    const h = hashCodigoEnlace('K7P442XQ');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCodigoEnlace('K7P442XQ')).toBe(h);
    expect(hashCodigoEnlace('K7P442XR')).not.toBe(h);
    expect(h).not.toContain('K7P442XQ');
  });

  describe('claveIp (los límites por IP)', () => {
    it.each([
      ['198.51.100.7', '198.51.100.7'],
      ['::ffff:198.51.100.7', '198.51.100.7'],
      ['2001:db8:1:2:aaaa:bbbb:cccc:dddd', '2001:db8:1:2::/64'],
      ['2001:0db8:0001:0002:ffff::1', '2001:db8:1:2::/64'],
      ['2001:DB8:1:2::', '2001:db8:1:2::/64'],
      ['[2001:db8:1:2::5]', '2001:db8:1:2::/64'],
      ['fe80::1%eth0', 'fe80:0:0:0::/64'],
      ['2001:db8::1', '2001:db8:0:0::/64'],
      ['::1', '0:0:0:0::/64'],
    ])('%s → %s', (ip, clave) => {
      expect(claveIp(ip)).toBe(clave);
    });

    it('dos direcciones del mismo /64 cuentan juntas; de otro /64, aparte', () => {
      expect(claveIp('2001:db8:1:2::a')).toBe(claveIp('2001:db8:1:2:ffff:ffff:ffff:ffff'));
      expect(claveIp('2001:db8:1:3::a')).not.toBe(claveIp('2001:db8:1:2::a'));
    });
  });

  describe('API_URL_PUBLICA', () => {
    it('sin definir (o vacía) es null', () => {
      expect(leerUrlPublicaApi({})).toBeNull();
      expect(leerUrlPublicaApi({ API_URL_PUBLICA: '  ' })).toBeNull();
    });

    it('https con o sin prefijo, sin la barra final', () => {
      expect(leerUrlPublicaApi({ API_URL_PUBLICA: 'https://x.ejemplo.com/' })).toBe(
        'https://x.ejemplo.com',
      );
      expect(leerUrlPublicaApi({ API_URL_PUBLICA: ' https://x.ejemplo.com/api ' })).toBe(
        'https://x.ejemplo.com/api',
      );
      expect(leerUrlPublicaApi({ API_URL_PUBLICA: 'http://localhost:3000' })).toBe(
        'http://localhost:3000',
      );
    });

    it.each([
      'monitor.ejemplo.com',
      'http://monitor.ejemplo.com',
      'ftp://monitor.ejemplo.com',
      'https://monitor.ejemplo.com/?a=1',
      'https://monitor.ejemplo.com/#x',
      'https://usuario:clave@monitor.ejemplo.com',
    ])('%s truena al arrancar', (valor) => {
      expect(() => leerUrlPublicaApi({ API_URL_PUBLICA: valor })).toThrow(/API_URL_PUBLICA/);
    });
  });
});
