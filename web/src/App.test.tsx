import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UsuarioActual } from './api/tipos';
import { Proveedores, Rutas } from './App';
import { terminarSesion } from './auth/sesion';
import { crearQueryClient } from './consultas/queryClient';
import {
  EMPRESA_A,
  EMPRESA_B,
  instalarApiFalsa,
  json,
  noAutorizado,
  sesion,
  SUCURSAL_A1,
  SUCURSAL_A2,
  SUCURSAL_B1,
  usuario,
  type Llamada,
} from './test/apiFalsa';

const A = EMPRESA_A.id;
const B = EMPRESA_B.id;
const PASSWORD_BUENA = 'correcta-123';

/**
 * API falsa con lo que la SPA necesita para arrancar. `cookieViva` = hay una cookie
 * de refresh válida en el navegador (la API responde 200 a `/auth/refresh`).
 */
function apiDePrueba({ u, cookieViva }: { u: UsuarioActual; cookieViva: boolean }) {
  const estado = { cookieViva };
  const api = instalarApiFalsa({
    'POST /auth/refresh': () => (estado.cookieViva ? json(200, sesion(u)) : noAutorizado()),
    'POST /auth/login': (l: Llamada) => {
      const { password } = l.cuerpo as { password: string };
      if (password !== PASSWORD_BUENA) return noAutorizado();
      estado.cookieViva = true;
      return json(200, sesion(u));
    },
    'GET /empresas': () =>
      json(200, u.rol === 'admin_global' ? [EMPRESA_A, EMPRESA_B] : [EMPRESA_A]),
    'GET /sucursales': (l: Llamada) => {
      const empresaId = l.query.get('empresaId');
      if (empresaId === A) return json(200, [SUCURSAL_A1, SUCURSAL_A2]);
      if (empresaId === B && u.rol === 'admin_global') return json(200, [SUCURSAL_B1]);
      return json(404, { statusCode: 404, message: 'Not Found' });
    },
  });
  return { ...api, estado };
}

function Ubicacion() {
  const { pathname, search } = useLocation();
  return <div data-testid="ubicacion">{pathname + search}</div>;
}

function montar(ruta: string, { estricto = false } = {}) {
  const queryClient = crearQueryClient();
  // Sin espera entre reintentos: el test de "la API falla" no tiene que dormir.
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retryDelay: 0 },
  });
  const arbol = (
    <MemoryRouter initialEntries={[ruta]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
        <Ubicacion />
      </Proveedores>
    </MemoryRouter>
  );
  const resultado = render(estricto ? <StrictMode>{arbol}</StrictMode> : arbol);
  return { ...resultado, queryClient };
}

const ubicacion = () => screen.getByTestId('ubicacion').textContent;

async function entrar(password = PASSWORD_BUENA) {
  const usuarioEvt = userEvent.setup();
  await usuarioEvt.type(await screen.findByLabelText('Correo'), 'ana@demo.local');
  await usuarioEvt.type(screen.getByLabelText('Contraseña'), password);
  await usuarioEvt.click(screen.getByRole('button', { name: 'Entrar' }));
}

/** Espera a que el selector de sucursales tenga sus opciones cargadas. */
async function selectorSucursal() {
  const select = await screen.findByLabelText('Sucursal');
  await waitFor(() => expect(select).toBeEnabled());
  return select as HTMLSelectElement;
}

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('deep-link y login', () => {
  it('anónimo en una vista con filtros: login y de vuelta a la MISMA vista con sus filtros', async () => {
    apiDePrueba({ u: usuario('admin_global'), cookieViva: false });
    const destino = `/tickets?empresa=${A}&sucursal=${SUCURSAL_A2.id}`;

    montar(destino);

    await screen.findByRole('button', { name: 'Entrar' });
    expect(ubicacion()).toBe(`/login?siguiente=${encodeURIComponent(destino)}`);

    await entrar();

    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument();
    expect(ubicacion()).toBe(destino);
    expect((await selectorSucursal()).value).toBe(SUCURSAL_A2.id);
    expect((screen.getByLabelText('Empresa') as HTMLSelectElement).value).toBe(A);
    expect(screen.getByTestId('alcance')).toHaveTextContent('Tacos Demo · Tijuana');
  });

  it('con la cookie de refresh viva entra directo a la vista, con UN solo refresh (StrictMode)', async () => {
    const api = apiDePrueba({ u: usuario('admin_global'), cookieViva: true });
    const destino = `/reportes?empresa=${A}&sucursal=${SUCURSAL_A1.id}`;

    montar(destino, { estricto: true });

    expect(await screen.findByRole('heading', { name: 'Reportes' })).toBeInTheDocument();
    expect(ubicacion()).toBe(destino);
    expect(api.contar('POST', '/auth/refresh')).toBe(1);
    expect(api.contar('POST', '/auth/login')).toBe(0);
  });

  it('credenciales malas: mensaje y se queda en el login', async () => {
    apiDePrueba({ u: usuario('admin_global'), cookieViva: false });
    montar('/');

    await entrar('mala');

    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas.');
    expect(ubicacion()).toBe('/login');
  });

  it('un 429 del login avisa que espere', async () => {
    const api = apiDePrueba({ u: usuario('admin_global'), cookieViva: false });
    api.manejadores['POST /auth/login'] = () => json(429, { statusCode: 429, message: 'Too Many' });
    montar('/');

    await entrar();

    expect(await screen.findByRole('alert')).toHaveTextContent('Demasiados intentos');
  });

  it('un ?siguiente= externo no saca de la SPA', async () => {
    apiDePrueba({ u: usuario('admin_global'), cookieViva: false });
    montar(`/login?siguiente=${encodeURIComponent('//evil.com/robar')}`);

    await entrar();

    expect(await screen.findByRole('heading', { name: 'Panel de ventas' })).toBeInTheDocument();
    expect(ubicacion()).toMatch(/^\/\?empresa=/);
  });
});

describe('cerrar sesión', () => {
  it('vuelve al login y, al recargar, NO hace el refresh silencioso', async () => {
    const api = apiDePrueba({ u: usuario('admin_global'), cookieViva: true });
    const primera = montar(`/?empresa=${A}`);
    await screen.findByRole('heading', { name: 'Panel de ventas' });

    await userEvent.setup().click(screen.getByRole('button', { name: 'Salir' }));

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    const refreshAntes = api.contar('POST', '/auth/refresh');

    primera.unmount();
    montar(`/?empresa=${A}`);

    expect(await screen.findByRole('button', { name: 'Entrar' })).toBeInTheDocument();
    expect(api.contar('POST', '/auth/refresh')).toBe(refreshAntes);
  });

  // B1 del revisor: la cookie del usuario anterior sigue viva (la API no tiene
  // logout). Un login malo NO puede terminar dentro como ese usuario.
  it('tras cerrar sesión, un login malo nunca entra como el usuario anterior', async () => {
    const api = apiDePrueba({ u: usuario('admin_global', 'Ricardo Anterior'), cookieViva: true });
    montar(`/?empresa=${A}`);
    await screen.findByText('Ricardo Anterior');
    await userEvent.setup().click(screen.getByRole('button', { name: 'Salir' }));
    await screen.findByRole('button', { name: 'Entrar' });
    const refreshAntes = api.contar('POST', '/auth/refresh');

    await entrar('mala');

    expect(await screen.findByRole('alert')).toHaveTextContent('Credenciales inválidas.');
    expect(ubicacion()).toMatch(/^\/login/);
    expect(api.contar('POST', '/auth/refresh')).toBe(refreshAntes);
    expect(screen.queryByText('Ricardo Anterior')).not.toBeInTheDocument();
  });

  it('si la sesión expira a mitad de uso, manda al login recordando la vista', async () => {
    const api = apiDePrueba({ u: usuario('admin_global'), cookieViva: true });
    const destino = `/tickets?empresa=${A}`;
    const { queryClient } = montar(destino);
    await screen.findByRole('heading', { name: 'Tickets' });
    await selectorSucursal();

    api.estado.cookieViva = false;
    api.manejadores['GET /empresas'] = noAutorizado;
    await queryClient.invalidateQueries();

    expect(await screen.findByRole('status')).toHaveTextContent('Tu sesión expiró');
    expect(ubicacion()).toBe(`/login?siguiente=${encodeURIComponent(destino)}`);
  });
});

describe('sidebar y roles', () => {
  it('el visor no ve Administración y en /admin ve "No encontrada"', async () => {
    apiDePrueba({ u: usuario('visor'), cookieViva: true });
    montar(`/admin?empresa=${A}`);

    expect(await screen.findByRole('heading', { name: 'No encontrada' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(nav).getByRole('link', { name: 'Tickets' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Administración' })).not.toBeInTheDocument();
  });

  it('admin_empresa ve Administración y entra', async () => {
    apiDePrueba({ u: usuario('admin_empresa'), cookieViva: true });
    montar(`/admin?empresa=${A}`);

    expect(await screen.findByRole('heading', { name: 'Administración' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Principal' });
    expect(within(nav).getByRole('link', { name: 'Administración' })).toBeInTheDocument();
  });

  it('una ruta que no existe es "No encontrada" dentro del layout', async () => {
    apiDePrueba({ u: usuario('visor'), cookieViva: true });
    montar(`/no-existe?empresa=${A}`);

    expect(await screen.findByRole('heading', { name: 'No encontrada' })).toBeInTheDocument();
  });

  it('el menú móvil abre, cierra con Escape y al navegar', async () => {
    apiDePrueba({ u: usuario('visor'), cookieViva: true });
    montar(`/?empresa=${A}`);
    const evt = userEvent.setup();

    const boton = await screen.findByRole('button', { name: 'Abrir menú' });
    await evt.click(boton);
    expect(screen.getByRole('button', { name: 'Cerrar menú' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );

    await evt.keyboard('{Escape}');
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );

    await evt.click(screen.getByRole('button', { name: 'Abrir menú' }));
    await evt.click(screen.getByRole('link', { name: 'Tickets' }));
    expect(screen.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });
});

describe('selector de empresa y sucursal en la URL', () => {
  it('elegir sucursal la escribe en la URL y la navegación la conserva', async () => {
    apiDePrueba({ u: usuario('admin_global'), cookieViva: true });
    montar(`/?empresa=${A}`);
    const evt = userEvent.setup();

    await evt.selectOptions(await selectorSucursal(), SUCURSAL_A1.id);
    expect(ubicacion()).toBe(`/?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);

    await evt.click(screen.getByRole('link', { name: 'Tickets' }));
    expect(ubicacion()).toBe(`/tickets?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    expect(screen.getByTestId('alcance')).toHaveTextContent('Tacos Demo · Centro');

    await evt.selectOptions(screen.getByLabelText('Sucursal'), '');
    expect(ubicacion()).toBe(`/tickets?empresa=${A}`);
  });

  it('cambiar de empresa borra la sucursal', async () => {
    apiDePrueba({ u: usuario('admin_global'), cookieViva: true });
    montar(`/tickets?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    await selectorSucursal();

    await userEvent.setup().selectOptions(screen.getByLabelText('Empresa'), B);

    expect(ubicacion()).toBe(`/tickets?empresa=${B}`);
    await waitFor(() => expect(screen.getByRole('option', { name: 'Puerto' })).toBeInTheDocument());
  });

  it.each([
    ['sin empresa', '/tickets'],
    [
      'empresa que no está en tu lista',
      `/tickets?empresa=00000000-0000-4000-8000-000000000000&sucursal=${SUCURSAL_A1.id}`,
    ],
  ])('%s: se normaliza a la primera empresa', async (_caso, ruta) => {
    apiDePrueba({ u: usuario('admin_global'), cookieViva: true });
    montar(ruta);

    await waitFor(() => expect(ubicacion()).toBe(`/tickets?empresa=${A}`));
  });

  it('una sucursal de otra empresa se quita de la URL', async () => {
    apiDePrueba({ u: usuario('admin_global'), cookieViva: true });
    montar(`/tickets?empresa=${A}&sucursal=${SUCURSAL_B1.id}`);

    await waitFor(() => expect(ubicacion()).toBe(`/tickets?empresa=${A}`));
  });

  it('si /empresas falla, la URL del deep-link NO se toca', async () => {
    const api = apiDePrueba({ u: usuario('admin_global'), cookieViva: true });
    api.manejadores['GET /empresas'] = () => json(500, { statusCode: 500, message: 'boom' });
    const destino = `/tickets?empresa=${A}&sucursal=${SUCURSAL_A1.id}`;
    montar(destino);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No se pudieron cargar las empresas.',
    );
    expect(ubicacion()).toBe(destino);
  });

  it('las empresas inactivas se muestran marcadas', async () => {
    apiDePrueba({ u: usuario('admin_global'), cookieViva: true });
    montar(`/?empresa=${A}`);

    expect(
      await screen.findByRole('option', { name: 'Mariscos Demo (inactiva)' }),
    ).toBeInTheDocument();
  });

  it('con una sola empresa se muestra como texto, no como selector', async () => {
    apiDePrueba({ u: usuario('visor'), cookieViva: true });
    montar(`/?empresa=${A}`);

    expect(await screen.findByTestId('empresa-unica')).toHaveTextContent('Tacos Demo');
    expect(screen.queryByLabelText('Empresa')).not.toBeInTheDocument();
  });
});
