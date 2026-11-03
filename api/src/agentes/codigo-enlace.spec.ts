import {
  ALFABETO_ENLACE,
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

  it('genera 6 símbolos del alfabeto, usando el azar que se le da', () => {
    expect(generarCodigoEnlace(() => 0)).toBe('AAAAAA');
    expect(generarCodigoEnlace((n) => n - 1)).toBe('999999');
    const secuencia = [9, 29, 13, 26, 24, 21];
    let i = 0;
    expect(generarCodigoEnlace(() => secuencia[i++])).toBe('K7P42X');
    for (let k = 0; k < 200; k++) expect(esCodigoEnlaceValido(generarCodigoEnlace())).toBe(true);
  });

  it('con el azar real no repite en 2000 códigos (32^6 ≈ 10^9)', () => {
    const vistos = new Set(Array.from({ length: 2000 }, () => generarCodigoEnlace()));
    expect(vistos.size).toBe(2000);
  });

  it('se muestra con guión y se normaliza lo que alguien teclea', () => {
    expect(formatearCodigoEnlace('K7P42X')).toBe('K7P-42X');
    expect(normalizarCodigoEnlace(' k7p-42x ')).toBe('K7P42X');
    expect(normalizarCodigoEnlace('K7P 42X')).toBe('K7P42X');
    expect(normalizarCodigoEnlace('k-7-p-4-2-x')).toBe('K7P42X');
  });

  it.each([
    ['K7P42X', true],
    ['K7P42', false],
    ['K7P42XX', false],
    ['O7P42X', false],
    ['K0P42X', false],
    ['KIP42X', false],
    ['K1P42X', false],
    ['K7P_2X', false],
    ['', false],
  ])('%s válido = %s', (codigo, valido) => {
    expect(esCodigoEnlaceValido(codigo)).toBe(valido);
  });

  it('el hash es SHA-256 hex, determinista y distinto del de una API key del mismo texto', () => {
    const h = hashCodigoEnlace('K7P42X');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashCodigoEnlace('K7P42X')).toBe(h);
    expect(hashCodigoEnlace('K7P42Y')).not.toBe(h);
    expect(h).not.toContain('K7P42X');
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
