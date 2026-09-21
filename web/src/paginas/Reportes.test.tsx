import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProductoTop, Resumen, VentaDia, VentaSucursal } from '../api/tipos';
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

// 2026-09-21 03:30 UTC = 20-sep 21:30 en CDMX. "Hoy" del panel es el 20.
const AHORA = new Date('2026-09-21T03:30:00Z');
const HOY = '2026-09-20';
const RANGO = 'periodo=rango&desde=2026-09-18&hasta=2026-09-20';

// Un juego COHERENTE, como lo devuelve la API: Σ por día = Σ comparativo = resumen.
// (Que la API lo cumpla lo prueban sus tests contra Postgres; aquí se prueba que la
// vista suma sin perder un centavo y pinta lo mismo que el Panel de ventas.)
const POR_DIA: VentaDia[] = [
  { dia: '2026-09-18', venta: '5000.25', cuentas: 10 },
  { dia: '2026-09-19', venta: '0.00', cuentas: 0 },
  { dia: '2026-09-20', venta: '10234.25', cuentas: 32 },
];
const COMPARATIVO: VentaSucursal[] = [
  {
    sucursalId: SUCURSAL_A1.id,
    nombre: 'Centro',
    venta: '8000.00',
    cuentas: 20,
    ticketPromedio: '400.00',
    comensales: 50,
  },
  {
    sucursalId: SUCURSAL_A2.id,
    nombre: 'Tijuana',
    venta: '7234.50',
    cuentas: 22,
    ticketPromedio: '328.84',
    comensales: 47,
  },
];
const TOP_IMPORTE: ProductoTop[] = [
  { producto: 'Tacos al pastor', importe: '5230.00', cantidad: '120.000' },
  { producto: 'Agua de horchata', importe: '980.50', cantidad: '98.000' },
];
const TOP_CANTIDAD: ProductoTop[] = [
  { producto: 'Tortillas extra', importe: '150.00', cantidad: '300.000' },
  { producto: 'Tacos al pastor', importe: '5230.00', cantidad: '120.000' },
];
const RESUMEN: Resumen = {
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
};

function apiReportes(extra: Record<string, Manejador> = {}) {
  const u = usuario('visor');
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /ventas/por-dia': () => json(200, POR_DIA),
    'GET /ventas/comparativo-sucursales': (l: Llamada) =>
      json(200, l.query.get('sucursalId') === SUCURSAL_A1.id ? [COMPARATIVO[0]] : COMPARATIVO),
    'GET /ventas/top-productos': (l: Llamada) =>
      json(200, l.query.get('por') === 'cantidad' ? TOP_CANTIDAD : TOP_IMPORTE),
    // Para comparar con el Panel de ventas.
    'GET /ventas/resumen': () => json(200, RESUMEN),
    'GET /ventas/por-hora': () => json(200, []),
    'GET /ventas/formas-pago': () => json(200, { formas: [], sinCatalogo: [] }),
    'GET /mesas/abiertas': () => json(200, []),
    ...extra,
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

const tarjeta = (nombre: string) => screen.getByRole('region', { name: nombre });
/** La vista aparece después del refresh de sesión: hay que esperarla. */
const esperarTarjeta = (nombre: string) => screen.findByRole('region', { name: nombre });
const pedidas = (api: ReturnType<typeof apiReportes>, ruta: string) =>
  api.llamadas.filter((l) => l.ruta === ruta);

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

describe('Reportes: los números son los de la API', () => {
  it('pinta los tres reportes y pide con el alcance y el periodo de la URL', async () => {
    const api = apiReportes();
    montar(`/reportes?empresa=${A}&${RANGO}`);

    expect(await screen.findByTestId('total-por-dia')).toHaveTextContent('$15,234.50');
    const porDia = await esperarTarjeta('Ventas por día');
    expect(porDia).toHaveTextContent('42 cuentas cerradas en 3 días');
    expect(within(porDia).getByTestId('dia-2026-09-18')).toHaveTextContent('$5,000.2510');
    expect(within(porDia).getByTestId('dia-2026-09-19')).toHaveTextContent('$0.000');
    expect(within(porDia).getByTestId('fila-total')).toHaveTextContent('Total$15,234.5042');

    const comparativo = await esperarTarjeta('Comparativo entre sucursales');
    await within(comparativo).findByTestId(`sucursal-${SUCURSAL_A2.id}`);
    expect(within(comparativo).getByTestId(`sucursal-${SUCURSAL_A1.id}`)).toHaveTextContent(
      'Centro$8,000.0020$400.0050',
    );
    expect(within(comparativo).getByTestId('fila-total')).toHaveTextContent(
      'Total$15,234.5042$362.7397',
    );

    const top = await esperarTarjeta('Top productos');
    expect(await within(top).findByTestId('top-1')).toHaveTextContent(
      '1Tacos al pastor$5,230.00120',
    );
    expect(within(top).getByTestId('top-2')).toHaveTextContent('2Agua de horchata$980.5098');

    for (const ruta of [
      '/ventas/por-dia',
      '/ventas/comparativo-sucursales',
      '/ventas/top-productos',
    ]) {
      const [l] = pedidas(api, ruta);
      expect(l.query.get('empresaId'), ruta).toBe(A);
      expect(l.query.get('sucursalId'), ruta).toBeNull();
      expect(l.query.get('desde'), ruta).toBe('2026-09-18');
      expect(l.query.get('hasta'), ruta).toBe('2026-09-20');
    }
    const [t] = pedidas(api, '/ventas/top-productos');
    expect(t.query.get('por')).toBe('importe');
    expect(t.query.get('limite')).toBe('10');
  });

  it('sin periodo, "hoy" es el de la zona del panel, no el de UTC', async () => {
    const api = apiReportes();
    montar(`/reportes?empresa=${A}`);
    await screen.findByTestId('total-por-dia');
    const [l] = pedidas(api, '/ventas/por-dia');
    expect(l.query.get('desde')).toBe(HOY);
    expect(l.query.get('hasta')).toBe(HOY);
  });

  it('los totales de los reportes son la Venta total del Panel de ventas para el mismo periodo', async () => {
    apiReportes();
    montar(`/?empresa=${A}&${RANGO}`);
    const ventaPanel = (await screen.findByTestId('venta-total')).textContent;
    cleanup();

    montar(`/reportes?empresa=${A}&${RANGO}`);
    expect(await screen.findByTestId('total-por-dia')).toHaveTextContent(ventaPanel!);
    const comparativo = await esperarTarjeta('Comparativo entre sucursales');
    await within(comparativo).findByTestId('fila-total');
    expect(within(comparativo).getByTestId('fila-total')).toHaveTextContent(ventaPanel!);
    expect(within(comparativo).getByTestId('total-ticket-promedio')).toHaveTextContent('$362.73');
  });
});

describe('Top productos', () => {
  it('ordenar por cantidad y cambiar el límite vuelve a pedir con esos parámetros', async () => {
    const user = userEvent.setup();
    const api = apiReportes();
    montar(`/reportes?empresa=${A}&${RANGO}`);
    const top = await esperarTarjeta('Top productos');
    await within(top).findByTestId('top-1');

    await user.click(within(top).getByRole('button', { name: 'Por cantidad' }));
    await waitFor(() =>
      expect(within(top).getByTestId('top-1')).toHaveTextContent('1Tortillas extra$150.00300'),
    );
    expect(within(top).getByRole('button', { name: 'Por cantidad' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    await user.selectOptions(within(top).getByLabelText('Mostrar'), '50');
    await waitFor(() =>
      expect(pedidas(api, '/ventas/top-productos').at(-1)?.query.get('limite')).toBe('50'),
    );
    expect(pedidas(api, '/ventas/top-productos').at(-1)?.query.get('por')).toBe('cantidad');
  });
});

describe('cambiar el alcance nunca muestra los datos del anterior', () => {
  it('con otra sucursal: skeleton mientras llega, y luego sólo esa', async () => {
    const user = userEvent.setup();
    let soltar: () => void = () => {};
    const pendiente = new Promise<void>((r) => (soltar = r));
    const api = apiReportes({
      'GET /ventas/comparativo-sucursales': async (l: Llamada) => {
        if (l.query.get('sucursalId') === SUCURSAL_A1.id) {
          await pendiente;
          return json(200, [COMPARATIVO[0]]);
        }
        return json(200, COMPARATIVO);
      },
    });
    montar(`/reportes?empresa=${A}&${RANGO}`);
    const comparativo = await esperarTarjeta('Comparativo entre sucursales');
    await within(comparativo).findByTestId(`sucursal-${SUCURSAL_A2.id}`);

    const selector = screen.getByLabelText('Sucursal');
    await waitFor(() => expect(selector).toBeEnabled());
    await user.selectOptions(selector, SUCURSAL_A1.id);

    await waitFor(() => expect(within(comparativo).getByTestId('esqueleto')).toBeInTheDocument());
    expect(within(comparativo).queryByTestId(`sucursal-${SUCURSAL_A2.id}`)).toBeNull();
    expect(within(comparativo).queryByTestId('fila-total')).toBeNull();

    act(() => soltar());
    await within(comparativo).findByTestId(`sucursal-${SUCURSAL_A1.id}`);
    expect(within(comparativo).queryByTestId(`sucursal-${SUCURSAL_A2.id}`)).toBeNull();
    expect(within(comparativo).getByTestId('fila-total')).toHaveTextContent('Total$8,000.0020');
    expect(pedidas(api, '/ventas/comparativo-sucursales').at(-1)?.query.get('sucursalId')).toBe(
      SUCURSAL_A1.id,
    );
  });
});

describe('importes ilegibles y errores', () => {
  it('un importe ilegible nunca se pinta como $0.00: la fila lo dice y el total es "Sin dato"', async () => {
    apiReportes({
      'GET /ventas/por-dia': () =>
        json(200, [POR_DIA[0], { dia: '2026-09-19', venta: '12,00', cuentas: 1 }]),
    });
    montar(`/reportes?empresa=${A}&${RANGO}`);
    const porDia = await esperarTarjeta('Ventas por día');
    expect(await within(porDia).findByTestId('total-por-dia')).toHaveTextContent('Sin dato');
    expect(within(porDia).getByTestId('dia-2026-09-19')).toHaveTextContent('Importe inválido');
    expect(within(porDia).getByTestId('fila-total')).toHaveTextContent('TotalSin dato');
    expect(porDia).not.toHaveTextContent('$0.00');
  });

  it('si un reporte falla, lo dice y los otros siguen', async () => {
    apiReportes({
      'GET /ventas/top-productos': () => json(500, { statusCode: 500, message: 'Falló' }),
    });
    montar(`/reportes?empresa=${A}&${RANGO}`);
    expect(
      await within(await esperarTarjeta('Top productos')).findByRole('alert'),
    ).toHaveTextContent('No se pudo cargar');
    expect(await screen.findByTestId('total-por-dia')).toHaveTextContent('$15,234.50');
    await within(await esperarTarjeta('Comparativo entre sucursales')).findByTestId('fila-total');
  });

  it('un rango inválido no consulta', async () => {
    const api = apiReportes();
    montar(`/reportes?empresa=${A}&periodo=rango&desde=2026-09-20&hasta=2026-09-01`);
    expect(
      await screen.findByText('Corrige el rango de fechas para ver los reportes.'),
    ).toBeVisible();
    expect(pedidas(api, '/ventas/por-dia')).toHaveLength(0);
  });
});

describe('export CSV por reporte', () => {
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

  async function lineas(blob: Blob): Promise<string[]> {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    return new TextDecoder().decode(bytes.slice(3)).replace(/\r\n$/, '').split('\r\n');
  }

  it('cada reporte baja su propio archivo con lo que se ve en pantalla', async () => {
    const user = userEvent.setup();
    const { blobs, nombres } = capturarDescarga();
    apiReportes();
    montar(`/reportes?empresa=${A}&${RANGO}`);
    await screen.findByTestId('total-por-dia');
    await within(await esperarTarjeta('Comparativo entre sucursales')).findByTestId('fila-total');
    await within(await esperarTarjeta('Top productos')).findByTestId('top-1');

    for (const nombre of ['Ventas por día', 'Comparativo entre sucursales', 'Top productos']) {
      await user.click(within(tarjeta(nombre)).getByRole('button', { name: 'Exportar CSV' }));
    }
    expect(nombres).toEqual([
      'ventas-por-dia_2026-09-18_2026-09-20.csv',
      'comparativo-sucursales_2026-09-18_2026-09-20.csv',
      'top-productos-por-importe_2026-09-18_2026-09-20.csv',
    ]);
    expect(await lineas(blobs[0])).toEqual([
      'Día,Venta,Cuentas',
      '2026-09-18,5000.25,10',
      '2026-09-19,0.00,0',
      '2026-09-20,10234.25,32',
    ]);
    expect(await lineas(blobs[1])).toEqual([
      'Sucursal,Venta,Tickets,Ticket promedio,Comensales',
      'Centro,8000.00,20,400.00,50',
      'Tijuana,7234.50,22,328.84,47',
    ]);
    expect(await lineas(blobs[2])).toEqual([
      'Posición,Producto,Importe,Cantidad',
      '1,Tacos al pastor,5230.00,120.000',
      '2,Agua de horchata,980.50,98.000',
    ]);
  });

  it('con una sucursal elegida, el nombre del archivo la lleva', async () => {
    const user = userEvent.setup();
    const { nombres } = capturarDescarga();
    apiReportes();
    montar(`/reportes?empresa=${A}&sucursal=${SUCURSAL_A1.id}&${RANGO}`);
    const comparativo = await esperarTarjeta('Comparativo entre sucursales');
    await within(comparativo).findByTestId('fila-total');
    await user.click(within(comparativo).getByRole('button', { name: 'Exportar CSV' }));
    expect(nombres).toEqual(['comparativo-sucursales_2026-09-18_2026-09-20_centro.csv']);
  });

  it('un importe ilegible: avisa y no descarga nada', async () => {
    const user = userEvent.setup();
    const { click } = capturarDescarga();
    apiReportes({
      'GET /ventas/por-dia': () => json(200, [{ dia: '2026-09-18', venta: '1e3', cuentas: 1 }]),
    });
    montar(`/reportes?empresa=${A}&${RANGO}`);
    const porDia = await esperarTarjeta('Ventas por día');
    await within(porDia).findByTestId('total-por-dia');
    await user.click(within(porDia).getByRole('button', { name: 'Exportar CSV' }));
    expect(await within(porDia).findByRole('alert')).toHaveTextContent('venta inválida');
    expect(click).not.toHaveBeenCalled();
  });
});
