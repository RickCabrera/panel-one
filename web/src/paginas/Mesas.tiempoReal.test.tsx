import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MesasSucursal } from '../api/tipos';
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
} from '../test/apiFalsa';
import { sockets } from '../test/socketFalso';

// F2-142 sobre la vista REAL del Monitor (rutas, proveedores, consultas) con el socket falso
// de `test-setup.ts`: un aviso de ingesta se ve en pantalla en < 5 s, y si el socket cae la
// vista sigue con sus datos y sólo cambia el indicador ("en vivo" → "cada 20 s").

const A = EMPRESA_A.id;
const AHORA = Date.parse('2026-09-21T03:30:00Z');
const hace = (segundos: number) => new Date(AHORA - segundos * 1000).toISOString();

function centro(mesas: string[]): MesasSucursal {
  return {
    sucursalId: SUCURSAL_A1.id,
    nombre: 'Centro',
    zonaHoraria: 'America/Mexico_City',
    snapshot: {
      capturadoAt: hace(10),
      recibidoAt: hace(10),
      edadSegundos: 10,
      edadRecepcionSegundos: 10,
      mesas: mesas.map((numero) => ({
        mesa: numero,
        mesero: 'Mesero sintético',
        folio: `F-${numero}`,
        abiertoAt: hace(600),
        total: '100.00',
        comensales: 2,
        impreso: false,
        partidas: [],
      })),
    },
  };
}

function montar(mesasDe: () => MesasSucursal[]) {
  const u = usuario('admin_empresa');
  const api = instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /mesas/abiertas': () => json(200, mesasDe()),
  });
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  render(
    <MemoryRouter initialEntries={[`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
      </Proveedores>
    </MemoryRouter>,
  );
  return {
    pedidas: () => api.llamadas.filter((l) => l.ruta === '/mesas/abiertas').length,
  };
}

/** Todos los sockets abiertos por la vista (la cabecera y el Monitor comparten alcance). */
function vivos() {
  return sockets.filter((s) => s.conexiones > s.desconexiones || s.active);
}

async function conectarTodo() {
  await act(async () => {
    for (const s of vivos()) s.simularConexion();
    await Promise.resolve();
  });
}

const indicador = () => screen.getByTestId('consultado');

beforeEach(() => {
  sockets.length = 0;
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
  vi.setSystemTime(AHORA);
});

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('Monitor de mesas en tiempo real (F2-142)', () => {
  it('sin socket: "cada 20 s", como siempre', async () => {
    montar(() => [centro(['1'])]);
    await screen.findByRole('listitem', { name: 'Mesa 1' });
    expect(indicador()).toHaveAttribute('data-modo', 'polling');
    expect(indicador()).toHaveTextContent('cada 20 s');
  });

  it('un aviso de ingesta se ve en pantalla en < 5 s; mientras está vivo no hay polling de 20 s', async () => {
    let mesas = ['1'];
    const vista = montar(() => [centro(mesas)]);
    await screen.findByRole('listitem', { name: 'Mesa 1' });
    expect(vivos().length).toBeGreaterThan(0);
    // El handshake lleva el access token de la sesión.
    expect(vivos()[0].tokenDelHandshake()).toEqual(expect.any(String));
    await conectarTodo();
    await waitFor(() => expect(indicador()).toHaveAttribute('data-modo', 'en-vivo'));
    expect(indicador()).toHaveTextContent('en vivo');
    expect(vivos()[0].emitidos[0]).toEqual({
      evento: 'suscribir',
      cuerpo: { empresaId: A, sucursalId: SUCURSAL_A1.id },
    });

    // Vivo: a los 20 s ya NO se consulta (el respaldo es de 60 s).
    const antes = vista.pedidas();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(vista.pedidas()).toBe(antes);

    mesas = ['1', '42'];
    const t0 = performance.now();
    act(() => {
      for (const s of vivos()) {
        s.recibir('ingesta', { sucursalId: SUCURSAL_A1.id, mesas: true, cheques: false });
      }
    });
    await screen.findByRole('listitem', { name: 'Mesa 42' }, { timeout: 5_000 });
    expect(performance.now() - t0).toBeLessThan(5_000);
  });

  it('matar el socket: los datos se quedan, el indicador pasa a "cada 20 s" y vuelve el polling', async () => {
    let mesas = ['1'];
    const vista = montar(() => [centro(mesas)]);
    await screen.findByRole('listitem', { name: 'Mesa 1' });
    await conectarTodo();
    await waitFor(() => expect(indicador()).toHaveAttribute('data-modo', 'en-vivo'));

    act(() => {
      for (const s of vivos()) s.simularCaida('transport close');
    });
    await waitFor(() => expect(indicador()).toHaveAttribute('data-modo', 'polling'));
    expect(indicador()).toHaveTextContent('cada 20 s');
    // Nada de skeletons ni vacío: la misma foto sigue en pantalla.
    expect(screen.getByRole('listitem', { name: 'Mesa 1' })).toBeInTheDocument();
    expect(screen.getByTestId('kpi-mesas')).toHaveTextContent('1');

    // Sin socket, lo nuevo llega por el polling de 20 s: no se pierde.
    mesas = ['1', '7'];
    const antes = vista.pedidas();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await waitFor(() => expect(vista.pedidas()).toBeGreaterThan(antes));
    expect(await screen.findByRole('listitem', { name: 'Mesa 7' })).toBeInTheDocument();
  });

  it('al volver el socket se relee de inmediato (lo que pasó mientras estuvo caído)', async () => {
    let mesas = ['1'];
    const vista = montar(() => [centro(mesas)]);
    await screen.findByRole('listitem', { name: 'Mesa 1' });
    await conectarTodo();
    await waitFor(() => expect(indicador()).toHaveAttribute('data-modo', 'en-vivo'));
    act(() => {
      for (const s of vivos()) s.simularCaida('transport close');
    });
    await waitFor(() => expect(indicador()).toHaveAttribute('data-modo', 'polling'));

    mesas = ['1', '9'];
    const antes = vista.pedidas();
    await conectarTodo();
    await screen.findByRole('listitem', { name: 'Mesa 9' });
    expect(vista.pedidas()).toBeGreaterThan(antes);
    expect(indicador()).toHaveAttribute('data-modo', 'en-vivo');
  });
});
