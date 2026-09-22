import { describe, expect, it } from 'vitest';

import { queryVista, usaPeriodo, VISTAS_CON_PERIODO } from './vista';

describe('queryVista', () => {
  it('conserva alcance y periodo, y suelta lo propio de cada vista', () => {
    const p = new URLSearchParams(
      'pagina=3&folio=A1&tab=agentes&empresa=e&sucursal=s&periodo=rango&desde=2026-08-01&hasta=2026-08-31',
    );
    expect(queryVista(p)).toBe(
      '?empresa=e&sucursal=s&periodo=rango&desde=2026-08-01&hasta=2026-08-31',
    );
  });

  it('sin nada compartido da cadena vacía', () => {
    expect(queryVista(new URLSearchParams('pagina=2'))).toBe('');
    expect(queryVista(new URLSearchParams())).toBe('');
  });

  it('no escribe parámetros vacíos', () => {
    expect(queryVista(new URLSearchParams('empresa=e&sucursal=&periodo=mes'))).toBe(
      '?empresa=e&periodo=mes',
    );
  });
});

describe('usaPeriodo', () => {
  it('sólo Inicio, Resumen, Comparativos, Análisis, Tickets y Reportes pintan el selector', () => {
    expect(VISTAS_CON_PERIODO).toEqual([
      '/',
      '/resumen',
      '/comparativos',
      '/analisis',
      '/tickets',
      '/reportes',
    ]);
    for (const ruta of [
      '/',
      '/resumen',
      '/resumen/',
      '/comparativos',
      '/comparativos/',
      '/analisis',
      '/analisis/',
      '/tickets',
      '/reportes',
      '/tickets/',
      '/reportes//',
    ]) {
      expect(usaPeriodo(ruta)).toBe(true);
    }
    for (const ruta of ['/mesas', '/admin', '/cuenta', '/login', '/no-existe']) {
      expect(usaPeriodo(ruta)).toBe(false);
    }
  });
});
