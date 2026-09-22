import { FACTURAMA_URL_SANDBOX, leerAdaptadoresConfig } from './config';

const REALES = {
  PAC_IMPL: 'facturama',
  FACTURAMA_USUARIO: 'usuario-sintetico',
  FACTURAMA_PASSWORD: 'password-sintetico',
  CORREO_IMPL: 'brevo',
  BREVO_API_KEY: 'api-key-sintetica',
  CORREO_REMITENTE: 'facturas@ejemplo.test',
  ARCHIVOS_IMPL: 'disco',
  ARCHIVOS_RAIZ: process.platform === 'win32' ? 'C:\\datos\\archivos' : '/datos/archivos',
  ARCHIVOS_SECRETO: 'secreto-sintetico-de-archivos-de-32-o-mas-000',
  ARCHIVOS_URL_BASE: 'https://panel.ejemplo.test/api/archivos',
};

describe('Configuración de adaptadores (F2-202)', () => {
  it('sin variables: todo en falso y sin modo demo', () => {
    expect(leerAdaptadoresConfig({})).toEqual({
      pac: { impl: 'falso' },
      correo: { impl: 'falso', directorio: undefined },
      archivos: { impl: 'falso', raiz: undefined },
      modoDemo: false,
    });
  });

  it('también en NODE_ENV=test y development', () => {
    expect(leerAdaptadoresConfig({ NODE_ENV: 'test' }).pac.impl).toBe('falso');
    expect(leerAdaptadoresConfig({ NODE_ENV: 'development' }).pac.impl).toBe('falso');
  });

  it.each(['PAC_IMPL', 'CORREO_IMPL', 'ARCHIVOS_IMPL'])(
    'un valor desconocido en %s truena nombrando la variable',
    (variable) => {
      expect(() => leerAdaptadoresConfig({ [variable]: 'sat-directo' })).toThrow(
        new RegExp(`^${variable}="sat-directo" no es válido`),
      );
    },
  );

  describe('producción', () => {
    it.each(['PAC_IMPL', 'CORREO_IMPL', 'ARCHIVOS_IMPL'])(
      'NODE_ENV=production con %s=falso ABORTA nombrando la variable',
      (variable) => {
        const entorno = { ...REALES, NODE_ENV: 'production', [variable]: 'falso' };
        expect(() => leerAdaptadoresConfig(entorno)).toThrow(
          `${variable}=falso no se permite con NODE_ENV=production`,
        );
      },
    );

    it('sin variables (falso por defecto) también aborta, y nombra las tres', () => {
      expect(() => leerAdaptadoresConfig({ NODE_ENV: 'production' })).toThrow(
        'PAC_IMPL=falso, CORREO_IMPL=falso, ARCHIVOS_IMPL=falso no se permite con NODE_ENV=production',
      );
    });

    it('con las tres reales y sus credenciales, arranca', () => {
      expect(leerAdaptadoresConfig({ ...REALES, NODE_ENV: 'production' })).toEqual({
        pac: {
          impl: 'facturama',
          url: FACTURAMA_URL_SANDBOX,
          usuario: 'usuario-sintetico',
          password: 'password-sintetico',
        },
        correo: {
          impl: 'brevo',
          apiKey: 'api-key-sintetica',
          remitente: { email: 'facturas@ejemplo.test', nombre: 'Monitor SoftRestaurant' },
        },
        archivos: {
          impl: 'disco',
          raiz: REALES.ARCHIVOS_RAIZ,
          secreto: REALES.ARCHIVOS_SECRETO,
          urlBase: REALES.ARCHIVOS_URL_BASE,
        },
        modoDemo: false,
      });
    });
  });

  it.each([
    'FACTURAMA_USUARIO',
    'FACTURAMA_PASSWORD',
    'BREVO_API_KEY',
    'CORREO_REMITENTE',
    'ARCHIVOS_RAIZ',
    'ARCHIVOS_SECRETO',
    'ARCHIVOS_URL_BASE',
  ])('una implementación real sin %s truena nombrándola', (variable) => {
    const entorno: Record<string, string> = { ...REALES };
    delete entorno[variable];
    expect(() => leerAdaptadoresConfig(entorno)).toThrow(new RegExp(`^${variable} es obligatoria`));
  });

  it('el mensaje de error nunca lleva el valor de una credencial', () => {
    const entorno = { ...REALES, ARCHIVOS_SECRETO: 'corto-y-secreto' };
    expect(() => leerAdaptadoresConfig(entorno)).toThrow('al menos 32 caracteres');
    try {
      leerAdaptadoresConfig(entorno);
    } catch (e) {
      expect((e as Error).message).not.toContain('corto-y-secreto');
    }
  });

  it('ARCHIVOS_RAIZ relativa se rechaza', () => {
    expect(() => leerAdaptadoresConfig({ ...REALES, ARCHIVOS_RAIZ: 'datos/archivos' })).toThrow(
      'ARCHIVOS_RAIZ tiene que ser una ruta absoluta',
    );
  });

  it('las credenciales de una real no se piden si esa impl está en falso', () => {
    expect(() => leerAdaptadoresConfig({ PAC_IMPL: 'falso', CORREO_IMPL: 'falso' })).not.toThrow();
  });

  describe('MODO_DEMO', () => {
    it.each([
      [undefined, false],
      ['', false],
      ['0', false],
      ['1', true],
    ])('MODO_DEMO=%j → %s', (valor, esperado) => {
      expect(leerAdaptadoresConfig(valor === undefined ? {} : { MODO_DEMO: valor }).modoDemo).toBe(
        esperado,
      );
    });

    it.each(['true', 'si', '2'])('MODO_DEMO=%s truena (no se adivina)', (valor) => {
      expect(() => leerAdaptadoresConfig({ MODO_DEMO: valor })).toThrow(/^MODO_DEMO=/);
    });
  });
});
