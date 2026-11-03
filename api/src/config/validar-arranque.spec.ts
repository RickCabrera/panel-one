import { erroresDeArranque, validarArranque } from './validar-arranque';

// Paso 0 del entrypoint: todo lo que tumbaría a la API al crear sus módulos, dicho ANTES de
// migrar, en un solo mensaje. Valores sintéticos con forma de reales.
const BUENO: NodeJS.ProcessEnv = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://postgres:Zq8xT1vR9kLm@postgres.railway.internal:5432/railway',
  JWT_ACCESS_SECRET: 'Kp2Vx9QeT7mZr4Lw8Nc1Yb6Hs3Df0Gj5Ua2Xo9Ei7Rt',
  JWT_REFRESH_SECRET: 'Wn5Bq8Lz1Mc7Xv3Kp9Rt2Yh6Ds4Fg0Jo8Ue1Ia5Ql3',
  PANEL_URL: 'https://panel-produccion.up.railway.app',
  TRUST_PROXY_SALTOS: '1',
  PERMITIR_FALSOS_EN_PRODUCCION: 'PAC_IMPL,CORREO_IMPL,ARCHIVOS_IMPL,PUSH_IMPL',
};

describe('validarArranque (paso 0 del entrypoint)', () => {
  it('con el entorno de Railway bien puesto no hay errores', () => {
    expect(erroresDeArranque(BUENO)).toEqual([]);
    expect(() => validarArranque(BUENO)).not.toThrow();
  });

  it('valida los adaptadores: un puerto en falso sin permitir truena aquí, antes de migrar', () => {
    const sinPermiso = { ...BUENO, PERMITIR_FALSOS_EN_PRODUCCION: undefined };
    expect(erroresDeArranque(sinPermiso).join('\n')).toMatch(
      /PAC_IMPL=falso, CORREO_IMPL=falso, ARCHIVOS_IMPL=falso, PUSH_IMPL=falso no se permite/,
    );
    expect(erroresDeArranque({ ...BUENO, CORREO_IMPL: 'gmail' }).join('\n')).toMatch(
      /CORREO_IMPL="gmail" no es válido/,
    );
  });

  it('valida el FORMATO de PANEL_URL: una URL rota o http en producción', () => {
    expect(erroresDeArranque({ ...BUENO, PANEL_URL: 'https://' }).join('\n')).toMatch(
      /PANEL_URL="https:\/\/" no es una URL válida/,
    );
    expect(
      erroresDeArranque({ ...BUENO, PANEL_URL: 'http://panel.up.railway.app' }).join(),
    ).toMatch(/PANEL_URL tiene que ser https/);
  });

  it('junta errores de lectores distintos en un solo mensaje, sin repetir la obligatoria', () => {
    const entorno = {
      ...BUENO,
      JWT_ACCESS_SECRET: undefined,
      TRUST_PROXY_SALTOS: 'uno',
      DOCS_USUARIO: 'docs',
      ADMIN_INICIAL_EMAIL: 'no-es-email',
      ADMIN_INICIAL_PASSWORD: 'Hx7Lq2Mz9Vb4Nc8K',
    };
    const errores = erroresDeArranque(entorno);
    const texto = errores.join('\n');
    expect(texto).toMatch(/JWT_ACCESS_SECRET es obligatoria/);
    expect(errores.filter((e) => e.startsWith('JWT_ACCESS_SECRET'))).toHaveLength(1);
    expect(texto).toMatch(/TRUST_PROXY_SALTOS debe ser un entero/);
    expect(texto).toMatch(/DOCS_USUARIO y DOCS_PASSWORD van juntos/);
    expect(texto).toMatch(/ADMIN_INICIAL_EMAIL no es un email válido/);
    expect(() => validarArranque(entorno)).toThrow(
      /La API no arranca: el entorno tiene 4 problema/,
    );
  });
});
