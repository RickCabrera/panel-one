import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CfdiFila,
  EnvioCfdi,
  PaginaCfdis,
  PaginaPorFacturar,
  TableroFacturacion,
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
  usuario,
  type Manejador,
} from '../test/apiFalsa';

// F2-106 en el web, contra el router y la app reales: Facturación → Tablero (la pestaña por
// defecto de `/facturacion`). Lo que se prueba: los KPIs son las cifras del api tal cual; la tasa
// sale en % exacto; sin facturas dice por qué; la búsqueda viaja como `q`; el CSV baja TODA la
// búsqueda; las descargas y el reenvío usan sus endpoints.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-22T18:00:00Z');
const RUTA = `/facturacion?empresa=${A}&periodo=mes`;

const TABLERO: TableroFacturacion = {
  ventas: { venta: '3406.78', cuentas: 9 },
  facturado: { monto: '2350.00', cfdis: 4 },
  cancelados: { monto: '250.00', cfdis: 1 },
  tasa: '0.6898',
  porFacturar: { cuentas: 2, monto: '273.45' },
  porSucursal: [
    {
      sucursalId: SUCURSAL_A1.id,
      nombre: SUCURSAL_A1.nombre,
      venta: '3406.78',
      cuentas: 9,
      facturado: '2350.00',
      cfdis: 4,
      cancelados: { monto: '250.00', cfdis: 1 },
      tasa: '0.6898',
    },
  ],
  porMes: [{ mes: '2026-09', facturado: '2350.00', cfdis: 4 }],
  porHora: Array.from({ length: 24 }, (_, hora) => ({ hora, facturado: '0.00', cfdis: 0 })),
};

function cfdi(n: number, c: Partial<CfdiFila> = {}): CfdiFila {
  return {
    id: `cfdi-${n}`,
    uuid: `5FB2822E-396D-4725-8521-CDC4BDD20C${String(n).padStart(2, '0')}`,
    serieFolio: `A-${100 + n}`,
    sucursalId: SUCURSAL_A1.id,
    sucursal: SUCURSAL_A1.nombre,
    receptorRfc: 'EKU9003173C9',
    receptorNombre: 'ESCUELA KEMPER URGATE',
    total: '100.00',
    estado: 'vigente',
    emitidoAt: '2026-09-10T20:30:00.000Z',
    folioTicket: `T-${n}`,
    xml: true,
    pdf: true,
    origen: 'ticket',
    receptor: {
      rfc: 'EKU9003173C9',
      razonSocial: 'ESCUELA KEMPER URGATE',
      regimenFiscal: '601',
      cp: '42501',
      usoCfdi: 'G03',
      email: 'kemper@ejemplo.test',
    },
    sustituyeA: null,
    sustituidoPor: null,
    sustitucionPendiente: false,
    motivoCancelacion: null,
    ...c,
  };
}

const PAGINA: PaginaCfdis = {
  total: 2,
  pagina: 1,
  porPagina: 20,
  cfdis: [cfdi(1), cfdi(2, { estado: 'cancelado', xml: false, pdf: false })],
};
const POR_FACTURAR: PaginaPorFacturar = {
  total: 1,
  monto: '123.45',
  pagina: 1,
  porPagina: 20,
  cuentas: [
    {
      chequeId: 'ch-1',
      folio: 'T-8',
      sucursalId: SUCURSAL_A1.id,
      sucursal: SUCURSAL_A1.nombre,
      cerradoAt: '2026-09-20T18:00:00.000Z',
      total: '123.45',
      codigo: '7JQRECP3U',
      expiraAt: '2026-10-01T06:00:00.000Z',
    },
  ],
};
const ENVIO: EnvioCfdi = {
  cfdiId: 'cfdi-1',
  uuid: cfdi(1).uuid,
  serieFolio: 'A-101',
  email: 'kemper@ejemplo.test',
  estado: 'fallido',
  requiereReintento: true,
  intentos: 1,
  error: 'Brevo 401',
  ultimoIntentoAt: '2026-09-10T20:31:00.000Z',
};

function api(extra: Record<string, Manejador> = {}) {
  const u = usuario('admin_empresa');
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1]),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /facturacion/tablero': () => json(200, TABLERO),
    'GET /facturacion/cfdis': () => json(200, PAGINA),
    'GET /facturacion/por-facturar': () => json(200, POR_FACTURAR),
    'GET /facturacion/envios': () => json(200, []),
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

const texto = (id: string) => screen.getByTestId(id).textContent;

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

describe('tablero de facturación', () => {
  it('es la pestaña por defecto; KPIs tal cual del api y la tasa en % exacto', async () => {
    const a = api();
    montar();
    expect(await screen.findByRole('tab', { name: 'Tablero' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await screen.findByTestId('kpi-ventas');
    expect(texto('kpi-ventas')).toBe('$3,406.78');
    expect(texto('kpi-facturado')).toBe('$2,350.00');
    expect(texto('kpi-cancelados')).toBe('$250.00');
    expect(texto('kpi-tasa')).toBe('68.98 %');
    expect(texto('kpi-por-facturar')).toBe('$273.45');
    // El periodo global de la cabecera ("Este mes") llega al api.
    const pedida = a.llamadas.find((l) => l.ruta === '/facturacion/tablero')!;
    expect(pedida.query.get('empresaId')).toBe(A);
    expect(pedida.query.get('desde')).toBe('2026-09-01');
    expect(pedida.query.get('hasta')).toBe('2026-09-22');
    // La cabecera pinta el selector de periodo en esta vista.
    expect(screen.getAllByRole('group', { name: 'Periodo' }).length).toBeGreaterThan(0);
  });

  it('sin facturas dice por qué y qué hace falta; sin venta la tasa es "—", nunca 0 %', async () => {
    api({
      'GET /facturacion/tablero': () =>
        json(200, {
          ...TABLERO,
          ventas: { venta: '0.00', cuentas: 0 },
          facturado: { monto: '0.00', cfdis: 0 },
          cancelados: { monto: '0.00', cfdis: 0 },
          tasa: null,
        }),
      'GET /facturacion/cfdis': () => json(200, { ...PAGINA, total: 0, cfdis: [] }),
    });
    montar();
    expect(await screen.findByTestId('sin-facturas')).toHaveTextContent(
      'No hay ventas en este periodo',
    );
    expect(texto('kpi-tasa')).toBe('—');
    expect(await screen.findByText('No se emitió ninguna factura en este periodo.')).toBeVisible();
  });

  it('la tabla: estado, "Sin archivos" cuando no se guardaron, y la búsqueda viaja como q', async () => {
    const user = userEvent.setup();
    const a = api();
    montar();
    const tabla = await screen.findByTestId('tabla-cfdis');
    expect(within(tabla).getByText('Cancelada')).toBeVisible();
    expect(within(tabla).getByText('Sin archivos')).toBeVisible();
    // Fecha en la zona de la sucursal: 20:30Z = 14:30 en CDMX.
    expect(within(tabla).getAllByText('10/09/2026 14:30')).toHaveLength(2);

    await user.type(screen.getByRole('textbox', { name: 'Buscar' }), ' eku900 ');
    await user.click(screen.getByRole('button', { name: 'Buscar' }));
    await waitFor(() =>
      expect(
        a.llamadas.some((l) => l.ruta === '/facturacion/cfdis' && l.query.get('q') === 'eku900'),
      ).toBe(true),
    );
    expect(screen.getByText(/sólo en las facturas del periodo seleccionado/)).toBeVisible();
  });

  it('Exportar CSV baja TODA la búsqueda página por página y arma el archivo', async () => {
    const user = userEvent.setup();
    const paginas: Record<string, PaginaCfdis> = {
      '1': {
        total: 201,
        pagina: 1,
        porPagina: 200,
        cfdis: Array.from({ length: 200 }, (_, i) => cfdi(i)),
      },
      '2': { total: 201, pagina: 2, porPagina: 200, cfdis: [cfdi(200)] },
    };
    const a = api({
      'GET /facturacion/cfdis': (l) =>
        json(200, l.query.get('porPagina') === '200' ? paginas[l.query.get('pagina')!] : PAGINA),
    });
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
    montar();
    await screen.findByTestId('tabla-cfdis');
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    await waitFor(() => expect(nombres).toEqual(['facturas_2026-09-01_2026-09-22.csv']));
    const exportadas = a.llamadas.filter(
      (l) => l.ruta === '/facturacion/cfdis' && l.query.get('porPagina') === '200',
    );
    expect(exportadas.map((l) => l.query.get('pagina'))).toEqual(['1', '2']);
    const contenido = new TextDecoder().decode(new Uint8Array(await blobs[0].arrayBuffer()));
    // Encabezado + 201 filas + línea final vacía.
    expect(contenido.slice(1).split('\r\n')).toHaveLength(203);
  });

  it('XML/PDF se bajan por el endpoint autenticado', async () => {
    const user = userEvent.setup();
    const a = api({
      'GET /facturacion/cfdis/cfdi-1/xml': () =>
        new Response('<cfdi/>', { status: 200, headers: { 'Content-Type': 'application/xml' } }),
    });
    URL.createObjectURL = () => 'blob:falso';
    URL.revokeObjectURL = () => {};
    const nombres: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      nombres.push(this.download);
    });
    montar();
    const tabla = await screen.findByTestId('tabla-cfdis');
    await user.click(within(tabla).getByRole('button', { name: 'XML' }));
    await waitFor(() => expect(nombres).toEqual([`A-101_${cfdi(1).uuid}.xml`]));
    const llamada = a.llamadas.find((l) => l.ruta === '/facturacion/cfdis/cfdi-1/xml')!;
    expect(llamada.autorizacion).toMatch(/^Bearer /);
  });

  it('por facturar lista las cuentas con su código; los correos fallidos se reenvían', async () => {
    const user = userEvent.setup();
    let pendientes: EnvioCfdi[] = [ENVIO];
    const a = api({
      'GET /facturacion/envios': () => json(200, pendientes),
      'POST /facturacion/cfdis/cfdi-1/envios/reintento': () => {
        pendientes = [];
        return json(200, { ...ENVIO, estado: 'enviado', intentos: 2, error: null });
      },
    });
    montar();
    const lista = await screen.findByTestId('tabla-por-facturar');
    expect(within(lista).getByText('7JQRECP3U')).toBeVisible();
    const envios = await screen.findByTestId('envios-pendientes');
    expect(envios).toHaveTextContent('A-101 → kemper@ejemplo.test');
    await user.click(within(envios).getByRole('button', { name: 'Reenviar' }));
    expect(await screen.findByRole('status')).toHaveTextContent(
      'La factura A-101 se envió a kemper@ejemplo.test.',
    );
    expect(a.contar('POST', '/facturacion/cfdis/cfdi-1/envios/reintento')).toBe(1);
    expect(
      await screen.findByText(
        'Todas las facturas se entregaron por correo: no hay nada que reenviar.',
      ),
    ).toBeVisible();
  });

  it('un error del tablero se dice como error, no como vacío', async () => {
    api({ 'GET /facturacion/tablero': () => json(500, { statusCode: 500, message: 'caído' }) });
    montar();
    expect(await screen.findByText(/No se pudo cargar este dato\. caído/)).toBeVisible();
    expect(screen.queryByTestId('sin-facturas')).toBeNull();
  });
});
