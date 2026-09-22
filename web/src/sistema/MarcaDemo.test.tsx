import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import {
  EMPRESA_A,
  instalarApiFalsa,
  json,
  noAutorizado,
  sesion,
  SUCURSAL_A1,
  usuario,
} from '../test/apiFalsa';
import { PREFIJO_TITULO_DEMO, TEXTO_MARCA_DEMO } from './sistema';

const TITULO = 'Monitor SoftRestaurant';

/** API falsa: `/sistema` dice si hay modo demo; `cookieViva` = hay sesión que refrescar. */
function api({ modoDemo, cookieViva }: { modoDemo: boolean | null; cookieViva: boolean }) {
  const u = usuario('admin_global');
  return instalarApiFalsa({
    ...(modoDemo === null ? {} : { 'GET /sistema': () => json(200, { modoDemo }) }),
    'POST /auth/refresh': () => (cookieViva ? json(200, sesion(u)) : noAutorizado()),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1]),
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
  document.title = TITULO;
});

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Marca del modo demo (F2-202)', () => {
  it('con modoDemo: se ve en el login y el título lleva el prefijo', async () => {
    api({ modoDemo: true, cookieViva: false });
    montar('/login');
    expect(await screen.findByTestId('marca-demo')).toHaveTextContent(TEXTO_MARCA_DEMO);
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(document.title).toBe(`${PREFIJO_TITULO_DEMO}${TITULO}`);
  });

  it.each([
    ['Inicio', '/'],
    ['Tickets', '/tickets'],
    ['Monitor de mesas', '/mesas'],
    ['Reportes', '/reportes'],
    ['Mi cuenta', '/cuenta'],
    ['Administración', '/admin'],
    ['una ruta que no existe', '/no-existe'],
  ])('con modoDemo: se ve en %s', async (_vista, ruta) => {
    api({ modoDemo: true, cookieViva: true });
    montar(ruta);
    expect(await screen.findByTestId('marca-demo')).toHaveTextContent(TEXTO_MARCA_DEMO);
    expect(document.title).toBe(`${PREFIJO_TITULO_DEMO}${TITULO}`);
  });

  it('el prefijo no se duplica y se quita al desmontar', async () => {
    api({ modoDemo: true, cookieViva: false });
    const { unmount } = montar('/login');
    await screen.findByTestId('marca-demo');
    expect(document.title).toBe(`${PREFIJO_TITULO_DEMO}${TITULO}`);
    unmount();
    expect(document.title).toBe(TITULO);
  });

  it('sin modoDemo: no hay marca y el título queda intacto', async () => {
    const llamadas = api({ modoDemo: false, cookieViva: false });
    montar('/login');
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    await vi.waitFor(() => expect(llamadas.contar('GET', '/sistema')).toBe(1));
    expect(screen.queryByTestId('marca-demo')).not.toBeInTheDocument();
    expect(document.title).toBe(TITULO);
  });

  it('si /sistema falla: no hay marca (no se inventa)', async () => {
    const llamadas = api({ modoDemo: null, cookieViva: false });
    montar('/login');
    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    await vi.waitFor(() => expect(llamadas.contar('GET', '/sistema')).toBe(1));
    expect(screen.queryByTestId('marca-demo')).not.toBeInTheDocument();
    expect(document.title).toBe(TITULO);
  });
});
