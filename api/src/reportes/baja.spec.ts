import { createHmac } from 'node:crypto';

import { tokenBaja, verificarTokenBaja } from './baja';
import { leerReportesConfig } from './config';

const CLAVE = createHmac('sha256', 'x'.repeat(32)).update('prueba').digest();
const ID = '0f000000-0000-4000-8000-000000000001';
const OTRO = '0f000000-0000-4000-8000-000000000002';

describe('token de baja (F2-141)', () => {
  it('un token recién firmado se verifica y devuelve su suscripción', () => {
    expect(verificarTokenBaja(CLAVE, tokenBaja(CLAVE, ID))).toBe(ID);
  });

  it('la firma de una suscripción no vale para otra', () => {
    const firma = tokenBaja(CLAVE, ID).split('.')[1];
    expect(verificarTokenBaja(CLAVE, `${OTRO}.${firma}`)).toBeNull();
  });

  it('una firma alterada, con otra llave o sin forma, no se verifica', () => {
    const bueno = tokenBaja(CLAVE, ID);
    const alterado = bueno.slice(0, -1) + (bueno.endsWith('A') ? 'B' : 'A');
    expect(verificarTokenBaja(CLAVE, alterado)).toBeNull();
    const otraClave = createHmac('sha256', 'y'.repeat(32)).update('prueba').digest();
    expect(verificarTokenBaja(otraClave, bueno)).toBeNull();
    expect(verificarTokenBaja(CLAVE, ID)).toBeNull();
    expect(verificarTokenBaja(CLAVE, '')).toBeNull();
    expect(verificarTokenBaja(CLAVE, `no-es-uuid.${bueno.split('.')[1]}`)).toBeNull();
  });

  it('la llave de baja se deriva del secreto del access, pero no es el secreto', () => {
    const secreto = 's'.repeat(40);
    const a = leerReportesConfig({ NODE_ENV: 'test' }, secreto).claveBaja;
    expect(a.equals(leerReportesConfig({ NODE_ENV: 'test' }, secreto).claveBaja)).toBe(true);
    expect(a.toString('utf8')).not.toContain(secreto);
    expect(a.equals(leerReportesConfig({ NODE_ENV: 'test' }, 't'.repeat(40)).claveBaja)).toBe(
      false,
    );
  });
});

describe('configuración de reportes (F2-141)', () => {
  const S = 's'.repeat(40);

  it('PANEL_URL es obligatoria y https en producción; nombra la variable', () => {
    expect(() => leerReportesConfig({ NODE_ENV: 'production' }, S)).toThrow(/PANEL_URL/);
    expect(() =>
      leerReportesConfig({ NODE_ENV: 'production', PANEL_URL: 'http://panel.mx' }, S),
    ).toThrow(/https/);
    expect(
      leerReportesConfig({ NODE_ENV: 'production', PANEL_URL: 'https://panel.mx/' }, S).panelUrl,
    ).toBe('https://panel.mx');
  });

  it('fuera de producción cae en el Vite local; una URL mala truena', () => {
    expect(leerReportesConfig({ NODE_ENV: 'development' }, S).panelUrl).toBe(
      'http://localhost:5173',
    );
    expect(() => leerReportesConfig({ PANEL_URL: 'panel' }, S)).toThrow(/PANEL_URL/);
    expect(() => leerReportesConfig({ PANEL_URL: 'ftp://panel.mx' }, S)).toThrow(/PANEL_URL/);
  });

  it('REPORTES_INTERVALO_S: 60 por defecto, apagado en test, entero ≥ 0', () => {
    expect(leerReportesConfig({}, S).intervaloS).toBe(60);
    expect(leerReportesConfig({ NODE_ENV: 'test' }, S).intervaloS).toBe(0);
    expect(leerReportesConfig({ REPORTES_INTERVALO_S: '30' }, S).intervaloS).toBe(30);
    expect(() => leerReportesConfig({ REPORTES_INTERVALO_S: '-1' }, S)).toThrow(
      /REPORTES_INTERVALO_S/,
    );
    expect(() => leerReportesConfig({ REPORTES_INTERVALO_S: '1.5' }, S)).toThrow(
      /REPORTES_INTERVALO_S/,
    );
  });
});
