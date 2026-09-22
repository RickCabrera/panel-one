import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { QueryClient } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { Rol, UsuarioAdmin } from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import {
  EMPRESA_A,
  EMPRESA_B,
  instalarApiFalsa,
  json,
  sesion,
  SUCURSAL_A1,
  SUCURSAL_A2,
  usuario,
  type Manejador,
} from '../test/apiFalsa';

// Vista de Administración (F1-060) contra una API falsa. Las reglas de permisos
// las garantiza la API (e2e de /api); aquí se prueba que la UI no OFRECE lo que no
// toca, que manda exactamente lo que dice el contrato y que la API key y las
// contraseñas no se quedan en ningún lado.

const A = EMPRESA_A.id;
const KEY = 'msr_key-sintetica-de-prueba-F1-060';
const PASSWORD = 'contrasena-sintetica-larga';

function usuarioAdmin(parcial: Partial<UsuarioAdmin> & { id: string }): UsuarioAdmin {
  return {
    email: `${parcial.id}@demo.local`,
    nombre: `Usuario ${parcial.id}`,
    rol: 'visor',
    empresaId: A,
    activo: true,
    ...parcial,
  };
}

const VISOR = usuarioAdmin({ id: 'u-visor', nombre: 'Vero Visor' });

function apiAdmin(rol: Rol, extra: Record<string, Manejador> = {}) {
  const yo = usuario(rol);
  const empresas = rol === 'admin_global' ? [EMPRESA_A, EMPRESA_B] : [EMPRESA_A];
  const yoComoFila = usuarioAdmin({
    id: yo.id,
    email: yo.email,
    nombre: yo.nombre,
    rol,
    empresaId: yo.empresaId,
  });
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(yo)),
    'GET /empresas': () => json(200, empresas),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /usuarios': (l) =>
      json(
        200,
        l.query.get('empresaId')
          ? [VISOR, ...(yo.empresaId ? [yoComoFila] : [])]
          : [yoComoFila, VISOR],
      ),
    ...extra,
  });
}

function montar(ruta: string): QueryClient {
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
  return queryClient;
}

const pestanas = () => screen.getAllByRole('tab').map((t) => t.textContent);

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('Administración: lo que se ofrece según el rol', () => {
  it('admin_empresa: sin pestaña Empresas (ni por URL) y sin la opción admin_global', async () => {
    apiAdmin('admin_empresa');
    montar(`/admin?empresa=${A}&tab=empresas`);

    await screen.findByRole('row', { name: 'Centro' });
    // F1-061 agregó Agentes; Empresas sigue fuera.
    expect(pestanas()).toEqual(['Sucursales', 'Usuarios', 'Agentes', 'Alertas']);
    expect(screen.getByRole('tab', { name: 'Sucursales' })).toHaveAttribute(
      'aria-selected',
      'true',
    );

    await userEvent.click(screen.getByRole('tab', { name: 'Usuarios' }));
    const alta = await screen.findByRole('form', { name: 'Nuevo usuario' });
    const opciones = within(alta)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(opciones).toEqual(['Visor', 'Administrador']);
    expect(
      screen.queryByRole('region', { name: 'Administradores globales' }),
    ).not.toBeInTheDocument();
  });

  it('admin_global: ve Empresas, puede crear un admin_global (sin empresa) y ve la lista de globales', async () => {
    const api = apiAdmin('admin_global', {
      'POST /usuarios': (l) => json(201, usuarioAdmin({ id: 'nuevo', ...(l.cuerpo as object) })),
    });
    montar(`/admin?empresa=${A}&tab=usuarios`);

    expect(await screen.findByRole('tab', { name: 'Empresas' })).toBeInTheDocument();
    const globales = await screen.findByRole('region', { name: 'Administradores globales' });
    expect(
      await within(globales).findByRole('row', { name: 'ana@demo.local' }),
    ).toBeInTheDocument();

    const alta = screen.getByRole('form', { name: 'Nuevo usuario' });
    await userEvent.type(within(alta).getByLabelText('Email'), 'nuevo@demo.local');
    await userEvent.type(within(alta).getByLabelText('Nombre'), 'Nuevo Global');
    await userEvent.selectOptions(within(alta).getByLabelText(/^Rol/), 'admin_global');
    await userEvent.type(within(alta).getByLabelText(/Contraseña inicial/), PASSWORD);
    await userEvent.click(within(alta).getByRole('button', { name: 'Agregar usuario' }));

    await waitFor(() => expect(api.contar('POST', '/usuarios')).toBe(1));
    expect(
      api.llamadas.find((l) => l.metodo === 'POST' && l.ruta !== '/auth/refresh')?.cuerpo,
    ).toEqual({
      email: 'nuevo@demo.local',
      nombre: 'Nuevo Global',
      rol: 'admin_global',
      empresaId: null,
      password: PASSWORD,
    });
    // La contraseña no se queda en el formulario.
    await waitFor(() => expect(within(alta).getByLabelText(/Contraseña inicial/)).toHaveValue(''));
  });

  it('admin_global da de alta una empresa y la lista se vuelve a pedir', async () => {
    const api = apiAdmin('admin_global', {
      'POST /empresas': (l) => json(201, { id: 'e-nueva', activo: true, ...(l.cuerpo as object) }),
    });
    montar(`/admin?empresa=${A}&tab=empresas`);

    const alta = await screen.findByRole('form', { name: 'Nueva empresa' });
    const antes = api.contar('GET', '/empresas');
    await userEvent.type(within(alta).getByLabelText('Nombre de la empresa'), 'Pozolería');
    await userEvent.click(within(alta).getByRole('button', { name: 'Agregar empresa' }));

    await waitFor(() => expect(api.contar('GET', '/empresas')).toBeGreaterThan(antes));
    expect(
      api.llamadas.find((l) => l.metodo === 'POST' && l.ruta !== '/auth/refresh')?.cuerpo,
    ).toEqual({ nombre: 'Pozolería' });
  });
});

describe('Sucursales', () => {
  it('alta: manda empresa del alcance, nombre y zona IANA, y refresca la lista', async () => {
    const api = apiAdmin('admin_empresa', {
      'POST /sucursales': (l) =>
        json(201, { id: 's-nueva', activo: true, ...(l.cuerpo as object) }),
    });
    montar(`/admin?empresa=${A}`);

    const alta = await screen.findByRole('form', { name: 'Nueva sucursal' });
    await screen.findByRole('row', { name: 'Centro' });
    const antes = api.contar('GET', '/sucursales');
    await userEvent.type(within(alta).getByLabelText('Nombre de la sucursal'), 'Playa');
    await userEvent.selectOptions(within(alta).getByLabelText('Zona horaria'), 'America/Cancun');
    await userEvent.click(within(alta).getByRole('button', { name: 'Agregar sucursal' }));

    await waitFor(() => expect(api.contar('GET', '/sucursales')).toBeGreaterThan(antes));
    expect(
      api.llamadas.find((l) => l.metodo === 'POST' && l.ruta !== '/auth/refresh')?.cuerpo,
    ).toEqual({
      empresaId: A,
      nombre: 'Playa',
      zonaHoraria: 'America/Cancun',
    });
  });

  it('editar: sólo manda lo que cambió y avisa que cambiar la zona mueve el histórico', async () => {
    const api = apiAdmin('admin_empresa', {
      [`PATCH /sucursales/${SUCURSAL_A1.id}`]: (l) =>
        json(200, { ...SUCURSAL_A1, ...(l.cuerpo as object) }),
    });
    montar(`/admin?empresa=${A}`);

    const fila = await screen.findByRole('row', { name: 'Centro' });
    await userEvent.click(within(fila).getByRole('button', { name: 'Editar' }));
    const dialogo = screen.getByRole('dialog', { name: 'Editar Centro' });
    expect(within(dialogo).queryByRole('note')).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialogo).getByLabelText('Zona horaria'), 'America/Merida');
    expect(within(dialogo).getByRole('note')).toHaveTextContent('mueve de día las ventas pasadas');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(api.llamadas.find((l) => l.metodo === 'PATCH')?.cuerpo).toEqual({
      zonaHoraria: 'America/Merida',
    });
  });

  it('API key: avisa que corta al agente, la muestra UNA vez, no se cierra sola y no queda en ningún lado', async () => {
    const api = apiAdmin('admin_empresa', {
      [`POST /sucursales/${SUCURSAL_A1.id}/api-key`]: () =>
        json(201, { sucursalId: SUCURSAL_A1.id, apiKey: KEY }),
    });
    const queryClient = montar(`/admin?empresa=${A}`);

    const fila = await screen.findByRole('row', { name: 'Centro' });
    await userEvent.click(within(fila).getByRole('button', { name: 'API key del agente' }));
    const confirmar = screen.getByRole('dialog', { name: 'API key de Centro' });
    expect(confirmar).toHaveTextContent('deja de servir en este momento');
    expect(api.contar('POST', `/sucursales/${SUCURSAL_A1.id}/api-key`)).toBe(0);
    await userEvent.click(within(confirmar).getByRole('button', { name: 'Generar key nueva' }));

    const mostrar = await screen.findByText(/no se volverá a mostrar/);
    expect(screen.getByDisplayValue(KEY)).toBeInTheDocument();
    // Ni Escape ni un clic afuera la cierran: sólo el botón.
    await userEvent.keyboard('{Escape}');
    expect(mostrar).toBeInTheDocument();

    // No quedó en la caché de TanStack (ni de queries ni de mutaciones).
    const enCache = JSON.stringify([
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
      queryClient
        .getMutationCache()
        .getAll()
        .map((m) => m.state),
    ]);
    expect(enCache).not.toContain(KEY);

    await userEvent.click(screen.getByRole('button', { name: 'Ya la copié, cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain(KEY);
    expect(screen.queryByDisplayValue(KEY)).not.toBeInTheDocument();
    expect(api.contar('POST', `/sucursales/${SUCURSAL_A1.id}/api-key`)).toBe(1);
  });

  it('dar de baja manda activo=false', async () => {
    const api = apiAdmin('admin_empresa', {
      [`PATCH /sucursales/${SUCURSAL_A2.id}`]: () => json(200, { ...SUCURSAL_A2, activo: false }),
    });
    montar(`/admin?empresa=${A}`);
    const fila = await screen.findByRole('row', { name: 'Tijuana' });
    await userEvent.click(within(fila).getByRole('button', { name: 'Dar de baja' }));
    await waitFor(() => expect(api.contar('PATCH', `/sucursales/${SUCURSAL_A2.id}`)).toBe(1));
    expect(api.llamadas.find((l) => l.metodo === 'PATCH')?.cuerpo).toEqual({ activo: false });
  });
});

describe('Usuarios', () => {
  it('uno mismo: sin "Dar de baja" ni "Restablecer contraseña", y con el rol bloqueado al editar', async () => {
    apiAdmin('admin_empresa');
    montar(`/admin?empresa=${A}&tab=usuarios`);

    const yo = await screen.findByRole('row', { name: 'ana@demo.local' });
    expect(within(yo).queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument();
    expect(
      within(yo).queryByRole('button', { name: 'Restablecer contraseña' }),
    ).not.toBeInTheDocument();
    const otro = screen.getByRole('row', { name: VISOR.email });
    expect(within(otro).getByRole('button', { name: 'Dar de baja' })).toBeInTheDocument();

    await userEvent.click(within(yo).getByRole('button', { name: 'Editar' }));
    const dialogo = screen.getByRole('dialog');
    expect(within(dialogo).getByLabelText('Rol')).toBeDisabled();
  });

  it('editar a otro: el rol sólo ofrece visor y administrador, y manda lo que cambió', async () => {
    const api = apiAdmin('admin_empresa', {
      [`PATCH /usuarios/${VISOR.id}`]: (l) => json(200, { ...VISOR, ...(l.cuerpo as object) }),
    });
    montar(`/admin?empresa=${A}&tab=usuarios`);

    const fila = await screen.findByRole('row', { name: VISOR.email });
    await userEvent.click(within(fila).getByRole('button', { name: 'Editar' }));
    const dialogo = screen.getByRole('dialog');
    const rol = within(dialogo).getByLabelText('Rol');
    expect(
      within(rol)
        .getAllByRole('option')
        .map((o) => o.getAttribute('value')),
    ).toEqual(['visor', 'admin_empresa']);
    await userEvent.selectOptions(rol, 'admin_empresa');
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.contar('PATCH', `/usuarios/${VISOR.id}`)).toBe(1));
    expect(api.llamadas.find((l) => l.metodo === 'PATCH')?.cuerpo).toEqual({
      rol: 'admin_empresa',
    });
  });

  it('restablecer contraseña: manda la nueva, confirma, y un error de la API se muestra', async () => {
    let status = 400;
    const api = apiAdmin('admin_empresa', {
      [`POST /usuarios/${VISOR.id}/password`]: () =>
        status === 204
          ? new Response(null, { status: 204 })
          : json(400, { statusCode: 400, message: ['password must be longer'] }),
    });
    montar(`/admin?empresa=${A}&tab=usuarios`);

    const fila = await screen.findByRole('row', { name: VISOR.email });
    await userEvent.click(within(fila).getByRole('button', { name: 'Restablecer contraseña' }));
    const dialogo = screen.getByRole('dialog');
    await userEvent.type(within(dialogo).getByLabelText(/Contraseña nueva/), PASSWORD);
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Restablecer' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent('password must be longer');
    expect(within(dialogo).getByLabelText(/Contraseña nueva/)).toHaveValue('');

    status = 204;
    await userEvent.type(within(dialogo).getByLabelText(/Contraseña nueva/), PASSWORD);
    await userEvent.click(within(dialogo).getByRole('button', { name: 'Restablecer' }));
    expect(await within(dialogo).findByRole('status')).toHaveTextContent('Contraseña restablecida');
    expect(
      api.llamadas.filter((l) => l.ruta === `/usuarios/${VISOR.id}/password`).map((l) => l.cuerpo),
    ).toEqual([{ password: PASSWORD }, { password: PASSWORD }]);
  });

  it('un email duplicado (409) se muestra en el formulario de alta', async () => {
    apiAdmin('admin_empresa', {
      'POST /usuarios': () => json(409, { statusCode: 409, message: 'Ese email ya está en uso' }),
    });
    montar(`/admin?empresa=${A}&tab=usuarios`);

    const alta = await screen.findByRole('form', { name: 'Nuevo usuario' });
    await userEvent.type(within(alta).getByLabelText('Email'), VISOR.email);
    await userEvent.type(within(alta).getByLabelText('Nombre'), 'Repetido');
    await userEvent.type(within(alta).getByLabelText(/Contraseña inicial/), PASSWORD);
    await userEvent.click(within(alta).getByRole('button', { name: 'Agregar usuario' }));
    expect(await within(alta).findByRole('alert')).toHaveTextContent('Ese email ya está en uso');
  });
});

describe('Mi cuenta (cualquier rol)', () => {
  it('el visor llega desde el Topbar; confirmación distinta no llama a la API', async () => {
    const api = apiAdmin('visor');
    montar(`/?empresa=${A}`);

    await userEvent.click(await screen.findByRole('link', { name: 'Mi cuenta' }));
    const form = await screen.findByRole('form', { name: 'Cambiar contraseña' });
    await userEvent.type(within(form).getByLabelText('Contraseña actual'), 'actual-sintetica');
    await userEvent.type(within(form).getByLabelText(/^Contraseña nueva/), PASSWORD);
    await userEvent.type(within(form).getByLabelText(/Confirma/), `${PASSWORD}-otra`);
    await userEvent.click(within(form).getByRole('button', { name: 'Cambiar contraseña' }));

    expect(await within(form).findByRole('alert')).toHaveTextContent('no coinciden');
    expect(api.contar('POST', '/cuenta/password')).toBe(0);
  });

  it('actual incorrecta (400): muestra el mensaje; correcta: usa la sesión nueva', async () => {
    let respuesta: Response = json(400, {
      statusCode: 400,
      message: 'La contraseña actual no es correcta',
    });
    const nueva = sesion(usuario('visor'), 'token-tras-el-cambio');
    const api = apiAdmin('visor', {
      'POST /cuenta/password': () => respuesta,
      'GET /ventas/resumen': () => json(500, {}),
    });
    montar(`/cuenta?empresa=${A}`);

    const form = await screen.findByRole('form', { name: 'Cambiar contraseña' });
    const llenar = async () => {
      await userEvent.type(within(form).getByLabelText('Contraseña actual'), 'actual-sintetica');
      await userEvent.type(within(form).getByLabelText(/^Contraseña nueva/), PASSWORD);
      await userEvent.type(within(form).getByLabelText(/Confirma/), PASSWORD);
      await userEvent.click(within(form).getByRole('button', { name: 'Cambiar contraseña' }));
    };

    await llenar();
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'La contraseña actual no es correcta',
    );
    for (const campo of within(form).getAllByLabelText(/Contraseña|Confirma/)) {
      expect(campo).toHaveValue('');
    }

    respuesta = json(200, nueva);
    await llenar();
    expect(await within(form).findByRole('status')).toHaveTextContent('Contraseña cambiada');
    expect(api.llamadas.filter((l) => l.ruta === '/cuenta/password').map((l) => l.cuerpo)).toEqual([
      { actual: 'actual-sintetica', nueva: PASSWORD },
      { actual: 'actual-sintetica', nueva: PASSWORD },
    ]);

    // El siguiente request ya sale con el token de la sesión nueva.
    await userEvent.click(screen.getByRole('link', { name: 'Inicio' }));
    await waitFor(() => expect(api.contar('GET', '/ventas/resumen')).toBeGreaterThan(0));
    expect(api.llamadas.find((l) => l.ruta === '/ventas/resumen')?.autorizacion).toBe(
      'Bearer token-tras-el-cambio',
    );
  });
});
