import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Conteos, ConteoDetalle, UsuarioActual } from '../api/tipos';
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

// F2-123 en el web, contra el router y la app reales: la lista de conteos (`/conteos`), el alta y
// la ayuda. Datos escritos a mano.

const A = EMPRESA_A.id;
const RUTA = `/conteos?empresa=${A}`;
const AHORA = new Date('2026-09-22T18:00:00Z');

function datos(p: Partial<Conteos> = {}): Conteos {
  return {
    conteos: [
      {
        id: 'c-1',
        folio: 1,
        sucursalId: SUCURSAL_A1.id,
        sucursal: 'Centro',
        almacenOrigenSrId: 'A1-GEN',
        almacen: 'Almacén general',
        grupoOrigenSrId: null,
        grupo: null,
        nota: 'Turno matutino',
        estado: 'cerrado',
        teoricoCapturadoAt: '2026-09-22T15:00:00.000Z',
        teoricoAtrasado: false,
        // 15:30 UTC = 09:30 en CDMX.
        creadoAt: '2026-09-22T15:30:00.000Z',
        cerradoAt: '2026-09-22T16:30:00.000Z',
        canceladoAt: null,
        articulos: 22,
        contados: 21,
      },
    ],
    total: 1,
    almacenes: [
      {
        sucursalId: SUCURSAL_A1.id,
        almacenOrigenSrId: 'A1-GEN',
        almacen: 'Almacén general',
        capturadoAt: '2026-09-22T17:00:00.000Z',
        atrasada: false,
      },
      {
        sucursalId: SUCURSAL_A1.id,
        almacenOrigenSrId: 'A1-BOD',
        almacen: 'Bodega',
        capturadoAt: null,
        atrasada: false,
      },
    ],
    grupos: [{ sucursalId: SUCURSAL_A1.id, grupoOrigenSrId: 'G1', grupo: 'Lácteos' }],
    sucursales: [
      { sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', zonaHoraria: 'America/Mexico_City' },
    ],
    ...p,
  };
}

const creado: ConteoDetalle = {
  conteo: { ...datos().conteos[0], id: 'c-2', folio: 2, estado: 'en_captura', cerradoAt: null },
  zonaHoraria: 'America/Mexico_City',
  partidas: [],
  totales: {
    articulos: 0,
    contados: 0,
    sinContar: 0,
    sinTeorico: 0,
    conDiferencia: 0,
    sinValuar: 0,
    faltante: '0.00',
    sobrante: '0.00',
    neto: '0.00',
  },
};

function api(u: UsuarioActual, lista: () => Conteos = () => datos()) {
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /usuarios': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /inventario/conteos': () => json(200, lista()),
    'POST /inventario/conteos': () => json(201, creado),
    'GET /inventario/conteos/c-2': () => json(200, creado),
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

describe('Conteos físicos (F2-123)', () => {
  it('lista con avance, estado y la hora en la zona de la sucursal', async () => {
    api(usuario('visor'));
    montar(RUTA);
    const fila = await screen.findByText('#1 · Todos los artículos', undefined, { timeout: 5000 });
    const tr = fila.closest('tr')!;
    expect(tr).toHaveTextContent('Almacén general');
    expect(tr).toHaveTextContent('Cerrado');
    expect(tr).toHaveTextContent('21 de 22');
    expect(tr).toHaveTextContent('22/09/2026 09:30');
    expect(tr).toHaveTextContent('Turno matutino');
    // El visor no crea conteos.
    expect(screen.queryByRole('region', { name: 'Nuevo conteo' })).not.toBeInTheDocument();
  });

  it('sin lectura de existencias: dice por qué no se puede contar (no una tabla vacía)', async () => {
    api(usuario('admin_empresa'), () =>
      datos({
        conteos: [],
        total: 0,
        almacenes: datos().almacenes.map((a) => ({ ...a, capturadoAt: null })),
      }),
    );
    montar(RUTA);
    const vacio = await screen.findByTestId('conteos-vacio', undefined, { timeout: 5000 });
    expect(vacio).toHaveTextContent('no ha mandado existencias');
    expect(vacio).toHaveTextContent('no hay teórico contra qué contar');
    expect(screen.queryByRole('region', { name: 'Nuevo conteo' })).not.toBeInTheDocument();
  });

  it('admin crea un conteo por grupo (sólo almacenes con lectura) y va a la captura', async () => {
    const user = userEvent.setup();
    const falsa = api(usuario('admin_empresa'));
    montar(RUTA);
    const form = await screen.findByRole('region', { name: 'Nuevo conteo' }, { timeout: 5000 });
    const almacen = within(form).getByRole('combobox', { name: 'Almacén' });
    // La bodega sin lectura NO se ofrece; se avisa aparte.
    expect(
      within(almacen)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Almacén general']);
    expect(form).toHaveTextContent(
      'Sin lectura de existencias (no se pueden contar todavía): Bodega',
    );
    expect(within(form).getByTestId('conteo-teorico')).toHaveTextContent(
      'El teórico será la lectura del 22/09/2026 11:00.',
    );
    await user.selectOptions(within(form).getByRole('combobox', { name: 'Artículos' }), 'G1');
    await user.type(within(form).getByRole('textbox', { name: /Nota/ }), 'Cierre de mes');
    await user.click(within(form).getByRole('button', { name: 'Crear conteo' }));
    expect(
      await screen.findByTestId('conteo-cabecera', undefined, { timeout: 5000 }),
    ).toBeInTheDocument();
    const post = falsa.llamadas.find(
      (l: Llamada) => l.metodo === 'POST' && l.ruta === '/inventario/conteos',
    )!;
    expect(post.cuerpo).toEqual({
      empresaId: A,
      sucursalId: SUCURSAL_A1.id,
      almacenOrigenSrId: 'A1-GEN',
      grupoOrigenSrId: 'G1',
      nota: 'Cierre de mes',
    });
  });

  it('un 409 al crear se explica en palabras', async () => {
    const user = userEvent.setup();
    const falsa = api(usuario('admin_empresa'));
    falsa.manejadores['POST /inventario/conteos'] = (() =>
      json(409, { statusCode: 409, message: 'sin lectura' })) as Manejador;
    montar(RUTA);
    const form = await screen.findByRole('region', { name: 'Nuevo conteo' }, { timeout: 5000 });
    await user.click(within(form).getByRole('button', { name: 'Crear conteo' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'todavía no tiene lectura de existencias',
    );
  });

  it('la ayuda explica el proceso y que el ajuste se hace en SoftRestaurant, no aquí', async () => {
    const user = userEvent.setup();
    api(usuario('visor'));
    montar(RUTA);
    await user.click(await screen.findByRole('link', { name: 'Cómo se hace un conteo' }));
    const ayuda = await screen.findByTestId('ayuda-conteos');
    expect(ayuda).toHaveTextContent('El panel nunca ajusta nada en el POS');
    expect(ayuda).toHaveTextContent('Ajusta en SoftRestaurant');
    expect(ayuda).toHaveTextContent('vacío no es 0');
  });
});
