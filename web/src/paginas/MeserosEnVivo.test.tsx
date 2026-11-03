import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MeserosEnVivo } from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import { formatearPesos } from '../dinero/dinero';
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
import { armarTablero } from './meseros/enVivo';

// MVP: "En vivo" de Meseros (cobrado de hoy + mesas abiertas), sobre la vista REAL y con cifras
// escritas a mano (las mismas del e2e del api para Centro).

const A = EMPRESA_A.id;
const AHORA = Date.parse('2026-10-22T22:00:00Z'); // 16:00 en CDMX
const RUTA = `/meseros?empresa=${A}&periodo=hoy`;

function datos(cambios: Partial<MeserosEnVivo> = {}, edadTijuana = 10): MeserosEnVivo {
  return {
    dia: '2026-10-22',
    sucursales: [
      {
        sucursalId: SUCURSAL_A1.id,
        nombre: 'Centro',
        zonaHoraria: 'America/Mexico_City',
        snapshot: {
          capturadoAt: '2026-10-22T21:59:50Z',
          recibidoAt: '2026-10-22T21:59:50Z',
          edadRecepcionSegundos: 10,
        },
      },
      {
        sucursalId: SUCURSAL_A2.id,
        nombre: 'Tijuana',
        zonaHoraria: 'America/Tijuana',
        snapshot: {
          capturadoAt: '2026-10-22T21:00:00Z',
          recibidoAt: '2026-10-22T21:00:00Z',
          edadRecepcionSegundos: edadTijuana,
        },
      },
    ],
    meseros: [
      fila(1, SUCURSAL_A1.id, 'Centro', 'Ana', '200.00', 2, '150.50', 1, '350.50', '100.00'),
      fila(1, SUCURSAL_A2.id, 'Tijuana', 'Ana', '0.00', 0, '300.00', 1, '300.00', null),
      fila(2, SUCURSAL_A1.id, 'Centro', 'Luis', '50.00', 1, '40.00', 1, '90.00', '50.00'),
      fila(null, SUCURSAL_A1.id, 'Centro', null, '30.00', 1, '10.00', 1, '40.00', '30.00'),
    ],
    totales: {
      cobrado: '280.00',
      cuentas: 4,
      enCurso: '500.50',
      mesasAbiertas: 4,
      mesasSinTotal: 0,
      total: '780.50',
    },
    ...cambios,
  };
}

function fila(
  posicion: number | null,
  sucursalId: string,
  sucursal: string,
  mesero: string | null,
  cobrado: string,
  cuentas: number,
  enCurso: string,
  mesasAbiertas: number,
  total: string,
  ticketPromedio: string | null,
) {
  return {
    posicion,
    sucursalId,
    sucursal,
    mesero,
    cobrado,
    cuentas,
    comensales: 0,
    ticketPromedio,
    mesasAbiertas,
    enCurso,
    mesasSinTotal: 0,
    comensalesEnMesa: 0,
    total,
  };
}

function montar(responder: () => MeserosEnVivo) {
  const u = usuario('visor');
  const api = instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /catalogos/meseros/rendimiento': () =>
      json(200, {
        venta: '0.00',
        cuentas: 0,
        descuentos: { monto: '0.00', cuentas: 0 },
        cancelados: { cuentas: 0, monto: '0.00' },
        sucursales: [],
        filas: [],
        sinVentas: [],
        catalogoTruncado: false,
      }),
    'GET /ventas/meseros-en-vivo': () => json(200, responder()),
  });
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  render(
    <MemoryRouter initialEntries={[RUTA]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
      </Proveedores>
    </MemoryRouter>,
  );
  return {
    pedidas: () => api.llamadas.filter((l) => l.ruta === '/ventas/meseros-en-vivo'),
  };
}

/** Los sockets abiertos por la vista (la cabecera y la sección comparten alcance). */
const vivos = () => sockets.filter((s) => s.conexiones > s.desconexiones || s.active);

const filasTabla = async () =>
  within(await screen.findByTestId('tabla-en-vivo')).getAllByTestId('fila-en-vivo');

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

describe('armarTablero (lo puro)', () => {
  it('con todo conectado: los totales del API, en centavos exactos', () => {
    const t = armarTablero(datos(), AHORA, AHORA);
    expect(formatearPesos(t.cobrado)).toBe('$280.00');
    expect(formatearPesos(t.enCurso)).toBe('$500.50');
    expect(t.mesasAbiertas).toBe(4);
    expect(t.filas.map((f) => [f.sucursal, f.mesero, f.posicion])).toEqual([
      ['Centro', 'Ana', 1],
      ['Tijuana', 'Ana', 1],
      ['Centro', 'Luis', 2],
      ['Centro', null, null],
    ]);
    expect(t.desconectadas).toEqual([]);
  });

  it('una sucursal desconectada no suma lo que tenía en curso (misma regla del Monitor)', () => {
    // 91 s de edad = desconectada (umbral de 90 s).
    const t = armarTablero(datos({}, 91), AHORA, AHORA);
    expect(t.desconectadas).toEqual(['Tijuana']);
    expect(formatearPesos(t.enCurso)).toBe('$200.50');
    // La Ana de Tijuana sólo tenía una mesa abierta: no queda nada que mostrar.
    expect(t.filas.map((f) => f.sucursal)).toEqual(['Centro', 'Centro', 'Centro']);
    // Y la edad sigue creciendo con el reloj del navegador aunque el API no conteste.
    expect(armarTablero(datos({}, 60), AHORA, AHORA + 31_000).desconectadas).toEqual(['Tijuana']);
  });
});

describe('Meseros: En vivo (MVP)', () => {
  it('pide el día de HOY de la sucursal y pinta cobrado, en curso, total y lugar', async () => {
    const vista = montar(() => datos());
    const [ana, anaTijuana, luis, sin] = await filasTabla();
    expect(vista.pedidas()[0].query.get('dia')).toBe('2026-10-22');
    expect(vista.pedidas()[0].query.get('empresaId')).toBe(A);
    expect(ana).toHaveTextContent('Ana');
    expect(within(ana).getByTestId('en-vivo-fila-en-curso')).toHaveTextContent('$150.50 · 1 mesa');
    expect(within(ana).getByTestId('en-vivo-fila-total')).toHaveTextContent('$350.50');
    expect(anaTijuana).toHaveTextContent('Tijuana');
    expect(luis).toHaveTextContent('$50.00');
    expect(sin).toHaveTextContent('Sin mesero');
    expect(screen.getByTestId('en-vivo-cobrado')).toHaveTextContent('$280.00');
    expect(screen.getByTestId('en-vivo-en-curso')).toHaveTextContent('$500.50');
  });

  it('un aviso de ingesta por el socket se ve sin esperar al polling', async () => {
    let actual = datos();
    const vista = montar(() => actual);
    await filasTabla();
    await act(async () => {
      for (const s of vivos()) s.simularConexion();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByTestId('en-vivo-modo')).toHaveAttribute('data-modo', 'en-vivo'),
    );
    const antes = vista.pedidas().length;

    actual = datos({
      totales: { ...datos().totales, cobrado: '380.00', total: '880.50' },
      meseros: [
        fila(1, SUCURSAL_A1.id, 'Centro', 'Ana', '300.00', 3, '150.50', 1, '450.50', '100.00'),
        ...datos().meseros.slice(1),
      ],
    });
    act(() => {
      for (const s of vivos()) {
        s.recibir('ingesta', { sucursalId: SUCURSAL_A1.id, mesas: false, cheques: true });
      }
    });
    // El socket agrupa los avisos (1 s): llega en < 5 s, sin esperar al polling de 20 s.
    await waitFor(
      () => expect(screen.getByTestId('en-vivo-cobrado')).toHaveTextContent('$380.00'),
      { timeout: 5_000 },
    );
    expect(vista.pedidas().length).toBeGreaterThan(antes);
  });

  it('sin socket se refresca solo cada 20 s', async () => {
    let actual = datos();
    const vista = montar(() => actual);
    await filasTabla();
    expect(screen.getByTestId('en-vivo-modo')).toHaveTextContent('cada 20 s');
    actual = datos({ totales: { ...datos().totales, cobrado: '999.00' } });
    const antes = vista.pedidas().length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await waitFor(() => expect(vista.pedidas().length).toBeGreaterThan(antes));
    // El total de arriba sale de las filas (no del campo del API): no cambia con sólo los totales.
    expect(screen.getByTestId('en-vivo-cobrado')).toHaveTextContent('$280.00');
  });

  it('una sucursal desconectada lo dice y su en curso no se muestra como vivo', async () => {
    montar(() => datos({}, 600));
    await filasTabla();
    expect(screen.getByTestId('en-vivo-desconectadas')).toHaveTextContent('Tijuana');
    expect(screen.getByTestId('en-vivo-en-curso')).toHaveTextContent('$200.50');
  });
});
