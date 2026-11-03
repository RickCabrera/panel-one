import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

import { esRelleno, revisarEntornoProduccion, validarEntornoProduccion } from './produccion.config';

// Un entorno de producción bien puesto: valores SINTÉTICOS con la forma de los reales
// (largos, aleatorios), sin ninguna marca de relleno.
const BUENO: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://postgres:Zq8xT1vR9kLm@postgres.railway.internal:5432/railway',
  JWT_ACCESS_SECRET: 'Kp2Vx9QeT7mZr4Lw8Nc1Yb6Hs3Df0Gj5Ua2Xo9Ei7Rt',
  JWT_REFRESH_SECRET: 'Wn5Bq8Lz1Mc7Xv3Kp9Rt2Yh6Ds4Fg0Jo8Ue1Ia5Ql3',
  PANEL_URL: 'https://panel-produccion.up.railway.app',
  TRUST_PROXY_SALTOS: '1',
};

const raizRepo = join(__dirname, '..', '..', '..');

describe('revisarEntornoProduccion', () => {
  it('fuera de producción no revisa nada (el desarrollo vive del relleno)', () => {
    expect(revisarEntornoProduccion({})).toEqual({ errores: [], avisos: [] });
    expect(revisarEntornoProduccion({ NODE_ENV: 'test', JWT_ACCESS_SECRET: 'relleno' })).toEqual({
      errores: [],
      avisos: [],
    });
  });

  it('con todo bien puesto no hay errores', () => {
    expect(revisarEntornoProduccion(BUENO).errores).toEqual([]);
    expect(() => validarEntornoProduccion(BUENO)).not.toThrow();
  });

  it('junta TODAS las obligatorias que faltan en un solo mensaje', () => {
    let mensaje = '';
    try {
      validarEntornoProduccion({ NODE_ENV: 'production' });
    } catch (e) {
      mensaje = (e as Error).message;
    }
    for (const nombre of [
      'DATABASE_URL',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'PANEL_URL',
      'TRUST_PROXY_SALTOS',
    ]) {
      expect(mensaje).toContain(nombre);
    }
    expect(mensaje).toMatch(/5 problema/);
  });

  it('rechaza CADA valor de relleno de api/.env.example, sin imprimir el valor', () => {
    const ejemplo = parseEnv(readFileSync(join(raizRepo, 'api', '.env.example'), 'utf8'));
    const entorno = {
      ...BUENO,
      DATABASE_URL: ejemplo.DATABASE_URL,
      JWT_ACCESS_SECRET: ejemplo.JWT_ACCESS_SECRET,
      JWT_REFRESH_SECRET: ejemplo.JWT_REFRESH_SECRET,
      DOCS_USUARIO: ejemplo.DOCS_USUARIO,
      DOCS_PASSWORD: ejemplo.DOCS_PASSWORD,
    };
    const { errores } = revisarEntornoProduccion(entorno);
    const texto = errores.join('\n');
    for (const nombre of [
      'DATABASE_URL',
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'DOCS_PASSWORD',
    ]) {
      expect(texto).toContain(nombre);
    }
    // Nombres sí, valores nunca: el log del deploy no es lugar para secretos.
    expect(texto).not.toContain(ejemplo.JWT_ACCESS_SECRET!);
    expect(texto).not.toContain(ejemplo.DOCS_PASSWORD!);
  });

  it('rechaza los marcadores de infra/railway.env.example', () => {
    const ejemplo = parseEnv(readFileSync(join(raizRepo, 'infra', 'railway.env.example'), 'utf8'));
    expect(esRelleno(ejemplo.JWT_ACCESS_SECRET!)).toBe(true);
    expect(esRelleno(ejemplo.JWT_REFRESH_SECRET!)).toBe(true);
    expect(esRelleno(ejemplo.ADMIN_INICIAL_PASSWORD!)).toBe(true);
    const { errores } = revisarEntornoProduccion({
      ...BUENO,
      JWT_ACCESS_SECRET: ejemplo.JWT_ACCESS_SECRET,
      ADMIN_INICIAL_PASSWORD: ejemplo.ADMIN_INICIAL_PASSWORD,
    });
    expect(errores.join('\n')).toMatch(/JWT_ACCESS_SECRET[\s\S]*ADMIN_INICIAL_PASSWORD/);
  });

  it('un secreto aleatorio de verdad no se confunde con relleno', () => {
    expect(esRelleno(BUENO.JWT_ACCESS_SECRET!)).toBe(false);
    expect(esRelleno('q1w2e3r4t5y6u7i8o9p0+/ZXCVBNMasdfghjkl==')).toBe(false);
  });

  it('PANEL_URL a localhost o a un dominio de ejemplo no sirve para los correos', () => {
    for (const url of [
      'https://localhost:5173',
      'https://panel.ejemplo.com',
      'https://app.example.com',
    ]) {
      expect(revisarEntornoProduccion({ ...BUENO, PANEL_URL: url }).errores.join()).toContain(
        'PANEL_URL',
      );
    }
  });

  it('TRUST_PROXY_SALTOS=0 en producción truena: la API va detrás del Caddy del web', () => {
    expect(
      revisarEntornoProduccion({ ...BUENO, TRUST_PROXY_SALTOS: '0' }).errores.join(),
    ).toContain('TRUST_PROXY_SALTOS=0');
    // Un valor mal formado lo reporta `leerTrustProxy` con su propio mensaje.
    expect(revisarEntornoProduccion({ ...BUENO, TRUST_PROXY_SALTOS: '1' }).errores).toEqual([]);
  });

  it('avisa (sin tronar) de /docs apagado, del modo demo y de la contraseña inicial olvidada', () => {
    const { errores, avisos } = revisarEntornoProduccion({
      ...BUENO,
      MODO_DEMO: '1',
      ADMIN_INICIAL_PASSWORD: 'Hx7Lq2Mz9Vb4Nc8Kd1Rf6Tg3',
    });
    expect(errores).toEqual([]);
    expect(avisos.join('\n')).toMatch(/\/docs[\s\S]*MODO_DEMO[\s\S]*ADMIN_INICIAL_PASSWORD/);
  });
});
