import { leerAuthConfig } from './auth.config';

const ACCESS = 'a'.repeat(32);
const REFRESH = 'r'.repeat(32);

describe('leerAuthConfig', () => {
  it('lee ambos secretos; la cookie es Secure sólo en producción', () => {
    expect(leerAuthConfig({ JWT_ACCESS_SECRET: ACCESS, JWT_REFRESH_SECRET: REFRESH })).toEqual({
      accessSecret: ACCESS,
      refreshSecret: REFRESH,
      cookieSegura: false,
    });
    expect(
      leerAuthConfig({
        JWT_ACCESS_SECRET: ACCESS,
        JWT_REFRESH_SECRET: REFRESH,
        NODE_ENV: 'production',
      }).cookieSegura,
    ).toBe(true);
  });

  it.each([
    ['falta el de access', { JWT_REFRESH_SECRET: REFRESH }, /JWT_ACCESS_SECRET/],
    ['falta el de refresh', { JWT_ACCESS_SECRET: ACCESS }, /JWT_REFRESH_SECRET/],
    ['uno es corto', { JWT_ACCESS_SECRET: 'corto', JWT_REFRESH_SECRET: REFRESH }, /32/],
    ['son iguales', { JWT_ACCESS_SECRET: ACCESS, JWT_REFRESH_SECRET: ACCESS }, /distintos/],
  ])('truena si %s', (_caso, entorno, error) => {
    expect(() => leerAuthConfig(entorno)).toThrow(error);
  });
});
