import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PaginaTickets, Ticket } from '../../api/tipos';
import { EMPRESA_A, instalarApiFalsa, json, type Llamada } from '../../test/apiFalsa';
import type { ParametrosTickets } from './consultas';
import { ErrorExport, exportarTickets, MAX_TICKETS_EXPORT, MENSAJE_CAMBIARON } from './exportar';
import { ticket } from './fixtures';

const PARAMS: ParametrosTickets = {
  empresaId: EMPRESA_A.id,
  sucursalId: undefined,
  desde: '2026-09-01',
  hasta: '2026-09-20',
  folio: '10',
  // F2-222: los filtros y el orden viajan en TODAS las llamadas, la del corte incluida.
  mesero: 'Ana María',
  mesa: undefined,
  forma: 'tarjeta',
  importeMin: '100.50',
  importeMax: undefined,
  canceladas: 'excluir',
  producto: 'taco',
  // F2-232: el cliente también viaja en todas.
  clienteId: 'c1a2b3c4-0000-4000-8000-000000000001',
  orden: 'total',
  dir: 'asc',
};

const lista = (n: number): Ticket[] =>
  Array.from({ length: n }, (_, i) => ticket({ id: `id-${i}`, folio: `10${i}` }));

/** El corte que "sugiere" la API falsa y cuándo se recibió cada ticket (ms). */
const CORTE = '2026-09-20T18:00:00.000Z';
const recibido = new Map<string, number>();
const llegoDespues = (t: Ticket) => {
  recibido.set(t.id, Date.parse(CORTE) + 1);
  return t;
};

/**
 * Una API que pagina `todos` como la real (`porPagina` de la query) y aplica el
 * corte por recepción (F2-203): con `corte`, fuera lo recibido después; sin él,
 * no filtra y sugiere `CORTE`.
 */
function paginar(todos: () => Ticket[]) {
  return (l: Llamada) => {
    const pagina = Number(l.query.get('pagina'));
    const porPagina = Number(l.query.get('porPagina'));
    const corte = l.query.get('corte');
    const vistos = todos().filter(
      (t) => corte === null || (recibido.get(t.id) ?? 0) <= Date.parse(corte),
    );
    const items = vistos.slice((pagina - 1) * porPagina, pagina * porPagina);
    const cuerpo: PaginaTickets = {
      items,
      total: vistos.length,
      pagina,
      porPagina,
      corte: corte ?? CORTE,
    };
    return json(200, cuerpo);
  };
}

/** Las llamadas de páginas del export (sin la primera, que sólo trae el corte). */
const paginas = (llamadas: Llamada[]) => llamadas.filter((l) => l.query.get('porPagina') !== '1');

afterEach(() => {
  vi.unstubAllGlobals();
  recibido.clear();
});

describe('exportarTickets', () => {
  it('baja todas las páginas de 100 con el mismo filtro, en orden', async () => {
    const todos = lista(250);
    const api = instalarApiFalsa({ 'GET /ventas/tickets': paginar(() => todos) });
    const progreso: string[] = [];

    const tickets = await exportarTickets(PARAMS, {
      onProgreso: (hechos, total) => progreso.push(`${hechos}/${total}`),
    });

    expect(tickets.map((t) => t.id)).toEqual(todos.map((t) => t.id));
    // Primero una de un ticket, sin corte, que sólo trae el corte sugerido.
    const [sonda, ...resto] = api.llamadas;
    expect(sonda.query.get('porPagina')).toBe('1');
    expect(sonda.query.has('corte')).toBe(false);
    expect(resto.map((l) => l.query.get('pagina'))).toEqual(['1', '2', '3']);
    for (const l of resto) {
      expect(l.query.get('porPagina')).toBe('100');
      expect(l.query.get('corte')).toBe(CORTE);
    }
    for (const l of api.llamadas) {
      expect(l.query.get('empresaId')).toBe(EMPRESA_A.id);
      expect(l.query.get('desde')).toBe('2026-09-01');
      expect(l.query.get('hasta')).toBe('2026-09-20');
      expect(l.query.get('folio')).toBe('10');
      expect(l.query.has('sucursalId')).toBe(false);
      expect(l.query.get('mesero')).toBe('Ana María');
      expect(l.query.get('forma')).toBe('tarjeta');
      expect(l.query.get('importeMin')).toBe('100.50');
      expect(l.query.get('canceladas')).toBe('excluir');
      expect(l.query.get('producto')).toBe('taco');
      expect(l.query.get('clienteId')).toBe('c1a2b3c4-0000-4000-8000-000000000001');
      expect(l.query.get('orden')).toBe('total');
      expect(l.query.get('dir')).toBe('asc');
      // Los que no se eligieron no se mandan.
      expect(l.query.has('mesa')).toBe(false);
      expect(l.query.has('importeMax')).toBe(false);
    }
    expect(progreso).toEqual(['100/250', '200/250', '250/250']);
  });

  it('avisa el corte con que bajó el archivo (para decirlo en pantalla)', async () => {
    instalarApiFalsa({ 'GET /ventas/tickets': paginar(() => lista(3)) });
    const cortes: string[] = [];
    await exportarTickets(PARAMS, { onCorte: (c) => cortes.push(c) });
    expect(cortes).toEqual([CORTE]);
  });

  it('sin tickets: la del corte y una página, y lista vacía', async () => {
    const api = instalarApiFalsa({ 'GET /ventas/tickets': paginar(() => []) });
    await expect(exportarTickets(PARAMS)).resolves.toEqual([]);
    expect(api.llamadas).toHaveLength(2);
    expect(paginas(api.llamadas)).toHaveLength(1);
  });

  it('F2-203: cheques que LLEGAN a media exportación no entran y no la abortan', async () => {
    let todos = lista(250);
    let n = 0;
    instalarApiFalsa({
      'GET /ventas/tickets': (l) => {
        const r = paginar(() => todos)(l);
        // Tras cada página entra un cheque nuevo arriba, recibido después del corte.
        todos = [llegoDespues(ticket({ id: `nuevo-${n++}` })), ...todos];
        return r;
      },
    });
    const tickets = await exportarTickets(PARAMS);
    expect(tickets).toHaveLength(250);
    expect(tickets.map((t) => t.id)).toEqual(lista(250).map((t) => t.id));
  });

  it('un ticket ya recibido que entra al filtro a media exportación (se cierra, se cancela) SÍ la aborta', async () => {
    // El corte sólo congela lo que llega; esto cambia el conteo con el mismo corte.
    let todos = lista(150);
    instalarApiFalsa({
      'GET /ventas/tickets': (l) => {
        const r = paginar(() => todos)(l);
        if (l.query.get('pagina') === '1' && l.query.has('corte')) {
          todos = [ticket({ id: 'recibido-antes' }), ...todos];
        }
        return r;
      },
    });
    await expect(exportarTickets(PARAMS)).rejects.toThrow(MENSAJE_CAMBIARON);
  });

  it('lo que NO detecta: un importe corregido de un ticket ya bajado (el conteo no se mueve)', async () => {
    const todos = lista(150);
    instalarApiFalsa({
      'GET /ventas/tickets': (l) => {
        const r = paginar(() => todos)(l);
        if (l.query.get('pagina') === '2') todos[0] = { ...todos[0], total: '999.99' };
        return r;
      },
    });
    const tickets = await exportarTickets(PARAMS);
    expect(tickets).toHaveLength(150);
    expect(tickets[0].total).not.toBe('999.99');
  });

  it('si los únicos no cuadran con el total (repetido entre páginas), no entrega archivo', async () => {
    const todos = lista(150);
    todos[120] = todos[5]; // la API devolvió el mismo cheque en dos páginas
    instalarApiFalsa({ 'GET /ventas/tickets': paginar(() => todos) });
    await expect(exportarTickets(PARAMS)).rejects.toThrow(ErrorExport);
  });

  it(`por encima de ${MAX_TICKETS_EXPORT} tickets pide acotar sin bajar nada más`, async () => {
    const api = instalarApiFalsa({
      'GET /ventas/tickets': () =>
        json(200, {
          items: lista(100),
          total: MAX_TICKETS_EXPORT + 1,
          pagina: 1,
          porPagina: 100,
          corte: CORTE,
        }),
    });
    await expect(exportarTickets(PARAMS)).rejects.toThrow(/Acota el rango/);
    expect(paginas(api.llamadas)).toHaveLength(1);
  });

  it('cancelar aborta los requests que faltan', async () => {
    const todos = lista(500);
    const controlador = new AbortController();
    const api = instalarApiFalsa({
      'GET /ventas/tickets': (l) => {
        if (l.query.get('pagina') === '2') controlador.abort();
        return paginar(() => todos)(l);
      },
    });
    // La API falsa no mira la señal: el corte lo hace `fetch` al ver la señal abortada
    // en el request siguiente. Se simula como lo hace el navegador.
    const fetchFalso = globalThis.fetch;
    vi.stubGlobal('fetch', (url: RequestInfo | URL, init?: RequestInit) =>
      init?.signal?.aborted
        ? Promise.reject(new DOMException('Abortado', 'AbortError'))
        : fetchFalso(url, init),
    );

    await expect(exportarTickets(PARAMS, { signal: controlador.signal })).rejects.toThrow(
      /Abortado/,
    );
    expect(paginas(api.llamadas).map((l) => l.query.get('pagina'))).toEqual(['1', '2']);
  });
});
