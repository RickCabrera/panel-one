import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EstadoAgenteSucursal, Rol } from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import {
  EMPRESA_A,
  EMPRESA_B,
  instalarApiFalsa,
  json,
  sesion,
  SUCURSAL_A1,
  SUCURSAL_A2,
  usuario,
  type Manejador,
} from '../test/apiFalsa';

// Estado de agentes (F1-061) contra una API falsa: la pestaña de Administración y
// el badge del sidebar. Las edades y el alcance los garantiza la API (e2e de /api);
// aquí se prueba que la vista las ENVEJECE sola (el agente caído se ve sin esperar
// otra respuesta buena) y que el badge sólo se prende cuando toca.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-21T18:00:00Z');

function fila(
  sucursal: { id: string; nombre: string; zonaHoraria: string },
  edadContactoSegundos: number | null,
  extra: Partial<EstadoAgenteSucursal> = {},
): EstadoAgenteSucursal {
  const nunca = edadContactoSegundos === null;
  return {
    sucursalId: sucursal.id,
    nombre: sucursal.nombre,
    zonaHoraria: sucursal.zonaHoraria,
    ultimoContactoAt: nunca
      ? null
      : new Date(AHORA.getTime() - edadContactoSegundos * 1000).toISOString(),
    edadContactoSegundos,
    ultimaLecturaAt: null,
    edadLecturaSegundos: null,
    versionAgente: nunca ? null : '0.1.0',
    versionSr: nunca ? null : '10.0',
    tamanoCola: nunca ? null : 0,
    ultimoError: null,
    ...extra,
  };
}

function apiAgentes(rol: Rol, estado: Manejador) {
  const yo = usuario(rol);
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(yo)),
    'GET /empresas': () => json(200, rol === 'admin_global' ? [EMPRESA_A, EMPRESA_B] : [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /usuarios': () => json(200, []),
    'GET /agentes/estado': estado,
  });
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
      </Proveedores>
    </MemoryRouter>,
  );
}

const estadoDe = (nombre: string) =>
  within(screen.getByRole('row', { name: nombre })).getByTestId('estado-agente');
const pedidas = (api: ReturnType<typeof apiAgentes>) =>
  api.llamadas.filter((l) => l.ruta === '/agentes/estado');

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

describe('Administración › Agentes: la tabla', () => {
  it('una fila por sucursal con estado, reporte, lectura, versiones, cola y error', async () => {
    const api = apiAgentes('admin_empresa', () =>
      json(200, [
        fila(SUCURSAL_A1, 10, {
          ultimaLecturaAt: '2026-09-21T17:15:00Z',
          edadLecturaSegundos: 45 * 60,
          ultimoError: 'no conecta a SQL Server (sintético)',
          tamanoCola: 7,
          versionAgente: '0.3.0',
          versionSr: '11.2',
        }),
        fila(SUCURSAL_A2, 91),
        fila({ id: 'nueva', nombre: 'Nueva', zonaHoraria: 'America/Mexico_City' }, null),
      ]),
    );
    montar(`/admin?empresa=${A}&tab=agentes`);

    const centro = await screen.findByRole('row', { name: 'Centro' });
    expect(estadoDe('Centro')).toHaveTextContent('Conectado');
    // Reporte y lectura en la zona de la sucursal (Centro: UTC-6).
    expect(centro).toHaveTextContent('hace menos de 1 min (11:59)');
    expect(centro).toHaveTextContent('hace 45 min (11:15)');
    expect(centro).toHaveTextContent('0.3.0');
    expect(centro).toHaveTextContent('11.2');
    expect(centro).toHaveTextContent('7');
    expect(within(centro).getByTitle('no conecta a SQL Server (sintético)')).toBeInTheDocument();

    expect(estadoDe('Tijuana')).toHaveTextContent('Desconectado');
    // Tijuana en septiembre es UTC-7: 17:58:29 UTC → 10:58.
    expect(screen.getByRole('row', { name: 'Tijuana' })).toHaveTextContent('hace 1 min (10:58)');

    expect(estadoDe('Nueva')).toHaveTextContent('Sin reporte');
    const nueva = screen.getByRole('row', { name: 'Nueva' });
    expect(within(nueva).getAllByText('Sin dato')).toHaveLength(5);
    expect(pedidas(api)[0].query.get('empresaId')).toBe(A);
  });

  it('pestaña Agentes para admin_empresa y admin_global', async () => {
    apiAgentes('admin_empresa', () => json(200, []));
    montar(`/admin?empresa=${A}`);
    await screen.findByRole('tab', { name: 'Agentes' });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Sucursales',
      'Usuarios',
      'Agentes',
    ]);
    await userEvent.click(screen.getByRole('tab', { name: 'Agentes' }));
    expect(await screen.findByText('Esta empresa no tiene sucursales activas.')).toBeVisible();
    cleanup();

    apiAgentes('admin_global', () => json(200, []));
    montar(`/admin?empresa=${A}`);
    await screen.findByRole('tab', { name: 'Agentes' });
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual([
      'Sucursales',
      'Usuarios',
      'Agentes',
      'Empresas',
    ]);
  });

  it('se consulta cada 20 s', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    const api = apiAgentes('admin_empresa', () => json(200, [fila(SUCURSAL_A1, 5)]));
    montar(`/admin?empresa=${A}&tab=agentes`);
    await screen.findByRole('row', { name: 'Centro' });
    const antes = pedidas(api).length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await waitFor(() => expect(pedidas(api).length).toBeGreaterThan(antes));
  });

  it('lógica de frescura: pasa sola a "Desconectado" al cruzar 90 s desde el último contacto, sin respuesta buena nueva', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    let caido = false;
    apiAgentes('admin_empresa', () =>
      caido
        ? json(503, { statusCode: 503, message: 'Service Unavailable' })
        : json(200, [fila(SUCURSAL_A1, 40)]),
    );
    montar(`/admin?empresa=${A}&tab=agentes`);
    await screen.findByRole('row', { name: 'Centro' });
    expect(estadoDe('Centro')).toHaveAttribute('data-estado', 'conectado');

    caido = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    // 40 + 45 = 85 s: todavía conectado, pero avisa que no pudo actualizar. Los
    // refetch fallidos NO rejuvenecen el dato.
    await waitFor(() => expect(screen.getByText(/No se pudo actualizar/)).toBeInTheDocument());
    expect(estadoDe('Centro')).toHaveAttribute('data-estado', 'conectado');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    // 40 + 55 = 95 s > 90 s: cruzó el umbral a los 50 s de la última respuesta buena.
    await waitFor(() => expect(estadoDe('Centro')).toHaveAttribute('data-estado', 'desconectado'));
  });
});

describe('Sidebar: badge de sucursales sin reportar', () => {
  it('con una sucursal a 601 s sale el badge; enlaza a la pestaña Agentes con el alcance', async () => {
    apiAgentes('admin_empresa', () => json(200, [fila(SUCURSAL_A1, 601), fila(SUCURSAL_A2, 5)]));
    montar(`/?empresa=${A}`);

    const badge = await screen.findByRole('link', {
      name: '1 sucursal lleva más de 10 min sin reportar',
    });
    expect(badge).toHaveTextContent('1');
    const destino = new URL(badge.getAttribute('href') ?? '', 'http://x');
    expect(destino.pathname).toBe('/admin');
    expect(destino.searchParams.get('empresa')).toBe(A);
    expect(destino.searchParams.get('tab')).toBe('agentes');

    await userEvent.click(badge);
    expect(await screen.findByRole('tab', { name: 'Agentes' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByRole('row', { name: 'Centro' })).toBeInTheDocument();
  });

  it('a 600 s, o si la sucursal nunca reportó, NO sale el badge', async () => {
    const api = apiAgentes('admin_global', () =>
      json(200, [
        fila(SUCURSAL_A1, 600),
        fila({ id: 'nueva', nombre: 'Nueva', zonaHoraria: 'America/Mexico_City' }, null),
      ]),
    );
    montar(`/admin?empresa=${A}&tab=agentes`);
    await screen.findByRole('row', { name: 'Nueva' });
    await waitFor(() => expect(pedidas(api).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('alerta-agentes')).not.toBeInTheDocument();
  });

  it('se prende solo al envejecer: 590 s y el API caído → badge sin respuesta buena nueva', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    let caido = false;
    const api = apiAgentes('admin_empresa', () =>
      caido
        ? json(503, { statusCode: 503, message: 'Service Unavailable' })
        : json(200, [fila(SUCURSAL_A1, 590)]),
    );
    montar(`/?empresa=${A}`);
    await waitFor(() => expect(pedidas(api)).toHaveLength(1));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    caido = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    // 590 + ~5 s: todavía no.
    expect(screen.queryByTestId('alerta-agentes')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    // 590 + ~25 s > 600 s, y el refetch fallido de los 20 s no lo apagó.
    await waitFor(() => expect(screen.getByTestId('alerta-agentes')).toHaveTextContent('1'));
  });

  it('un visor no ve el badge ni pide /agentes/estado', async () => {
    const api = apiAgentes('visor', () => json(200, [fila(SUCURSAL_A1, 3600)]));
    montar(`/?empresa=${A}`);
    await screen.findByRole('link', { name: 'Inicio' });
    await waitFor(() => expect(api.contar('GET', '/empresas')).toBeGreaterThan(0));
    expect(pedidas(api)).toHaveLength(0);
    expect(screen.queryByTestId('alerta-agentes')).not.toBeInTheDocument();
  });
});
