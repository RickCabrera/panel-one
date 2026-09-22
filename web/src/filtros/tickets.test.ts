import { describe, expect, it } from 'vitest';

import {
  escribirFiltros,
  escribirFolio,
  escribirOrden,
  escribirPagina,
  hayFiltros,
  importesInvertidos,
  leerFiltros,
  leerFolio,
  leerOrden,
  leerPagina,
  ORDEN_DEFAULT,
  paginasDe,
  siguienteOrden,
  SIN_FILTROS,
} from './tickets';

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

describe('filtros en la URL (F2-222)', () => {
  it('lee cada filtro, con los nombres cortos de la URL', () => {
    expect(
      leerFiltros(
        p(
          'mesero=Ana%20Mar%C3%ADa&mesa=12&forma=tarjeta&min=100.5&max=2000&canceladas=solo&producto=taco',
        ),
      ),
    ).toEqual({
      mesero: 'Ana María',
      mesa: '12',
      forma: 'tarjeta',
      importeMin: '100.5',
      importeMax: '2000',
      canceladas: 'solo',
      producto: 'taco',
    });
  });

  it('sin nada, o con basura, son los defaults: nada inválido llega a la API', () => {
    expect(leerFiltros(p(''))).toEqual(SIN_FILTROS);
    expect(
      leerFiltros(p('forma=cheque&min=1e3&max=1.234&canceladas=todas&mesero=%20%20&producto=')),
    ).toEqual(SIN_FILTROS);
    // Once dígitos enteros: más de lo que acepta la API.
    expect(leerFiltros(p('min=12345678901')).importeMin).toBe('');
    expect(leerFiltros(p('min=-50')).importeMin).toBe('-50');
  });

  it('un rango de importes al revés se descarta completo (en centavos exactos)', () => {
    expect(leerFiltros(p('min=100.01&max=100'))).toMatchObject({ importeMin: '', importeMax: '' });
    expect(leerFiltros(p('min=100&max=100.00'))).toMatchObject({
      importeMin: '100',
      importeMax: '100.00',
    });
    expect(importesInvertidos('0.3', '0.29')).toBe(true);
    expect(importesInvertidos('0.30', '0.3')).toBe(false);
    expect(importesInvertidos('', '5')).toBe(false);
  });

  it('los textos se recortan al tope de la API', () => {
    expect(leerFiltros(p(`producto=${'x'.repeat(90)}`)).producto).toHaveLength(80);
    expect(leerFiltros(p(`mesa=${'9'.repeat(50)}`)).mesa).toHaveLength(40);
  });

  it('escribir: los vacíos y el default no se escriben, el resto se conserva y la página vuelve a 1', () => {
    const nuevos = escribirFiltros(p('empresa=e&folio=12&pagina=4&orden=total&dir=asc'), {
      ...SIN_FILTROS,
      mesero: 'Ana',
      importeMax: '99.5',
      canceladas: 'excluir',
    });
    expect(nuevos.toString()).toBe(
      'empresa=e&folio=12&orden=total&dir=asc&mesero=Ana&max=99.5&canceladas=excluir',
    );
    expect(escribirFiltros(nuevos, SIN_FILTROS).toString()).toBe(
      'empresa=e&folio=12&orden=total&dir=asc',
    );
  });

  it('escribir descarta lo inválido igual que leer (ida y vuelta)', () => {
    const nuevos = escribirFiltros(p(''), { ...SIN_FILTROS, importeMin: 'mil', mesero: ' Luis ' });
    expect(nuevos.toString()).toBe('mesero=Luis');
    expect(leerFiltros(nuevos)).toEqual({ ...SIN_FILTROS, mesero: 'Luis' });
  });

  it('hayFiltros no cuenta el default de canceladas', () => {
    expect(hayFiltros(SIN_FILTROS)).toBe(false);
    expect(hayFiltros({ ...SIN_FILTROS, canceladas: 'incluir' })).toBe(false);
    expect(hayFiltros({ ...SIN_FILTROS, canceladas: 'solo' })).toBe(true);
  });
});

describe('orden en la URL (F2-222)', () => {
  it('lee el orden; lo desconocido es el default (momento, desc)', () => {
    expect(leerOrden(p('orden=total&dir=asc'))).toEqual({ orden: 'total', dir: 'asc' });
    expect(leerOrden(p('orden=id&dir=up'))).toEqual(ORDEN_DEFAULT);
    expect(leerOrden(p('orden=folio'))).toEqual({ orden: 'folio', dir: 'desc' });
  });

  it('el default no se escribe; cambiar de orden vuelve a la página 1', () => {
    expect(escribirOrden(p('empresa=e&pagina=3'), { orden: 'mesa', dir: 'asc' }).toString()).toBe(
      'empresa=e&orden=mesa&dir=asc',
    );
    expect(escribirOrden(p('orden=mesa&dir=asc'), ORDEN_DEFAULT).toString()).toBe('');
  });

  it('la misma columna invierte; otra arranca en su dirección natural', () => {
    expect(siguienteOrden(ORDEN_DEFAULT, 'momento')).toEqual({ orden: 'momento', dir: 'asc' });
    expect(siguienteOrden(ORDEN_DEFAULT, 'total')).toEqual({ orden: 'total', dir: 'desc' });
    expect(siguienteOrden(ORDEN_DEFAULT, 'mesero')).toEqual({ orden: 'mesero', dir: 'asc' });
    expect(siguienteOrden({ orden: 'mesero', dir: 'asc' }, 'mesero')).toEqual({
      orden: 'mesero',
      dir: 'desc',
    });
  });
});
