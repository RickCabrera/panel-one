import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Alerta, HistorialAlertas, ReglaAlerta, Rol } from '../api/tipos';
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

// F2-224 en el web, contra el router y la app reales: la campana de la cabecera, la vista
// `/alertas` y la pestaña de reglas de Administración.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-22T20:00:00Z');

function alerta(id: string, p: Partial<Alerta> = {}): Alerta {
  return {
    id,
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    tipo: 'mesa_abierta',
    severidad: 'advertencia',
    llave: `F-${id}`,
    umbral: 60,
    detalle: { folio: `F-${id}`, mesa: id, minutos: 75 },
    abiertaAt: '2026-09-22T19:00:00Z',
    cerradaAt: null,
    motivoCierre: null,
    ...p,
  };
}

const CRITICA = alerta('c1', {
  sucursalId: SUCURSAL_A2.id,
  sucursal: 'Tijuana',
  tipo: 'sucursal_sin_reporte',
  severidad: 'critica',
  llave: '',
  umbral: 10,
  detalle: { nunca: true },
});
const ABIERTAS: Alerta[] = [CRITICA, alerta('1'), alerta('2')];

function historial(pagina: number, total = 60): HistorialAlertas {
  const desde = (pagina - 1) * 50;
  const n = Math.max(0, Math.min(50, total - desde));
  return {
    total,
    pagina,
    porPagina: 50,
    filas: Array.from({ length: n }, (_, i) =>
      alerta(`h${desde + i}`, {
        abiertaAt: '2026-09-21T18:00:00Z',
        cerradaAt: '2026-09-21T18:45:00Z',
        motivoCierre: 'condicion',
      }),
    ),
  };
}

const REGLAS: ReglaAlerta[] = [
  {
    tipo: 'sucursal_sin_reporte',
    activa: true,
    umbral: 10,
    porDefecto: true,
    unidad: 'minutos',
    minimo: 1,
    maximo: 1440,
    valorPorDefecto: 10,
  },
  {
    tipo: 'mesa_abierta',
    activa: true,
    umbral: 60,
    porDefecto: true,
    unidad: 'minutos',
    minimo: 1,
    maximo: 1440,
    valorPorDefecto: 60,
  },
  {
    tipo: 'cuenta_sin_imprimir',
    activa: true,
    umbral: 30,
    porDefecto: true,
    unidad: 'minutos',
    minimo: 1,
    maximo: 1440,
    valorPorDefecto: 30,
  },
  {
    tipo: 'caida_venta',
    activa: true,
    umbral: 30,
    porDefecto: true,
    unidad: 'porcentaje',
    minimo: 1,
    maximo: 100,
    valorPorDefecto: 30,
  },
];

function api(rol: Rol = 'admin_empresa', extra: Record<string, Manejador> = {}) {
  const u = usuario(rol);
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /usuarios': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, ABIERTAS),
    'GET /alertas/historial': (l) => json(200, historial(Number(l.query.get('pagina') ?? '1'))),
    'GET /alertas/reglas': () => json(200, REGLAS),
    ...extra,
  });
}

function montar(ruta: string) {
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
      </Proveedores>
    </MemoryRouter>,
  );
}

const campana = () => screen.getByTestId('campana-alertas');
const filasAbiertas = () => within(screen.getByTestId('alertas-abiertas')).getAllByRole('listitem');

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

describe('AC3: la campana y el panel', () => {
  it('el número de la campana es el número de filas abiertas del panel, de UNA consulta', async () => {
    const falsa = api();
    montar(`/alertas?empresa=${A}`);
    await screen.findByTestId('alertas-abiertas');
    expect(filasAbiertas()).toHaveLength(3);
    expect(within(campana()).getByTestId('campana-conteo')).toHaveTextContent('3');
    expect(campana()).toHaveAttribute('aria-label', 'Alertas: 3 abiertas, 1 crítica');
    expect(falsa.contar('GET', '/alertas/abiertas')).toBe(1);
  });

  it('cuando la lista cambia, cambian las dos a la vez', async () => {
    vi.useRealTimers();
    vi.useFakeTimers({
      toFake: ['Date', 'setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'],
      shouldAdvanceTime: true,
    });
    vi.setSystemTime(AHORA);
    let respuesta = ABIERTAS;
    api('admin_empresa', { 'GET /alertas/abiertas': () => json(200, respuesta) });
    montar(`/alertas?empresa=${A}`);
    await screen.findByTestId('alertas-abiertas');
    respuesta = [alerta('1')];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    await waitFor(() => expect(filasAbiertas()).toHaveLength(1));
    expect(within(campana()).getByTestId('campana-conteo')).toHaveTextContent('1');
    expect(campana()).toHaveAttribute('aria-label', 'Alertas: 1 abierta');
  });

  it('sin alertas: la campana no pinta "0" y el panel dice por qué está vacío', async () => {
    api('visor', { 'GET /alertas/abiertas': () => json(200, []) });
    montar(`/alertas?empresa=${A}`);
    expect(await screen.findByText(/Ninguna alerta abierta/)).toBeVisible();
    expect(screen.queryByTestId('campana-conteo')).toBeNull();
    expect(campana()).toHaveAttribute('aria-label', 'Alertas: ninguna abierta');
  });

  it('si la API falla, la campana lo dice y el panel no finge "ninguna"', async () => {
    api('visor', {
      'GET /alertas/abiertas': () => json(500, { statusCode: 500, message: 'caída' }),
    });
    montar(`/alertas?empresa=${A}`);
    await waitFor(() =>
      expect(campana()).toHaveAttribute('aria-label', 'Alertas: no se pudieron leer'),
    );
    expect(screen.getByRole('region', { name: 'Abiertas' })).toHaveTextContent(
      'No se pudo cargar este dato.',
    );
    expect(screen.queryByText(/Ninguna alerta abierta/)).toBeNull();
  });

  it('la campana lleva a /alertas con el alcance', async () => {
    api();
    montar(`/?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    await waitFor(() =>
      expect(campana()).toHaveAttribute('href', `/alertas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`),
    );
  });
});

describe('vista /alertas', () => {
  it('abiertas con severidad en palabras y su detalle; historial con las dos marcas', async () => {
    api();
    montar(`/alertas?empresa=${A}`);
    await screen.findByTestId('alertas-abiertas');
    expect(filasAbiertas()[0]).toHaveTextContent('Crítica');
    expect(filasAbiertas()[0]).toHaveTextContent('Tijuana: nunca ha reportado.');
    // 19:00Z en Tijuana (UTC−7) = 12:00; lleva 60 min a las 20:00Z.
    expect(filasAbiertas()[0]).toHaveTextContent('Desde 22/09/2026 12:00 · lleva 1 h');
    const tabla = await screen.findByTestId('alertas-historial');
    const primera = within(tabla).getAllByRole('row')[1];
    expect(primera).toHaveTextContent('21/09/2026 12:00');
    expect(primera).toHaveTextContent('21/09/2026 12:45');
    expect(primera).toHaveTextContent('Se resolvió');
    expect(primera).toHaveTextContent('45 min');
  });

  it('el historial pagina: la página 2 se pide al API', async () => {
    const falsa = api();
    montar(`/alertas?empresa=${A}`);
    expect(await screen.findByTestId('alertas-pagina')).toHaveTextContent(
      'Página 1 de 2 · 60 alertas',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
    await waitFor(() =>
      expect(screen.getByTestId('alertas-pagina')).toHaveTextContent('Página 2 de 2'),
    );
    expect(
      falsa.llamadas.some((l) => l.ruta === '/alertas/historial' && l.query.get('pagina') === '2'),
    ).toBe(true);
    expect(within(screen.getByTestId('alertas-historial')).getAllByRole('row')).toHaveLength(11);
  });

  it('historial vacío: lo dice', async () => {
    api('visor', {
      'GET /alertas/abiertas': () => json(200, []),
      'GET /alertas/historial': () => json(200, historial(1, 0)),
    });
    montar(`/alertas?empresa=${A}`);
    expect(await screen.findByText(/Todavía no hay alertas en el historial/)).toBeVisible();
  });

  it('sólo los admins ven "Configurar umbrales"', async () => {
    api('admin_empresa');
    montar(`/alertas?empresa=${A}`);
    expect(await screen.findByRole('link', { name: 'Configurar umbrales' })).toHaveAttribute(
      'href',
      `/admin?empresa=${A}&tab=alertas`,
    );
    cleanup();
    terminarSesion('cerrada');
    api('visor');
    montar(`/alertas?empresa=${A}`);
    await screen.findByTestId('alertas-abiertas');
    expect(screen.queryByRole('link', { name: 'Configurar umbrales' })).toBeNull();
  });
});

describe('Administración › Alertas (reglas)', () => {
  it('guardar manda la regla y refresca las abiertas (la campana se actualiza ya)', async () => {
    // API falsa con estado: lo que el PUT guarda es lo que el GET de reglas devuelve después.
    let abiertas = ABIERTAS;
    let reglas = REGLAS;
    const falsa = api('admin_empresa', {
      'GET /alertas/abiertas': () => json(200, abiertas),
      'GET /alertas/reglas': () => json(200, reglas),
      'PUT /alertas/reglas/mesa_abierta': () => {
        abiertas = [CRITICA];
        reglas = REGLAS.map((r) =>
          r.tipo === 'mesa_abierta' ? { ...r, umbral: 200, porDefecto: false } : r,
        );
        return json(200, reglas);
      },
    });
    montar(`/admin?empresa=${A}&tab=alertas`);
    const regla = await screen.findByRole('listitem', { name: 'Regla: Mesa abierta mucho tiempo' });
    await waitFor(() =>
      expect(within(campana()).getByTestId('campana-conteo')).toHaveTextContent('3'),
    );
    const umbral = within(regla).getByLabelText(/Umbral \(min, de 1 a 1440\)/);
    await userEvent.clear(umbral);
    await userEvent.type(umbral, '200');
    await userEvent.click(within(regla).getByRole('button', { name: 'Guardar' }));
    expect(await within(regla).findByRole('status')).toHaveTextContent('Guardado y aplicado.');
    const put = falsa.llamadas.find((l) => l.metodo === 'PUT');
    expect(put?.cuerpo).toEqual({ empresaId: A, activa: true, umbral: 200 });
    await waitFor(() =>
      expect(within(campana()).getByTestId('campana-conteo')).toHaveTextContent('1'),
    );
  });

  it('un umbral fuera de rango no se manda; un 400 del API se muestra', async () => {
    const falsa = api('admin_empresa', {
      'PUT /alertas/reglas/caida_venta': () =>
        json(400, {
          statusCode: 400,
          message: 'umbral de caida_venta debe ser un entero entre 1 y 100 (porcentaje).',
        }),
    });
    montar(`/admin?empresa=${A}&tab=alertas`);
    const regla = await screen.findByRole('listitem', { name: 'Regla: Caída de venta' });
    const umbral = within(regla).getByLabelText(/Umbral \(%, de 1 a 100\)/);
    await userEvent.clear(umbral);
    await userEvent.type(umbral, '101');
    expect(within(regla).getByText('Escribe un número entero entre 1 y 100.')).toBeVisible();
    expect(within(regla).getByRole('button', { name: 'Guardar' })).toBeDisabled();

    // Apagarla sí se manda; el API la rechaza (simulado) y se dice.
    await userEvent.clear(umbral);
    await userEvent.type(umbral, '30');
    await userEvent.click(within(regla).getByRole('checkbox'));
    await userEvent.click(within(regla).getByRole('button', { name: 'Guardar' }));
    expect(await within(regla).findByRole('alert')).toHaveTextContent(
      'No se guardó: umbral de caida_venta',
    );
    expect(falsa.contar('PUT', '/alertas/reglas/caida_venta')).toBe(1);
  });
});
