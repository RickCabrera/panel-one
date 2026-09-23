import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompraDetalle, CompraResumen, Compras as DatosCompras } from '../api/tipos';
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

// F2-126 en el web, contra el router y la app reales: Compras (`/compras`). Las compras las lee el
// agente de SoftRestaurant; aquí se prueba cómo se pintan: resumen por proveedor, la lista con su
// detalle, la cancelada marcada (y fuera del total que manda el API), el CSV y los estados vacíos
// con su porqué. Cifras escritas a mano.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-22T18:00:00Z');
const RUTA = `/compras?empresa=${A}&periodo=rango&desde=2026-09-01&hasta=2026-09-21`;

function compra(p: Partial<CompraResumen> & Pick<CompraResumen, 'id' | 'folio'>): CompraResumen {
  return {
    sucursalId: SUCURSAL_A1.id,
    // 10:30 en CDMX.
    fecha: '2026-09-10T16:30:00Z',
    proveedorOrigenSrId: 'P1',
    proveedor: 'Carnes del Norte',
    almacenOrigenSrId: 'A1',
    almacen: 'General',
    total: '1000.00',
    partidas: 2,
    cancelada: false,
    ...p,
  };
}

/**
 * Centro manda compras; Tijuana nunca las ha mandado. La 000124 está cancelada: sale marcada y
 * NO está en el total (1,000 + 500 + 200 = 1,700) ni en el resumen por proveedor.
 */
function compras(p: Partial<DatosCompras> = {}): DatosCompras {
  return {
    sucursales: [
      { sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', comprasRecibidas: 4 },
      { sucursalId: SUCURSAL_A2.id, sucursal: 'Tijuana', comprasRecibidas: 0 },
    ],
    porProveedor: [
      {
        sucursalId: SUCURSAL_A1.id,
        proveedorOrigenSrId: 'P1',
        proveedor: 'Carnes del Norte',
        compras: 2,
        total: '1500.00',
      },
      {
        sucursalId: SUCURSAL_A1.id,
        proveedorOrigenSrId: 'P9',
        proveedor: null,
        compras: 1,
        total: '200.00',
      },
    ],
    compras: [
      compra({ id: 'c1', folio: '000123' }),
      compra({
        id: 'c2',
        folio: '000124',
        fecha: '2026-09-11T15:00:00Z',
        total: '999.00',
        partidas: 1,
        cancelada: true,
      }),
      compra({
        id: 'c3',
        folio: '000125',
        fecha: '2026-09-12T20:05:00Z',
        total: '500.00',
        partidas: 1,
      }),
      compra({
        id: 'c4',
        folio: '000126',
        fecha: '2026-09-13T17:00:00Z',
        proveedorOrigenSrId: 'P9',
        proveedor: null,
        almacenOrigenSrId: null,
        almacen: null,
        total: '200.00',
        partidas: 1,
      }),
    ],
    totalCompras: 4,
    truncado: false,
    total: '1700.00',
    ...p,
  };
}

const DETALLE: CompraDetalle = {
  ...compra({ id: 'c1', folio: '000123' }),
  sucursal: 'Centro',
  detalle: [
    {
      renglon: 1,
      insumoOrigenSrId: 'I1',
      insumo: 'Carne al pastor',
      unidad: 'Kilogramo',
      cantidad: '2.5000',
      costoUnitario: '200.00',
      importe: '500.00',
    },
    {
      renglon: 2,
      insumoOrigenSrId: 'I9',
      insumo: null,
      unidad: null,
      cantidad: '10.0000',
      costoUnitario: '50.00',
      importe: '500.00',
    },
  ],
};

function api(c: () => DatosCompras = () => compras(), extra: Record<string, Manejador> = {}) {
  const u = usuario('admin_empresa');
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /finanzas/compras': () => json(200, c()),
    'GET /finanzas/compras/c1': () => json(200, DETALLE),
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

const esperarTabla = () => screen.findByTestId('tabla-compras', undefined, { timeout: 5000 });
const filaDe = (folio: string) =>
  screen.getByRole('button', { name: folio }).closest('tr') as HTMLElement;
const celdas = (fila: HTMLElement) =>
  within(fila)
    .getAllByRole('cell')
    .map((c) => c.textContent);

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

describe('lista y resumen', () => {
  it('resumen por proveedor, total del API y la sucursal que nunca mandó compras', async () => {
    const a = api();
    montar();
    await esperarTabla();

    expect(screen.getByTestId('compras-total')).toHaveTextContent('$1,700.00');
    const proveedores = within(screen.getByTestId('por-proveedor'))
      .getAllByRole('listitem')
      .map((l) => l.textContent);
    expect(proveedores).toEqual([
      'Carnes del Norte · Centro · 2 compras$1,500.00',
      'Proveedor P9 (sin catálogo) · Centro · 1 compra$200.00',
    ]);
    // Tijuana: comprasRecibidas = 0 → el agente nunca mandó, no "cero compras".
    const sinLector = screen.getByTestId('compras-sin-lector');
    expect(sinLector).toHaveTextContent('Tijuana: todavía no manda compras');
    expect(sinLector).toHaveTextContent('Su ausencia no quiere decir que no compró.');
    expect(sinLector).not.toHaveTextContent('Centro');

    const pedida = a.llamadas.find((l) => l.ruta === '/finanzas/compras');
    expect(pedida?.query.get('empresaId')).toBe(A);
    expect(pedida?.query.get('desde')).toBe('2026-09-01');
    expect(pedida?.query.get('hasta')).toBe('2026-09-21');
  });

  it('cada compra con fecha local de la sucursal, catálogo faltante por id y la cancelada marcada', async () => {
    api();
    montar();
    await esperarTabla();

    expect(celdas(filaDe('000123'))).toEqual([
      '10/09/2026 10:30',
      'Centro',
      '000123',
      'Carnes del Norte',
      'General',
      '$1,000.00',
    ]);
    expect(celdas(filaDe('000126'))).toEqual([
      '13/09/2026 11:00',
      'Centro',
      '000126',
      'P9 (sin catálogo)',
      '—',
      '$200.00',
    ]);
    // La cancelada se ve, marcada y tachada; el total de arriba no la cuenta.
    const cancelada = filaDe('000124');
    expect(cancelada).toHaveTextContent('(cancelada)');
    const importe = within(cancelada).getByText('$999.00');
    expect(importe).toHaveClass('line-through');
    expect(within(filaDe('000123')).getByText('$1,000.00')).not.toHaveClass('line-through');
    expect(filaDe('000123')).not.toHaveTextContent('(cancelada)');
    expect(screen.getByTestId('compras-total')).toHaveTextContent('$1,700.00');
  });

  it('una sola sucursal en el alcance: sin la columna ni la etiqueta de sucursal', async () => {
    api(() =>
      compras({
        sucursales: [{ sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', comprasRecibidas: 4 }],
      }),
    );
    montar(`${RUTA}&sucursal=${SUCURSAL_A1.id}`);
    await esperarTabla();
    expect(
      within(screen.getByTestId('tabla-compras')).queryByRole('columnheader', { name: 'Sucursal' }),
    ).toBeNull();
    expect(screen.getByTestId('por-proveedor')).not.toHaveTextContent('· Centro');
    expect(screen.queryByTestId('compras-sin-lector')).toBeNull();
  });

  it('el detalle se pide al abrir la compra y trae sus partidas', async () => {
    const user = userEvent.setup();
    const a = api();
    montar();
    await esperarTabla();
    expect(a.contar('GET', '/finanzas/compras/c1')).toBe(0);

    const boton = screen.getByRole('button', { name: '000123' });
    expect(boton).toHaveAttribute('aria-expanded', 'false');
    await user.click(boton);
    expect(boton).toHaveAttribute('aria-expanded', 'true');

    const detalle = await screen.findByTestId('detalle-compra');
    const filas = within(detalle).getAllByRole('row').slice(1);
    expect(filas.map((f) => celdas(f))).toEqual([
      ['Carne al pastor', '2.5 Kilogramo', '$200.00', '$500.00'],
      ['I9 (sin catálogo)', '10', '$50.00', '$500.00'],
    ]);
    const pedida = a.llamadas.find((l) => l.ruta === '/finanzas/compras/c1');
    expect(pedida?.query.get('empresaId')).toBe(A);

    // Se cierra con el mismo botón.
    await user.click(boton);
    expect(screen.queryByTestId('detalle-compra')).toBeNull();
  });
});

describe('estados vacíos y avisos', () => {
  it('ninguna sucursal mandó compras: lo atribuye al agente, no al negocio, y sin $0.00', async () => {
    api(() =>
      compras({
        sucursales: [
          { sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', comprasRecibidas: 0 },
          { sucursalId: SUCURSAL_A2.id, sucursal: 'Tijuana', comprasRecibidas: 0 },
        ],
        porProveedor: [],
        compras: [],
        totalCompras: 0,
        total: '0.00',
      }),
    );
    montar();
    const vacio = await screen.findByTestId('compras-vacio-sin-lector', undefined, {
      timeout: 5000,
    });
    expect(vacio).toHaveTextContent('Ninguna sucursal del alcance ha mandado compras todavía');
    expect(vacio).toHaveTextContent('Esto no significa que no se haya comprado.');
    expect(screen.getByRole('region', { name: 'Compras del periodo' })).not.toHaveTextContent(
      '$0.00',
    );
    expect(screen.queryByTestId('tabla-compras')).toBeNull();
  });

  it('las sucursales sí mandan pero el periodo no tiene compras: lo dice así', async () => {
    api(() => compras({ porProveedor: [], compras: [], totalCompras: 0, total: '0.00' }));
    montar();
    const vacio = await screen.findByTestId('compras-vacio-periodo', undefined, { timeout: 5000 });
    expect(vacio).toHaveTextContent('Sin compras registradas en SoftRestaurant en este periodo');
    expect(screen.queryByTestId('compras-total')).toBeNull();
  });

  it('truncado: dice cuántas hay y que el total no va recortado', async () => {
    api(() => compras({ truncado: true, totalCompras: 2345 }));
    montar();
    await esperarTabla();
    expect(screen.getByTestId('compras-truncado')).toHaveTextContent(
      'Hay 2345 compras en el periodo y se muestran las 2000 más recientes',
    );
  });

  it('sin truncar no hay aviso', async () => {
    api();
    montar();
    await esperarTabla();
    expect(screen.queryByTestId('compras-truncado')).toBeNull();
  });

  it('si la consulta falla, se ve el error y no una tabla', async () => {
    api(() => compras(), {
      'GET /finanzas/compras': () => json(500, { statusCode: 500, message: 'Falla' }),
    });
    montar();
    expect(await screen.findByRole('alert', undefined, { timeout: 5000 })).toHaveTextContent(
      'No se pudo cargar este dato.',
    );
    expect(screen.queryByTestId('tabla-compras')).toBeNull();
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
    return { blobs, nombres, contenido };
  }

  it('baja la lista: fecha y hora locales, folio como texto, cancelada marcada', async () => {
    const user = userEvent.setup();
    const d = espiarDescargas();
    api();
    montar();
    await esperarTabla();
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));

    expect(d.nombres).toEqual(['compras_2026-09-01_2026-09-21.csv']);
    expect(await d.contenido(0)).toBe(
      '\uFEFFFecha,Hora,Sucursal,Folio,Proveedor,Almacén,Partidas,Total sin IVA,Cancelada\r\n' +
        '2026-09-10,10:30,Centro,"=""000123""",Carnes del Norte,General,2,1000.00,no\r\n' +
        '2026-09-11,09:00,Centro,"=""000124""",Carnes del Norte,General,1,999.00,sí\r\n' +
        '2026-09-12,14:05,Centro,"=""000125""",Carnes del Norte,General,1,500.00,no\r\n' +
        '2026-09-13,11:00,Centro,"=""000126""",P9,,1,200.00,no\r\n',
    );
  });

  it('un importe inválido no baja nada y se dice', async () => {
    const user = userEvent.setup();
    const d = espiarDescargas();
    api(() => compras({ compras: [compra({ id: 'c1', folio: '000123', total: '1,000.00' })] }));
    montar();
    await esperarTabla();
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(d.nombres).toEqual([]);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'La compra 000123 trae un importe inválido ("1,000.00").',
    );
  });
});
