import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DetalleProducto,
  FilaProducto,
  Menu,
  ProductoMenu,
  Rol,
  SincronizacionSucursal,
  VendidosSinCatalogo,
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
  type Manejador,
} from '../test/apiFalsa';

// F2-145 en el web, contra el router y la app reales: el orquestador de menú (`/menu`) y
// Productos (`/productos`). Precios escritos a mano.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-22T20:00:00Z');

function producto(p: Partial<ProductoMenu> & { clave: string; nombre: string }): ProductoMenu {
  return {
    llave: `c:${p.clave}`,
    criterio: 'clave',
    grupo: 'Platos fuertes',
    gruposDistintos: false,
    duplicadoEnSucursal: false,
    discrepancia: false,
    precioMin: '89.00',
    precioMax: '89.00',
    precios: [
      {
        productoId: `${p.clave}-1`,
        sucursalId: SUCURSAL_A1.id,
        origenSrId: p.clave,
        nombre: p.nombre,
        precio: '89.00',
        vigente: true,
        tieneMetadata: false,
      },
      {
        productoId: `${p.clave}-2`,
        sucursalId: SUCURSAL_A2.id,
        origenSrId: p.clave,
        nombre: p.nombre,
        precio: '89.00',
        vigente: true,
        tieneMetadata: false,
      },
    ],
    ...p,
  };
}

const TACOS = producto({
  clave: 'P009',
  nombre: 'Tacos al pastor',
  discrepancia: true,
  precioMin: '89.00',
  precioMax: '95.00',
  precios: [
    {
      productoId: 't1',
      sucursalId: SUCURSAL_A1.id,
      origenSrId: 'P009',
      nombre: 'Tacos al pastor',
      precio: '89.00',
      vigente: true,
      tieneMetadata: false,
    },
    {
      productoId: 't2',
      sucursalId: SUCURSAL_A2.id,
      origenSrId: 'P009',
      nombre: 'Tacos al pastor',
      precio: '95.00',
      vigente: true,
      tieneMetadata: false,
    },
  ],
});
const MOLE = producto({ clave: 'P011', nombre: 'Mole poblano' });
const REFRESCO = producto({
  clave: 'P020',
  nombre: 'Refresco',
  grupo: 'Bebidas',
  precios: [
    {
      productoId: 'r1',
      sucursalId: SUCURSAL_A1.id,
      origenSrId: 'P020',
      nombre: 'Refresco',
      precio: null,
      vigente: true,
      tieneMetadata: false,
    },
  ],
});

const SUCURSALES_MENU = [
  {
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    sincronizadoAt: '2026-09-22T09:00:00Z',
    productos: 3,
  },
  {
    sucursalId: SUCURSAL_A2.id,
    sucursal: 'Tijuana',
    sincronizadoAt: '2026-09-22T09:00:00Z',
    productos: 2,
  },
];

const MENU: Menu = {
  sucursales: SUCURSALES_MENU,
  categorias: [
    { grupo: 'Bebidas', productos: [REFRESCO] },
    { grupo: 'Platos fuertes', productos: [MOLE, TACOS] },
  ],
  productos: 3,
  discrepancias: 1,
  truncado: false,
};

const SIN_CATALOGO: VendidosSinCatalogo = {
  filas: [
    {
      sucursalId: SUCURSAL_A1.id,
      sucursal: 'Centro',
      producto: 'Especial del día',
      variantes: 2,
      partidas: 3,
      cantidad: '3.000',
      importe: '450.00',
    },
  ],
  total: 1,
  truncado: false,
  sucursalesSinCatalogo: [],
};

function fila(p: Partial<FilaProducto> = {}): FilaProducto {
  return {
    id: 'aaaaaaaa-0000-4000-8000-000000000009',
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    origenSrId: 'P009',
    clave: 'P009',
    nombre: 'Tacos al pastor',
    activo: true,
    activoPos: true,
    vistoAt: '2026-09-22T09:00:00Z',
    updatedAt: '2026-09-22T09:00:00Z',
    grupoOrigenSrId: 'G03',
    grupo: 'Platos fuertes',
    precio: '89.00',
    tieneMetadata: false,
    ...p,
  };
}

const DETALLE: DetalleProducto = { ...fila(), metadata: null };

function sincronizacion(ultima: string | null, pendiente = false): SincronizacionSucursal[] {
  return [SUCURSAL_A1, SUCURSAL_A2].map((s) => ({
    sucursalId: s.id,
    sucursal: s.nombre,
    catalogos: (['grupos', 'productos', 'meseros', 'clientes', 'areas', 'canales'] as const).map(
      (catalogo) => ({
        catalogo,
        ultimaCompletaAt: ultima,
        recibidaAt: ultima,
        total: ultima ? 26 : null,
        rechazados: ultima ? 0 : null,
        desactivados: ultima ? 0 : null,
      }),
    ),
    solicitud: { solicitadaAt: pendiente ? AHORA.toISOString() : null, pendiente },
  }));
}

function api(rol: Rol = 'admin_empresa', extra: Record<string, Manejador> = {}) {
  const u = usuario(rol);
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /catalogos/menu': () => json(200, MENU),
    'GET /catalogos/sin-catalogo': () => json(200, SIN_CATALOGO),
    'GET /catalogos/productos': () =>
      json(200, { filas: [fila()], total: 1, pagina: 1, porPagina: 50 }),
    'GET /catalogos/sincronizacion': () => json(200, sincronizacion('2026-09-22T09:00:00Z')),
    [`GET /catalogos/productos/${DETALLE.id}`]: () => json(200, DETALLE),
    ...extra,
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

const filasMenu = () =>
  screen.getAllByTestId('menu-categoria').flatMap((t) => within(t).getAllByRole('row').slice(1));

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
});

describe('Orquestador de menú: AC — la discrepancia de precio aparece señalada', () => {
  it('el producto con precio distinto se marca con texto, no sólo color; el igual no', async () => {
    api('visor');
    montar(`/menu?empresa=${A}`);
    expect(await screen.findByTestId('menu-resumen')).toHaveTextContent(
      '1 producto con precio distinto entre sucursales de 3 en el menú.',
    );
    const tacos = filasMenu().find((r) => within(r).queryByText('Tacos al pastor'))!;
    expect(tacos).toHaveAttribute('data-discrepancia', 'si');
    expect(within(tacos).getByText('Precio distinto: $89.00 a $95.00')).toBeVisible();
    expect(within(tacos).getByText('$95.00')).toBeVisible();
    const mole = filasMenu().find((r) => within(r).queryByText('Mole poblano'))!;
    expect(mole).toHaveAttribute('data-discrepancia', 'no');
    expect(within(mole).queryByText(/Precio distinto/)).toBeNull();
  });

  it('una columna por sucursal; "Sin precio" y "—" nunca se pintan como $0.00', async () => {
    api('visor');
    montar(`/menu?empresa=${A}`);
    await screen.findByTestId('menu-resumen');
    const refresco = filasMenu().find((r) => within(r).queryByText('Refresco'))!;
    expect(within(refresco).getByText('Sin precio')).toBeVisible();
    expect(within(refresco).getByText('No está en esta sucursal')).toBeInTheDocument();
    expect(within(refresco).queryByText('$0.00')).toBeNull();
    // Categorías en el orden del API.
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual(
      expect.arrayContaining(['Bebidas', 'Platos fuertes']),
    );
  });

  it('"sólo precios distintos" deja únicamente los señalados', async () => {
    api('visor');
    montar(`/menu?empresa=${A}`);
    await screen.findByTestId('menu-resumen');
    await userEvent.click(screen.getByLabelText('Sólo productos con precio distinto'));
    const nombres = filasMenu().map((r) => within(r).getAllByRole('cell')[0].textContent);
    expect(nombres).toHaveLength(1);
    expect(nombres[0]).toContain('Tacos al pastor');
  });

  it('pide el menú del alcance de la URL', async () => {
    const falsa = api('visor');
    montar(`/menu?empresa=${A}&sucursal=${SUCURSAL_A2.id}`);
    await waitFor(() => expect(falsa.contar('GET', '/catalogos/menu')).toBe(1));
    const l = falsa.llamadas.find((x) => x.ruta === '/catalogos/menu')!;
    expect(l.query.get('empresaId')).toBe(A);
    expect(l.query.get('sucursalId')).toBe(SUCURSAL_A2.id);
  });
});

describe('Orquestador de menú: estados vacíos honestos', () => {
  it('sin catálogo sincronizado dice por qué y qué hace falta', async () => {
    api('visor', {
      'GET /catalogos/menu': () =>
        json(200, {
          ...MENU,
          sucursales: SUCURSALES_MENU.map((s) => ({ ...s, sincronizadoAt: null, productos: 0 })),
          categorias: [],
          productos: 0,
          discrepancias: 0,
        }),
    });
    montar(`/menu?empresa=${A}`);
    expect(
      await screen.findByText(/ninguna sucursal ha enviado su primera sincronización/),
    ).toBeVisible();
  });

  it('una sucursal sin sincronizar se nombra, y el truncado se avisa', async () => {
    api('visor', {
      'GET /catalogos/menu': () =>
        json(200, {
          ...MENU,
          sucursales: [SUCURSALES_MENU[0], { ...SUCURSALES_MENU[1], sincronizadoAt: null }],
          truncado: true,
        }),
    });
    montar(`/menu?empresa=${A}`);
    expect(await screen.findByTestId('menu-sin-sincronizar')).toHaveTextContent('Tijuana');
    expect(screen.getByText(/sólo se ven los primeros 5000 renglones/)).toBeVisible();
  });

  it('con una sola sucursal explica que no hay nada que comparar', async () => {
    api('visor', {
      'GET /catalogos/menu': () =>
        json(200, { ...MENU, sucursales: [SUCURSALES_MENU[0]], discrepancias: 0 }),
    });
    montar(`/menu?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    expect(await screen.findByText(/no hay precios que comparar/)).toBeVisible();
  });
});

describe('Orquestador de menú: vendidos sin catálogo', () => {
  it('lista lo vendido fuera del catálogo con el periodo de la URL', async () => {
    const falsa = api('visor');
    montar(`/menu?empresa=${A}&periodo=rango&desde=2026-09-01&hasta=2026-09-10`);
    const tabla = await screen.findByTestId('sin-catalogo');
    expect(within(tabla).getByText('Especial del día')).toBeVisible();
    expect(within(tabla).getByText('(2 escrituras)')).toBeVisible();
    expect(within(tabla).getByText('$450.00')).toBeVisible();
    const l = falsa.llamadas.find((x) => x.ruta === '/catalogos/sin-catalogo')!;
    expect(l.query.get('empresaId')).toBe(A);
    expect(l.query.get('desde')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('sin nada fuera del catálogo lo dice; las sucursales sin catálogo completo se nombran', async () => {
    api('visor', {
      'GET /catalogos/sin-catalogo': () =>
        json(200, {
          filas: [],
          total: 0,
          truncado: false,
          sucursalesSinCatalogo: [{ sucursalId: SUCURSAL_A2.id, sucursal: 'Tijuana' }],
        }),
    });
    montar(`/menu?empresa=${A}`);
    expect(await screen.findByTestId('sin-catalogo-pendientes')).toHaveTextContent(
      /No se revisan Tijuana/,
    );
    expect(
      await screen.findByText(
        'En las sucursales con catálogo completo, todo lo vendido en el periodo está en su catálogo.',
      ),
    ).toBeVisible();
  });
});

describe('Productos', () => {
  it('lista con precio y estado; la ficha de un visor no trae formulario', async () => {
    api('visor');
    montar(`/productos?empresa=${A}`);
    const tabla = await screen.findByTestId('productos-tabla');
    expect(within(tabla).getByText('$89.00')).toBeVisible();
    expect(within(tabla).getByText('Vigente')).toBeVisible();
    await userEvent.click(within(tabla).getByRole('button', { name: 'Tacos al pastor' }));
    const ficha = await screen.findByTestId('ficha-producto');
    expect(within(ficha).getByText('Sin datos propios todavía.')).toBeVisible();
    expect(within(ficha).queryByRole('button', { name: 'Guardar datos propios' })).toBeNull();
    // Un visor tampoco pide sincronizaciones.
    expect(screen.queryByRole('button', { name: 'Pedir sincronización' })).toBeNull();
  });

  it('un admin guarda la metadata con el cuerpo exacto del contrato', async () => {
    const falsa = api('admin_empresa', {
      [`PUT /catalogos/productos/${DETALLE.id}/metadata`]: (l) =>
        json(200, {
          ...DETALLE,
          metadata: { ...(l.cuerpo as object), updatedAt: AHORA.toISOString() },
        }),
    });
    montar(`/productos?empresa=${A}`);
    const tabla = await screen.findByTestId('productos-tabla');
    await userEvent.click(within(tabla).getByRole('button', { name: 'Tacos al pastor' }));
    const ficha = await screen.findByTestId('ficha-producto');
    await userEvent.type(within(ficha).getByLabelText('Descripción'), 'Con piña');
    await userEvent.type(
      within(ficha).getByLabelText('Etiquetas (separadas por coma)'),
      'picante, , favorito',
    );
    await userEvent.type(within(ficha).getByLabelText('Existencia mínima'), '2.5');
    await userEvent.click(within(ficha).getByRole('button', { name: 'Guardar datos propios' }));
    expect(await within(ficha).findByText('Guardado.')).toBeVisible();
    const put = falsa.llamadas.find((l) => l.metodo === 'PUT')!;
    expect(put.cuerpo).toEqual({
      empresaId: A,
      descripcion: 'Con piña',
      fotoUrl: null,
      etiquetas: ['picante', 'favorito'],
      minimo: '2.5',
      maximo: null,
    });
  });

  it('sin catálogo sincronizado lo explica en vez de una tabla vacía', async () => {
    api('visor', {
      'GET /catalogos/productos': () =>
        json(200, { filas: [], total: 0, pagina: 1, porPagina: 50 }),
      'GET /catalogos/sincronizacion': () => json(200, sincronizacion(null)),
    });
    montar(`/productos?empresa=${A}`);
    expect(await screen.findByText(/no ha enviado su primera sincronización/)).toBeVisible();
    expect(screen.getAllByText('Nunca ha sincronizado su catálogo de productos.')).toHaveLength(2);
  });

  it('un admin pide la sincronización de una sucursal', async () => {
    let pendiente = false;
    const falsa = api('admin_empresa', {
      'GET /catalogos/sincronizacion': () =>
        json(200, sincronizacion('2026-09-22T09:00:00Z', pendiente)),
      'POST /catalogos/sincronizacion/forzar': () => {
        pendiente = true;
        return json(202, sincronizacion('2026-09-22T09:00:00Z', true)[0]);
      },
    });
    montar(`/productos?empresa=${A}`);
    await screen.findByTestId('sincronizacion');
    await userEvent.click(screen.getAllByRole('button', { name: 'Pedir sincronización' })[0]);
    await waitFor(() =>
      expect(screen.getAllByText(/Sincronización pedida/).length).toBeGreaterThan(0),
    );
    const post = falsa.llamadas.find((l) => l.metodo === 'POST' && l.ruta.includes('forzar'))!;
    expect(post.cuerpo).toEqual({ empresaId: A, sucursalId: SUCURSAL_A1.id });
  });
});
