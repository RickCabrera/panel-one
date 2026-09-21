import { describe, expect, it } from 'vitest';

import { escribirFolio, escribirPagina, leerFolio, leerPagina, paginasDe } from './tickets';

const p = (texto: string) => new URLSearchParams(texto);

describe('página en la URL', () => {
  it('lee enteros válidos y todo lo demás es 1', () => {
    expect(leerPagina(p('pagina=3'))).toBe(3);
    expect(leerPagina(p('pagina=10000'))).toBe(10000);
    for (const malo of [
      '',
      'pagina=0',
      'pagina=-2',
      'pagina=2.5',
      'pagina=abc',
      'pagina=10001',
      'pagina=1e3',
    ]) {
      expect(leerPagina(p(malo))).toBe(1);
    }
  });

  it('la página 1 no se escribe y se conserva el resto', () => {
    expect(escribirPagina(p('empresa=e&pagina=4'), 1).toString()).toBe('empresa=e');
    expect(escribirPagina(p('empresa=e'), 7).toString()).toBe('empresa=e&pagina=7');
  });

  it('páginas totales, mínimo una', () => {
    expect(paginasDe(0, 50)).toBe(1);
    expect(paginasDe(50, 50)).toBe(1);
    expect(paginasDe(51, 50)).toBe(2);
    expect(paginasDe(10_000, 50)).toBe(200);
  });
});

describe('folio en la URL', () => {
  it('se limpia y se recorta al tope de la API', () => {
    expect(leerFolio(p('folio=%20%20A12%20'))).toBe('A12');
    expect(leerFolio(p(`folio=${'9'.repeat(50)}`))).toHaveLength(40);
  });

  it('buscar reinicia la página; vacío quita el filtro', () => {
    expect(escribirFolio(p('empresa=e&pagina=9'), ' 12 ').toString()).toBe('empresa=e&folio=12');
    expect(escribirFolio(p('empresa=e&folio=12&pagina=2'), '   ').toString()).toBe('empresa=e');
  });
});
