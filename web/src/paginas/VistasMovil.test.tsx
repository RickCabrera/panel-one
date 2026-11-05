import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  EstadoAgenteSucursal,
  ListaCortes,
  PaginaTickets,
  ResumenCorte,
  Ticket,
} from '../api/tipos';
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
import { anchoDePantalla } from '../test/matchMedia';
import { TEXTO_INCOMPLETO } from './cortes/reglas';
import { ticket } from './tickets/fixtures';

// UI-04: las vistas de celular (y de tableta) de Tickets y Turnos, y el aviso de agentes en la
// barra inferior. Datos sintéticos.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-21T03:30:00Z');

const TICKETS: Ticket[] = [
  ticket({ id: 't-1', folio: '5001', total: '300.00', mesa: '4', mesero: 'Ana' }),
  ticket({ id: 't-2', folio: '5002', total: '845.50', cancelado: true, mesa: '9' }),
];

const T8: ResumenCorte = {
  id: 'c0000000-0000-4000-8000-000000000008',
  sucursalId: SUCURSAL_A1.id,
  sucursal: 'Centro',
  zonaHoraria: 'America/Mexico_City',
  turnoSr: '8',
  aperturaAt: '2026-09-20T20:06:00.000Z',
  cierreAt: null,
  abierto: true,
  estacion: 'CAJA1',
  fondo: '300.00',
  venta: '108.00',
  cuentas: 1,
  ticketPromedio: '108.00',
  posiblementeIncompleto: false,
};
const T7: ResumenCorte = {
  ...T8,
  id: 'c0000000-0000-4000-8000-000000000007',
  turnoSr: '7',
  aperturaAt: '2026-09-19T15:00:00.000Z',
  cierreAt: '2026-09-20T20:05:00.000Z',
  abierto: false,
  venta: '415.50',
  cuentas: 2,
  ticketPromedio: '207.75',
  posiblementeIncompleto: true,
};

function api(rol: 'visor' | 'admin_empresa' = 'visor', extra: Record<string, Manejador> = {}) {
  const u = usuario(rol);
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /ventas/tickets': (l: Llamada) => {
      const cuerpo: PaginaTickets = {
        items: TICKETS,
        total: TICKETS.length,
        pagina: Number(l.query.get('pagina')),
        porPagina: Number(l.query.get('porPagina')),
        corte: '2026-09-21T03:29:30.000Z',
      };
      return json(200, cuerpo);
    },
    'GET /cortes': () => json(200, { cortes: [T8, T7], truncado: false } satisfies ListaCortes),
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
const descripcion = (el: HTMLElement) =>
  document.getElementById(el.getAttribute('aria-describedby') ?? '')?.textContent ?? '';

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  terminarSesion('cerrada');
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('UI-04 · Tickets a 390 px', () => {
  it('una tarjeta por ticket: el botón dice qué hace y describe hora, total y mesa', async () => {
    anchoDePantalla(390);
    api();
    montar(`/tickets?empresa=${A}`);

    const boton = await screen.findByRole('button', { name: 'Ver detalle del folio 5001' });
    // Sin tabla en el celular.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const texto = descripcion(boton);
    expect(texto).toContain('$300.00');
    expect(texto).toContain('Mesa 4');
    expect(texto).toContain('Ana');
    expect(texto).toMatch(/20\/09\/2026 21:30/);

    await userEvent.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region', { name: 'Detalle del folio 5001' })).toBeInTheDocument();
  });

  it('el cancelado lo dice con palabras y su total va tachado', async () => {
    anchoDePantalla(390);
    api();
    montar(`/tickets?empresa=${A}`);

    const tarjeta = await screen.findByTestId('ticket-5002');
    expect(within(tarjeta).getByText('Cancelado')).toBeInTheDocument();
    const total = within(tarjeta).getByTestId('ticket-total');
    expect(total).toHaveTextContent('$845.50');
    expect(total).toHaveClass('line-through');
    expect(within(screen.getByTestId('ticket-5001')).getByTestId('ticket-total')).not.toHaveClass(
      'line-through',
    );
    expect(
      descripcion(screen.getByRole('button', { name: 'Ver detalle del folio 5002' })),
    ).toContain('Cancelado');
  });

  it('el orden: el selector cambia la columna y el botón el sentido, en la URL', async () => {
    anchoDePantalla(390);
    api();
    montar(`/tickets?empresa=${A}`);
    await screen.findByTestId('ticket-5001');
    const evt = userEvent.setup();

    await evt.selectOptions(screen.getByRole('combobox', { name: 'Ordenar por' }), 'total');
    await waitFor(() => expect(ubicacion().searchParams.get('orden')).toBe('total'));
    expect(ubicacion().searchParams.get('dir')).toBe('desc');

    await evt.click(
      screen.getByRole('button', { name: 'Orden descendente; cambiar a ascendente' }),
    );
    await waitFor(() => expect(ubicacion().searchParams.get('dir')).toBe('asc'));
    expect(
      screen.getByRole('button', { name: 'Orden ascendente; cambiar a descendente' }),
    ).toBeInTheDocument();
  });

  it('los filtros se pliegan: abrir, aplicar cierra, y el botón cuenta los activos', async () => {
    anchoDePantalla(390);
    api();
    montar(`/tickets?empresa=${A}`);
    await screen.findByTestId('ticket-5001');
    const evt = userEvent.setup();

    const boton = screen.getByRole('button', { name: /^Filtros/ });
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('filtros-tickets')).not.toBeVisible();

    await evt.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');
    expect(document.getElementById('filtros-tickets')).toBeVisible();
    await evt.type(screen.getByLabelText('Mesa'), '9');
    await evt.click(screen.getByRole('button', { name: 'Aplicar filtros' }));

    await waitFor(() => expect(ubicacion().searchParams.get('mesa')).toBe('9'));
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    expect(boton).toHaveTextContent(/Filtros\s*1/);
  });

  it('en escritorio, la tabla de siempre sin botón de filtros', async () => {
    api();
    montar(`/tickets?empresa=${A}`);
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Filtros/ })).not.toBeInTheDocument();
  });
});

describe.each([
  ['celular', 390],
  ['tableta', 900],
])('UI-04 · Turnos en tarjetas (%s)', (_nombre, ancho) => {
  it('abierto e incompleto se ven y se leen; el cerrado dice cuándo cerró', async () => {
    anchoDePantalla(ancho);
    api();
    montar(`/turnos?empresa=${A}&periodo=hoy`);

    const filas = await screen.findAllByTestId('fila-corte');
    expect(filas).toHaveLength(2);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    const abierto = within(filas[0]).getByRole('button', { name: 'Turno 8 · CAJA1' });
    expect(within(filas[0]).getByTestId('corte-abierto')).toHaveTextContent('Abierto');
    expect(descripcion(abierto)).toContain('$108.00');
    expect(descripcion(abierto)).toContain('acumulado en curso');

    const cerrado = within(filas[1]).getByRole('button', { name: 'Turno 7 · CAJA1' });
    expect(within(filas[1]).queryByTestId('corte-abierto')).not.toBeInTheDocument();
    expect(within(filas[1]).getByTestId('corte-incompleto')).toBeInTheDocument();
    const texto = descripcion(cerrado);
    expect(texto).toContain('$415.50');
    expect(texto).toContain(TEXTO_INCOMPLETO);
    // Cierre en la zona de la sucursal (CDMX): 20-sep 14:05.
    expect(texto).toMatch(/cerró 20\/09\/2026 14:05/);
    expect(texto).toContain('Cuentas2');

    await userEvent.click(cerrado);
    expect(cerrado).toHaveAttribute('aria-pressed', 'true');
    expect(ubicacion().searchParams.get('turno')).toBe(T7.id);
  });
});

describe('UI-04 · aviso de agentes sin reportar en el celular (F1-061)', () => {
  const caida: EstadoAgenteSucursal = {
    sucursalId: SUCURSAL_A1.id,
    nombre: SUCURSAL_A1.nombre,
    zonaHoraria: SUCURSAL_A1.zonaHoraria,
    ultimoContactoAt: new Date(AHORA.getTime() - 700_000).toISOString(),
    edadContactoSegundos: 700,
    ultimaLecturaAt: null,
    edadLecturaSegundos: null,
    versionAgente: '0.1.0',
    versionSr: '10.0',
    tamanoCola: 0,
    latenciaQueryMs: 12,
    ultimoError: null,
    actualizacionAutomatica: false,
    versionObjetivo: null,
    actualizacion: null,
  };
  const TEXTO = '1 sucursal lleva más de 10 min sin reportar';

  it('admin: punto en «Más», descripción en palabras y conteo junto a Agentes', async () => {
    anchoDePantalla(390);
    const falsa = api('admin_empresa', { 'GET /agentes/estado': () => json(200, [caida]) });
    montar(`/?empresa=${A}`);

    const mas = await screen.findByRole('button', { name: 'Más' });
    expect(await screen.findByTestId('aviso-mas-agentes')).toBeInTheDocument();
    expect(mas).toHaveAccessibleDescription(TEXTO);
    expect(mas).toHaveAttribute('aria-controls', 'hoja-mas');
    expect(falsa.contar('GET', '/agentes/estado')).toBeGreaterThan(0);

    await userEvent.click(mas);
    const hoja = screen.getByRole('dialog', { name: 'Más' });
    expect(hoja).toHaveAttribute('id', 'hoja-mas');
    const agentes = within(hoja).getByRole('link', { name: 'Agentes' });
    expect(agentes).toHaveAccessibleDescription(TEXTO);
    expect(within(agentes).getByTestId('alerta-agentes')).toHaveTextContent('1');
  });

  it('admin con todo reportando: sin punto ni conteo', async () => {
    anchoDePantalla(390);
    api('admin_empresa');
    montar(`/?empresa=${A}`);
    const mas = await screen.findByRole('button', { name: 'Más' });
    await waitFor(() => expect(mas).toHaveAccessibleDescription(''));
    expect(screen.queryByTestId('aviso-mas-agentes')).not.toBeInTheDocument();
  });

  it('el visor no pide el estado de agentes ni ve aviso', async () => {
    anchoDePantalla(390);
    const falsa = api('visor', { 'GET /agentes/estado': () => json(200, [caida]) });
    montar(`/?empresa=${A}`);
    const mas = await screen.findByRole('button', { name: 'Más' });
    expect(mas).not.toHaveAttribute('aria-describedby');
    expect(screen.queryByTestId('aviso-mas-agentes')).not.toBeInTheDocument();
    expect(falsa.contar('GET', '/agentes/estado')).toBe(0);
  });
});
