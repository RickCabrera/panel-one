import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FilaRendimientoMesero, RendimientoMeseros, SucursalRendimiento } from '../api/tipos';
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

// F2-231 en el web, contra el router y la app reales: la vista Meseros (`/meseros`). Cifras
// escritas a mano (las mismas del e2e del api).

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-22T20:00:00Z');
const RUTA = `/meseros?empresa=${A}&periodo=mes-anterior`;

function fila(p: Partial<FilaRendimientoMesero>): FilaRendimientoMesero {
  return {
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    mesero: 'Ana López',
    textosPos: ['Ana López'],
    cruce: 'catalogo',
    catalogo: null,
    venta: '0.00',
    cuentas: 0,
    ticketPromedio: null,
    comensales: 0,
    cuentasConComensales: 0,
    propina: '0.00',
    descuentos: { monto: '0.00', cuentas: 0 },
    cancelados: { cuentas: 0, monto: '0.00' },
    minutosPromedio: null,
    cuentasConDuracion: 0,
    posicion: null,
    ...p,
  };
}

const catalogo = (id: string, clave: string, nombre: string, activoPos: boolean | null = true) => ({
  id,
  clave,
  nombre,
  activo: true,
  activoPos,
  vistoAt: '2026-09-12T10:00:00Z',
});

const PEDRO = fila({
  mesero: 'Pedro Baja',
  textosPos: ['Pedro Baja'],
  catalogo: catalogo('m2', 'M2', 'Pedro Baja', false),
  venta: '200.00',
  cuentas: 1,
  ticketPromedio: '200.00',
  cancelados: { cuentas: 1, monto: '80.00' },
  minutosPromedio: '60.0',
  cuentasConDuracion: 1,
  posicion: 1,
});
const ANA = fila({
  textosPos: ['ANA LÓPEZ', 'Ana López'],
  catalogo: catalogo('m1', 'M1', 'Ana López', null),
  venta: '150.50',
  cuentas: 2,
  ticketPromedio: '75.25',
  comensales: 4,
  cuentasConComensales: 2,
  propina: '5.00',
  descuentos: { monto: '10.00', cuentas: 1 },
  minutosPromedio: '60.0',
  cuentasConDuracion: 1,
  posicion: 2,
});
const SIN_MESERO = fila({
  mesero: null,
  textosPos: [],
  cruce: 'sin-mesero',
  venta: '20.00',
  cuentas: 1,
  ticketPromedio: '20.00',
});
const TIJUANA = fila({
  sucursalId: SUCURSAL_A2.id,
  sucursal: 'Tijuana',
  cruce: 'sin-sincronizar',
  venta: '40.00',
  cuentas: 1,
  ticketPromedio: '40.00',
  posicion: 1,
});

const sucursal = (
  s: { id: string; nombre: string },
  p: Partial<SucursalRendimiento>,
): SucursalRendimiento => ({
  sucursalId: s.id,
  sucursal: s.nombre,
  catalogoSincronizado: true,
  meserosEnRanking: 0,
  venta: '0.00',
  cuentas: 0,
  promedio: {
    ventaPorMesero: null,
    cuentasPorMesero: null,
    propinaPorMesero: null,
    comensalesPorMesero: null,
    ticketPromedio: null,
    minutosPromedio: null,
  },
  ...p,
});

const DATOS: RendimientoMeseros = {
  venta: '410.50',
  cuentas: 5,
  descuentos: { monto: '10.00', cuentas: 1 },
  cancelados: { cuentas: 1, monto: '80.00' },
  catalogoTruncado: false,
  sucursales: [
    sucursal(SUCURSAL_A1, {
      meserosEnRanking: 2,
      venta: '370.50',
      cuentas: 4,
      promedio: {
        ventaPorMesero: '175.25',
        cuentasPorMesero: '1.5',
        propinaPorMesero: '2.50',
        comensalesPorMesero: '2.0',
        ticketPromedio: '92.63',
        minutosPromedio: '60.0',
      },
    }),
    sucursal(SUCURSAL_A2, {
      catalogoSincronizado: false,
      meserosEnRanking: 1,
      venta: '40.00',
      cuentas: 1,
    }),
  ],
  filas: [PEDRO, ANA, SIN_MESERO, TIJUANA],
  sinVentas: [
    {
      ...catalogo('m4', 'M4', 'Sin Ventas'),
      sucursalId: SUCURSAL_A1.id,
      sucursal: 'Centro',
    },
  ],
};

function api(extra: Record<string, Manejador> = {}) {
  const u = usuario('visor');
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /catalogos/meseros/rendimiento': () => json(200, DATOS),
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
  within(await screen.findByTestId('tabla-meseros')).getAllByTestId('fila-mesero');

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

describe('Meseros (F2-231)', () => {
  it('pide el rendimiento con el alcance y el periodo global', async () => {
    const llamadas = api();
    montar(RUTA);
    await filas();
    const pedida = llamadas.llamadas.find((l) => l.ruta === '/catalogos/meseros/rendimiento')!;
    expect(pedida.query.get('empresaId')).toBe(A);
    expect(pedida.query.get('desde')).toBe('2026-08-01');
    expect(pedida.query.get('hasta')).toBe('2026-08-31');
  });

  it('tabla con posición, estado y cancelaciones/descuentos como conteo e importe, fuera de la venta', async () => {
    api();
    montar(RUTA);
    const [pedro, ana, sin, tijuana] = await filas();
    expect(pedro).toHaveTextContent('1 de 2');
    expect(pedro).toHaveTextContent('Dado de baja en el POS');
    expect(within(pedro).getByTestId('mesero-venta')).toHaveTextContent('$200.00');
    expect(within(pedro).getByTestId('mesero-cancelados')).toHaveTextContent('1 · $80.00');
    expect(within(ana).getByTestId('mesero-descuentos')).toHaveTextContent('$10.00 · 1');
    expect(ana).toHaveTextContent('En el POS (sin dato de baja)');
    expect(sin).toHaveTextContent('Sin mesero');
    expect(sin).toHaveTextContent('Cuentas sin mesero');
    expect(tijuana).toHaveTextContent('Catálogo sin sincronizar');
    expect(screen.getByTestId('meseros-cuadre')).toHaveTextContent(
      'suma la venta del periodo: $410.50',
    );
    expect(screen.getByTestId('meseros-cancelados')).toHaveTextContent(
      '1 cuenta por $80.00 (no suman a la venta)',
    );
    // La sucursal sin catálogo lo dice y qué haría falta.
    expect(screen.getByTestId('meseros-sin-catalogo')).toHaveTextContent(
      'Tijuana no ha enviado su catálogo de meseros',
    );
    expect(screen.getByTestId('meseros-sin-ventas')).toHaveTextContent('Sin Ventas');
  });

  it('la ficha compara contra el promedio de SU sucursal, con texto y no sólo color', async () => {
    api();
    montar(RUTA);
    const [, anaCentro] = await filas();
    await userEvent.click(within(anaCentro).getByRole('button', { name: 'Ana López' }));
    const ficha = await screen.findByTestId('ficha-mesero');
    expect(within(ficha).getByTestId('ficha-posicion')).toHaveTextContent(
      'Lugar 2 de 2 por venta en Centro.',
    );
    const comparacion = within(ficha).getByTestId('ficha-comparacion');
    const venta = within(comparacion).getByRole('row', { name: /^Venta/ });
    // 150.50 contra 175.25 = −14.1 %
    expect(venta).toHaveTextContent('$150.50$175.25−14.1 % abajo del promedio');
    const ticket = within(comparacion).getByRole('row', { name: /^Ticket promedio/ });
    expect(ticket).toHaveTextContent('$75.25$92.63−18.8 % abajo del promedio');
    const mesa = within(comparacion).getByRole('row', { name: /^Tiempo promedio de mesa/ });
    expect(mesa).toHaveTextContent('60.0 min60.0 min0.0 % igual al promedio');
    expect(within(ficha).getByTestId('ficha-descuentos')).toHaveTextContent('$10.00 en 1 cuenta');
    expect(ficha).toHaveTextContent(
      'En el POS aparece escrito de 2 formas (ANA LÓPEZ · Ana López)',
    );
  });

  it('sin ventas en el periodo lo explica, sin tabla de ceros', async () => {
    api({
      'GET /catalogos/meseros/rendimiento': () =>
        json(200, {
          ...DATOS,
          venta: '0.00',
          cuentas: 0,
          descuentos: { monto: '0.00', cuentas: 0 },
          cancelados: { cuentas: 0, monto: '0.00' },
          filas: [],
        }),
    });
    montar(RUTA);
    expect(await screen.findByText(/No hubo cuentas ni cancelaciones en el periodo/)).toBeVisible();
    expect(screen.queryByTestId('tabla-meseros')).toBeNull();
    expect(screen.queryByTestId('meseros-csv')).toBeNull();
  });

  it('exporta TODAS las filas a CSV con su nombre de periodo', async () => {
    const blobs: Blob[] = [];
    const nombres: string[] = [];
    const originales = { crear: URL.createObjectURL, revocar: URL.revokeObjectURL };
    URL.createObjectURL = (b: Blob | MediaSource) => {
      blobs.push(b as Blob);
      return 'blob:falso';
    };
    URL.revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      nombres.push(this.download);
    });
    try {
      api();
      montar(RUTA);
      await filas();
      await userEvent.click(screen.getByTestId('meseros-csv'));
      expect(nombres).toEqual(['meseros_2026-08-01_2026-08-31.csv']);
      const contenido = new TextDecoder().decode(new Uint8Array(await blobs[0].arrayBuffer()));
      // Encabezado + 4 filas + fin de línea final.
      expect(contenido.slice(1).split('\r\n')).toHaveLength(6);
    } finally {
      URL.createObjectURL = originales.crear;
      URL.revokeObjectURL = originales.revocar;
    }
  });
});
