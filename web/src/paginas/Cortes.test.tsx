import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { DetalleCorte, ListaCortes, ResumenCorte } from '../api/tipos';
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

// MVP: la vista Cortes (`/cortes`) contra el router y la app reales. Cifras escritas a mano:
// las mismas del e2e del api (turno 7 cerrado con $415.50; turno 8 abierto con $108.00).

const A = EMPRESA_A.id;
const AHORA = new Date('2026-10-22T22:00:00Z');
const RUTA = `/cortes?empresa=${A}&periodo=hoy`;

const T8: ResumenCorte = {
  id: 'c0000000-0000-4000-8000-000000000008',
  sucursalId: SUCURSAL_A1.id,
  sucursal: 'Centro',
  zonaHoraria: 'America/Mexico_City',
  turnoSr: '8',
  aperturaAt: '2026-10-22T20:06:00.000Z',
  cierreAt: null,
  abierto: true,
  estacion: 'CAJA1',
  fondo: '300.00',
  venta: '108.00',
  cuentas: 1,
  ticketPromedio: '108.00',
};

const T7: ResumenCorte = {
  ...T8,
  id: 'c0000000-0000-4000-8000-000000000007',
  turnoSr: '7',
  aperturaAt: '2026-10-19T15:00:00.000Z',
  cierreAt: '2026-10-22T20:05:00.000Z',
  abierto: false,
  fondo: '500.00',
  venta: '415.50',
  cuentas: 2,
  ticketPromedio: '207.75',
};

const DETALLE_T7: DetalleCorte = {
  ...T7,
  comensales: { total: 3, cuentasConDato: 1 },
  propina: '25.50',
  descuentos: { monto: '10.00', cuentas: 1 },
  cancelados: { cuentas: 1, monto: '50.00' },
  formasPago: {
    formas: [
      { forma: 'efectivo', monto: '260.00' },
      { forma: 'tarjeta', monto: '115.50' },
      { forma: 'transferencia', monto: '0.00' },
      { forma: 'otro', monto: '40.00' },
    ],
    sinCatalogo: [{ formaRaw: 'CORTESIA RARA', monto: '40.00' }],
  },
  cobrado: '415.50',
  cuadre: [
    { concepto: 'efectivo', declarado: '1000.00', cobrado: '260.00', diferencia: '740.00' },
    { concepto: 'tarjeta', declarado: '100.00', cobrado: '115.50', diferencia: '-15.50' },
    { concepto: 'vales', declarado: '0.00', cobrado: null, diferencia: null },
    { concepto: 'credito', declarado: '0.00', cobrado: null, diferencia: null },
    { concepto: 'total', declarado: '1100.00', cobrado: '415.50', diferencia: '684.50' },
  ],
  topProductos: [
    { producto: 'Agua sintética', importe: '175.00', cantidad: '1.500' },
    { producto: 'Taco sintético', importe: '175.00', cantidad: '7.000' },
  ],
};

const DETALLE_T8: DetalleCorte = {
  ...DETALLE_T7,
  ...T8,
  cuadre: DETALLE_T7.cuadre.map((r) => ({ ...r, diferencia: null })),
};

function api(extra: Record<string, Manejador> = {}) {
  const u = usuario('visor');
  const lista: ListaCortes = { cortes: [T8, T7], truncado: false };
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /cortes': () => json(200, lista),
    [`GET /cortes/${T7.id}`]: () => json(200, DETALLE_T7),
    [`GET /cortes/${T8.id}`]: () => json(200, DETALLE_T8),
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

const filas = async () =>
  within(await screen.findByTestId('tabla-cortes')).getAllByTestId('fila-corte');

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
  vi.restoreAllMocks();
});

describe('Cortes (MVP)', () => {
  it('pide los cortes del periodo global con el alcance', async () => {
    const llamadas = api();
    montar(RUTA);
    await filas();
    const pedida = llamadas.llamadas.find((l) => l.ruta === '/cortes')!;
    expect(pedida.query.get('empresaId')).toBe(A);
    // "Hoy" en la zona del panel (CDMX): 22-oct a las 16:00.
    expect(pedida.query.get('desde')).toBe('2026-10-22');
    expect(pedida.query.get('hasta')).toBe('2026-10-22');
  });

  it('la lista: turno abierto y cerrado, horas en la zona de la sucursal y la venta', async () => {
    api();
    montar(RUTA);
    const [abierto, cerrado] = await filas();
    expect(abierto).toHaveTextContent('Turno 8 · CAJA1');
    expect(within(abierto).getByTestId('corte-abierto')).toHaveTextContent('Abierto');
    expect(abierto).toHaveTextContent('22/10/2026 14:06');
    expect(within(abierto).getByTestId('corte-venta')).toHaveTextContent('$108.00');
    expect(cerrado).toHaveTextContent('19/10/2026 09:00');
    expect(cerrado).toHaveTextContent('22/10/2026 14:05');
    expect(cerrado).toHaveTextContent('3 d 5 h');
    expect(within(cerrado).getByTestId('corte-venta')).toHaveTextContent('$415.50');
    expect(cerrado).toHaveTextContent('$207.75');
  });

  it('clic en un corte: detalle con formas de pago y declarado vs cobrado', async () => {
    api();
    montar(RUTA);
    const usuarioEvt = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const [, cerrado] = await filas();
    await usuarioEvt.click(within(cerrado).getByRole('button', { name: 'Turno 7 · CAJA1' }));
    const detalle = await screen.findByTestId('detalle-corte');
    expect(within(detalle).getByTestId('detalle-venta')).toHaveTextContent('$415.50');
    expect(within(detalle).getByTestId('detalle-cuentas')).toHaveTextContent('2');
    expect(within(detalle).getByTestId('detalle-canceladas')).toHaveTextContent('$50.00');
    const formas = within(detalle).getByTestId('detalle-formas');
    expect(formas).toHaveTextContent('Efectivo$260.00');
    expect(formas).toHaveTextContent('Total cobrado$415.50');
    expect(detalle).toHaveTextContent('CORTESIA RARA $40.00');
    expect(within(detalle).getByTestId('cuadre-efectivo')).toHaveTextContent(
      '$1,000.00$260.00$740.00 (sobrante)',
    );
    expect(within(detalle).getByTestId('cuadre-tarjeta')).toHaveTextContent('-$15.50 (faltante)');
    expect(within(detalle).getByTestId('cuadre-vales')).toHaveTextContent('$0.00——');
    expect(within(detalle).getByTestId('detalle-top')).toHaveTextContent('Taco sintético');
    expect(screen.queryByTestId('corte-en-curso')).not.toBeInTheDocument();
  });

  it('el detalle se abre desde la URL (?corte=) y un turno abierto dice que es acumulado', async () => {
    api();
    montar(`${RUTA}&corte=${T8.id}`);
    const detalle = await screen.findByTestId('detalle-corte');
    expect(within(detalle).getByTestId('corte-en-curso')).toHaveTextContent('acumulado en curso');
    expect(within(detalle).getByTestId('cuadre-total')).toHaveTextContent('$1,100.00$415.50—');
    const usuarioEvt = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    await usuarioEvt.click(within(detalle).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByTestId('detalle-corte')).not.toBeInTheDocument();
  });

  it('sin cortes lo dice; un corte ajeno o inexistente (404) muestra el error en su tarjeta', async () => {
    api({
      'GET /cortes': () => json(200, { cortes: [], truncado: false }),
      [`GET /cortes/${T7.id}`]: () =>
        json(404, { statusCode: 404, message: 'Recurso no encontrado' }),
    });
    montar(`${RUTA}&corte=${T7.id}`);
    expect(await screen.findByText(/No hubo turnos abiertos en el periodo/)).toBeInTheDocument();
    const detalle = await screen.findByRole('region', { name: 'Detalle del corte' });
    expect(await within(detalle).findByRole('alert')).toHaveTextContent('No se pudo cargar');
  });

  it('el menú lleva a Cortes, junto a Tickets', async () => {
    api();
    montar(`/tickets?empresa=${A}`);
    const enlace = await screen.findByRole('link', { name: 'Cortes' });
    expect(enlace.getAttribute('href')).toContain('/cortes');
  });
});
