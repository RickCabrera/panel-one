import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FichaCliente, FilaResumenCliente, ResumenClientes } from '../api/tipos';
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
  type Llamada,
  type Manejador,
} from '../test/apiFalsa';

// F2-232 en el web, contra el router y la app reales: la vista Clientes (`/clientes`). Cifras
// escritas a mano (las mismas del e2e del api).

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-22T20:00:00Z');
const RUTA = `/clientes?empresa=${A}&periodo=mes-anterior`;
const ID_ANA = 'c1a2b3c4-0000-4000-8000-000000000001';

function fila(p: Partial<FilaResumenCliente>): FilaResumenCliente {
  return {
    id: null,
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    cruce: 'ficha',
    origenSrId: 'SR-0',
    clave: null,
    nombre: null,
    activo: true,
    activoPos: null,
    visitas: 0,
    venta: '0.00',
    ticketPromedio: null,
    ultimaVisita: null,
    canceladas: { cuentas: 0, monto: '0.00' },
    ...p,
  };
}

const ANA = fila({
  id: ID_ANA,
  origenSrId: 'SR-17',
  clave: 'C001',
  nombre: 'Ana Cliente',
  visitas: 3,
  venta: '183.34',
  ticketPromedio: '61.11',
  ultimaVisita: '2026-08-11T05:30:00.000Z',
  canceladas: { cuentas: 1, monto: '80.00' },
});
const SIN_FICHA = fila({
  origenSrId: 'SR-20',
  cruce: 'sin-ficha',
  activo: null,
  visitas: 1,
  venta: '45.00',
  ticketPromedio: '45.00',
});

const CON_CLIENTES: ResumenClientes = {
  usaClientes: true,
  catalogoTruncado: false,
  cuentas: 8,
  cuentasConCliente: 6,
  ventaConCliente: '288.34',
  sucursales: [
    {
      sucursalId: SUCURSAL_A1.id,
      sucursal: 'Centro',
      catalogo: 'con-clientes',
      clientesActivos: 3,
      cuentas: 6,
      cuentasConCliente: 5,
    },
    {
      sucursalId: SUCURSAL_A2.id,
      sucursal: 'Tijuana',
      catalogo: 'con-clientes',
      clientesActivos: 4,
      cuentas: 2,
      cuentasConCliente: 0,
    },
  ],
  filas: [ANA, SIN_FICHA],
  total: 2,
  pagina: 1,
  porPagina: 50,
};

const SIN_CLIENTES: ResumenClientes = {
  ...CON_CLIENTES,
  usaClientes: false,
  cuentasConCliente: 0,
  ventaConCliente: '0.00',
  sucursales: [
    { ...CON_CLIENTES.sucursales[0], catalogo: 'vacio', clientesActivos: 0, cuentasConCliente: 0 },
    {
      ...CON_CLIENTES.sucursales[1],
      catalogo: 'sin-sincronizar',
      clientesActivos: 0,
      cuentasConCliente: 0,
    },
  ],
  filas: [],
  total: 0,
};

const FICHA: FichaCliente = {
  cliente: {
    id: ID_ANA,
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    origenSrId: 'SR-17',
    clave: 'C001',
    nombre: 'Ana Cliente',
    telefono: '555-010-9901',
    correo: 'ana.cliente@ejemplo.test',
    rfc: null,
    activo: true,
    activoPos: null,
    vistoAt: '2026-09-01T10:00:00.000Z',
  },
  receptor: null,
  periodo: {
    visitas: 3,
    venta: '183.34',
    ticketPromedio: '61.11',
    ultimaVisita: '2026-08-11T05:30:00.000Z',
    canceladas: { cuentas: 1, monto: '80.00' },
  },
  productos: [{ producto: 'Taco', cantidad: '5.000', importe: '100.01', cuentas: 2 }],
};

function api(resumen: ResumenClientes | ((l: Llamada) => Response) = CON_CLIENTES, extra = {}) {
  const u = usuario('visor');
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /catalogos/clientes/resumen':
      typeof resumen === 'function' ? resumen : () => json(200, resumen),
    [`GET /catalogos/clientes/${ID_ANA}/ficha`]: () => json(200, FICHA),
    'GET /ventas/tickets': () =>
      json(200, { items: [], total: 0, pagina: 1, porPagina: 50, corte: AHORA.toISOString() }),
    ...extra,
  } as Record<string, Manejador>);
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

const filas = async () =>
  within(await screen.findByTestId('tabla-clientes')).getAllByTestId('fila-cliente');

/** Captura las descargas: nombre y contenido de cada archivo. */
function capturarDescargas() {
  const archivos: Array<{ nombre: string; blob: Blob }> = [];
  const blobs: Blob[] = [];
  const originales = { crear: URL.createObjectURL, revocar: URL.revokeObjectURL };
  URL.createObjectURL = (b: Blob | MediaSource) => {
    blobs.push(b as Blob);
    return 'blob:falso';
  };
  URL.revokeObjectURL = () => {};
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    archivos.push({ nombre: this.download, blob: blobs[blobs.length - 1] });
  });
  return {
    archivos,
    texto: async (i: number) =>
      new TextDecoder().decode(new Uint8Array(await archivos[i].blob.arrayBuffer())),
    restaurar: () => {
      URL.createObjectURL = originales.crear;
      URL.revokeObjectURL = originales.revocar;
    },
  };
}

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

describe('Clientes (F2-232)', () => {
  it('pide la lista con el alcance y el periodo global, sin datos de contacto', async () => {
    const falsa = api();
    montar(RUTA);
    await filas();
    const pedida = falsa.llamadas.find((l) => l.ruta === '/catalogos/clientes/resumen')!;
    expect(pedida.query.get('empresaId')).toBe(A);
    expect(pedida.query.get('desde')).toBe('2026-08-01');
    expect(pedida.query.get('hasta')).toBe('2026-08-31');
    expect(pedida.query.has('contacto')).toBe(false);
  });

  it('AC vacío: sin clientes explica por qué (por sucursal) y qué haría falta, sin tabla', async () => {
    api(SIN_CLIENTES);
    montar(RUTA);
    const vacio = await screen.findByTestId('clientes-vacio');
    expect(vacio).toHaveTextContent(
      'El catálogo de clientes de Centro llegó vacío y ninguna cuenta del periodo trae cliente.',
    );
    expect(vacio).toHaveTextContent('Tijuana todavía no ha enviado su catálogo de clientes');
    expect(vacio).toHaveTextContent('hace falta que el POS capture al cliente en la cuenta');
    // No afirma que el POS no usa clientes: puede ser una lectura que falló.
    expect(vacio).toHaveTextContent('también puede ser una lectura que falló');
    expect(screen.queryByTestId('tabla-clientes')).toBeNull();
    expect(screen.queryByTestId('clientes-csv')).toBeNull();
  });

  it('tabla: visitas, ticket, canceladas aparte; "sin ficha" sin enlace; aviso de sucursal sin cuentas con cliente', async () => {
    api();
    montar(RUTA);
    const [ana, sinFicha] = await filas();
    expect(ana).toHaveTextContent('Ana Cliente');
    expect(ana).toHaveTextContent('$183.34');
    expect(ana).toHaveTextContent('$61.11');
    expect(ana).toHaveTextContent('1 · $80.00');
    // 05:30Z del 11-ago es el 10-ago 23:30 en CDMX.
    expect(ana).toHaveTextContent('23:30');
    expect(within(sinFicha).queryByRole('button')).toBeNull();
    expect(sinFicha).toHaveTextContent('Id del POS SR-20');
    expect(sinFicha).toHaveTextContent('Sin ficha en el catálogo');
    expect(screen.getByTestId('clientes-totales')).toHaveTextContent('6 de 8 cuentas (75.0 %)');
    expect(screen.getByTestId('clientes-sin-cuentas')).toHaveTextContent(
      'Ninguna cuenta del periodo trae cliente en Tijuana',
    );
  });

  it('la ficha: datos del POS, periodo, lo que más pide y "Ver sus tickets" sin canceladas', async () => {
    api();
    montar(RUTA);
    const [ana] = await filas();
    await userEvent.click(within(ana).getByRole('button', { name: 'Ana Cliente' }));
    const ficha = await screen.findByTestId('ficha-cliente');
    expect(ficha).toHaveTextContent('555-010-9901');
    expect(ficha).toHaveTextContent('RFCEl POS no lo tiene');
    expect(within(ficha).getByTestId('ficha-cliente-periodo')).toHaveTextContent(
      '1 cuenta por $80.00 (aparte: no suman a su venta)',
    );
    expect(within(ficha).getByTestId('ficha-cliente-productos')).toHaveTextContent(
      'Taco5 · $100.01 · en 2 visitas',
    );
    const enlace = within(ficha).getByTestId('ficha-cliente-tickets');
    expect(enlace).toHaveTextContent('Ver sus 3 visitas en Tickets');
    const destino = new URL(enlace.getAttribute('href')!, 'http://x');
    expect(destino.pathname).toBe('/tickets');
    expect(destino.searchParams.get('cliente')).toBe(ID_ANA);
    expect(destino.searchParams.get('canceladas')).toBe('excluir');
    expect(destino.searchParams.get('empresa')).toBe(A);
    expect(destino.searchParams.get('periodo')).toBe('mes-anterior');
    // Ningún dato personal en el enlace.
    expect(destino.search).not.toMatch(/Ana|555|ejemplo/);
  });

  it('F2-100: sin RFC no hay bloque de facturación; con RFC, el receptor o "sin datos"', async () => {
    api();
    montar(RUTA);
    const [ana] = await filas();
    await userEvent.click(within(ana).getByRole('button', { name: 'Ana Cliente' }));
    await screen.findByTestId('ficha-cliente');
    expect(screen.queryByTestId('ficha-cliente-receptor')).toBeNull();
    cleanup();

    const conRfc = (receptor: FichaCliente['receptor']): FichaCliente => ({
      ...FICHA,
      cliente: { ...FICHA.cliente, rfc: 'EKU9003173C9' },
      receptor,
    });
    api(CON_CLIENTES, {
      [`GET /catalogos/clientes/${ID_ANA}/ficha`]: () => json(200, conRfc(null)),
    });
    montar(RUTA);
    await userEvent.click(within((await filas())[0]).getByRole('button', { name: 'Ana Cliente' }));
    expect(await screen.findByTestId('ficha-cliente-receptor')).toHaveTextContent(
      'Sin datos de facturación guardados para este RFC.',
    );
    cleanup();

    api(CON_CLIENTES, {
      [`GET /catalogos/clientes/${ID_ANA}/ficha`]: () =>
        json(
          200,
          conRfc({
            rfc: 'EKU9003173C9',
            razonSocial: 'ESCUELA KEMPER URGATE',
            regimenFiscal: '601',
            cp: '42501',
            usoCfdi: 'G03',
            email: null,
          }),
        ),
    });
    montar(RUTA);
    await userEvent.click(within((await filas())[0]).getByRole('button', { name: 'Ana Cliente' }));
    const bloque = await screen.findByTestId('ficha-cliente-receptor');
    expect(bloque).toHaveTextContent('ESCUELA KEMPER URGATE');
    expect(bloque).toHaveTextContent('601 · 42501');
    expect(bloque).toHaveTextContent('G03');
    expect(bloque).toHaveTextContent('Sin correo guardado');
  });

  it('Tickets recibe el cliente de la URL: lo manda a la API y lo muestra como filtro sin el nombre', async () => {
    const falsa = api();
    montar(`/tickets?empresa=${A}&periodo=mes-anterior&cliente=${ID_ANA}&canceladas=excluir`);
    await waitFor(() => expect(falsa.contar('GET', '/ventas/tickets')).toBeGreaterThan(0));
    const pedida = falsa.llamadas.find((l) => l.ruta === '/ventas/tickets')!;
    expect(pedida.query.get('clienteId')).toBe(ID_ANA);
    expect(pedida.query.get('canceladas')).toBe('excluir');
    expect(await screen.findByText('Un cliente (desde su ficha)')).toBeInTheDocument();
  });

  it('la búsqueda viaja a la API (la vista la guarda en su estado, no en la URL)', async () => {
    const falsa = api();
    montar(RUTA);
    await filas();
    await userEvent.type(screen.getByRole('searchbox'), 'Ana');
    await userEvent.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() =>
      expect(
        falsa.llamadas.some(
          (l) => l.ruta === '/catalogos/clientes/resumen' && l.query.get('q') === 'Ana',
        ),
      ).toBe(true),
    );
    // Y vuelve a la página 1 de la búsqueda.
    const ultima = falsa.llamadas.filter((l) => l.ruta === '/catalogos/clientes/resumen').at(-1)!;
    expect(ultima.query.get('pagina')).toBe('1');
  });

  it('AC datos personales: el CSV no los trae salvo que se marque la casilla', async () => {
    const d = capturarDescargas();
    try {
      const falsa = api((l) =>
        json(
          200,
          l.query.get('contacto') === 'true'
            ? {
                ...CON_CLIENTES,
                filas: [
                  { ...ANA, telefono: '555-010-9901', correo: 'ana.cliente@ejemplo.test', rfc: null },
                  { ...SIN_FICHA, telefono: null, correo: null, rfc: null },
                ],
              }
            : CON_CLIENTES,
        ),
      );
      montar(RUTA);
      await filas();
      await userEvent.click(screen.getByTestId('clientes-csv'));
      await waitFor(() => expect(d.archivos).toHaveLength(1));
      expect(d.archivos[0].nombre).toBe('clientes_2026-08-01_2026-08-31.csv');
      const sin = await d.texto(0);
      expect(sin).not.toMatch(/Ana Cliente|555-010|ejemplo\.test/);
      expect(sin).toContain('C001');
      const pedidas = () =>
        falsa.llamadas.filter(
          (l) => l.ruta === '/catalogos/clientes/resumen' && l.query.get('porPagina') === '500',
        );
      expect(pedidas().every((l) => !l.query.has('contacto'))).toBe(true);

      await userEvent.click(screen.getByTestId('clientes-csv-contacto'));
      await userEvent.click(screen.getByTestId('clientes-csv'));
      await waitFor(() => expect(d.archivos).toHaveLength(2));
      const con = await d.texto(1);
      expect(con).toContain('Ana Cliente');
      expect(con).toContain('555-010-9901');
      expect(pedidas().some((l) => l.query.get('contacto') === 'true')).toBe(true);
    } finally {
      d.restaurar();
    }
  });
});
