import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ConsumoTeorico,
  FilaConsumo,
  ProductoReceta,
  Recetas as DatosRecetas,
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

// F2-125 en el web, contra el router y la app reales: la vista Recetas (`/recetas`). Cifras
// escritas a mano (que el servidor las calcule bien lo prueban los e2e del api).

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-22T18:00:00Z');
const RUTA = `/recetas?empresa=${A}&periodo=rango&desde=2026-09-02&hasta=2026-09-02`;

function fila(p: Partial<FilaConsumo> & Pick<FilaConsumo, 'insumoOrigenSrId'>): FilaConsumo {
  return {
    sucursalId: SUCURSAL_A1.id,
    insumo: 'Carne al pastor',
    unidad: 'Kilogramo',
    teorico: '3.113',
    real: '3.200',
    consumo: '3.000',
    merma: '0.200',
    ajuste: '0.000',
    variacion: '0.087',
    porcentaje: '2.8',
    sinTeorico: false,
    costo: '200.00',
    importeTeorico: '622.60',
    importeVariacion: '17.40',
    ...p,
  };
}

function consumo(p: Partial<ConsumoTeorico> = {}): ConsumoTeorico {
  return {
    sucursales: [
      {
        sucursalId: SUCURSAL_A1.id,
        sucursal: 'Centro',
        recetasRecibidas: 4,
        catalogoProductos: true,
        polizasRecibidas: 7,
        calculada: true,
        productosExplotados: 2,
      },
      {
        sucursalId: SUCURSAL_A2.id,
        sucursal: 'Tijuana',
        recetasRecibidas: 0,
        catalogoProductos: true,
        polizasRecibidas: 0,
        calculada: false,
        productosExplotados: 0,
      },
    ],
    filas: [
      fila({ insumoOrigenSrId: 'I1' }),
      fila({
        insumoOrigenSrId: 'I9',
        insumo: 'Contenedor',
        unidad: 'Pieza',
        teorico: '0.000',
        real: '4.000',
        consumo: '4.000',
        merma: '0.000',
        variacion: '4.000',
        porcentaje: null,
        sinTeorico: true,
        costo: '2.00',
        importeTeorico: '0.00',
        importeVariacion: '8.00',
      }),
      fila({
        insumoOrigenSrId: 'I2',
        insumo: null,
        unidad: null,
        teorico: '36.000',
        real: '34.000',
        consumo: '36.000',
        merma: '0.000',
        ajuste: '-2.000',
        variacion: '-2.000',
        porcentaje: '-5.6',
        costo: '1.50',
        importeVariacion: '-3.00',
      }),
    ],
    aparte: [
      {
        sucursalId: SUCURSAL_A1.id,
        sucursal: 'Centro',
        producto: 'Refresco',
        motivo: 'sin_receta',
        productoOrigenSrId: 'P2',
        partidas: 1,
        cantidad: '2.000',
        importe: '50.00',
      },
      {
        sucursalId: SUCURSAL_A1.id,
        sucursal: 'Centro',
        producto: 'Pozole',
        motivo: 'sin_catalogo',
        productoOrigenSrId: null,
        partidas: 1,
        cantidad: '1.000',
        importe: '120.00',
      },
    ],
    ...p,
  };
}

function producto(p: Partial<ProductoReceta> & Pick<ProductoReceta, 'productoOrigenSrId'>) {
  return {
    sucursalId: SUCURSAL_A1.id,
    clave: p.productoOrigenSrId,
    nombre: 'Taco al pastor',
    vigente: true,
    enCatalogo: true,
    precio: '25.00',
    conReceta: true,
    renglones: [
      {
        insumoOrigenSrId: 'I1',
        insumo: 'Carne al pastor',
        unidad: 'Kilogramo',
        cantidad: '0.1500',
        costo: '200.00',
        importe: '30.00',
      },
      {
        insumoOrigenSrId: 'I3',
        insumo: 'Cebolla',
        unidad: 'Kilogramo',
        cantidad: '0.0200',
        costo: null,
        importe: null,
      },
    ],
    costo: '30.00',
    costoIncompleto: true,
    porcentajePrecio: null,
    ...p,
  } satisfies ProductoReceta;
}

function recetas(p: Partial<DatosRecetas> = {}): DatosRecetas {
  return {
    sucursales: [
      {
        sucursalId: SUCURSAL_A1.id,
        sucursal: 'Centro',
        recetasRecibidas: 4,
        catalogoProductos: true,
      },
      {
        sucursalId: SUCURSAL_A2.id,
        sucursal: 'Tijuana',
        recetasRecibidas: 0,
        catalogoProductos: true,
      },
    ],
    productos: [
      producto({
        productoOrigenSrId: 'P6',
        nombre: 'Arrachera',
        precio: '350.00',
        renglones: [
          {
            insumoOrigenSrId: 'I1',
            insumo: 'Carne al pastor',
            unidad: 'Kilogramo',
            cantidad: '1.0500',
            costo: '200.00',
            importe: '210.00',
          },
        ],
        costo: '210.00',
        costoIncompleto: false,
        porcentajePrecio: '60.0',
      }),
      producto({ productoOrigenSrId: 'P1' }),
      producto({
        productoOrigenSrId: 'P2',
        nombre: 'Refresco',
        conReceta: false,
        renglones: [],
        costo: null,
        costoIncompleto: false,
      }),
    ],
    total: 3,
    truncado: false,
    ...p,
  };
}

function api(
  u: UsuarioActual,
  c: () => ConsumoTeorico = () => consumo(),
  r: () => DatosRecetas = () => recetas(),
) {
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /inventario/consumo-teorico': () => json(200, c()),
    'GET /inventario/recetas': () => json(200, r()),
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

const tabla = (id: string) => screen.findByTestId(id, undefined, { timeout: 5000 });

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

describe('Recetas (F2-125)', () => {
  it('ranking: desglose, variación con signo y sentido en texto, % e importe', async () => {
    const f = api(usuario('visor'));
    montar(RUTA);
    const t = await tabla('tabla-consumo');
    const filas = within(t).getAllByRole('row').slice(1);
    expect(filas).toHaveLength(3);
    expect(filas[0]).toHaveTextContent('Carne al pastor');
    expect(filas[0]).toHaveTextContent('3.113');
    expect(filas[0]).toHaveTextContent('+0.087');
    expect(filas[0]).toHaveTextContent('Faltante');
    expect(filas[0]).toHaveTextContent('2.8 %');
    expect(filas[0]).toHaveTextContent('$17.40');
    // Sin teórico: sin %, y dice por qué.
    expect(filas[1]).toHaveTextContent('ningún producto vendido lo explica');
    expect(filas[1]).toHaveTextContent('—');
    // Insumo sin catálogo, ajuste a favor, sobrante.
    expect(filas[2]).toHaveTextContent('Insumo I2 (sin catálogo)');
    expect(filas[2]).toHaveTextContent('−2');
    expect(filas[2]).toHaveTextContent('Sobrante');
    expect(filas[2]).toHaveTextContent('−5.6 %');
    expect(filas[2]).toHaveTextContent('-$3.00');
    // El periodo de la cabecera viaja a la consulta.
    const q = f.llamadas.find((l) => l.ruta === '/inventario/consumo-teorico')!.query;
    expect([q.get('empresaId'), q.get('desde'), q.get('hasta')]).toEqual([
      A,
      '2026-09-02',
      '2026-09-02',
    ]);
    // La sucursal que no se calcula se dice, con la razón.
    expect(screen.getByTestId('avisos-consumo')).toHaveTextContent(
      'Tijuana: todavía no ha mandado recetas',
    );
  });

  it('lo vendido sin receta o sin catálogo va aparte, con la razón a la vista', async () => {
    api(usuario('visor'));
    montar(RUTA);
    const t = await tabla('tabla-aparte');
    const filas = within(t).getAllByRole('row').slice(1);
    expect(filas[0]).toHaveTextContent('Refresco');
    expect(filas[0]).toHaveTextContent('Sin receta');
    expect(filas[0]).toHaveTextContent('$50.00');
    expect(filas[1]).toHaveTextContent('No está en el catálogo');
  });

  it('ninguna sucursal calculable: dice por qué y qué falta, sin tabla', async () => {
    api(usuario('visor'), () =>
      consumo({
        sucursales: consumo().sucursales.map((s) => ({
          ...s,
          recetasRecibidas: 0,
          calculada: false,
        })),
        filas: [],
        aparte: [],
      }),
    );
    montar(RUTA);
    const v = await tabla('consumo-vacio');
    expect(v).toHaveTextContent('Centro: todavía no ha mandado recetas');
    expect(v).toHaveTextContent('F2-241');
    expect(screen.queryByTestId('tabla-consumo')).not.toBeInTheDocument();
  });

  it('periodo sin ventas ni salidas: lo dice en vez de una tabla vacía', async () => {
    api(usuario('visor'), () => consumo({ filas: [], aparte: [] }));
    montar(RUTA);
    expect(
      await screen.findByText(
        'En el periodo elegido no hubo ventas ni salidas de inventario que comparar.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('tabla-consumo')).not.toBeInTheDocument();
  });

  it('recetas: costo, % del precio, incompleto, detalle al abrir y sin receta aparte', async () => {
    api(usuario('visor'));
    montar(RUTA);
    const t = await tabla('tabla-recetas');
    const filas = within(t).getAllByRole('row').slice(1);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toHaveTextContent('Arrachera');
    expect(filas[0]).toHaveTextContent('$210.00');
    expect(filas[0]).toHaveTextContent('60.0 %');
    expect(filas[1]).toHaveTextContent('incompleto');
    expect(screen.getByTestId('sin-receta')).toHaveTextContent('Refresco');

    await userEvent.click(within(t).getByRole('button', { name: 'Taco al pastor' }));
    const detalle = screen.getByRole('table', { name: 'Receta de Taco al pastor' });
    expect(detalle).toHaveTextContent('0.15 Kilogramo');
    expect(detalle).toHaveTextContent('Sin costo');
    expect(within(t).getByRole('button', { name: 'Taco al pastor' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('la búsqueda filtra por nombre o clave sin ir al servidor', async () => {
    const f = api(usuario('visor'));
    montar(RUTA);
    const t = await tabla('tabla-recetas');
    const antes = f.contar('GET', '/inventario/recetas');
    await userEvent.type(screen.getByRole('searchbox', { name: 'Buscar' }), 'arra');
    expect(within(t).getAllByRole('row').slice(1)).toHaveLength(1);
    expect(f.contar('GET', '/inventario/recetas')).toBe(antes);
  });

  it('sin recetas recibidas: dice por qué y qué falta', async () => {
    api(
      usuario('visor'),
      () => consumo(),
      () =>
        recetas({
          sucursales: recetas().sucursales.map((s) => ({ ...s, recetasRecibidas: 0 })),
          productos: [],
          total: 0,
        }),
    );
    montar(RUTA);
    const v = await tabla('recetas-vacio');
    expect(v).toHaveTextContent('Ninguna sucursal ha mandado todavía sus recetas.');
    expect(v).toHaveTextContent('F2-241');
  });

  it('el menú lleva a Recetas', async () => {
    api(usuario('visor'));
    montar(`/tickets?empresa=${A}`);
    await userEvent.click(await screen.findByRole('link', { name: 'Recetas' }));
    expect(await screen.findByRole('heading', { name: 'Recetas' })).toBeInTheDocument();
  });
});
