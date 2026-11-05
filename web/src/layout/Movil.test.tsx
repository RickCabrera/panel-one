import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type { Rol } from '../api/tipos';
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
} from '../test/apiFalsa';
import { anchoDePantalla } from '../test/matchMedia';
import { barraMovilPara } from './menu';

// UI-04: la versión de celular del panel. jsdom no aplica CSS, así que lo que se prueba es lo
// que se MONTA según `matchMedia` (falso: `anchoDePantalla`), que es lo que decide el armazón.

const A = EMPRESA_A.id;

function api(rol: Rol = 'visor') {
  const u = usuario(rol);
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'POST /auth/logout': () => new Response(null, { status: 204 }),
    'GET /empresas': () => json(200, rol === 'admin_global' ? [EMPRESA_A, EMPRESA_B] : [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /cortes': () => json(200, { cortes: [], truncado: false }),
    'GET /cortes/en-curso': () => json(200, []),
  });
}

function Ubicacion() {
  const { pathname, search } = useLocation();
  return <div data-testid="ubicacion">{pathname + search}</div>;
}

function montar(ruta: string) {
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
        <Ubicacion />
      </Proveedores>
    </MemoryRouter>,
  );
}

const ubicacion = () => screen.getByTestId('ubicacion').textContent;
const barra = () => screen.getByRole('navigation', { name: 'Principal' });
const masBoton = () => within(barra()).getByRole('button', { name: 'Más' });
const hoja = () => screen.getByRole('dialog', { name: 'Más' });

afterEach(() => {
  terminarSesion('cerrada');
  window.localStorage.clear();
});

describe('UI-04 · qué armazón se monta según el ancho', () => {
  it('a 390 px: barra inferior y cabecera compacta, sin lateral ni cabecera de escritorio', async () => {
    anchoDePantalla(390);
    api();
    montar(`/?empresa=${A}`);

    const nav = await screen.findByRole('navigation', { name: 'Principal' });
    expect(document.querySelector('[data-armazon="movil"]')).toBeInTheDocument();
    expect(document.getElementById('menu-principal')).not.toBeInTheDocument();
    // Los cuatro destinos y «Más», nada más (lo demás está en la hoja).
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.getAttribute('aria-label')),
    ).toEqual(['Inicio', 'Monitor de mesas', 'Turnos', 'Tickets']);
    expect(within(nav).getByRole('button', { name: 'Más' })).toBeInTheDocument();
    // Tema, cuenta y salir ya no están en la cabecera: están en «Más».
    expect(screen.queryByRole('group', { name: 'Tema' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Salir' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Mi cuenta' })).not.toBeInTheDocument();
    // La empresa, la sucursal y la operación en vivo sí.
    expect(screen.getByRole('button', { name: /^Empresa y sucursal: / })).toBeInTheDocument();
    expect(screen.getByTestId('operacion-en-vivo')).toBeInTheDocument();
  });

  it('a 1280 px: el lateral de siempre y ninguna barra inferior', async () => {
    api();
    montar(`/?empresa=${A}`);

    expect(await screen.findByRole('navigation', { name: 'Principal' })).toBeInTheDocument();
    expect(document.querySelector('[data-armazon="escritorio"]')).toBeInTheDocument();
    expect(document.getElementById('menu-principal')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Más' })).not.toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Tema' })).toBeInTheDocument();
  });

  it('girar el teléfono o agrandar la ventana cambia de armazón sin perder la vista', async () => {
    anchoDePantalla(390);
    api();
    montar(`/tickets?empresa=${A}`);
    expect(await screen.findByRole('button', { name: 'Más' })).toBeInTheDocument();

    act(() => anchoDePantalla(1024));
    expect(screen.queryByRole('button', { name: 'Más' })).not.toBeInTheDocument();
    expect(document.getElementById('menu-principal')).toBeInTheDocument();

    act(() => anchoDePantalla(767));
    expect(screen.getByRole('button', { name: 'Más' })).toBeInTheDocument();
    expect(ubicacion()).toBe(`/tickets?empresa=${A}`);
  });
});

describe('UI-04 · la barra inferior', () => {
  it('el destino activo lleva aria-current y los enlaces conservan el alcance', async () => {
    anchoDePantalla(390);
    api();
    montar(`/turnos?empresa=${A}&sucursal=${SUCURSAL_A1.id}&periodo=mes`);
    const turnos = await within(
      await screen.findByRole('navigation', { name: 'Principal' }),
    ).findByRole('link', { name: 'Turnos' });
    expect(turnos).toHaveAttribute('aria-current', 'page');
    expect(within(barra()).getByRole('link', { name: 'Inicio' })).not.toHaveAttribute(
      'aria-current',
    );
    expect(within(barra()).getByRole('link', { name: 'Tickets' })).toHaveAttribute(
      'href',
      `/tickets?empresa=${A}&sucursal=${SUCURSAL_A1.id}&periodo=mes`,
    );
  });

  it('cada destino de la barra existe en el router: ninguno cae en "No encontrada"', async () => {
    anchoDePantalla(390);
    api();
    montar(`/?empresa=${A}`);
    const evt = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Principal' });

    for (const entrada of barraMovilPara('visor')) {
      await evt.click(within(barra()).getByRole('link', { name: entrada.texto }));
      expect(ubicacion()?.split('?')[0]).toBe(entrada.destino!.ruta);
      expect(screen.queryByRole('heading', { name: 'No encontrada' })).not.toBeInTheDocument();
      expect(within(barra()).getByRole('link', { name: entrada.texto })).toHaveAttribute(
        'aria-current',
        'page',
      );
    }
  });

  it.each([
    ['visor', false, false, false],
    ['admin_empresa', true, false, false],
    ['admin_global', true, true, true],
  ] as const)(
    '%s: la barra es la misma; «Más» trae Administración=%s, Empresas=%s, Plataforma=%s',
    async (rol, conAdmin, conEmpresas, conPlataforma) => {
      anchoDePantalla(390);
      api(rol);
      montar(`/?empresa=${A}`);
      const evt = userEvent.setup();

      const nav = await screen.findByRole('navigation', { name: 'Principal' });
      expect(within(nav).getAllByRole('link')).toHaveLength(4);
      await evt.click(masBoton());
      const dentro = within(hoja());
      // Las secciones de menu.ts, sin repetir los de la barra.
      expect(dentro.getByRole('link', { name: 'Resumen' })).toBeInTheDocument();
      expect(dentro.queryByRole('link', { name: 'Tickets' })).not.toBeInTheDocument();
      expect(Boolean(dentro.queryByRole('heading', { name: 'Administración' }))).toBe(conAdmin);
      expect(Boolean(dentro.queryByRole('link', { name: 'Empresas' }))).toBe(conEmpresas);
      expect(Boolean(dentro.queryByRole('link', { name: 'Plataforma' }))).toBe(conPlataforma);
      // Las acciones de cuenta, para todos.
      expect(dentro.getByRole('group', { name: 'Tema' })).toBeInTheDocument();
      expect(dentro.getByRole('link', { name: 'Mi cuenta' })).toHaveAttribute(
        'href',
        `/cuenta?empresa=${A}`,
      );
      expect(dentro.getByRole('button', { name: 'Salir' })).toBeInTheDocument();
    },
  );

  it('en una vista que no está en la barra, «Más» la marca y su enlace sale activo en la hoja', async () => {
    anchoDePantalla(390);
    api();
    montar(`/analisis?empresa=${A}`);
    const evt = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Principal' });
    expect(within(barra()).queryByRole('link', { current: 'page' })).not.toBeInTheDocument();

    await evt.click(masBoton());
    expect(within(hoja()).getByRole('link', { name: 'Análisis' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('UI-04 · la hoja «Más» con teclado', () => {
  it('Enter abre con el foco dentro, Tab no sale, Escape cierra y el foco vuelve a «Más»', async () => {
    anchoDePantalla(390);
    api('admin_empresa');
    montar(`/?empresa=${A}`);
    const evt = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Principal' });

    masBoton().focus();
    await evt.keyboard('{Enter}');
    const dialogo = hoja();
    expect(dialogo).toHaveAttribute('aria-modal', 'true');
    expect(dialogo).toContainElement(document.activeElement as HTMLElement);
    expect(masBoton()).toHaveAttribute('aria-expanded', 'true');

    // Más Tabs que controles: el foco da la vuelta y nunca sale al fondo.
    const controles = within(dialogo).getAllByRole('link').length + 5;
    for (let i = 0; i < controles; i++) {
      await evt.tab();
      expect(dialogo).toContainElement(document.activeElement as HTMLElement);
    }
    // Shift+Tab desde el primero (Cerrar) va al último (Salir).
    within(dialogo).getByRole('button', { name: 'Cerrar' }).focus();
    await evt.tab({ shift: true });
    expect(document.activeElement).toBe(within(dialogo).getByRole('button', { name: 'Salir' }));

    await evt.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(masBoton());
    expect(masBoton()).toHaveAttribute('aria-expanded', 'false');
  });

  it('se cierra con «Cerrar», tocando el velo o arrastrando la agarradera hacia abajo', async () => {
    anchoDePantalla(390);
    api();
    montar(`/?empresa=${A}`);
    const evt = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Principal' });

    await evt.click(masBoton());
    await evt.click(within(hoja()).getByRole('button', { name: 'Cerrar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await evt.click(masBoton());
    fireEvent.mouseDown(screen.getByTestId('hoja-velo'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Un arrastre corto regresa; uno largo cierra.
    await evt.click(masBoton());
    const agarradera = screen.getByTestId('hoja-agarradera');
    fireEvent.pointerDown(agarradera, { button: 0, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(agarradera, { clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(agarradera, { clientY: 140, pointerId: 1 });
    expect(hoja().style.transform).toBe('');
    fireEvent.pointerDown(agarradera, { button: 0, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(agarradera, { clientY: 300, pointerId: 1 });
    fireEvent.pointerUp(agarradera, { clientY: 300, pointerId: 1 });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('el fondo no hace scroll mientras está abierta', async () => {
    anchoDePantalla(390);
    api();
    montar(`/?empresa=${A}`);
    const evt = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Principal' });

    await evt.click(masBoton());
    expect(document.body.style.overflow).toBe('hidden');
    await evt.keyboard('{Escape}');
    expect(document.body.style.overflow).toBe('');
  });

  it('«Salir» desde la hoja cierra la sesión', async () => {
    anchoDePantalla(390);
    const llamadas = api();
    montar(`/?empresa=${A}`);
    const evt = userEvent.setup();
    await screen.findByRole('navigation', { name: 'Principal' });

    await evt.click(masBoton());
    await evt.click(within(hoja()).getByRole('button', { name: 'Salir' }));
    await waitFor(() => expect(llamadas.contar('POST', '/auth/logout')).toBe(1));
  });
});

describe('UI-04 · la cabecera compacta', () => {
  it('el botón de empresa y sucursal abre una hoja; elegir sucursal la escribe en la URL', async () => {
    anchoDePantalla(390);
    api('admin_global');
    montar(`/?empresa=${A}`);
    const evt = userEvent.setup();

    const boton = await screen.findByRole('button', {
      name: 'Empresa y sucursal: Tacos Demo, Todas las sucursales',
    });
    await evt.click(boton);
    const dialogo = screen.getByRole('dialog', { name: 'Empresa y sucursal' });
    expect(within(dialogo).getByRole('combobox', { name: 'Empresa' })).toBeInTheDocument();
    const sucursal = within(dialogo).getByRole('combobox', { name: 'Sucursal' });
    await waitFor(() => expect(sucursal).toBeEnabled());
    await evt.selectOptions(sucursal, SUCURSAL_A1.id);
    expect(ubicacion()).toBe(`/?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);

    await evt.click(within(dialogo).getByRole('button', { name: 'Listo' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Empresa y sucursal: Tacos Demo, Centro' }),
    ).toHaveFocus();
  });

  it('el periodo sale bajo la cabecera en las vistas con periodo, con las cinco opciones', async () => {
    anchoDePantalla(360);
    api();
    montar(`/tickets?empresa=${A}&periodo=mes`);
    const grupo = await screen.findByRole('group', { name: 'Periodo' });
    expect(
      within(grupo)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Hoy', 'Esta semana', 'Este mes', 'Mes anterior', 'Rango']);
    expect(within(grupo).getByRole('button', { name: 'Este mes' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });
});
