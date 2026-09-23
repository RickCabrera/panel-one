import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';

import type { EstadoAgenteSucursal, UsuarioActual } from '../api/tipos';
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
import { SECCIONES } from './menu';

// F2-210 contra el router y la app reales: el menú por secciones, las entradas pendientes
// que no navegan, el orden de Tab, el colapso recordado y el badge de agentes.

const A = EMPRESA_A.id;

function api(u: UsuarioActual, agentes: EstadoAgenteSucursal[] = []) {
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /usuarios': () => json(200, []),
    'GET /agentes/estado': () => json(200, agentes),
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
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
        <Ubicacion />
      </Proveedores>
    </MemoryRouter>,
  );
}

const ubicacion = () => screen.getByTestId('ubicacion').textContent;
const menu = async () => screen.findByRole('navigation', { name: 'Principal' });

/** La lista de una sección; espera a que el menú esté montado. */
async function lista(seccionId: string): Promise<HTMLElement> {
  await menu();
  const el = document.getElementById(`menu-seccion-${seccionId}`);
  if (!el) throw new Error(`no hay sección ${seccionId}`);
  return el;
}

/** Los controles de las entradas de una lista (enlace o botón pendiente), en orden. */
const controles = (el: HTMLElement) =>
  Array.from(el.querySelectorAll<HTMLElement>(':scope > li > a, :scope > li > button'));

/** El nombre visible de un control del menú: su primer `span` (el texto, sin "Pronto"). */
function nombre(el: Element): string {
  return (el.querySelector('span')?.textContent ?? el.textContent ?? '').trim();
}

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
});

describe('AC1 · las seis secciones con sus entradas', () => {
  it('admin_global: seis encabezados en orden, y cada entrada como enlace o pendiente', async () => {
    api(usuario('admin_global'));
    montar(`/cuenta?empresa=${A}`);
    const nav = await menu();

    const encabezados = within(nav)
      .getAllByRole('button')
      .filter((b) => b.hasAttribute('aria-expanded'));
    expect(encabezados.map(nombre)).toEqual(SECCIONES.map((s) => s.titulo));

    for (const seccion of SECCIONES) {
      const items = controles(await lista(seccion.id));
      expect(items.map(nombre)).toEqual(seccion.entradas.map((e) => e.texto));
      for (const [i, entrada] of seccion.entradas.entries()) {
        expect(items[i].tagName).toBe(entrada.destino ? 'A' : 'BUTTON');
      }
    }
  });

  it('admin_empresa: Administración sin Empresas; visor: sin la sección', async () => {
    api(usuario('admin_empresa'));
    montar(`/cuenta?empresa=${A}`);
    expect(controles(await lista('administracion')).map(nombre)).toEqual([
      'Sucursales',
      'Usuarios',
      'Agentes',
      'Facturación',
    ]);
    cleanup();
    terminarSesion('cerrada');

    api(usuario('visor'));
    montar(`/cuenta?empresa=${A}`);
    await menu();
    expect(document.getElementById('menu-seccion-administracion')).toBeNull();
    // Las pendientes NO se ocultan por no estar construidas: el visor ve el mapa.
    expect(screen.getByRole('button', { name: 'Ventas por canal' })).toBeInTheDocument();
  });
});

describe('AC2 · una entrada sin módulo no navega a una pantalla rota', () => {
  it('clic y Enter no cambian la vista, y la razón se expone como descripción', async () => {
    api(usuario('visor'));
    montar(`/tickets?empresa=${A}`);
    const nav = await menu();
    // Proyecciones ya navega (F2-127): la pendiente de ejemplo es Ventas por canal (F2-144).
    const compras = within(nav).getByRole('button', { name: 'Ventas por canal' });

    expect(compras).toHaveAttribute('aria-disabled', 'true');
    expect(compras).not.toBeDisabled(); // sigue en el orden de Tab
    expect(compras).toHaveAccessibleDescription(
      'Se construye en F2-144, sobre los canales de F2-233.',
    );
    expect(compras).toHaveAttribute(
      'title',
      'Ventas por canal: Se construye en F2-144, sobre los canales de F2-233.',
    );

    await userEvent.click(compras);
    expect(ubicacion()).toBe(`/tickets?empresa=${A}`);
    compras.focus();
    await userEvent.keyboard('{Enter}');
    await userEvent.keyboard(' ');
    expect(ubicacion()).toBe(`/tickets?empresa=${A}`);
    expect(screen.queryByRole('heading', { name: 'No encontrada' })).not.toBeInTheDocument();
  });

  it('las de SIN_TAREA dicen que no tienen tarea, sin inventarla', async () => {
    api(usuario('visor'));
    montar(`/cuenta?empresa=${A}`);
    const principal = await lista('principal');
    expect(within(principal).getByRole('button', { name: 'Empresas' })).toHaveAccessibleDescription(
      /sin tarea asignada/,
    );
  });

  it('cada destino del menú existe en el router: ninguno cae en "No encontrada"', async () => {
    for (const entrada of SECCIONES.flatMap((s) => s.entradas)) {
      if (!entrada.destino) continue;
      const { ruta, tab } = entrada.destino;
      api(usuario('admin_global'));
      montar(`${ruta}?empresa=${A}${tab ? `&tab=${tab}` : ''}`);
      await waitFor(() =>
        expect(screen.getByTestId('alcance')).toHaveTextContent(EMPRESA_A.nombre),
      );
      expect([entrada.id, screen.queryByRole('heading', { name: 'No encontrada' })]).toEqual([
        entrada.id,
        null,
      ]);
      if (tab) {
        expect(screen.getByRole('tab', { selected: true })).toHaveTextContent(entrada.texto);
      }
      cleanup();
      terminarSesion('cerrada');
    }
  });
});

describe('AC3 · teclado', () => {
  it('Tab recorre todo el menú en el orden visual de la ficha', async () => {
    api(usuario('admin_global'));
    montar(`/cuenta?empresa=${A}`);
    const nav = await menu();
    const evt = userEvent.setup();

    const primero = within(nav).getByRole('button', { name: 'Principal' });
    primero.focus();
    // Nada del menú va antes que su primer encabezado.
    await evt.tab({ shift: true });
    expect(nav.contains(document.activeElement)).toBe(false);

    primero.focus();
    const recorrido: string[] = [];
    while (document.activeElement && nav.contains(document.activeElement)) {
      recorrido.push(nombre(document.activeElement));
      await evt.tab();
    }
    const esperado = SECCIONES.flatMap((s) => [s.titulo, ...s.entradas.map((e) => e.texto)]);
    expect(recorrido).toEqual(esperado);
  });

  it('Enter sobre una entrada navega y conserva empresa y sucursal', async () => {
    api(usuario('visor'));
    montar(`/cuenta?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    const nav = await menu();
    within(nav).getByRole('link', { name: 'Tickets' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(ubicacion()).toBe(`/tickets?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    expect(await screen.findByRole('heading', { name: 'Tickets' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'Tickets' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});

describe('AC4 · colapso recordado', () => {
  it('la sección colapsada sale del Tab y sigue colapsada al recargar; otro usuario no', async () => {
    const ana = usuario('visor');
    api(ana);
    montar(`/cuenta?empresa=${A}`);
    let nav = await menu();
    const evt = userEvent.setup();

    const catalogos = within(nav).getByRole('button', { name: 'Catálogos' });
    expect(catalogos).toHaveAttribute('aria-expanded', 'true');
    await evt.keyboard('{Tab}'); // da foco al documento antes de usar el teclado
    catalogos.focus();
    await evt.keyboard('{Enter}');
    expect(catalogos).toHaveAttribute('aria-expanded', 'false');
    expect(within(nav).queryByRole('link', { name: 'Clientes' })).not.toBeInTheDocument();
    // Del encabezado colapsado, Tab brinca directo a la siguiente sección.
    await evt.tab();
    expect(nombre(document.activeElement!)).toBe('Inventario y compras');

    // "Recarga": se desmonta todo y se vuelve a montar con la misma sesión de navegador.
    cleanup();
    terminarSesion('cerrada');
    api(ana);
    montar(`/cuenta?empresa=${A}`);
    nav = await menu();
    expect(within(nav).getByRole('button', { name: 'Catálogos' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
    expect(within(nav).queryByRole('link', { name: 'Clientes' })).not.toBeInTheDocument();

    cleanup();
    terminarSesion('cerrada');
    api({ ...usuario('visor', 'Beto'), id: '88888888-8888-4888-8888-888888888888' });
    montar(`/cuenta?empresa=${A}`);
    nav = await menu();
    expect(within(nav).getByRole('button', { name: 'Catálogos' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    // Clientes ya es enlace (F2-232).
    expect(within(nav).getByRole('link', { name: 'Clientes' })).toBeInTheDocument();
  });
});

describe('Administración', () => {
  it('la entrada activa sigue a la pestaña', async () => {
    api(usuario('admin_empresa'));
    montar(`/admin?empresa=${A}&tab=agentes`);
    const nav = await menu();
    await screen.findByRole('tab', { name: 'Agentes', selected: true });
    expect(within(nav).getByRole('link', { name: 'Agentes' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(within(nav).getByRole('link', { name: 'Sucursales' })).not.toHaveAttribute(
      'aria-current',
    );
    await userEvent.click(within(nav).getByRole('link', { name: 'Usuarios' }));
    expect(ubicacion()).toBe(`/admin?empresa=${A}&tab=usuarios`);
    expect(screen.getByRole('tab', { name: 'Usuarios' })).toHaveAttribute('aria-selected', 'true');
  });

  it('con Administración colapsada, el badge de agentes sube a su encabezado', async () => {
    const caida: EstadoAgenteSucursal = {
      sucursalId: SUCURSAL_A1.id,
      nombre: SUCURSAL_A1.nombre,
      zonaHoraria: SUCURSAL_A1.zonaHoraria,
      ultimoContactoAt: new Date(Date.now() - 700_000).toISOString(),
      edadContactoSegundos: 700,
      ultimaLecturaAt: null,
      edadLecturaSegundos: null,
      versionAgente: '0.1.0',
      versionSr: '10.0',
      tamanoCola: 0,
      latenciaQueryMs: 12,
      ultimoError: null,
    };
    api(usuario('admin_empresa'), [caida]);
    montar(`/cuenta?empresa=${A}`);
    const nav = await menu();
    const nombreBadge = '1 sucursal lleva más de 10 min sin reportar';

    const badge = await within(nav).findByRole('link', { name: nombreBadge });
    expect(document.getElementById('menu-seccion-administracion')).toContainElement(badge);

    await userEvent.click(within(nav).getByRole('button', { name: 'Administración' }));
    const arriba = await within(nav).findByRole('link', { name: nombreBadge });
    expect(document.getElementById('menu-seccion-administracion')).not.toContainElement(arriba);
    expect(screen.getAllByTestId('alerta-agentes')).toHaveLength(1);
    expect(arriba.getAttribute('href')).toBe(`/admin?empresa=${A}&tab=agentes`);
  });
});
