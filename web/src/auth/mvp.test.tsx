import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UsuarioActual } from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { crearQueryClient } from '../consultas/queryClient';
import { EMPRESA_A, instalarApiFalsa, json, sesion, SUCURSAL_A1, usuario } from '../test/apiFalsa';
import { OCULTAR_A_CLIENTES, veVistasOcultas } from './mvp';
import { terminarSesion } from './sesion';

describe('MVP (9-nov-2026) · interruptor de vistas ocultas a los clientes', () => {
  it('está prendido: los clientes no las ven, el equipo interno sí', () => {
    expect(OCULTAR_A_CLIENTES).toBe(true);
    expect(veVistasOcultas('admin_global')).toBe(true);
    expect(veVistasOcultas('admin_empresa')).toBe(false);
    expect(veVistasOcultas('visor')).toBe(false);
  });
});

// Por URL directa: al cliente le sale "No encontrada" (igual que cualquier vista restringida) y
// la vista ni siquiera monta, así que no pide nada al api.
describe('MVP · rutas ocultas por URL', () => {
  afterEach(() => {
    cleanup();
    terminarSesion('cerrada');
    vi.unstubAllGlobals();
  });

  function montar(ruta: string, rol: UsuarioActual['rol']) {
    instalarApiFalsa({
      'POST /auth/refresh': () => json(200, sesion(usuario(rol))),
      'GET /empresas': () => json(200, [EMPRESA_A]),
      'GET /sucursales': () => json(200, [SUCURSAL_A1]),
    });
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

  const RUTAS = [
    '/menu',
    '/clientes',
    '/areas',
    '/existencias',
    '/movimientos',
    '/conteos',
    '/conteos/ayuda',
    '/recetas',
    '/proyecciones',
    '/compras',
    '/gastos',
    '/traspasos',
    '/traspasos/nuevo',
    '/conteos/c-1',
    '/traspasos/t-1',
  ];

  const CASOS = (['admin_empresa', 'visor'] as const).flatMap((rol) =>
    RUTAS.map((ruta) => [rol, ruta] as const),
  );

  it.each(CASOS)('%s en %s: "No encontrada"', async (rol, ruta) => {
    montar(`${ruta}?empresa=${EMPRESA_A.id}`, rol);
    expect(
      await screen.findByRole('heading', { name: 'No encontrada' }, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  it('admin_global (equipo interno) sí entra a una ruta oculta', async () => {
    montar(`/existencias?empresa=${EMPRESA_A.id}`, 'admin_global');
    expect(
      await screen.findByRole('heading', { name: 'Existencias' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'No encontrada' })).toBeNull();
  });

  it('Productos, Meseros y Ventas por canal siguen abiertas al cliente', async () => {
    for (const ruta of ['/productos', '/meseros', '/canales']) {
      montar(`${ruta}?empresa=${EMPRESA_A.id}`, 'visor');
      await screen.findByRole('navigation', {}, { timeout: 5000 });
      expect(screen.queryByRole('heading', { name: 'No encontrada' })).toBeNull();
      cleanup();
      terminarSesion('cerrada');
    }
  });

  // Los enlaces cruzados hacia vistas ocultas tampoco le salen al cliente.
  it.each([
    ['visor', false],
    ['admin_empresa', false],
    ['admin_global', true],
  ] as const)('%s: Productos enlaza al orquestador de menú = %s', async (rol, enlaza) => {
    montar(`/productos?empresa=${EMPRESA_A.id}`, rol);
    const intro = await screen.findByText(/^El catálogo tal como lo tiene el POS/, undefined, {
      timeout: 5000,
    });
    expect(Boolean(within(intro).queryByRole('link', { name: 'orquestador de menú' }))).toBe(
      enlaza,
    );
  });
});
