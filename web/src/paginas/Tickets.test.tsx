import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PaginaTickets, Ticket } from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import {
  EMPRESA_A,
  instalarApiFalsa,
  json,
  sesion,
  SUCURSAL_A1,
  SUCURSAL_A2,
  usuario,
  type Llamada,
  type Manejador,
} from '../test/apiFalsa';
import { ticket } from './tickets/fixtures';

const A = EMPRESA_A.id;

// 2026-09-21 03:30 UTC = domingo 20-sep 21:30 en CDMX. "Hoy" es el 20, no el 21.
const AHORA = new Date('2026-09-21T03:30:00Z');
const HOY = '2026-09-20';

/** `n` tickets sintéticos, del más reciente al más viejo, repartidos entre A1 y A2. */
function lista(n: number): Ticket[] {
  return Array.from({ length: n }, (_, i) =>
    ticket({
      id: `t-${i}`,
      folio: String(5000 - i),
      sucursalId: i % 2 === 0 ? SUCURSAL_A1.id : SUCURSAL_A2.id,
      cerradoAt: new Date(AHORA.getTime() - i * 60_000).toISOString(),
    }),
  );
}

const CORTE_SUGERIDO = '2026-09-20T17:59:30.000Z';

/** Pagina y filtra por folio y sucursal como la API real. */
function tickets(todos: Ticket[]): Manejador {
  return (l: Llamada) => {
    const pagina = Number(l.query.get('pagina'));
    const porPagina = Number(l.query.get('porPagina'));
    const folio = l.query.get('folio') ?? '';
    const sucursal = l.query.get('sucursalId');
    const filtrados = todos.filter(
      (t) => t.folio.startsWith(folio) && (!sucursal || t.sucursalId === sucursal),
    );
    const cuerpo: PaginaTickets = {
      items: filtrados.slice((pagina - 1) * porPagina, pagina * porPagina),
      total: filtrados.length,
      pagina,
      porPagina,
      corte: l.query.get('corte') ?? CORTE_SUGERIDO,
    };
    return json(200, cuerpo);
  };
}

function apiTickets(todos: Ticket[], extra: Record<string, Manejador> = {}) {
  const u = usuario('admin_empresa');
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /ventas/tickets': tickets(todos),
    ...extra,
  });
}

function Ubicacion() {
  const { pathname, search } = useLocation();
  return <div data-testid="ubicacion">{pathname + search}</div>;
}

function montar(ruta: string) {
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
        <Ubicacion />
      </Proveedores>
    </MemoryRouter>,
  );
}

const ubicacion = () => new URL(screen.getByTestId('ubicacion').textContent ?? '', 'http://x');
const pedidas = (api: ReturnType<typeof apiTickets>) =>
  api.llamadas.filter((l) => l.ruta === '/ventas/tickets');
const ultima = (api: ReturnType<typeof apiTickets>) => pedidas(api).at(-1)!.query;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Vista Tickets: la tabla', () => {
  it('pinta cada columna con el dato exacto, la hora en la zona de su sucursal', async () => {
    const api = apiTickets([
      ticket(),
      ticket({
        id: 't2',
        folio: '1002',
        sucursalId: SUCURSAL_A2.id,
        mesa: null,
        mesero: null,
        comensales: null,
        total: '99.90',
        pagos: [],
      }),
    ]);
    montar(`/tickets?empresa=${A}`);

    const fila = await screen.findByTestId('ticket-1001');
    const celdas = within(fila)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(celdas.slice(1)).toEqual([
      '1001',
      '20/09/2026 21:30',
      'Centro',
      '5',
      'Juan Pérez',
      '3',
      '$1,160.00',
      'EFECTIVO + TARJETA DE CREDITO',
    ]);
    const otra = within(screen.getByTestId('ticket-1002')).getAllByRole('cell');
    expect(otra.map((c) => c.textContent).slice(1)).toEqual([
      '1002',
      '20/09/2026 20:30', // Tijuana, el mismo instante
      'Tijuana',
      '—',
      '—',
      '—',
      '$99.90',
      '—',
    ]);

    // La consulta: el día de hoy en CDMX, 50 por página, página 1, sin sucursal.
    const q = ultima(api);
    expect(q.get('empresaId')).toBe(A);
    expect(q.get('desde')).toBe(HOY);
    expect(q.get('hasta')).toBe(HOY);
    expect(q.get('pagina')).toBe('1');
    expect(q.get('porPagina')).toBe('50');
    expect(q.has('sucursalId')).toBe(false);
    expect(q.has('folio')).toBe(false);
    expect(screen.getByTestId('conteo')).toHaveTextContent('2 tickets');
  });

  it('con una sucursal elegida no hay columna Sucursal y se filtra en la API', async () => {
    const api = apiTickets([ticket()]);
    montar(`/tickets?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);

    await screen.findByTestId('ticket-1001');
    expect(screen.queryByRole('columnheader', { name: 'Sucursal' })).not.toBeInTheDocument();
    expect(ultima(api).get('sucursalId')).toBe(SUCURSAL_A1.id);
  });

  it('un cancelado se marca y su total se ve tachado', async () => {
    apiTickets([ticket({ cancelado: true })]);
    montar(`/tickets?empresa=${A}`);

    const fila = await screen.findByTestId('ticket-1001');
    expect(fila).toHaveTextContent('Cancelado');
    expect(within(fila).getByText('$1,160.00')).toHaveClass('line-through');
  });

  it('un importe inválido dice "Importe inválido", nunca $0.00', async () => {
    apiTickets([ticket({ total: 'x' })]);
    montar(`/tickets?empresa=${A}`);
    expect(await screen.findByTestId('ticket-1001')).toHaveTextContent('Importe inválido');
  });

  it('la fila se expande con partidas, modificadores (también los de $0.00) y pagos', async () => {
    const user = userEvent.setup();
    apiTickets([ticket()]);
    montar(`/tickets?empresa=${A}`);

    const boton = await screen.findByRole('button', { name: 'Ver detalle del folio 1001' });
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    await user.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');

    const detalle = screen.getByRole('region', { name: 'Detalle del folio 1001' });
    expect(detalle).toHaveTextContent('2Tacos al pastor$125.50 c/u$251.00');
    expect(detalle).toHaveTextContent('+ Sin cebolla$0.00');
    expect(detalle).toHaveTextContent('+ Extra queso$15.00');
    expect(detalle).toHaveTextContent('0.25Arrachera$800.00 c/u$200.00');
    expect(detalle).toHaveTextContent('EFECTIVO$600.00');
    expect(detalle).toHaveTextContent('TARJETA DE CREDITO$610.00');
    expect(detalle).toHaveTextContent('Subtotal$1,000.00');
    expect(detalle).toHaveTextContent('Impuestos$160.00');
    expect(detalle).toHaveTextContent('Propina$50.00');
    expect(detalle).toHaveTextContent('Total$1,160.00');

    await user.click(screen.getByRole('button', { name: 'Ocultar detalle del folio 1001' }));
    expect(screen.queryByRole('region', { name: 'Detalle del folio 1001' })).toBeNull();
  });

  it('sin tickets: mensaje claro y el export deshabilitado', async () => {
    apiTickets([]);
    montar(`/tickets?empresa=${A}`);
    expect(await screen.findByText('No hay tickets en este periodo.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar CSV' })).toBeDisabled();
  });

  it('un error de la API se muestra con su mensaje', async () => {
    apiTickets([], {
      'GET /ventas/tickets': () => json(500, { statusCode: 500, message: 'Se cayó' }),
    });
    montar(`/tickets?empresa=${A}`);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudieron cargar los tickets. Se cayó',
    );
  });
});

describe('Vista Tickets: paginación y filtros en la URL', () => {
  it('pagina de 50 en 50 en el servidor y la página vive en la URL', async () => {
    const user = userEvent.setup();
    const api = apiTickets(lista(120));
    montar(`/tickets?empresa=${A}`);

    await screen.findByTestId('ticket-5000');
    expect(screen.getByTestId('pagina')).toHaveTextContent('Página 1 de 3');
    expect(screen.getByTestId('conteo')).toHaveTextContent('120 tickets');
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByTestId('ticket-4950')).toBeInTheDocument();
    expect(screen.queryByTestId('ticket-5000')).toBeNull();
    expect(ubicacion().searchParams.get('pagina')).toBe('2');
    expect(screen.getByTestId('pagina')).toHaveTextContent('Página 2 de 3');

    await user.click(screen.getByRole('button', { name: 'Siguiente' }));
    expect(await screen.findByTestId('ticket-4900')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
    // Cada página se pidió al servidor (la siguiente, de antemano), nunca todo junto.
    const paginas = pedidas(api).map((l) => l.query.get('pagina'));
    expect(new Set(paginas)).toEqual(new Set(['1', '2', '3']));
    expect(pedidas(api).every((l) => l.query.get('porPagina') === '50')).toBe(true);
  });

  it('un deep-link a la página 2 abre la página 2', async () => {
    const api = apiTickets(lista(120));
    montar(`/tickets?empresa=${A}&pagina=2`);
    expect(await screen.findByTestId('ticket-4950')).toBeInTheDocument();
    expect(pedidas(api)[0].query.get('pagina')).toBe('2');
  });

  it('una página que ya no existe ofrece ir a la última', async () => {
    const user = userEvent.setup();
    apiTickets(lista(60));
    montar(`/tickets?empresa=${A}&pagina=9`);

    await user.click(await screen.findByRole('button', { name: 'Ir a la última página' }));
    expect(await screen.findByTestId('ticket-4950')).toBeInTheDocument();
    expect(ubicacion().searchParams.get('pagina')).toBe('2');
  });

  it('buscar por folio va a la API, a la URL, y vuelve a la página 1', async () => {
    const user = userEvent.setup();
    const api = apiTickets(lista(120));
    montar(`/tickets?empresa=${A}&pagina=2`);
    await screen.findByTestId('ticket-4950');

    await user.type(screen.getByRole('searchbox'), ' 4999 {Enter}');
    expect(await screen.findByTestId('ticket-4999')).toBeInTheDocument();
    expect(screen.getByTestId('conteo')).toHaveTextContent('1 ticket');
    expect(ubicacion().searchParams.get('folio')).toBe('4999');
    expect(ubicacion().searchParams.has('pagina')).toBe(false);
    expect(ultima(api).get('folio')).toBe('4999');
    expect(ultima(api).get('pagina')).toBe('1');

    await user.click(screen.getByRole('button', { name: 'Limpiar' }));
    expect(await screen.findByTestId('ticket-5000')).toBeInTheDocument();
    expect(ubicacion().searchParams.has('folio')).toBe(false);
  });

  it('un folio que no existe lo dice', async () => {
    apiTickets(lista(3));
    montar(`/tickets?empresa=${A}&folio=ZZ`);
    expect(
      await screen.findByText('Ningún ticket del periodo tiene un folio que empiece con "ZZ".'),
    ).toBeInTheDocument();
  });

  it('cambiar el periodo pide el rango nuevo y vuelve a la página 1', async () => {
    const user = userEvent.setup();
    const api = apiTickets(lista(120));
    montar(`/tickets?empresa=${A}&pagina=2`);
    await screen.findByTestId('ticket-4950');

    await user.click(screen.getByRole('button', { name: 'Este mes' }));
    await waitFor(() => expect(ultima(api).get('desde')).toBe('2026-09-01'));
    // La primera del rango nuevo es la página 1 (después puede venir la 2 de antemano).
    const delMes = pedidas(api).filter((l) => l.query.get('desde') === '2026-09-01');
    expect(delMes[0].query.get('hasta')).toBe(HOY);
    expect(delMes[0].query.get('pagina')).toBe('1');
    expect(ubicacion().searchParams.get('periodo')).toBe('mes');
    expect(ubicacion().searchParams.has('pagina')).toBe(false);
  });

  it('con otro filtro NUNCA se ven los tickets del anterior mientras llega la respuesta', async () => {
    const user = userEvent.setup();
    const todos = lista(120);
    let soltar: () => void = () => {};
    const pendiente = new Promise<void>((r) => (soltar = r));
    apiTickets(todos, {
      'GET /ventas/tickets': async (l) => {
        // El rango nuevo tarda: mientras tanto no puede verse la lista de "Hoy".
        if (l.query.get('desde') === '2026-09-01') await pendiente;
        return tickets(todos)(l);
      },
    });
    montar(`/tickets?empresa=${A}`);
    await screen.findByTestId('ticket-5000');

    await user.click(screen.getByRole('button', { name: 'Este mes' }));
    await waitFor(() => expect(screen.queryByTestId('ticket-5000')).toBeNull());
    expect(screen.getByTestId('esqueleto')).toBeInTheDocument();

    soltar();
    expect(await screen.findByTestId('ticket-5000')).toBeInTheDocument();
  });

  it('cambiar de sucursal vuelve a la página 1 SIN pedir la página vieja con el alcance nuevo', async () => {
    const user = userEvent.setup();
    const api = apiTickets(lista(300));
    montar(`/tickets?empresa=${A}&pagina=3`);
    await screen.findByTestId('ticket-4900');

    await user.selectOptions(screen.getByLabelText('Sucursal'), SUCURSAL_A2.id);
    // A2 tiene los impares: el más reciente es 4999.
    expect(await screen.findByTestId('ticket-4999')).toBeInTheDocument();
    expect(ubicacion().searchParams.has('pagina')).toBe(false);

    const deA2 = pedidas(api).filter((l) => l.query.get('sucursalId') === SUCURSAL_A2.id);
    expect(deA2.length).toBeGreaterThan(0);
    // La página 1 y, si acaso, la 2 de antemano; nunca la 3 del alcance anterior.
    expect(deA2.map((l) => l.query.get('pagina'))).not.toContain('3');
    expect(screen.queryByText('Esta página ya no tiene tickets.')).toBeNull();
  });
});

describe('Vista Tickets: export CSV', () => {
  const originales = { crear: URL.createObjectURL, revocar: URL.revokeObjectURL };
  afterEach(() => {
    URL.createObjectURL = originales.crear;
    URL.revokeObjectURL = originales.revocar;
    vi.restoreAllMocks();
  });

  function capturarDescarga() {
    const blobs: Blob[] = [];
    const nombres: string[] = [];
    URL.createObjectURL = (b: Blob | MediaSource) => {
      blobs.push(b as Blob);
      return 'blob:falso';
    };
    URL.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      nombres.push(this.download);
    });
    return { blobs, nombres, click };
  }

  it('exporta TODAS las páginas del filtro actual, con BOM, y sin sumar cancelados', async () => {
    const user = userEvent.setup();
    const todos = lista(230);
    todos[1] = { ...todos[1], cancelado: true };
    const api = apiTickets(todos);
    const { blobs, nombres, click } = capturarDescarga();
    montar(`/tickets?empresa=${A}&folio=4`);
    await screen.findByTestId('ticket-4999');

    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));

    expect(nombres).toEqual([`tickets_${HOY}_${HOY}.csv`]);
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(blobs[0].type).toBe('text/csv;charset=utf-8');

    const texto = new TextDecoder().decode(bytes.slice(3));
    const lineas = texto.replace(/\r\n$/, '').split('\r\n');
    const conFolio4 = todos.filter((t) => t.folio.startsWith('4'));
    expect(lineas).toHaveLength(1 + conFolio4.length); // encabezado + filas, sin totales
    expect(lineas[1].split(',')[1]).toBe(`"=""${conFolio4[0].folio}"""`);
    expect(lineas.filter((l) => l.endsWith(',Sí'))).toHaveLength(1);

    // El export pidió de 100 en 100 con el mismo filtro que la tabla.
    const delExport = pedidas(api).filter((l) => l.query.get('porPagina') === '100');
    expect(delExport.map((l) => l.query.get('pagina'))).toEqual(['1', '2', '3']);
    expect(delExport.every((l) => l.query.get('folio') === '4')).toBe(true);
  });

  it('si el export falla, lo dice y no descarga nada', async () => {
    const user = userEvent.setup();
    const { click } = capturarDescarga();
    apiTickets([ticket({ sucursalId: 'de-otra-lista' })]);
    montar(`/tickets?empresa=${A}`);
    await screen.findByTestId('ticket-1001');

    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudo exportar. El ticket 1001 es de una sucursal que no está en tu lista.',
    );
    expect(click).not.toHaveBeenCalled();
    // Y en la tabla esa fila dice "Sin dato" en vez de inventar una zona.
    expect(screen.getByTestId('ticket-1001')).toHaveTextContent('Sin dato');
  });
});
