import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { Profiler } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MesasSucursal } from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import { zonaDelPanel } from '../filtros/periodo';
import {
  EMPRESA_A,
  instalarApiFalsa,
  json,
  sesion,
  SUCURSAL_A1,
  SUCURSAL_A2,
  usuario,
} from '../test/apiFalsa';
import { nombreMesa } from './mesas/textos';

/**
 * F2-223, "Listo cuando": con 60 mesas abiertas la vista mantiene 60 fps al avanzar el
 * reloj, porque el contador no provoca repintados fuera de su propia tarjeta (lo mismo
 * que el badge de agentes de F1-094). jsdom no mide fotogramas: se mide el aislamiento
 * de renders, que es la causa.
 *
 * Contadores: `nombreMesa` se llama UNA vez por render de tarjeta, y `zonaDelPanel` sólo
 * en el cuerpo de `Mesas`. Los mocks delegan en la función real (no cambian nada); cada
 * test comprueba primero que engancharon (contador > 0), para que no den un verde vacío.
 */
vi.mock('./mesas/textos', async (original) => {
  const real = await original<typeof import('./mesas/textos')>();
  return { ...real, nombreMesa: vi.fn(real.nombreMesa) };
});
vi.mock('../filtros/periodo', async (original) => {
  const real = await original<typeof import('../filtros/periodo')>();
  return { ...real, zonaDelPanel: vi.fn(real.zonaDelPanel) };
});

const A = EMPRESA_A.id;
const AHORA = Date.parse('2026-09-21T03:30:00Z');
/** La lectura llegó 10 s antes de montar. */
const RECIBIDO = AHORA - 10_000;
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * 60 mesas con folio único, como el seed. Todas cruzan de minuto a los +30 s de AHORA
 * (abiertas `m` min y 30 s antes), salvo la mesa `unaCruzaEn`, si se da, que cruza de 15
 * a 16 min a ese instante (sin cruzar ningún umbral del semáforo).
 */
function sesentaMesas({
  unaCruzaEn,
  totalMesa5 = '150.00',
}: { unaCruzaEn?: number; totalMesa5?: string } = {}) {
  return Array.from({ length: 60 }, (_, i) => {
    const numero = String(i + 1);
    const minutos = 5 + ((i * 37) % 146);
    const abiertoAt =
      numero === '1' && unaCruzaEn !== undefined
        ? AHORA + unaCruzaEn - 16 * 60_000
        : AHORA + 30_000 - (minutos + 1) * 60_000;
    return {
      mesa: numero,
      mesero: `Mesero ${i % 6}`,
      folio: `SEED-VIVO-A${String(i + 1).padStart(3, '0')}`,
      abiertoAt: iso(abiertoAt),
      total: numero === '5' ? totalMesa5 : `${100 + i}.00`,
      comensales: 1 + (i % 6),
      impreso: i % 3 === 0,
      partidas: [{ producto: 'Guacamole', cantidad: '1', total: '95.00' }],
    };
  });
}

/** El snapshot de Centro con la edad que tendría AHORA de verdad (como el API). */
function centro(mesas: Record<string, unknown>[]): MesasSucursal {
  const edad = Math.max(0, Math.floor((Date.now() - RECIBIDO) / 1000));
  return {
    sucursalId: SUCURSAL_A1.id,
    nombre: 'Centro',
    zonaHoraria: 'America/Mexico_City',
    snapshot: {
      capturadoAt: iso(RECIBIDO),
      recibidoAt: iso(RECIBIDO),
      edadSegundos: edad,
      edadRecepcionSegundos: edad,
      mesas,
    },
  };
}

function montar(mesas: () => Record<string, unknown>[]) {
  const u = usuario('admin_empresa');
  const api = instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /mesas/abiertas': () => json(200, [centro(mesas())]),
  });
  const commits: string[] = [];
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  render(
    <MemoryRouter initialEntries={[`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`]}>
      <Proveedores queryClient={queryClient}>
        <Profiler id="app" onRender={(_, fase) => commits.push(fase)}>
          <Rutas />
        </Profiler>
      </Proveedores>
    </MemoryRouter>,
  );
  return { api, commits };
}

const tarjetas = vi.mocked(nombreMesa);
const vista = vi.mocked(zonaDelPanel);
const pedidas = (api: ReturnType<typeof montar>['api']) =>
  api.llamadas.filter((l) => l.ruta === '/mesas/abiertas');

/** Espera las 60 tarjetas y deja los contadores en cero (tras comprobar que enganchan). */
async function listo(api: ReturnType<typeof montar>['api'], commits: string[]) {
  await waitFor(() =>
    expect(screen.getAllByRole('button', { name: /^Ver consumo de Mesa/ })).toHaveLength(60),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(pedidas(api)).toHaveLength(1);
  expect(tarjetas.mock.calls.length).toBeGreaterThanOrEqual(60);
  expect(vista.mock.calls.length).toBeGreaterThan(0);
  tarjetas.mockClear();
  vista.mockClear();
  commits.length = 0;
}

async function pulso(ms = 5_000) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
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

describe('Monitor con 60 mesas: el reloj no repinta la vista (F2-223)', () => {
  it('tres pulsos sin que cambie ningún minuto: ningún commit', async () => {
    const { api, commits } = montar(() => sesentaMesas());
    await listo(api, commits);

    for (let i = 0; i < 3; i++) await pulso();
    expect(pedidas(api)).toHaveLength(1);
    expect(commits).toEqual([]);
    expect(tarjetas).not.toHaveBeenCalled();
    expect(vista).not.toHaveBeenCalled();
  });

  it('cuando UNA mesa cruza de minuto, sólo su tarjeta se vuelve a pintar', async () => {
    // La mesa 1 pasa de 15 a 16 min a los +8 s: en el segundo pulso.
    const { api, commits } = montar(() => sesentaMesas({ unaCruzaEn: 8_000 }));
    await listo(api, commits);
    const uno = screen.getByRole('listitem', { name: 'Mesa 1' });
    expect(within(uno).getByTestId('mesa-minutos')).toHaveTextContent('15 min');

    await pulso();
    expect(commits).toEqual([]);

    await pulso();
    expect(within(uno).getByTestId('mesa-minutos')).toHaveTextContent('16 min');
    expect(commits).toHaveLength(1);
    expect(tarjetas).toHaveBeenCalledTimes(1);
    expect(tarjetas.mock.calls[0][0].mesa).toBe('1');
    expect(vista).not.toHaveBeenCalled();
    expect(pedidas(api)).toHaveLength(1);
  });

  it('un poll con los mismos datos no vuelve a pintar ninguna tarjeta', async () => {
    const { api, commits } = montar(() => sesentaMesas());
    await listo(api, commits);

    // A los 20 s llega el poll (la edad ya avanzó 20 s, en segundos enteros).
    await pulso(21_000);
    await waitFor(() => expect(pedidas(api)).toHaveLength(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    // La vista sí se pinta (el poll cambia "Actualizando…"): el contador engancha.
    expect(vista).toHaveBeenCalled();
    expect(tarjetas).not.toHaveBeenCalled();
  });

  it('un poll que cambia UNA mesa pinta sólo esa tarjeta', async () => {
    let total = '150.00';
    const { api, commits } = montar(() => sesentaMesas({ totalMesa5: total }));
    await listo(api, commits);
    const cinco = screen.getByRole('listitem', { name: 'Mesa 5' });
    expect(within(cinco).getByTestId('mesa-total')).toHaveTextContent('$150.00');

    total = '275.50';
    await pulso(21_000);
    await waitFor(() =>
      expect(within(cinco).getByTestId('mesa-total')).toHaveTextContent('$275.50'),
    );
    expect(tarjetas).toHaveBeenCalledTimes(1);
    expect(tarjetas.mock.calls[0][0].mesa).toBe('5');
  });
});
