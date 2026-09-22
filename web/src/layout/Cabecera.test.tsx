import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
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

// F2-212 contra el router y la app reales: el periodo y la sucursal viajan entre vistas y
// en la URL, el selector de periodo es uno solo (en la cabecera), un rango invertido no
// llega a la API, y el indicador de operación en vivo no pinta una hora vieja.

const A = EMPRESA_A.id;
// 2026-09-21 03:30 UTC = domingo 20-sep 21:30 en CDMX.
const AHORA = new Date('2026-09-21T03:30:00Z');
const HOY = '2026-09-20';

function snapshot(edadRecepcionSegundos: number) {
  const recibido = new Date(AHORA.getTime() - edadRecepcionSegundos * 1000).toISOString();
  return {
    capturadoAt: recibido,
    recibidoAt: recibido,
    edadSegundos: edadRecepcionSegundos,
    edadRecepcionSegundos,
    mesas: [],
  };
}

/** Centro con lectura de hace `edadA1` s y Tijuana con la de `edadA2` (null = nunca). */
function mesas(edadA1: number | null, edadA2: number | null) {
  return (l: Llamada): Response => {
    const filas: MesasSucursal[] = [
      {
        sucursalId: SUCURSAL_A1.id,
        nombre: 'Centro',
        zonaHoraria: 'America/Mexico_City',
        snapshot: edadA1 === null ? null : snapshot(edadA1),
      },
      {
        sucursalId: SUCURSAL_A2.id,
        nombre: 'Tijuana',
        zonaHoraria: 'America/Mexico_City',
        snapshot: edadA2 === null ? null : snapshot(edadA2),
      },
    ];
    const sucursalId = l.query.get('sucursalId');
    return json(200, sucursalId ? filas.filter((f) => f.sucursalId === sucursalId) : filas);
  };
}

const RESUMEN = {
  venta: '0.00',
  cuentas: 0,
  ticketPromedio: null,
  subtotal: '0.00',
  impuestos: '0.00',
  propina: '0.00',
  descuentos: { monto: '0.00', cuentas: 0 },
  cortesias: null,
  comensales: { total: 0, cuentasConDato: 0, promedioPorComensal: null },
  cancelados: { cuentas: 0 },
};

function api(extra: Record<string, Manejador> = {}) {
  const u = usuario('admin_empresa');
  // Tijuana, pero en la zona de CDMX, para que "hoy" sea el mismo con o sin sucursal.
  const a2 = { ...SUCURSAL_A2, zonaHoraria: 'America/Mexico_City' };
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, a2]),
    'GET /usuarios': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /ventas/resumen': () => json(200, RESUMEN),
    'GET /ventas/por-hora': () =>
      json(
        200,
        Array.from({ length: 24 }, (_, hora) => ({ hora, venta: '0.00', cuentas: 0 })),
      ),
    'GET /ventas/formas-pago': () => json(200, { formas: [], sinCatalogo: [] }),
    'GET /ventas/tickets': () => json(200, { total: 0, items: [] }),
    'GET /ventas/por-dia': () => json(200, []),
    'GET /ventas/comparativo-sucursales': () => json(200, []),
    'GET /ventas/top-productos': () => json(200, []),
    'GET /mesas/abiertas': mesas(10, 20),
    ...extra,
  });
}

function Ubicacion() {
  const { pathname, search } = useLocation();
  return <div data-testid="ubicacion">{pathname + search}</div>;
}

/** Cada montaje con su QueryClient nuevo y vacío: como abrir otra pestaña. */
function montar(ruta: string) {
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
        <Ubicacion />
      </Proveedores>
    </MemoryRouter>,
  );
}

const ubicacion = () => new URL(screen.getByTestId('ubicacion').textContent ?? '', 'http://x');
const cabecera = () => screen.getByRole('banner');
const pedidas = (a: ReturnType<typeof api>, ruta: string) =>
  a.llamadas.filter((l) => l.ruta === ruta);
const menu = async () => screen.findByRole('navigation', { name: 'Principal' });
const indicador = () => screen.getByTestId('operacion-en-vivo');

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

describe('AC1 · el periodo sobrevive a la navegación', () => {
  it('"Este mes" en Inicio → Tickets por el menú: mismo periodo en la URL, el selector y la API', async () => {
    const a = api();
    const user = userEvent.setup();
    montar(`/?empresa=${A}`);
    await screen.findByRole('group', { name: 'Periodo' });

    await user.click(within(cabecera()).getByRole('button', { name: 'Este mes' }));
    await waitFor(() => expect(ubicacion().searchParams.get('periodo')).toBe('mes'));

    await user.click(within(await menu()).getByRole('link', { name: 'Tickets' }));
    await waitFor(() => expect(ubicacion().pathname).toBe('/tickets'));
    expect(ubicacion().searchParams.get('periodo')).toBe('mes');
    expect(ubicacion().searchParams.get('empresa')).toBe(A);
    expect(within(cabecera()).getByRole('button', { name: 'Este mes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await waitFor(() => expect(pedidas(a, '/ventas/tickets').length).toBeGreaterThan(0));
    for (const l of pedidas(a, '/ventas/tickets')) {
      expect(l.query.get('desde')).toBe('2026-09-01');
      expect(l.query.get('hasta')).toBe(HOY);
    }
  });

  it('un rango libre de Tickets pasa a Reportes, y la sucursal con él', async () => {
    const a = api();
    const user = userEvent.setup();
    montar(
      `/tickets?empresa=${A}&sucursal=${SUCURSAL_A2.id}&periodo=rango&desde=2026-07-01&hasta=2026-07-15&pagina=3`,
    );
    await user.click(within(await menu()).getByRole('link', { name: 'Reportes' }));
    await waitFor(() => expect(ubicacion().pathname).toBe('/reportes'));
    const p = ubicacion().searchParams;
    expect(p.get('periodo')).toBe('rango');
    expect(p.get('desde')).toBe('2026-07-01');
    expect(p.get('hasta')).toBe('2026-07-15');
    expect(p.get('sucursal')).toBe(SUCURSAL_A2.id);
    // La página es de Tickets: no viaja.
    expect(p.has('pagina')).toBe(false);
    await waitFor(() => expect(pedidas(a, '/ventas/por-dia').length).toBeGreaterThan(0));
    const [porDia] = pedidas(a, '/ventas/por-dia');
    expect(porDia.query.get('desde')).toBe('2026-07-01');
    expect(porDia.query.get('hasta')).toBe('2026-07-15');
    expect(porDia.query.get('sucursalId')).toBe(SUCURSAL_A2.id);
  });

  it('en el Monitor no hay selector, pero el periodo sigue en la URL y vuelve con Inicio', async () => {
    api();
    const user = userEvent.setup();
    montar(`/?empresa=${A}&periodo=mes-anterior`);
    await screen.findByRole('group', { name: 'Periodo' });

    await user.click(within(await menu()).getByRole('link', { name: 'Monitor de mesas' }));
    await waitFor(() => expect(ubicacion().pathname).toBe('/mesas'));
    expect(within(cabecera()).queryByRole('group', { name: 'Periodo' })).not.toBeInTheDocument();
    expect(ubicacion().searchParams.get('periodo')).toBe('mes-anterior');

    await user.click(within(await menu()).getByRole('link', { name: 'Inicio' }));
    await waitFor(() => expect(ubicacion().pathname).toBe('/'));
    expect(within(cabecera()).getByRole('button', { name: 'Mes anterior' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('"Mi cuenta" también conserva el periodo', async () => {
    api();
    const user = userEvent.setup();
    montar(`/reportes?empresa=${A}&periodo=semana`);
    await menu();
    await user.click(within(cabecera()).getByRole('link', { name: 'Mi cuenta' }));
    await waitFor(() => expect(ubicacion().pathname).toBe('/cuenta'));
    expect(ubicacion().searchParams.get('periodo')).toBe('semana');
    expect(ubicacion().searchParams.get('empresa')).toBe(A);
  });

  it('cambiar el periodo desde la cabecera vuelve Tickets a la página 1', async () => {
    api();
    const user = userEvent.setup();
    montar(`/tickets?empresa=${A}&pagina=2`);
    await menu();
    await user.click(within(cabecera()).getByRole('button', { name: 'Esta semana' }));
    await waitFor(() => expect(ubicacion().searchParams.get('periodo')).toBe('semana'));
    expect(ubicacion().searchParams.has('pagina')).toBe(false);
  });
});

describe('AC2 · la URL pegada en otra pestaña abre exactamente lo mismo', () => {
  it('/reportes con sucursal y rango: selector, sucursal y consultas iguales', async () => {
    const a = api();
    const url = `/reportes?empresa=${A}&sucursal=${SUCURSAL_A2.id}&periodo=rango&desde=2026-08-03&hasta=2026-08-09`;
    montar(url);

    expect(await screen.findByRole('heading', { name: 'Reportes' })).toBeInTheDocument();
    await waitFor(() =>
      expect((screen.getByLabelText('Sucursal') as HTMLSelectElement).value).toBe(SUCURSAL_A2.id),
    );
    expect(within(cabecera()).getByRole('button', { name: 'Rango' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect((screen.getByLabelText('Desde') as HTMLInputElement).value).toBe('2026-08-03');
    expect((screen.getByLabelText('Hasta') as HTMLInputElement).value).toBe('2026-08-09');

    await waitFor(() => {
      for (const ruta of [
        '/ventas/por-dia',
        '/ventas/comparativo-sucursales',
        '/ventas/top-productos',
      ]) {
        expect(pedidas(a, ruta).length).toBeGreaterThan(0);
      }
    });
    for (const l of a.llamadas.filter((x) => x.ruta.startsWith('/ventas/'))) {
      expect(l.query.get('empresaId')).toBe(A);
      expect(l.query.get('sucursalId')).toBe(SUCURSAL_A2.id);
      expect(l.query.get('desde')).toBe('2026-08-03');
      expect(l.query.get('hasta')).toBe('2026-08-09');
    }
    // La normalización del alcance no se comió nada de la URL pegada.
    expect(ubicacion().pathname + ubicacion().search).toBe(url);
  });

  it('sin empresa en la URL, la normalización la pone y conserva el periodo', async () => {
    api();
    montar(`/?periodo=rango&desde=2026-08-03&hasta=2026-08-09`);
    await waitFor(() => expect(ubicacion().searchParams.get('empresa')).toBe(A));
    const p = ubicacion().searchParams;
    expect(p.get('periodo')).toBe('rango');
    expect(p.get('desde')).toBe('2026-08-03');
    expect(p.get('hasta')).toBe('2026-08-09');
  });

  it('el selector de periodo es uno solo y sólo sale en las vistas con periodo', async () => {
    api();
    for (const ruta of ['/', '/tickets', '/reportes']) {
      const { unmount } = montar(`${ruta}?empresa=${A}`);
      await menu();
      expect(screen.getAllByRole('group', { name: 'Periodo' })).toHaveLength(1);
      expect(within(cabecera()).getByRole('group', { name: 'Periodo' })).toBeInTheDocument();
      unmount();
    }
    for (const ruta of ['/mesas', '/admin', '/cuenta']) {
      const { unmount } = montar(`${ruta}?empresa=${A}&periodo=mes`);
      await menu();
      expect(screen.queryByRole('group', { name: 'Periodo' })).not.toBeInTheDocument();
      unmount();
    }
  });
});

describe('AC3 · el indicador de operación en vivo', () => {
  it('con lecturas frescas: la hora de la más vieja y cuántas reportan', async () => {
    api({ 'GET /mesas/abiertas': mesas(10, null) });
    montar(`/?empresa=${A}`);
    await waitFor(() => expect(indicador()).toHaveAttribute('data-estado', 'en-vivo'));
    // 03:29:50 UTC = 21:29 en CDMX.
    expect(indicador()).toHaveTextContent('En vivo · 21:29');
    expect(indicador()).toHaveTextContent('1 de 2 sucursales reportando');
    expect(indicador()).toHaveAccessibleName(
      'Operación: En vivo · 21:29 · 1 de 2 sucursales reportando',
    );
  });

  it('con demora lo dice con palabras, no sólo con el color', async () => {
    api({ 'GET /mesas/abiertas': mesas(75, 70) });
    montar(`/mesas?empresa=${A}`);
    await waitFor(() => expect(indicador()).toHaveAttribute('data-estado', 'en-vivo'));
    expect(indicador()).toHaveTextContent('En vivo (con demora) · 21:28');
    expect(indicador()).toHaveTextContent('2 de 2 sucursales reportando');
  });

  it('ninguna reporta: "Sin lectura reciente" y ninguna hora', async () => {
    api({ 'GET /mesas/abiertas': mesas(3600, null) });
    montar(`/tickets?empresa=${A}`);
    await waitFor(() => expect(indicador()).toHaveAttribute('data-estado', 'sin-lectura'));
    expect(indicador()).toHaveTextContent('Sin lectura reciente');
    expect(indicador()).toHaveTextContent('0 de 2 sucursales reportando');
    expect(indicador().textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it('con una sucursal elegida cuenta sólo esa, aunque otra sí reporte', async () => {
    api({ 'GET /mesas/abiertas': mesas(10, 600) });
    montar(`/?empresa=${A}&sucursal=${SUCURSAL_A2.id}`);
    await waitFor(() => expect(indicador()).toHaveAttribute('data-estado', 'sin-lectura'));
    expect(indicador()).toHaveTextContent('Sin lectura reciente');
    expect(indicador()).toHaveTextContent('0 de 1 sucursal reportando');
    expect(indicador().textContent).not.toMatch(/\d{2}:\d{2}/);
  });

  it('con la API caída desde el principio: "Sin lectura reciente", no "consultando"', async () => {
    api({
      'GET /mesas/abiertas': () => json(500, { statusCode: 500, message: 'Error' }),
    });
    montar(`/admin?empresa=${A}`);
    await waitFor(() => expect(indicador()).toHaveAttribute('data-estado', 'sin-lectura'));
    expect(indicador()).toHaveTextContent('Sin lectura reciente');
    expect(indicador()).toHaveTextContent('No se pudo consultar');
  });

  it('si deja de llegar lectura, se apaga solo con el paso del tiempo', async () => {
    api({ 'GET /mesas/abiertas': mesas(30, null) });
    montar(`/cuenta?empresa=${A}`);
    await waitFor(() => expect(indicador()).toHaveAttribute('data-estado', 'en-vivo'));
    // 61 s después la lectura tiene 91 s: pasa el umbral de 90. El pulso es de 5 s.
    vi.setSystemTime(AHORA.getTime() + 61_000);
    await waitFor(() => expect(indicador()).toHaveAttribute('data-estado', 'sin-lectura'), {
      timeout: 7_000,
    });
    expect(indicador().textContent).not.toMatch(/\d{2}:\d{2}/);
  }, 15_000);
});

describe('AC4 · un rango invertido se explica y no se manda a la API', () => {
  it('teclear un fin anterior al inicio: alerta, cero consultas con ese rango', async () => {
    const a = api();
    const user = userEvent.setup();
    montar(`/tickets?empresa=${A}&periodo=rango&desde=2026-09-10&hasta=2026-09-15`);
    await waitFor(() => expect(pedidas(a, '/ventas/tickets').length).toBeGreaterThan(0));

    const hasta = within(cabecera()).getByLabelText('Hasta');
    await user.clear(hasta);
    await user.type(hasta, '2026-09-01');
    expect(await within(cabecera()).findByRole('alert')).toHaveTextContent(
      'La fecha de inicio no puede ser posterior a la de fin.',
    );
    expect(
      screen.getByText('Corrige el rango de fechas para ver los tickets.'),
    ).toBeInTheDocument();
    for (const l of a.llamadas.filter((x) => x.ruta.startsWith('/ventas/'))) {
      expect(l.query.get('hasta')! >= l.query.get('desde')!).toBe(true);
    }
  });

  it('el calendario ya no ofrece fechas que inviertan el rango', async () => {
    api();
    montar(`/?empresa=${A}&periodo=rango&desde=2026-09-10&hasta=2026-09-15`);
    await menu();
    expect(within(cabecera()).getByLabelText('Desde')).toHaveAttribute('max', '2026-09-15');
    expect(within(cabecera()).getByLabelText('Hasta')).toHaveAttribute('min', '2026-09-10');
  });

  it('un deep-link invertido tampoco consulta, en ninguna vista con periodo', async () => {
    for (const ruta of ['/', '/tickets', '/reportes']) {
      const a = api();
      const { unmount } = montar(
        `${ruta}?empresa=${A}&periodo=rango&desde=2026-09-10&hasta=2026-09-01`,
      );
      await menu();
      expect(
        within(cabecera()).getByText('La fecha de inicio no puede ser posterior a la de fin.'),
      ).toBeInTheDocument();
      await screen.findByLabelText('Sucursal');
      // El indicador sí consulta (no usa periodo); ninguna consulta de ventas sale.
      await waitFor(() => expect(pedidas(a, '/mesas/abiertas').length).toBeGreaterThan(0));
      expect(a.llamadas.filter((x) => x.ruta.startsWith('/ventas/'))).toHaveLength(0);
      unmount();
      vi.unstubAllGlobals();
    }
  });
});
