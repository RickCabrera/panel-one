import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type { UsuarioAdmin } from '../api/tipos';
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
  type Manejador,
} from '../test/apiFalsa';

// Membresías, del lado del panel de los CLIENTES: el aviso de pago pendiente (vencida: sí
// entran), el mensaje de cuenta suspendida en el login, y que nadie ofrece restablecer la
// contraseña de un administrador global.

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

function conSesion(
  rol: 'admin_global' | 'admin_empresa' | 'visor',
  extra: Record<string, Manejador> = {},
) {
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(usuario(rol))),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1]),
    ...extra,
  });
}

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
});

describe('aviso de pago pendiente', () => {
  it('membresía vencida: el panel lo avisa arriba (y deja trabajar)', async () => {
    conSesion('visor', {
      'GET /cuenta/membresia': () =>
        json(200, {
          membresia: {
            estado: 'vencida',
            vencimiento: '2026-10-05',
            fechaLimite: '2026-10-10',
            plan: 'Esencial',
          },
        }),
    });
    montar('/cuenta');
    const aviso = await screen.findByTestId('aviso-membresia');
    expect(aviso).toHaveTextContent('Pago pendiente.');
    expect(aviso).toHaveTextContent('Tu membresía venció el 5 oct 2026.');
    expect(screen.getByRole('link', { name: 'Mi cuenta' })).toBeInTheDocument();
  });

  it.each([
    [
      'al corriente',
      {
        membresia: {
          estado: 'activa',
          vencimiento: '2026-12-05',
          fechaLimite: '2026-12-10',
          plan: 'E',
        },
      },
    ],
    ['sin suscripción', { membresia: null }],
  ])('%s: sin aviso', async (_c, cuerpo) => {
    const falsa = conSesion('admin_empresa', { 'GET /cuenta/membresia': () => json(200, cuerpo) });
    montar('/cuenta');
    await screen.findByRole('link', { name: 'Mi cuenta' });
    await new Promise((r) => setTimeout(r, 20));
    expect(falsa.contar('GET', '/cuenta/membresia')).toBe(1);
    expect(screen.queryByTestId('aviso-membresia')).toBeNull();
  });

  it('el admin_global (sin empresa) ni lo pregunta', async () => {
    const falsa = conSesion('admin_global');
    montar('/cuenta');
    await screen.findByRole('link', { name: 'Mi cuenta' });
    expect(falsa.contar('GET', '/cuenta/membresia')).toBe(0);
  });
});

describe('login de una cuenta suspendida', () => {
  it('muestra el mensaje de la API: "Tu cuenta está suspendida. Contacta a soporte."', async () => {
    const usuarioEv = userEvent.setup();
    instalarApiFalsa({
      'POST /auth/refresh': () => noAutorizado(),
      'POST /auth/login': () =>
        json(403, {
          statusCode: 403,
          error: 'Forbidden',
          message: 'Tu cuenta está suspendida. Contacta a soporte.',
          codigo: 'cuenta_bloqueada',
        }),
    });
    montar('/login');
    await usuarioEv.type(await screen.findByLabelText('Correo'), 'duena@demo.local');
    await usuarioEv.type(screen.getByLabelText('Contraseña'), 'contrasena-sintetica');
    await usuarioEv.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Tu cuenta está suspendida. Contacta a soporte.',
    );
  });
});

describe('contraseña de un administrador global', () => {
  it('Administración › Usuarios no ofrece restablecer la de otro admin_global (sí la de un usuario de empresa)', async () => {
    const otroGlobal: UsuarioAdmin = {
      id: 'otro-global',
      email: 'otro@demo.local',
      nombre: 'Otro Global',
      rol: 'admin_global',
      empresaId: null,
      activo: true,
    };
    const visor: UsuarioAdmin = {
      id: 'u-visor',
      email: 'visor@demo.local',
      nombre: 'Vero Visor',
      rol: 'visor',
      empresaId: EMPRESA_A.id,
      activo: true,
    };
    conSesion('admin_global', {
      'GET /usuarios': (l) => json(200, l.query.get('empresaId') ? [visor] : [visor, otroGlobal]),
    });
    montar('/admin?tab=usuarios');
    const globales = await screen.findByRole('region', { name: 'Administradores globales' });
    const fila = await within(globales).findByRole('row', { name: 'otro@demo.local' });
    expect(within(fila).queryByRole('button', { name: /contraseña/i })).toBeNull();
    const deEmpresa = await screen.findByRole('row', { name: 'visor@demo.local' });
    expect(
      within(deEmpresa).getByRole('button', { name: 'Restablecer contraseña' }),
    ).toBeInTheDocument();
  });
});
