import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  FilaMovimiento,
  Kardex,
  Movimientos as DatosMovimientos,
  PolizaDetalle,
  UsuarioActual,
} from '../api/tipos';
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
} from '../test/apiFalsa';

// F2-122 en el web, contra el router y la app reales: la vista Movimientos (`/movimientos`).
// Cifras escritas a mano (que el servidor las calcule bien lo prueban los e2e del api).

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-22T18:00:00Z');
const RUTA = `/movimientos?empresa=${A}&periodo=rango&desde=2026-09-01&hasta=2026-09-22`;

function mov(p: Partial<FilaMovimiento> & Pick<FilaMovimiento, 'id'>): FilaMovimiento {
  return {
    poliza: { id: 'pol-c', folio: 'POL-C', tipo: 'compra', cancelada: false, referencia: 'OC-7' },
    renglon: 0,
    // 16:00 UTC = 10:00 en CDMX.
    fecha: '2026-09-02T16:00:00.000Z',
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    almacenOrigenSrId: 'ALM1',
    almacen: 'General',
    insumoOrigenSrId: 'I1',
    insumo: 'Harina',
    clave: 'HAR',
    unidad: 'kg',
    cantidad: '5.000',
    costoUnitario: '22.00',
    importe: '110.00',
    ...p,
  };
}

const MOVS: FilaMovimiento[] = [
  mov({
    id: 'm-x',
    poliza: { id: 'pol-x', folio: 'POL-X', tipo: 'merma', cancelada: true, referencia: null },
    fecha: '2026-09-02T18:00:00.000Z',
    cantidad: '-100.000',
    costoUnitario: '20.00',
    importe: '-2000.00',
  }),
  mov({ id: 'm-c' }),
  mov({
    id: 'm-o',
    poliza: { id: 'pol-o', folio: 'POL-O', tipo: 'otro', cancelada: false, referencia: null },
    insumoOrigenSrId: 'I9',
    insumo: null,
    unidad: null,
    cantidad: '-0.500',
    costoUnitario: '21.00',
    importe: '-10.50',
  }),
];

function movimientos(p: Partial<DatosMovimientos> = {}): DatosMovimientos {
  return {
    movimientos: MOVS,
    total: 3,
    pagina: 1,
    porPagina: 50,
    sucursales: [
      {
        sucursalId: SUCURSAL_A1.id,
        sucursal: 'Centro',
        zonaHoraria: 'America/Mexico_City',
        polizasRecibidas: 5,
      },
      {
        sucursalId: SUCURSAL_A2.id,
        sucursal: 'Tijuana',
        zonaHoraria: 'America/Tijuana',
        polizasRecibidas: 0,
      },
    ],
    almacenes: [{ sucursalId: SUCURSAL_A1.id, almacenOrigenSrId: 'ALM1', almacen: 'General' }],
    ...p,
  };
}

const POLIZA: PolizaDetalle = {
  id: 'pol-c',
  origenSrId: 'C',
  folio: 'POL-C',
  tipo: 'compra',
  tipoSr: 'E',
  fecha: '2026-09-02T16:00:00.000Z',
  referencia: 'OC-7',
  cancelada: false,
  sucursalId: SUCURSAL_A1.id,
  sucursal: 'Centro',
  zonaHoraria: 'America/Mexico_City',
  almacenOrigenSrId: 'ALM1',
  almacen: 'General',
  recibidaAt: '2026-09-04T00:00:00.000Z',
  partidas: [
    {
      renglon: 0,
      insumoOrigenSrId: 'I1',
      insumo: 'Harina',
      clave: 'HAR',
      unidad: 'kg',
      cantidad: '5.000',
      costoUnitario: '22.00',
      importe: '110.00',
    },
    {
      renglon: 1,
      insumoOrigenSrId: 'I2',
      insumo: 'Azúcar',
      clave: 'AZU',
      unidad: null,
      cantidad: '2.000',
      costoUnitario: '5.00',
      importe: '10.00',
    },
  ],
  importeTotal: '120.00',
};

function kardex(p: Partial<Kardex> = {}): Kardex {
  return {
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    zonaHoraria: 'America/Mexico_City',
    almacenOrigenSrId: 'ALM1',
    almacen: 'General',
    insumoOrigenSrId: 'I1',
    insumo: 'Harina',
    clave: 'HAR',
    unidad: 'kg',
    polizasRecibidas: 5,
    saldoInicial: '7.500',
    movimientos: [
      { ...MOVS[1], saldo: '12.500' },
      { ...MOVS[0], saldo: '12.500' },
    ],
    saldoFinal: '12.500',
    entradas: '5.000',
    salidas: '0.000',
    // 12:00 UTC = 06:00 en CDMX.
    corteExistencia: '2026-09-03T12:00:00.000Z',
    existencia: '12.500',
    saldoAlCorte: '12.500',
    diferencia: '0.000',
    cuadra: true,
    ...p,
  };
}

function api(
  u: UsuarioActual,
  datos: () => DatosMovimientos = () => movimientos(),
  k: () => Kardex = () => kardex(),
) {
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /inventario/movimientos': () => json(200, datos()),
    'GET /inventario/polizas/pol-c': () => json(200, POLIZA),
    'GET /inventario/kardex': () => json(200, k()),
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

const tabla = () => screen.findByTestId('tabla-movimientos', undefined, { timeout: 5000 });

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

describe('Movimientos (F2-122)', () => {
  it('línea de tiempo: hora de la sucursal, signo visible, cancelada marcada y "otro" dicho', async () => {
    const f = api(usuario('visor'));
    montar(RUTA);
    const t = await tabla();
    const filas = within(t).getAllByRole('row').slice(1);
    expect(filas).toHaveLength(3);
    // 16:00 UTC → 10:00 en CDMX, nunca la hora del navegador.
    expect(filas[1]).toHaveTextContent('02/09/2026 10:00');
    expect(filas[1]).toHaveTextContent('+5');
    expect(filas[1]).toHaveTextContent('$110.00');
    expect(filas[0]).toHaveTextContent('Cancelada');
    expect(filas[0]).toHaveTextContent('−100');
    expect(filas[2]).toHaveTextContent('Otro (sin traducir)');
    expect(filas[2]).toHaveTextContent('Insumo I9 (sin catálogo)');
    // El periodo de la cabecera viaja a la consulta.
    const q = f.llamadas.find((l) => l.ruta === '/inventario/movimientos')!.query;
    expect([q.get('empresaId'), q.get('desde'), q.get('hasta')]).toEqual([
      A,
      '2026-09-01',
      '2026-09-22',
    ]);
    expect(screen.getByTestId('aviso-sin-movimientos')).toHaveTextContent('Tijuana');
  });

  it('el filtro de tipo viaja a la consulta', async () => {
    const f = api(usuario('visor'));
    montar(RUTA);
    await tabla();
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Tipo' }), 'merma');
    await vi.waitFor(() =>
      expect(
        f.llamadas.some(
          (l) => l.ruta === '/inventario/movimientos' && l.query.get('tipo') === 'merma',
        ),
      ).toBe(true),
    );
  });

  it('detalle de póliza: cabecera, partidas y total', async () => {
    api(usuario('visor'));
    montar(RUTA);
    const t = await tabla();
    await userEvent.click(within(t).getAllByRole('button', { name: 'POL-C' })[0]);
    const d = await screen.findByTestId('detalle-poliza');
    expect(d).toHaveTextContent('(en SR: E)');
    expect(d).toHaveTextContent('OC-7');
    expect(d).toHaveTextContent('02/09/2026 10:00');
    expect(within(d).getByTestId('partidas-poliza')).toHaveTextContent('Azúcar');
    expect(within(d).getByTestId('total-poliza')).toHaveTextContent('$120.00');
  });

  it('kardex: saldo inicial, saldo corrido y "cuadra" con la hora del corte en la sucursal', async () => {
    const f = api(usuario('visor'));
    montar(RUTA);
    const t = await tabla();
    await userEvent.click(within(t).getAllByRole('button', { name: 'Harina' })[0]);
    const k = await screen.findByTestId('kardex');
    expect(within(k).getByTestId('kardex-inicial')).toHaveTextContent('7.5 kg');
    expect(within(k).getByTestId('kardex-final')).toHaveTextContent('12.5 kg');
    expect(within(k).getByTestId('kardex-cuadre')).toHaveTextContent(
      'Cuadra con la existencia leída el 03/09/2026 06:00: 12.5.',
    );
    const filas = within(within(k).getByTestId('tabla-kardex')).getAllByRole('row').slice(1);
    expect(filas.map((r) => r.textContent)).toEqual([
      expect.stringContaining('12.5'),
      expect.stringContaining('Cancelada'),
    ]);
    const q = f.llamadas.find((l) => l.ruta === '/inventario/kardex')!.query;
    expect([
      q.get('sucursalId'),
      q.get('almacenOrigenSrId'),
      q.get('insumoOrigenSrId'),
      q.get('desde'),
    ]).toEqual([SUCURSAL_A1.id, 'ALM1', 'I1', '2026-09-01']);
    // La línea de tiempo también se acota al artículo.
    await vi.waitFor(() =>
      expect(
        f.llamadas.some(
          (l) => l.ruta === '/inventario/movimientos' && l.query.get('insumoOrigenSrId') === 'I1',
        ),
      ).toBe(true),
    );
  });

  it('kardex con diferencia la dice; sin existencia leída no inventa una', async () => {
    let k = kardex({
      existencia: '3.000',
      saldoAlCorte: '4.000',
      diferencia: '-1.000',
      cuadra: false,
    });
    api(usuario('visor'), undefined, () => k);
    montar(RUTA);
    const t = await tabla();
    await userEvent.click(within(t).getAllByRole('button', { name: 'Harina' })[0]);
    expect(await screen.findByTestId('kardex-cuadre')).toHaveTextContent('diferencia de −1');
    cleanup();
    k = kardex({ existencia: null, saldoAlCorte: null, diferencia: null, cuadra: null });
    api(usuario('visor'), undefined, () => k);
    montar(RUTA);
    const t2 = await tabla();
    await userEvent.click(within(t2).getAllByRole('button', { name: 'Harina' })[0]);
    const c = await screen.findByTestId('kardex-cuadre');
    expect(c).toHaveTextContent('Sin lectura de existencias');
    expect(c).not.toHaveTextContent('diferencia');
  });

  it('sin pólizas de ninguna sucursal: dice por qué y qué falta, sin tabla', async () => {
    api(usuario('visor'), () =>
      movimientos({
        movimientos: [],
        total: 0,
        sucursales: [
          {
            sucursalId: SUCURSAL_A1.id,
            sucursal: 'Centro',
            zonaHoraria: 'America/Mexico_City',
            polizasRecibidas: 0,
          },
        ],
      }),
    );
    montar(RUTA);
    const v = await screen.findByTestId('movimientos-vacio', undefined, { timeout: 5000 });
    expect(v).toHaveTextContent('Centro todavía no ha mandado movimientos de inventario.');
    expect(v).toHaveTextContent('F2-241');
    expect(screen.queryByTestId('tabla-movimientos')).toBeNull();
  });

  it('con pólizas pero periodo sin movimientos: lo dice, no pinta ceros', async () => {
    api(usuario('visor'), () => movimientos({ movimientos: [], total: 0 }));
    montar(RUTA);
    expect(
      await screen.findByText('No hay movimientos en el periodo elegido.', undefined, {
        timeout: 5000,
      }),
    ).toBeInTheDocument();
    expect(screen.queryByText('$0.00')).toBeNull();
  });

  it('un rango inválido en la URL no consulta y lo dice', async () => {
    const f = api(usuario('visor'));
    montar(`/movimientos?empresa=${A}&periodo=rango&desde=2026-09-22&hasta=2026-09-01`);
    expect(
      await screen.findByText(/El rango de fechas no es válido/, undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(f.contar('GET', '/inventario/movimientos')).toBe(0);
  });
});
