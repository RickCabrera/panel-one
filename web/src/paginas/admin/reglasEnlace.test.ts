import { describe, expect, it } from 'vitest';

import { formatoRestante, leerUrlInstalador, segundosRestantes } from './reglasEnlace';

describe('reglas del diálogo Conectar sucursal', () => {
  it('la URL del instalador sólo se acepta con https://', () => {
    expect(leerUrlInstalador(undefined)).toBeNull();
    expect(leerUrlInstalador('  ')).toBeNull();
    expect(leerUrlInstalador('no es url')).toBeNull();
    expect(leerUrlInstalador('http://x.ejemplo.com/a.zip')).toBeNull();
    expect(leerUrlInstalador('javascript:alert(1)')).toBeNull();
    expect(leerUrlInstalador(' https://x.ejemplo.com/Instalar-YoControlo.zip ')).toBe(
      'https://x.ejemplo.com/Instalar-YoControlo.zip',
    );
  });

  it('los segundos restantes redondean hacia arriba y nunca son negativos', () => {
    const expira = '2026-11-03T12:30:00.000Z';
    const ms = Date.parse(expira);
    expect(segundosRestantes(expira, ms - 1_800_000)).toBe(1800);
    expect(segundosRestantes(expira, ms - 1500)).toBe(2);
    expect(segundosRestantes(expira, ms)).toBe(0);
    expect(segundosRestantes(expira, ms + 60_000)).toBe(0);
  });

  it('formatea m:ss', () => {
    expect(formatoRestante(1800)).toBe('30:00');
    expect(formatoRestante(1799)).toBe('29:59');
    expect(formatoRestante(61)).toBe('1:01');
    expect(formatoRestante(0)).toBe('0:00');
  });
});
