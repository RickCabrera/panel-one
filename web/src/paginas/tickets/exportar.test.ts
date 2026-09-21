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
};

const lista = (n: number): Ticket[] =>
  Array.from({ length: n }, (_, i) => ticket({ id: `id-${i}`, folio: `10${i}` }));

/** Una API que pagina `todos` como la real (`porPagina` de la query). */
function paginar(todos: () => Ticket[]) {
  return (l: Llamada) => {
    const pagina = Number(l.query.get('pagina'));
    const porPagina = Number(l.query.get('porPagina'));
    const items = todos().slice((pagina - 1) * porPagina, pagina * porPagina);
    const cuerpo: PaginaTickets = { items, total: todos().length, pagina, porPagina };
    return json(200, cuerpo);
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
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
    expect(api.llamadas.map((l) => l.query.get('pagina'))).toEqual(['1', '2', '3']);
    for (const l of api.llamadas) {
      expect(l.query.get('porPagina')).toBe('100');
      expect(l.query.get('empresaId')).toBe(EMPRESA_A.id);
      expect(l.query.get('desde')).toBe('2026-09-01');
      expect(l.query.get('hasta')).toBe('2026-09-20');
      expect(l.query.get('folio')).toBe('10');
      expect(l.query.has('sucursalId')).toBe(false);
    }
    expect(progreso).toEqual(['100/250', '200/250', '250/250']);
  });

  it('sin tickets: una sola llamada y lista vacía', async () => {
    const api = instalarApiFalsa({ 'GET /ventas/tickets': paginar(() => []) });
    await expect(exportarTickets(PARAMS)).resolves.toEqual([]);
    expect(api.llamadas).toHaveLength(1);
  });

  it('si llega un cheque a media exportación, no entrega archivo', async () => {
    let todos = lista(150);
    instalarApiFalsa({
      'GET /ventas/tickets': (l) => {
        const r = paginar(() => todos)(l);
        // Tras la primera página entra un cheque nuevo arriba: todo se recorre uno.
        todos = [ticket({ id: 'nuevo' }), ...todos];
        return r;
      },
    });
    await expect(exportarTickets(PARAMS)).rejects.toThrow(MENSAJE_CAMBIARON);
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
        json(200, { items: lista(100), total: MAX_TICKETS_EXPORT + 1, pagina: 1, porPagina: 100 }),
    });
    await expect(exportarTickets(PARAMS)).rejects.toThrow(/Acota el rango/);
    expect(api.llamadas).toHaveLength(1);
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
    expect(api.llamadas.map((l) => l.query.get('pagina'))).toEqual(['1', '2']);
  });
});
