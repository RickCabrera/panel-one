import { leerTrustProxy } from './proxy.config';

describe('leerTrustProxy', () => {
  it('sin variable (o vacía) no confía en ningún proxy', () => {
    expect(leerTrustProxy({})).toBe(0);
    expect(leerTrustProxy({ TRUST_PROXY_SALTOS: '' })).toBe(0);
    expect(leerTrustProxy({ TRUST_PROXY_SALTOS: '  ' })).toBe(0);
  });

  it('acepta enteros >= 0', () => {
    expect(leerTrustProxy({ TRUST_PROXY_SALTOS: '0' })).toBe(0);
    expect(leerTrustProxy({ TRUST_PROXY_SALTOS: '1' })).toBe(1);
    expect(leerTrustProxy({ TRUST_PROXY_SALTOS: ' 2 ' })).toBe(2);
  });

  it.each(['-1', '1.5', 'true', 'uno', 'loopback', '100'])('truena con "%s"', (valor) => {
    expect(() => leerTrustProxy({ TRUST_PROXY_SALTOS: valor })).toThrow(/TRUST_PROXY_SALTOS/);
  });
});
