import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CategoriaGasto,
  EstadoResultados,
  EstadoResultadosBase,
  Gastos as DatosGastos,
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
  type Manejador,
} from '../test/apiFalsa';
import { MARCA_SOBRESTIMADA } from './Gastos';

// F2-126 en el web, contra el router y la app reales: "Gastos y utilidad" (`/gastos`). Las cifras
// están escritas a mano; que el servidor las calcule bien lo prueban los e2e del api. Aquí se
// prueba lo que se pinta: lo nulo con su porqué (nunca $0.00), lo sobrestimado marcado, la gráfica,
// los CSV y la captura de gastos (sólo administradores).

const A = EMPRESA_A.id;
// Martes 22-sep-2026, 12:00 en CDMX.
const AHORA = new Date('2026-09-22T18:00:00Z');
const RUTA = `/gastos?empresa=${A}&periodo=rango&desde=2026-09-01&hasta=2026-09-21`;

function base(p: Partial<EstadoResultadosBase> = {}): EstadoResultadosBase {
  return {
    cuentas: 10,
    venta: '11600.00',
    ventaNeta: '10000.00',
    costo: {
      importe: '3000.00',
      completo: true,
      insumosSinCosto: 0,
      productosSinCosto: 0,
      ventaSinCosto: '0.00',
    },
    gastos: '2000.00',
    compras: '4500.00',
    utilidadBruta: '7000.00',
    utilidadOperacion: '5000.00',
    margenBruto: '70.0',
    margenOperacion: '50.0',
    utilidadSobrestimada: false,
    sinVentas: false,
    ...p,
  };
}

/**
 * Centro con costo incompleto (1 insumo sin costo): utilidad sobrestimada. Tijuana sin recetas:
 * sin costo ni utilidad. El total del API es nulo porque falta Tijuana.
 */
function estadoNormal(): EstadoResultados {
  return {
    sucursales: [
      {
        sucursalId: SUCURSAL_A1.id,
        sucursal: 'Centro',
        motivo: null,
        ...base({
          costo: {
            importe: '3000.00',
            completo: false,
            insumosSinCosto: 1,
            productosSinCosto: 0,
            ventaSinCosto: '0.00',
          },
          utilidadSobrestimada: true,
        }),
      },
      {
        sucursalId: SUCURSAL_A2.id,
        sucursal: 'Tijuana',
        motivo: 'sin_recetas',
        ...base({
          cuentas: 5,
          venta: '5800.00',
          ventaNeta: '5000.00',
          costo: {
            importe: null,
            completo: false,
            insumosSinCosto: 0,
            productosSinCosto: 0,
            ventaSinCosto: '0.00',
          },
          gastos: '1000.00',
          compras: '0.00',
          utilidadBruta: null,
          utilidadOperacion: null,
          margenBruto: null,
          margenOperacion: null,
        }),
      },
    ],
    total: {
      sucursalesSinCalculo: ['Tijuana'],
      ...base({
        cuentas: 15,
        venta: '17400.00',
        ventaNeta: '15000.00',
        costo: {
          importe: null,
          completo: false,
          insumosSinCosto: 1,
          productosSinCosto: 0,
          ventaSinCosto: '0.00',
        },
        gastos: '3000.00',
        utilidadBruta: null,
        utilidadOperacion: null,
        margenBruto: null,
        margenOperacion: null,
      }),
    },
    gastosPorCategoria: [
      { categoriaId: 'c1', categoria: 'Renta', monto: '2150.50' },
      { categoriaId: 'c2', categoria: 'Luz', monto: '849.50' },
    ],
  };
}

/** Sin cuentas ni gastos en ninguna sucursal. */
function estadoVacio(): EstadoResultados {
  const cero = base({
    cuentas: 0,
    venta: '0.00',
    ventaNeta: '0.00',
    gastos: '0.00',
    compras: '0.00',
    costo: {
      importe: '0.00',
      completo: true,
      insumosSinCosto: 0,
      productosSinCosto: 0,
      ventaSinCosto: '0.00',
    },
    utilidadBruta: '0.00',
    utilidadOperacion: '0.00',
    margenBruto: null,
    margenOperacion: null,
    sinVentas: true,
  });
  return {
    sucursales: [
      { sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', motivo: null, ...cero },
      { sucursalId: SUCURSAL_A2.id, sucursal: 'Tijuana', motivo: null, ...cero },
    ],
    total: { sucursalesSinCalculo: [], ...cero },
    gastosPorCategoria: [],
  };
}

const CATEGORIAS: CategoriaGasto[] = [
  { id: 'c1', nombre: 'Renta', activa: true },
  { id: 'c2', nombre: 'Luz', activa: true },
  { id: 'c3', nombre: 'Publicidad', activa: false },
];

function gastos(p: Partial<DatosGastos> = {}): DatosGastos {
  return {
    gastos: [
      {
        id: 'g1',
        sucursalId: SUCURSAL_A1.id,
        dia: '2026-09-05',
        categoriaId: 'c1',
        categoria: 'Renta',
        concepto: 'Renta de septiembre',
        monto: '2150.50',
        anulado: false,
      },
      {
        id: 'g2',
        sucursalId: SUCURSAL_A2.id,
        dia: '2026-09-06',
        categoriaId: 'c2',
        categoria: 'Luz',
        concepto: 'Recibo CFE',
        monto: '849.50',
        anulado: false,
      },
    ],
    truncado: false,
    total: '3000.00',
    porCategoria: [],
    ...p,
  };
}

function api(
  u: UsuarioActual = usuario('admin_empresa'),
  e: () => EstadoResultados = estadoNormal,
  g: () => DatosGastos = () => gastos(),
  extra: Record<string, Manejador> = {},
) {
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /finanzas/estado-resultados': () => json(200, e()),
    'GET /finanzas/gastos': () => json(200, g()),
    'GET /finanzas/categorias-gasto': () => json(200, { categorias: CATEGORIAS }),
    ...extra,
  });
}

function montar(ruta = RUTA) {
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

const region = (nombre: string) => screen.getByRole('region', { name: nombre });
const texto = (testId: string) => screen.getByTestId(testId).textContent ?? '';
const esperarEstado = () => screen.findByTestId('estado-total', undefined, { timeout: 5000 });
const esperarGastos = () => screen.findByTestId('tabla-gastos', undefined, { timeout: 5000 });

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

describe('estado de resultados', () => {
  it('sin ventas ni gastos: dice por qué, y no pinta ningún $0.00', async () => {
    const a = api(usuario('admin_empresa'), estadoVacio, () =>
      gastos({ gastos: [], total: '0.00' }),
    );
    montar();
    expect(
      await screen.findByText(/Sin ventas ni gastos en el periodo: no hay nada que restar/),
    ).toBeInTheDocument();
    const estado = region('Estado de resultados');
    expect(estado).not.toHaveTextContent('$0.00');
    expect(screen.queryByTestId('grafica-estado')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    // El periodo viaja tal cual en la consulta.
    const pedida = a.llamadas.find((l) => l.ruta === '/finanzas/estado-resultados');
    expect(pedida?.query.get('empresaId')).toBe(A);
    expect(pedida?.query.get('desde')).toBe('2026-09-01');
    expect(pedida?.query.get('hasta')).toBe('2026-09-21');
    // La lista de gastos vacía también dice qué hacer.
    expect(
      await screen.findByText(/Sin gastos en el periodo\.\s*Regístralos arriba\./),
    ).toBeInTheDocument();
  });

  it('sin recetas es "—" con su motivo; sobrestimada marcada; total nulo si falta una sucursal', async () => {
    api();
    montar();
    await esperarEstado();

    // Centro: la cifra con asterisco y la salvedad.
    const centro = screen.getByTestId('utilidad-Centro');
    expect(centro).toHaveTextContent('$5,000.00 *');
    expect(centro).toHaveAttribute('title', MARCA_SOBRESTIMADA);
    expect(within(centro).getByLabelText(MARCA_SOBRESTIMADA)).toBeInTheDocument();

    // Tijuana: "—" en costo, utilidades y márgenes; nunca $0.00.
    const tijuana = screen.getByTestId('estado-Tijuana');
    expect(screen.getByTestId('utilidad-Tijuana')).toHaveTextContent(/^—$/);
    expect(tijuana).not.toHaveTextContent('$0.00');
    const celdas = within(tijuana)
      .getAllByRole('cell')
      .map((c) => c.textContent);
    expect(celdas).toEqual(['$5,800.00', '$5,000.00', '—', '—', '—', '$1,000.00', '—', '—']);

    // El total lo manda nulo el API (falta Tijuana) aunque Centro tenga cifra: no se suma aquí.
    expect(screen.getByTestId('utilidad-total')).toHaveTextContent(/^—$/);
    expect(screen.getByTestId('estado-total')).not.toHaveTextContent('$0.00');

    const avisos = texto('avisos-estado');
    expect(avisos).toContain(
      'Tijuana: sin costo de lo vendido, todavía no ha mandado recetas (llegan con el lector de recetas, F2-241).',
    );
    expect(avisos).toContain(
      'Centro: utilidad SOBRESTIMADA (la real es menor) porque falta costo de 1 insumo sin costo de referencia.',
    );
    expect(avisos).toContain('El total no tiene costo ni utilidad: falta el costo de Tijuana.');

    // Las compras son informativas, no se restan.
    expect(texto('compras-informativo')).toContain('$4,500.00');
  });

  it('con datos hay gráfica por sucursal y gastos por categoría', async () => {
    api();
    montar();
    await esperarEstado();
    expect(within(region('Por sucursal')).getByTestId('grafica-estado')).toBeInTheDocument();
    const categorias = within(screen.getByTestId('gastos-por-categoria')).getAllByRole('listitem');
    expect(categorias.map((c) => c.textContent)).toEqual(['Renta$2,150.50', 'Luz$849.50']);
  });

  it('si el estado de resultados falla, se ve el error y la lista de gastos sigue', async () => {
    api(usuario('admin_empresa'), estadoNormal, () => gastos(), {
      'GET /finanzas/estado-resultados': () => json(500, { statusCode: 500, message: 'Falla' }),
    });
    montar();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar este dato.');
    expect(screen.queryByTestId('estado-total')).toBeNull();
    expect(await esperarGastos()).toBeInTheDocument();
  });
});

describe('export CSV', () => {
  const originales = { crear: URL.createObjectURL, revocar: URL.revokeObjectURL };
  afterEach(() => {
    URL.createObjectURL = originales.crear;
    URL.revokeObjectURL = originales.revocar;
  });

  function espiarDescargas() {
    const blobs: Blob[] = [];
    const nombres: string[] = [];
    URL.createObjectURL = (b: Blob | MediaSource) => {
      blobs.push(b as Blob);
      return 'blob:falso';
    };
    URL.revokeObjectURL = () => {};
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      nombres.push(this.download);
    });
    const contenido = async (i: number) =>
      new TextDecoder('utf-8', { ignoreBOM: true }).decode(
        new Uint8Array(await blobs[i].arrayBuffer()),
      );
    return { nombres, contenido };
  }

  it('el estado de resultados: lo nulo va vacío (no 0) y el total con su porqué', async () => {
    const user = userEvent.setup();
    const d = espiarDescargas();
    api();
    montar();
    await esperarEstado();
    await user.click(
      within(region('Estado de resultados')).getByRole('button', { name: 'Exportar CSV' }),
    );

    expect(d.nombres).toEqual(['estado-resultados_2026-09-01_2026-09-21.csv']);
    const csv = await d.contenido(0);
    expect(csv.startsWith('\uFEFFSucursal,Cuentas,')).toBe(true);
    const lineas = csv.slice(1).split('\r\n');
    expect(lineas.slice(1)).toEqual([
      'Centro,10,11600.00,10000.00,3000.00,no,7000.00,70.0,2000.00,5000.00,50.0,sí,4500.00,',
      'Tijuana,5,5800.00,5000.00,,,,,1000.00,,,,0.00,"todavía no ha mandado recetas (llegan con el lector de recetas, F2-241)"',
      'Total,15,17400.00,15000.00,,,,,3000.00,,,,4500.00,falta el costo de Tijuana',
      '',
    ]);
  });

  it('los gastos: con el nombre de la sucursal y los montos exactos', async () => {
    const user = userEvent.setup();
    const d = espiarDescargas();
    api();
    montar();
    await esperarGastos();
    await user.click(
      within(region('Gastos del periodo')).getByRole('button', { name: 'Exportar CSV' }),
    );

    expect(d.nombres).toEqual(['gastos_2026-09-01_2026-09-21.csv']);
    expect(await d.contenido(0)).toBe(
      '\uFEFFDía,Sucursal,Categoría,Concepto,Monto sin IVA,Anulado\r\n' +
        '2026-09-05,Centro,Renta,Renta de septiembre,2150.50,no\r\n' +
        '2026-09-06,Tijuana,Luz,Recibo CFE,849.50,no\r\n',
    );
  });

  it('un importe inválido no baja nada y se dice', async () => {
    const user = userEvent.setup();
    const d = espiarDescargas();
    api(usuario('admin_empresa'), () => {
      const e = estadoNormal();
      e.sucursales[0].venta = 'no-es-importe';
      return e;
    });
    montar();
    await esperarEstado();
    await user.click(
      within(region('Estado de resultados')).getByRole('button', { name: 'Exportar CSV' }),
    );
    expect(d.nombres).toEqual([]);
    expect(within(region('Estado de resultados')).getByRole('alert')).toHaveTextContent(
      'Centro trae un importe inválido ("no-es-importe").',
    );
  });
});

describe('captura de gastos', () => {
  it('el administrador registra un gasto: POST con el body esperado y todo se vuelve a pedir', async () => {
    const user = userEvent.setup();
    const a = api(usuario('admin_empresa'), estadoNormal, () => gastos(), {
      'POST /finanzas/gastos': () => json(201, { id: 'nuevo' }),
    });
    montar();
    await esperarGastos();
    const form = region('Registrar gasto');
    const selects = within(form).getAllByRole('combobox');
    await user.selectOptions(selects[0], SUCURSAL_A1.id);
    // La categoría inactiva no se ofrece.
    expect(
      within(selects[1])
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Elige…', 'Renta', 'Luz']);
    await user.selectOptions(selects[1], 'c2');
    fireEvent.change(within(form).getByLabelText('Día'), { target: { value: '2026-09-20' } });
    await user.type(within(form).getByLabelText('Concepto'), '  Recibo de gas  ');
    await user.type(within(form).getByLabelText('Monto sin IVA'), ' 1250.5 ');

    const antes = a.contar('GET', '/finanzas/estado-resultados');
    await user.click(within(form).getByRole('button', { name: 'Registrar' }));

    expect(await within(form).findByRole('status')).toHaveTextContent('Gasto registrado.');
    const post = a.llamadas.filter((l) => l.metodo === 'POST' && l.ruta === '/finanzas/gastos');
    expect(post).toHaveLength(1);
    expect(post[0].cuerpo).toEqual({
      empresaId: A,
      sucursalId: SUCURSAL_A1.id,
      categoriaId: 'c2',
      dia: '2026-09-20',
      concepto: 'Recibo de gas',
      monto: '1250.5',
    });
    // La escritura invalida todo lo de finanzas: el estado de resultados se vuelve a pedir.
    await waitFor(() =>
      expect(a.contar('GET', '/finanzas/estado-resultados')).toBeGreaterThan(antes),
    );
    // Concepto y monto se limpian para el siguiente.
    expect(within(form).getByLabelText('Concepto')).toHaveValue('');
    expect(within(form).getByLabelText('Monto sin IVA')).toHaveValue('');
  });

  it('un día futuro o un monto en cero no salen al API', async () => {
    const user = userEvent.setup();
    const a = api();
    montar();
    await esperarGastos();
    const form = region('Registrar gasto');
    const selects = within(form).getAllByRole('combobox');
    await user.selectOptions(selects[0], SUCURSAL_A1.id);
    await user.selectOptions(selects[1], 'c1');
    // Hoy en CDMX es 2026-09-22: el 23 es futuro.
    fireEvent.change(within(form).getByLabelText('Día'), { target: { value: '2026-09-23' } });
    await user.type(within(form).getByLabelText('Concepto'), 'Renta');
    await user.type(within(form).getByLabelText('Monto sin IVA'), '0');
    // En un navegador el `max` del input ya frena el envío; aquí se envía directo para probar la
    // validación propia (la que también cubre un navegador sin `max`).
    fireEvent.submit(form.querySelector('form') as HTMLFormElement);

    const errores = within(form).getByRole('alert');
    expect(
      within(errores)
        .getAllByRole('listitem')
        .map((l) => l.textContent),
    ).toEqual([
      'El día del gasto no puede ser posterior a hoy.',
      'El monto tiene que ser mayor que cero.',
    ]);
    expect(within(form).getByLabelText('Día')).toHaveAttribute('max', '2026-09-22');
    expect(a.contar('POST', '/finanzas/gastos')).toBe(0);
  });

  it('un rechazo del API se dice en el formulario', async () => {
    const user = userEvent.setup();
    api(usuario('admin_empresa'), estadoNormal, () => gastos(), {
      'POST /finanzas/gastos': () => json(404, { statusCode: 404, message: 'Not Found' }),
    });
    montar();
    await esperarGastos();
    const form = region('Registrar gasto');
    const selects = within(form).getAllByRole('combobox');
    await user.selectOptions(selects[0], SUCURSAL_A2.id);
    await user.selectOptions(selects[1], 'c1');
    fireEvent.change(within(form).getByLabelText('Día'), { target: { value: '2026-09-21' } });
    await user.type(within(form).getByLabelText('Concepto'), 'Renta');
    await user.type(within(form).getByLabelText('Monto sin IVA'), '100');
    await user.click(within(form).getByRole('button', { name: 'Registrar' }));
    expect(await within(form).findByRole('alert')).toHaveTextContent(
      'Esa sucursal, categoría o gasto ya no está en tu alcance.',
    );
  });

  it('anular un gasto lo pide con la empresa y refresca la lista', async () => {
    const user = userEvent.setup();
    const a = api(usuario('admin_empresa'), estadoNormal, () => gastos(), {
      'POST /finanzas/gastos/g2/anular': () => new Response(null, { status: 204 }),
    });
    montar();
    await esperarGastos();
    const antes = a.contar('GET', '/finanzas/gastos');
    const fila = screen.getByText('Recibo CFE').closest('tr') as HTMLElement;
    await user.click(within(fila).getByRole('button', { name: 'Anular' }));
    await waitFor(() => expect(a.contar('POST', '/finanzas/gastos/g2/anular')).toBe(1));
    const anular = a.llamadas.find((l) => l.ruta === '/finanzas/gastos/g2/anular');
    expect(anular?.query.get('empresaId')).toBe(A);
    await waitFor(() => expect(a.contar('GET', '/finanzas/gastos')).toBeGreaterThan(antes));
  });

  it('el visor ve el estado y la lista, pero ningún control de captura', async () => {
    api(usuario('visor', 'Vero Visor'));
    montar();
    await esperarEstado();
    await esperarGastos();
    expect(screen.queryByRole('region', { name: 'Registrar gasto' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Categorías de gasto' })).toBeNull();
    const lista = region('Gastos del periodo');
    expect(within(lista).queryByRole('button', { name: 'Editar' })).toBeNull();
    expect(within(lista).queryByRole('button', { name: 'Anular' })).toBeNull();
    // Exportar sí puede.
    expect(within(lista).getByRole('button', { name: 'Exportar CSV' })).toBeInTheDocument();
  });

  it('el visor, sin gastos, lee quién los registra', async () => {
    api(usuario('visor', 'Vero Visor'), estadoNormal, () => gastos({ gastos: [], total: '0.00' }));
    montar();
    expect(
      await screen.findByText(/Un administrador los registra en esta vista\./),
    ).toBeInTheDocument();
  });
});
