import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
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
  type Manejador,
} from '../test/apiFalsa';

// F2-223: la vista de pared del Monitor de mesas (`/mesas/pared`).

const A = EMPRESA_A.id;
const AHORA = Date.parse('2026-09-21T03:30:00Z');
const hace = (segundos: number) => new Date(AHORA - segundos * 1000).toISOString();

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

function sucursal(
  s: typeof SUCURSAL_A1,
  edad: number | null,
  mesas: Record<string, unknown>[] = [],
): MesasSucursal {
  return {
    sucursalId: s.id,
    nombre: s.nombre,
    zonaHoraria: s.zonaHoraria,
    snapshot:
      edad === null
        ? null
        : {
            capturadoAt: hace(edad),
            recibidoAt: hace(edad),
            edadSegundos: edad,
            edadRecepcionSegundos: edad,
            mesas,
          },
  };
}

const CENTRO = [
  mesa('12', '350.50', 15),
  mesa('3', '1200.00', 65, { impreso: true }),
  mesa('7', '0.20', 40),
  mesa('10', '0.10', 39),
];

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

const pedidas = (api: ReturnType<typeof apiMesas>) =>
  api.llamadas.filter((l) => l.ruta === '/mesas/abiertas');

/**
 * "Se lee a 2 m" como criterio tipográfico: la raíz fija `text-2xl` y NADA adentro lo
 * reduce a un tamaño menor (xs, sm, base, lg, xl).
 */
function sinTextoChico(raiz: HTMLElement) {
  expect(raiz).toHaveClass('text-2xl');
  const chicos = [raiz, ...raiz.querySelectorAll<HTMLElement>('*')].filter((el) =>
    /(^|\s)text-(xs|sm|base|lg|xl)(\s|$)/.test(el.getAttribute('class') ?? ''),
  );
  expect(chicos.map((el) => el.outerHTML.slice(0, 80))).toEqual([]);
}

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

describe('Vista de pared (F2-223)', () => {
  it('sin menú ni cabecera, con las mesas del alcance de la URL', async () => {
    const api = apiMesas(() => json(200, [sucursal(SUCURSAL_A1, 30, CENTRO)]));
    montar(`/mesas/pared?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);

    const pared = await screen.findByTestId('vista-pared');
    await waitFor(() => expect(within(pared).getByTestId('kpi-mesas')).toHaveTextContent('4'));
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Monitor de Mesas' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Mesas · Centro');
    expect(within(pared).getByTestId('kpi-atencion')).toHaveTextContent('1');
    expect(within(pared).getByTestId('kpi-sin-imprimir')).toHaveTextContent('3');

    // El alcance de la URL viaja tal cual a la consulta.
    const q = pedidas(api)[0].query;
    expect(q.get('empresaId')).toBe(A);
    expect(q.get('sucursalId')).toBe(SUCURSAL_A1.id);
    // Sin detalle: en la pared no hay nada que abrir.
    expect(screen.queryByRole('button', { name: /Ver consumo/ })).not.toBeInTheDocument();
  });

  it('sin empresa en la URL se normaliza a la primera, igual que dentro del panel', async () => {
    const api = apiMesas(() => json(200, [sucursal(SUCURSAL_A1, 30, CENTRO)]));
    montar('/mesas/pared');
    await waitFor(() => expect(pedidas(api)).not.toHaveLength(0));
    expect(pedidas(api)[0].query.get('empresaId')).toBe(A);
    expect(pedidas(api)[0].query.get('sucursalId')).toBeNull();
    expect(await screen.findByRole('heading', { level: 1 })).toHaveTextContent(
      'Mesas · Todas las sucursales',
    );
  });

  it('respeta orden y filtro de la URL, y "Salir" vuelve con ellos', async () => {
    apiMesas(() => json(200, [sucursal(SUCURSAL_A1, 30, CENTRO)]));
    montar(
      `/mesas/pared?empresa=${A}&sucursal=${SUCURSAL_A1.id}&orden=importe&estado=sin-imprimir`,
    );
    const grid = await screen.findByRole('list', { name: 'Mesas abiertas' });
    expect(
      within(grid)
        .getAllByRole('listitem')
        .map((li) => li.getAttribute('aria-label')),
    ).toEqual(['Mesa 12', 'Mesa 7', 'Mesa 10']);

    const salir = screen.getByRole('link', { name: 'Salir' });
    const destino = new URL(salir.getAttribute('href')!, 'http://x');
    expect(destino.pathname).toBe('/mesas');
    expect(destino.searchParams.get('sucursal')).toBe(SUCURSAL_A1.id);
    expect(destino.searchParams.get('orden')).toBe('importe');
    expect(destino.searchParams.get('estado')).toBe('sin-imprimir');
  });

  it('tipografía grande: número y minutos enormes, y nada por debajo de text-2xl', async () => {
    apiMesas(() =>
      json(200, [
        sucursal(SUCURSAL_A1, 30, CENTRO),
        sucursal(SUCURSAL_A2, 7200, [mesa('1', '1', 1)]),
      ]),
    );
    montar(`/mesas/pared?empresa=${A}`);
    const tarjeta = await screen.findByRole('listitem', { name: 'Mesa 3 · Centro' });
    expect(within(tarjeta).getByRole('heading', { name: '3' })).toHaveClass('text-5xl');
    expect(within(tarjeta).getByTestId('mesa-minutos')).toHaveClass('text-4xl');
    expect(within(tarjeta).getByTestId('mesa-minutos')).toHaveTextContent('65 min');
    expect(within(tarjeta).getByTestId('mesa-total')).toHaveClass('text-3xl');
    expect(tarjeta).toHaveAttribute('data-semaforo', 'rojo');
    // El aviso de la desconectada también entra en la regla.
    expect(screen.getByTestId('banner-desconectada')).toHaveTextContent(
      'Tijuana: sucursal desconectada.',
    );
    sinTextoChico(screen.getByTestId('vista-pared'));
  });

  it('con todas las sucursales desconectadas dice por qué, sin KPIs en cero', async () => {
    apiMesas(() => json(200, [sucursal(SUCURSAL_A1, 7200, CENTRO), sucursal(SUCURSAL_A2, null)]));
    montar(`/mesas/pared?empresa=${A}`);
    expect(await screen.findByTestId('sin-vivo')).toHaveTextContent(
      'Ninguna sucursal está reportando en vivo: sus mesas aparecen cuando su agente vuelva a mandar lectura.',
    );
    expect(screen.getByTestId('banner-desconectada')).toHaveTextContent('Centro');
    expect(screen.getByTestId('banner-sin-reporte')).toHaveTextContent('Tijuana');
    expect(screen.queryByTestId('kpi-mesas')).not.toBeInTheDocument();
    expect(screen.queryByTestId('kpi-atencion')).not.toBeInTheDocument();
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Mesas abiertas' })).not.toBeInTheDocument();
    sinTextoChico(screen.getByTestId('vista-pared'));
  });

  it('un filtro vacío en la pared también dice por qué, en grande', async () => {
    apiMesas(() => json(200, [sucursal(SUCURSAL_A1, 30, [mesa('1', '1.00', 5)])]));
    montar(`/mesas/pared?empresa=${A}&estado=atencion`);
    expect(await screen.findByText('Ninguna mesa requiere atención.')).toBeInTheDocument();
    sinTextoChico(screen.getByTestId('vista-pared'));
  });
});
