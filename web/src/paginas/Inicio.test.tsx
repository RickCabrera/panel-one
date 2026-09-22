import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FormasPago, MesasSucursal, Resumen, VentaHora } from '../api/tipos';
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

// 2026-09-21 03:30 UTC = domingo 20-sep 21:30 en CDMX: en UTC ya es el 21. Si el
// panel calculara "hoy" en UTC o en la zona del navegador, pediría el día 21.
const AHORA = new Date('2026-09-21T03:30:00Z');
const HOY = '2026-09-20';

function resumen(parcial: Partial<Resumen> = {}): Resumen {
  return {
    venta: '15234.50',
    cuentas: 42,
    ticketPromedio: '362.73',
    subtotal: '13133.19',
    impuestos: '2101.31',
    propina: '812.00',
    descuentos: { monto: '640.25', cuentas: 5 },
    cortesias: null,
    comensales: { total: 97, cuentasConDato: 40, promedioPorComensal: '151.10' },
    cancelados: { cuentas: 2 },
    ...parcial,
  };
}

const RESUMEN_A1 = resumen({
  venta: '8000.00',
  cuentas: 20,
  ticketPromedio: '400.00',
  descuentos: { monto: '100.00', cuentas: 1 },
  comensales: { total: 50, cuentasConDato: 20, promedioPorComensal: '160.00' },
  cancelados: { cuentas: 0 },
});

const FORMAS: FormasPago = {
  formas: [
    { forma: 'efectivo', monto: '1.00' },
    { forma: 'tarjeta', monto: '2.00' },
    { forma: 'transferencia', monto: '0.00' },
    { forma: 'otro', monto: '0.00' },
  ],
  sinCatalogo: [],
};

const POR_HORA: VentaHora[] = Array.from({ length: 24 }, (_, hora) => ({
  hora,
  venta: hora === 14 ? '15234.50' : '0.00',
  cuentas: hora === 14 ? 42 : 0,
}));

function mesas(): MesasSucursal[] {
  return [
    {
      sucursalId: SUCURSAL_A1.id,
      nombre: 'Centro',
      zonaHoraria: 'America/Mexico_City',
      snapshot: {
        capturadoAt: '2026-09-21T03:29:59.000Z',
        recibidoAt: '2026-09-21T03:30:00.000Z',
        edadSegundos: 30,
        // Fresca: con más de 90 s la sucursal ya es desconectada y no se suma (F1-094).
        edadRecepcionSegundos: 30,
        mesas: [{ total: '350.50' }, { total: '1200.00' }],
      },
    },
    {
      sucursalId: SUCURSAL_A2.id,
      nombre: 'Tijuana',
      zonaHoraria: 'America/Tijuana',
      snapshot: null,
    },
  ];
}

function apiDashboard(extra: Record<string, Manejador> = {}) {
  const u = usuario('admin_empresa');
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /ventas/resumen': (l: Llamada) =>
      json(200, l.query.get('sucursalId') === SUCURSAL_A1.id ? RESUMEN_A1 : resumen()),
    'GET /ventas/por-hora': () => json(200, POR_HORA),
    'GET /ventas/formas-pago': () => json(200, FORMAS),
    'GET /mesas/abiertas': () => json(200, mesas()),
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
  return queryClient;
}

const tarjeta = (nombre: string) => screen.getByRole('region', { name: nombre });
const ubicacion = () => new URL(screen.getByTestId('ubicacion').textContent ?? '', 'http://x');
const pedidas = (api: ReturnType<typeof apiDashboard>, ruta: string) =>
  api.llamadas.filter((l) => l.ruta === ruta);

beforeEach(() => {
  // Sólo se falsea la fecha; los timers siguen siendo reales salvo donde se diga.
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

describe('Panel de ventas: los números son los de la API', () => {
  it('pinta exactamente lo que devuelven los endpoints', async () => {
    const api = apiDashboard();
    montar(`/?empresa=${A}`);

    expect(await screen.findByTestId('venta-total')).toHaveTextContent('$15,234.50');
    expect(tarjeta('Venta total')).toHaveTextContent(
      '42 cuentas cerradas · 2 canceladas (no suman)',
    );
    expect(screen.getByTestId('ticket-promedio')).toHaveTextContent('$362.73');
    expect(screen.getByTestId('comensales')).toHaveTextContent('97');
    expect(screen.getByTestId('por-comensal')).toHaveTextContent('$151.10');
    expect(tarjeta('Ticket promedio')).toHaveTextContent('40 de 42 cuentas traían comensales.');
    expect(screen.getByTestId('descuentos')).toHaveTextContent('$640.25');
    expect(tarjeta('Descuentos y cortesías')).toHaveTextContent('en 5 cuentas');
    expect(screen.getByTestId('cortesias')).toHaveTextContent('Sin dato');

    // % sobre lo pagado: 1 de 3 y 2 de 3.
    expect(await screen.findByTestId('forma-efectivo')).toHaveTextContent('Efectivo$1.0033.3 %');
    expect(screen.getByTestId('dona-formas')).toBeInTheDocument();
    expect(screen.getByTestId('forma-tarjeta')).toHaveTextContent('Tarjeta$2.0066.7 %');
    expect(screen.getByTestId('forma-transferencia')).toHaveTextContent('$0.000.0 %');

    // Venta en vivo: 350.50 + 1200.00 del snapshot de Centro; Tijuana no reporta.
    expect(await screen.findByTestId('venta-en-vivo')).toHaveTextContent('$1,550.50');
    expect(tarjeta('Venta en vivo')).toHaveTextContent(
      '2 mesas abiertas · dato de hace menos de 1 min',
    );
    expect(tarjeta('Venta en vivo')).toHaveTextContent('Sin reporte todavía: Tijuana.');

    // "Hoy" es el día de CDMX (las sucursales están en zonas distintas), no el de UTC.
    for (const ruta of ['/ventas/resumen', '/ventas/por-hora', '/ventas/formas-pago']) {
      const [llamada] = pedidas(api, ruta);
      expect(llamada.query.get('empresaId'), ruta).toBe(A);
      expect(llamada.query.get('sucursalId'), ruta).toBeNull();
      expect(llamada.query.get('desde'), ruta).toBe(HOY);
      expect(llamada.query.get('hasta'), ruta).toBe(HOY);
    }
    expect(pedidas(api, '/mesas/abiertas')[0].query.get('empresaId')).toBe(A);

    expect(screen.getByTestId('actualizado')).toHaveTextContent('Actualizado 21:30');
  });

  it('con una sucursal elegida, "hoy" es el de SU zona', async () => {
    // 06:30 UTC del 21 = 00:30 del 21 en CDMX, pero 23:30 del 20 en Tijuana.
    vi.setSystemTime(new Date('2026-09-21T06:30:00Z'));
    const api = apiDashboard();
    montar(`/?empresa=${A}&sucursal=${SUCURSAL_A2.id}`);

    await screen.findByTestId('venta-total');
    const [llamada] = pedidas(api, '/ventas/resumen');
    expect(llamada.query.get('sucursalId')).toBe(SUCURSAL_A2.id);
    expect(llamada.query.get('desde')).toBe('2026-09-20');
    expect(screen.getByTestId('actualizado')).toHaveTextContent('Actualizado 23:30');
  });

  it('un null de la API es "—", nunca $0.00', async () => {
    apiDashboard({
      'GET /ventas/resumen': () =>
        json(
          200,
          resumen({
            ticketPromedio: null,
            comensales: { total: 0, cuentasConDato: 0, promedioPorComensal: null },
          }),
        ),
    });
    montar(`/?empresa=${A}`);

    expect(await screen.findByTestId('ticket-promedio')).toHaveTextContent('—');
    expect(screen.getByTestId('por-comensal')).toHaveTextContent('—');
  });
});

describe('cambiar sucursal o periodo actualiza todo sin recargar', () => {
  it('cambiar de sucursal pide con sucursalId y pinta los números nuevos', async () => {
    const api = apiDashboard();
    const usuarioEvt = userEvent.setup();
    montar(`/?empresa=${A}`);
    expect(await screen.findByTestId('venta-total')).toHaveTextContent('$15,234.50');

    const selector = screen.getByLabelText('Sucursal');
    await waitFor(() => expect(selector).toBeEnabled());
    await usuarioEvt.selectOptions(selector, SUCURSAL_A1.id);

    await waitFor(() => expect(screen.getByTestId('venta-total')).toHaveTextContent('$8,000.00'));
    expect(screen.getByTestId('ticket-promedio')).toHaveTextContent('$400.00');
    expect(screen.getByTestId('descuentos')).toHaveTextContent('$100.00');
    expect(tarjeta('Venta total')).not.toHaveTextContent('canceladas');
    for (const ruta of [
      '/ventas/resumen',
      '/ventas/por-hora',
      '/ventas/formas-pago',
      '/mesas/abiertas',
    ]) {
      expect(pedidas(api, ruta).at(-1)?.query.get('sucursalId'), ruta).toBe(SUCURSAL_A1.id);
    }
    // La sesión no se reinició: la SPA no se recargó.
    expect(api.contar('POST', '/auth/refresh')).toBe(1);
  });

  it('cambiar de periodo pide los días nuevos y lo deja en la URL', async () => {
    const api = apiDashboard();
    const usuarioEvt = userEvent.setup();
    montar(`/?empresa=${A}`);
    await screen.findByTestId('venta-total');

    await usuarioEvt.click(screen.getByRole('button', { name: 'Esta semana' }));
    await waitFor(() =>
      expect(pedidas(api, '/ventas/resumen').at(-1)?.query.get('desde')).toBe('2026-09-14'),
    );
    expect(ubicacion().searchParams.get('periodo')).toBe('semana');
    expect(ubicacion().searchParams.get('empresa')).toBe(A);

    await usuarioEvt.click(screen.getByRole('button', { name: 'Mes anterior' }));
    await waitFor(() => {
      const ultima = pedidas(api, '/ventas/formas-pago').at(-1)!;
      expect(ultima.query.get('desde')).toBe('2026-08-01');
      expect(ultima.query.get('hasta')).toBe('2026-08-31');
    });
    expect(screen.getByRole('button', { name: 'Mes anterior' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      await screen.findByText('Venta por hora de cierre (suma de los 31 días)'),
    ).toBeInTheDocument();
    expect(api.contar('POST', '/auth/refresh')).toBe(1);
  });

  it('"Rango" arranca con el periodo que se veía y se puede editar', async () => {
    const api = apiDashboard();
    const usuarioEvt = userEvent.setup();
    montar(`/?empresa=${A}&periodo=mes`);
    await screen.findByTestId('venta-total');

    await usuarioEvt.click(screen.getByRole('button', { name: 'Rango' }));
    expect(ubicacion().searchParams.get('desde')).toBe('2026-09-01');
    expect(ubicacion().searchParams.get('hasta')).toBe(HOY);

    const hasta = screen.getByLabelText('Hasta');
    await usuarioEvt.clear(hasta);
    await usuarioEvt.type(hasta, '2026-09-10');
    await waitFor(() =>
      expect(pedidas(api, '/ventas/resumen').at(-1)?.query.get('hasta')).toBe('2026-09-10'),
    );
  });

  it('deep-link a un rango: lo consulta tal cual', async () => {
    const api = apiDashboard();
    montar(`/?empresa=${A}&periodo=rango&desde=2026-07-01&hasta=2026-07-15`);
    await screen.findByTestId('venta-total');
    const [llamada] = pedidas(api, '/ventas/resumen');
    expect(llamada.query.get('desde')).toBe('2026-07-01');
    expect(llamada.query.get('hasta')).toBe('2026-07-15');
    expect((screen.getByLabelText('Desde') as HTMLInputElement).value).toBe('2026-07-01');
  });

  it('un rango inválido no consulta: explica qué corregir', async () => {
    const api = apiDashboard();
    montar(`/?empresa=${A}&periodo=rango&desde=2026-09-10&hasta=2026-09-01`);

    expect(
      await screen.findByText('La fecha de inicio no puede ser posterior a la de fin.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Corrige el rango de fechas para ver los datos.')).toBeInTheDocument();
    await screen.findByLabelText('Sucursal');
    expect(pedidas(api, '/ventas/resumen')).toHaveLength(0);
  });

  it('con una sucursal que no es de la empresa, no consulta con ella', async () => {
    const api = apiDashboard();
    montar(`/?empresa=${A}&sucursal=bbbbbbb1-0000-4000-8000-000000000001`);
    await screen.findByTestId('venta-total');
    expect(
      api.llamadas
        .filter((l) => l.ruta.startsWith('/ventas/') || l.ruta.startsWith('/mesas/'))
        .every((l) => l.query.get('sucursalId') === null),
    ).toBe(true);
  });
});

describe('carga, vacío y error', () => {
  it('skeletons mientras la API no responde', async () => {
    let soltar: () => void = () => {};
    const pendiente = new Promise<void>((r) => (soltar = r));
    apiDashboard({
      'GET /ventas/resumen': async () => {
        await pendiente;
        return json(200, resumen());
      },
    });
    montar(`/?empresa=${A}`);

    await waitFor(() =>
      expect(within(tarjeta('Venta total')).getByTestId('esqueleto')).toHaveAttribute(
        'aria-busy',
        'true',
      ),
    );
    expect(within(tarjeta('Ticket promedio')).getByTestId('esqueleto')).toBeInTheDocument();
    expect(screen.queryByTestId('venta-total')).not.toBeInTheDocument();

    act(() => soltar());
    expect(await screen.findByTestId('venta-total')).toHaveTextContent('$15,234.50');
    expect(within(tarjeta('Venta total')).queryByTestId('esqueleto')).not.toBeInTheDocument();
  });

  it('sin ventas: mensajes claros, no ceros sueltos', async () => {
    apiDashboard({
      'GET /ventas/resumen': () =>
        json(
          200,
          resumen({
            venta: '0.00',
            cuentas: 0,
            ticketPromedio: null,
            descuentos: { monto: '0.00', cuentas: 0 },
            comensales: { total: 0, cuentasConDato: 0, promedioPorComensal: null },
            cancelados: { cuentas: 0 },
          }),
        ),
      'GET /ventas/formas-pago': () =>
        json(200, { ...FORMAS, formas: FORMAS.formas.map((f) => ({ ...f, monto: '0.00' })) }),
      'GET /mesas/abiertas': () =>
        json(
          200,
          mesas().map((m) => ({ ...m, snapshot: null })),
        ),
    });
    montar(`/?empresa=${A}`);

    const enTarjeta = async (nombre: string, texto: string) =>
      within(await screen.findByRole('region', { name: nombre })).findByText(texto);
    expect(await enTarjeta('Venta total', 'Sin ventas en este periodo.')).toBeInTheDocument();
    expect(await enTarjeta('Ticket promedio', 'Sin cuentas en este periodo.')).toBeInTheDocument();
    expect(await enTarjeta('Formas de pago', 'Sin pagos en este periodo.')).toBeInTheDocument();
    expect(
      await enTarjeta('Venta en vivo', 'Ninguna sucursal ha reportado sus mesas todavía.'),
    ).toBeInTheDocument();
  });

  it('una mesa sin total legible: "Sin dato", no una suma parcial', async () => {
    apiDashboard({
      'GET /mesas/abiertas': () => {
        const filas = mesas();
        filas[0].snapshot!.mesas = [{ total: '350.50' }, { importe: '1200.00' }];
        return json(200, filas);
      },
    });
    montar(`/?empresa=${A}`);
    expect(await screen.findByTestId('venta-en-vivo')).toHaveTextContent('Sin dato');
    expect(tarjeta('Venta en vivo')).not.toHaveTextContent('$350.50');
  });

  it('una forma de pago con importe ilegible: "Sin dato", sin %, sin dona y fuera del total', async () => {
    apiDashboard({
      'GET /ventas/formas-pago': () =>
        json(200, {
          ...FORMAS,
          formas: [
            { forma: 'efectivo', monto: '1.00' },
            { forma: 'tarjeta', monto: '2,00' },
            { forma: 'transferencia', monto: '0.00' },
            { forma: 'otro', monto: '0.00' },
          ],
        }),
    });
    montar(`/?empresa=${A}`);

    const filaTarjeta = await screen.findByTestId('forma-tarjeta');
    expect(filaTarjeta).toHaveTextContent('TarjetaSin dato');
    expect(filaTarjeta).not.toHaveTextContent('$0.00');
    // Sin porcentajes: con una base incompleta, efectivo NO es el 100 %.
    expect(screen.getByTestId('forma-efectivo')).toHaveTextContent(/^Efectivo\$1\.00$/);
    expect(screen.getByTestId('formas-incompletas')).toHaveTextContent(
      'no se muestran porcentajes sobre una suma incompleta',
    );
    expect(tarjeta('Formas de pago')).not.toHaveTextContent('%');
    expect(screen.queryByTestId('dona-formas')).not.toBeInTheDocument();
  });

  it('todas las formas ilegibles: "Sin dato" en cada una, y no "Sin pagos"', async () => {
    apiDashboard({
      'GET /ventas/formas-pago': () =>
        json(200, { ...FORMAS, formas: FORMAS.formas.map((f) => ({ ...f, monto: 'x' })) }),
    });
    montar(`/?empresa=${A}`);

    for (const forma of ['efectivo', 'tarjeta', 'transferencia', 'otro']) {
      expect(await screen.findByTestId(`forma-${forma}`)).toHaveTextContent('Sin dato');
    }
    expect(screen.getByTestId('formas-incompletas')).toBeInTheDocument();
    expect(tarjeta('Formas de pago')).not.toHaveTextContent('Sin pagos');
    expect(tarjeta('Formas de pago')).not.toHaveTextContent('$0.00');
  });

  it('con "Hoy", la gráfica por hora termina en la hora en curso; otro periodo, las 24 (F2-201)', async () => {
    // AHORA = 21:30 de CDMX: se dibujan 00:00…21:00, las 22 horas que ya ocurrieron.
    apiDashboard();
    montar(`/?empresa=${A}`);
    expect(await screen.findByTestId('grafica-por-hora')).toHaveAttribute('data-horas', '22');
    cleanup();
    apiDashboard();
    montar(`/?empresa=${A}&periodo=mes`);
    expect(await screen.findByTestId('grafica-por-hora')).toHaveAttribute('data-horas', '24');
  });

  it('una hora con importe ilegible lo avisa bajo la gráfica', async () => {
    apiDashboard({
      'GET /ventas/por-hora': () =>
        json(
          200,
          POR_HORA.map((f) => (f.hora === 13 ? { ...f, venta: 'mucho' } : f)),
        ),
    });
    montar(`/?empresa=${A}`);
    expect(await screen.findByTestId('horas-sin-dato')).toHaveTextContent(
      'Alguna hora no trae un importe legible',
    );
  });

  it('si un endpoint falla, esa tarjeta lo dice y las demás siguen', async () => {
    apiDashboard({
      'GET /ventas/formas-pago': () => json(500, { statusCode: 500, message: 'Falló la base' }),
    });
    montar(`/?empresa=${A}`);

    const formas = await screen.findByRole('region', { name: 'Formas de pago' });
    expect(await within(formas).findByRole('alert')).toHaveTextContent(
      'No se pudo cargar este dato. Falló la base',
    );
    expect(await screen.findByTestId('venta-total')).toHaveTextContent('$15,234.50');
    expect(screen.getByTestId('venta-en-vivo')).toHaveTextContent('$1,550.50');
  });
});

describe('Venta en vivo con una sucursal desconectada (F1-094)', () => {
  /** Centro fresco (30 s) y Tijuana con un snapshot de `edadTijuana` segundos. */
  function conTijuana(edadTijuana: number, edadCentro = 30): MesasSucursal[] {
    const [centro] = mesas();
    centro.snapshot!.edadRecepcionSegundos = edadCentro;
    return [
      centro,
      {
        sucursalId: SUCURSAL_A2.id,
        nombre: 'Tijuana',
        zonaHoraria: 'America/Tijuana',
        snapshot: {
          capturadoAt: new Date(AHORA.getTime() - edadTijuana * 1000).toISOString(),
          recibidoAt: new Date(AHORA.getTime() - edadTijuana * 1000).toISOString(),
          edadSegundos: edadTijuana,
          edadRecepcionSegundos: edadTijuana,
          mesas: [{ total: '9999.00' }],
        },
      },
    ];
  }

  it('Inicio y Monitor muestran la misma cifra, y la desconectada se nombra', async () => {
    apiDashboard({ 'GET /mesas/abiertas': () => json(200, conTijuana(7200)) });
    montar(`/?empresa=${A}`);

    expect(await screen.findByTestId('venta-en-vivo')).toHaveTextContent('$1,550.50');
    expect(tarjeta('Venta en vivo')).toHaveTextContent('2 mesas abiertas');
    expect(tarjeta('Venta en vivo')).not.toHaveTextContent('9,999');
    // "dato de hace…" es el de lo que se suma, no las 2 h de Tijuana.
    expect(tarjeta('Venta en vivo')).toHaveTextContent('dato de hace menos de 1 min');
    expect(screen.getByTestId('vivo-desconectadas')).toHaveTextContent(
      'Desconectadas, sin contar: Tijuana.',
    );
    const enInicio = screen.getByTestId('venta-en-vivo').textContent;

    cleanup();
    montar(`/mesas?empresa=${A}`);
    expect(await screen.findByTestId('kpi-en-curso')).toHaveTextContent(enInicio!);
    expect(screen.getByTestId('kpi-mesas')).toHaveTextContent('2');
  });

  it('si todas las que reportan están desconectadas no hay cifra, ni $0.00', async () => {
    apiDashboard({ 'GET /mesas/abiertas': () => json(200, conTijuana(7200, 7200)) });
    montar(`/?empresa=${A}`);

    expect(
      await within(await screen.findByRole('region', { name: 'Venta en vivo' })).findByText(
        'No hay datos en vivo que mostrar.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('venta-en-vivo')).not.toBeInTheDocument();
    expect(tarjeta('Venta en vivo')).not.toHaveTextContent('$0.00');
    expect(screen.getByTestId('vivo-desconectadas')).toHaveTextContent('Centro, Tijuana');
  });

  it('sin respuesta nueva, la sucursal que pasa los 90 s sale sola de la suma', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    apiDashboard({ 'GET /mesas/abiertas': () => json(200, conTijuana(80)) });
    montar(`/?empresa=${A}`);
    expect(await screen.findByTestId('venta-en-vivo')).toHaveTextContent('$11,549.50');

    // Dos pulsos del reloj (10 s) y ningún refresco (20 s): Tijuana llega a ~90 s.
    // Uno más y pasa el umbral sin que la API conteste nada nuevo.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    await waitFor(() => expect(screen.getByTestId('venta-en-vivo')).toHaveTextContent('$1,550.50'));
    expect(screen.getByTestId('vivo-desconectadas')).toHaveTextContent('Tijuana');
  });
});

describe('refresco', () => {
  it('"Refrescar" vuelve a pedir las cuatro consultas', async () => {
    const api = apiDashboard();
    const usuarioEvt = userEvent.setup();
    montar(`/?empresa=${A}`);
    await screen.findByTestId('venta-total');
    await screen.findByTestId('venta-en-vivo');
    await waitFor(() => expect(screen.getByRole('button', { name: 'Refrescar' })).toBeEnabled());

    await usuarioEvt.click(screen.getByRole('button', { name: 'Refrescar' }));

    await waitFor(() => {
      for (const ruta of [
        '/ventas/resumen',
        '/ventas/por-hora',
        '/ventas/formas-pago',
        '/mesas/abiertas',
      ]) {
        expect(pedidas(api, ruta), ruta).toHaveLength(2);
      }
    });
  });

  it('con un periodo que incluye hoy se refresca solo cada 60 s', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    const api = apiDashboard();
    montar(`/?empresa=${A}&periodo=mes`);
    await screen.findByTestId('venta-total');
    expect(pedidas(api, '/ventas/resumen')).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    await waitFor(() => expect(pedidas(api, '/ventas/resumen')).toHaveLength(2));
    expect(pedidas(api, '/mesas/abiertas').length).toBeGreaterThanOrEqual(2);
  });

  it('con un periodo que no incluye hoy, los agregados no se refrescan solos (el vivo sí)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    const api = apiDashboard();
    montar(`/?empresa=${A}&periodo=mes-anterior`);
    await screen.findByTestId('venta-total');
    await screen.findByTestId('venta-en-vivo');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // El vivo cada 20 s (como el Monitor): 1 + 3 en 60 s. Los agregados, ninguno más.
    await waitFor(() => expect(pedidas(api, '/mesas/abiertas')).toHaveLength(4));
    expect(pedidas(api, '/ventas/resumen')).toHaveLength(1);
    expect(pedidas(api, '/ventas/por-hora')).toHaveLength(1);
  });
});
