import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  type Llamada,
  type Manejador,
} from '../test/apiFalsa';

const A = EMPRESA_A.id;

// 2026-09-21 03:30 UTC = 20-sep 21:30 en CDMX (la zona del panel con "Todas", porque
// Centro y Tijuana no comparten zona).
const AHORA = Date.parse('2026-09-21T03:30:00Z');
const hace = (segundos: number) => new Date(AHORA - segundos * 1000).toISOString();

/** Una cuenta abierta hace `min` minutos (la captura + su edad = AHORA). */
function mesa(numero: string, total: string, min: number, extra: Record<string, unknown> = {}) {
  return {
    mesa: numero,
    mesero: `Mesero de la ${numero}`,
    folio: `F-${numero}`,
    abiertoAt: hace(min * 60),
    total,
    comensales: 2,
    impreso: false,
    partidas: [{ producto: 'Guacamole', cantidad: '1' }],
    ...extra,
  };
}

const PARTIDAS_5 = [
  { producto: 'Tacos al pastor (orden)', cantidad: '2' },
  { producto: 'Arrachera', cantidad: '0.750' },
  { producto: 'Refresco', cantidad: 3 },
  { producto: 'Flan napolitano', cantidad: '1' },
  { producto: 'Café de olla', cantidad: '2' },
];

function centro(
  edad = 30,
  mesas = [
    mesa('12', '350.50', 15),
    mesa('3', '1200.00', 65, { impreso: true, partidas: PARTIDAS_5 }),
    mesa('7', '0.20', 40),
    mesa('10', '0.10', 39),
  ],
): MesasSucursal {
  return {
    sucursalId: SUCURSAL_A1.id,
    nombre: 'Centro',
    zonaHoraria: 'America/Mexico_City',
    snapshot: {
      capturadoAt: hace(edad),
      recibidoAt: hace(edad),
      edadSegundos: edad,
      edadRecepcionSegundos: edad,
      mesas,
    },
  };
}

function tijuana(edad: number | null): MesasSucursal {
  return {
    sucursalId: SUCURSAL_A2.id,
    nombre: 'Tijuana',
    zonaHoraria: 'America/Tijuana',
    snapshot:
      edad === null
        ? null
        : {
            capturadoAt: hace(edad),
            recibidoAt: hace(edad),
            edadSegundos: edad,
            edadRecepcionSegundos: edad,
            mesas: [mesa('99', '9999.00', 150)],
          },
  };
}

function apiMesas(mesas: Manejador) {
  const u = usuario('admin_empresa');
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /mesas/abiertas': mesas,
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

const kpi = (id: string) => screen.getByTestId(id);
const tarjetaMesa = (nombre: string) => screen.getByRole('listitem', { name: nombre });
const pedidas = (api: ReturnType<typeof apiMesas>) =>
  api.llamadas.filter((l) => l.ruta === '/mesas/abiertas');

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

describe('Monitor de mesas: KPIs y grid', () => {
  it('pinta las cifras de las mesas abiertas (calculadas a mano)', async () => {
    apiMesas(() => json(200, [centro(), tijuana(null)]));
    montar(`/mesas?empresa=${A}`);

    expect(await screen.findByTestId('kpi-mesas')).toHaveTextContent('4');
    // 350.50 + 1200.00 + 0.20 + 0.10
    expect(kpi('kpi-en-curso')).toHaveTextContent('$1,550.80');
    expect(kpi('kpi-sin-imprimir')).toHaveTextContent('3');
    expect(kpi('kpi-atencion')).toHaveTextContent('1');
    expect(screen.queryByTestId('kpi-sin-hora')).not.toBeInTheDocument();
    // Recibido 03:29:30 UTC = 21:29 en CDMX; 30 s = fresca (≤ 60 s).
    expect(kpi('kpi-lectura')).toHaveTextContent('21:29');
    expect(kpi('kpi-lectura')).toHaveAttribute('data-frescura', 'fresca');
    // Tijuana nunca reportó: se dice, y no entra en las cifras.
    expect(screen.getByTestId('banner-sin-reporte')).toHaveTextContent(
      'Tijuana: todavía no llegan datos del agente.',
    );
    expect(screen.getByRole('region', { name: 'Mesas abiertas' })).toHaveTextContent(
      'Sin contar: Tijuana.',
    );
  });

  it('cada tarjeta: número, total, mesero, minutos, semáforo y primeras 3 partidas', async () => {
    apiMesas(() => json(200, [centro(), tijuana(null)]));
    montar(`/mesas?empresa=${A}`);
    await screen.findByTestId('kpi-mesas');

    // Orden natural por número de mesa.
    const grid = screen.getByRole('list', { name: 'Mesas abiertas' });
    expect(
      within(grid)
        .getAllByRole('listitem')
        .filter((li) => li.parentElement === grid)
        .map((li) => li.getAttribute('aria-label')),
    ).toEqual(['Mesa 3 · Centro', 'Mesa 7 · Centro', 'Mesa 10 · Centro', 'Mesa 12 · Centro']);

    const tres = tarjetaMesa('Mesa 3 · Centro');
    expect(tres).toHaveAttribute('data-semaforo', 'rojo');
    expect(tres).toHaveClass('border-red-600');
    expect(within(tres).getByTestId('mesa-total')).toHaveTextContent('$1,200.00');
    expect(within(tres).getByTestId('mesa-minutos')).toHaveTextContent('65 min');
    expect(tres).toHaveTextContent('Mesero de la 3');
    expect(tres).toHaveTextContent('2 × Tacos al pastor (orden)');
    expect(tres).toHaveTextContent('0.75 × Arrachera');
    expect(tres).toHaveTextContent('3 × Refresco');
    expect(tres).not.toHaveTextContent('Flan napolitano');
    expect(tres).toHaveTextContent('2 partidas más');

    expect(tarjetaMesa('Mesa 7 · Centro')).toHaveAttribute('data-semaforo', 'alerta');
    expect(tarjetaMesa('Mesa 10 · Centro')).toHaveAttribute('data-semaforo', 'ok');
    expect(tarjetaMesa('Mesa 12 · Centro')).toHaveAttribute('data-semaforo', 'ok');
    expect(tarjetaMesa('Mesa 12 · Centro')).not.toHaveTextContent('partidas más');
  });

  it('con una sucursal elegida, las tarjetas no repiten el nombre de la sucursal', async () => {
    apiMesas((l: Llamada) => {
      expect(l.query.get('sucursalId')).toBe(SUCURSAL_A1.id);
      return json(200, [centro()]);
    });
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    await screen.findByTestId('kpi-mesas');
    expect(tarjetaMesa('Mesa 3')).toBeInTheDocument();
  });

  it('un total ilegible: la tarjeta y el KPI dicen "Sin dato", nunca $0.00', async () => {
    apiMesas(() =>
      json(200, [centro(30, [mesa('1', '100.00', 5), mesa('2', 'cien', 5, { impreso: 'sí' })])]),
    );
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    expect(await screen.findByTestId('kpi-en-curso')).toHaveTextContent('Sin dato');
    expect(kpi('kpi-sin-imprimir')).toHaveTextContent('Sin dato');
    expect(within(tarjetaMesa('Mesa 2')).getByTestId('mesa-total')).toHaveTextContent('Sin dato');
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('una mesa sin hora de apertura se reporta aparte', async () => {
    apiMesas(() =>
      json(200, [centro(30, [mesa('1', '1.00', 70), mesa('2', '1.00', 5, { abiertoAt: null })])]),
    );
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    expect(await screen.findByTestId('kpi-atencion')).toHaveTextContent('1');
    expect(kpi('kpi-sin-hora')).toHaveTextContent('1 mesa sin hora de apertura legible.');
    expect(within(tarjetaMesa('Mesa 2')).getByTestId('mesa-minutos')).toHaveTextContent(
      'Tiempo: sin dato',
    );
  });

  it('sin mesas abiertas lo dice', async () => {
    apiMesas(() => json(200, [centro(30, [])]));
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    expect(await screen.findByText('No hay mesas abiertas.')).toBeInTheDocument();
    expect(kpi('kpi-mesas')).toHaveTextContent('0');
  });
});

describe('Monitor de mesas: sucursal desconectada', () => {
  it('un snapshot de hace 2 h: banner en lugar de sus mesas, y no suma', async () => {
    apiMesas(() => json(200, [centro(), tijuana(7200)]));
    montar(`/mesas?empresa=${A}`);

    const banner = await screen.findByTestId('banner-desconectada');
    // Recibido 01:30 UTC = 19:30 en CDMX.
    expect(banner).toHaveTextContent(
      'Tijuana: sucursal desconectada. Última lectura hace 2 h (19:30). Sus mesas no se muestran',
    );
    expect(screen.queryByRole('listitem', { name: 'Mesa 99 · Tijuana' })).not.toBeInTheDocument();
    expect(screen.queryByText('$9,999.00')).not.toBeInTheDocument();
    expect(kpi('kpi-mesas')).toHaveTextContent('4');
    expect(kpi('kpi-en-curso')).toHaveTextContent('$1,550.80');
    // La última lectura muestra la más vieja, en rojo.
    expect(kpi('kpi-lectura')).toHaveTextContent('19:30');
    expect(kpi('kpi-lectura')).toHaveAttribute('data-frescura', 'desconectada');
  });

  it('si la única sucursal está desconectada no hay KPIs en cero, sólo el aviso', async () => {
    apiMesas(() => json(200, [tijuana(7200)]));
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A2.id}`);
    expect(await screen.findByTestId('banner-desconectada')).toBeInTheDocument();
    expect(screen.getByText('No hay datos en vivo que mostrar.')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-mesas')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Mesas abiertas' })).not.toBeInTheDocument();
  });

  it('91 s ya es desconectada; 90 s no', async () => {
    apiMesas(() => json(200, [centro(90), tijuana(91)]));
    montar(`/mesas?empresa=${A}`);
    const banner = await screen.findByTestId('banner-desconectada');
    expect(banner).toHaveTextContent('Tijuana');
    expect(screen.getAllByTestId('banner-desconectada')).toHaveLength(1);
    expect(kpi('kpi-lectura')).toHaveAttribute('data-frescura', 'desconectada');
    expect(kpi('kpi-mesas')).toHaveTextContent('4');
  });
});

describe('Monitor de mesas: polling y datos viejos', () => {
  it('se consulta cada 20 s', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    const api = apiMesas(() => json(200, [centro()]));
    montar(`/mesas?empresa=${A}`);
    await screen.findByTestId('kpi-mesas');
    expect(pedidas(api)).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await waitFor(() => expect(pedidas(api)).toHaveLength(2));
  });

  it('si el API deja de contestar, al pasar el umbral sale el banner (no la última foto como viva)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    let caido = false;
    apiMesas(() =>
      caido
        ? json(503, { statusCode: 503, message: 'Service Unavailable' })
        : json(200, [centro(10)]),
    );
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    await screen.findByTestId('kpi-mesas');
    expect(screen.queryByTestId('banner-desconectada')).not.toBeInTheDocument();

    caido = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    // 10 + 40 s: todavía conectada, pero ya se avisa que no se pudo actualizar.
    await waitFor(() => expect(screen.getByTestId('sin-actualizar')).toBeInTheDocument());
    expect(screen.queryByTestId('banner-desconectada')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    // 10 + 85 s > 90 s: la vista envejece sola la última respuesta.
    await waitFor(() => expect(screen.getByTestId('banner-desconectada')).toBeInTheDocument());
    expect(screen.queryByRole('listitem', { name: 'Mesa 3' })).not.toBeInTheDocument();
  });

  it('cambiar de sucursal muestra skeletons, nunca las mesas del alcance anterior', async () => {
    let soltar: (() => void) | undefined;
    const api = apiMesas((l: Llamada) => {
      if (l.query.get('sucursalId') !== SUCURSAL_A2.id) return json(200, [centro()]);
      return new Promise<Response>((resolver) => {
        soltar = () =>
          resolver(
            json(200, [
              {
                ...tijuana(20),
                snapshot: { ...tijuana(20).snapshot!, mesas: [mesa('50', '5.00', 5)] },
              },
            ]),
          );
      });
    });
    const usuarioEvt = userEvent.setup();
    montar(`/mesas?empresa=${A}`);
    await screen.findByTestId('kpi-mesas');
    expect(tarjetaMesa('Mesa 3 · Centro')).toBeInTheDocument();

    const selector = screen.getByLabelText('Sucursal');
    await waitFor(() => expect(selector).toBeEnabled());
    await usuarioEvt.selectOptions(selector, SUCURSAL_A2.id);

    await waitFor(() => expect(pedidas(api).at(-1)?.query.get('sucursalId')).toBe(SUCURSAL_A2.id));
    expect(screen.getAllByTestId('esqueleto').length).toBeGreaterThan(0);
    expect(screen.queryByRole('listitem', { name: /Mesa 3/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('kpi-mesas')).not.toBeInTheDocument();

    await act(async () => soltar!());
    expect(await screen.findByRole('listitem', { name: 'Mesa 50' })).toBeInTheDocument();
  });
});
