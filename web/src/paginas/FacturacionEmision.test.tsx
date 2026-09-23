import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CatalogosSat,
  CfdiFila,
  FacturaEmitidaAdmin,
  PaginaCfdis,
  ResultadoRefacturacion,
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

// F2-107 en el web, contra el router y la app reales: Facturación → "Sin ticket" (captura manual) y
// la refacturación desde la tabla del Tablero. Lo que se prueba: el total viaja como TEXTO, la
// llave de la captura se repite en un reintento y cambia con una captura nueva, los errores del api
// se pintan por campo, la tabla distingue manuales y sustituciones, y el diálogo guiado manda el
// receptor corregido (o sólo reintenta la cancelación).

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-22T18:00:00Z');
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const CATALOGOS: CatalogosSat = {
  regimenesFiscales: [
    { clave: '601', descripcion: 'General de Ley Personas Morales', fisica: false, moral: true },
    { clave: '612', descripcion: 'Actividades Empresariales', fisica: true, moral: false },
  ],
  usosCfdi: [
    {
      clave: 'G03',
      descripcion: 'Gastos en general',
      fisica: true,
      moral: true,
      regimenes: ['601', '612'],
    },
  ],
};

const TABLERO: TableroFacturacion = {
  ventas: { venta: '1000.00', cuentas: 3 },
  facturado: { monto: '500.00', cfdis: 2 },
  global: { monto: '0.00', cfdis: 0 },
  cancelados: { monto: '0.00', cfdis: 0 },
  tasa: '0.5000',
  porFacturar: { cuentas: 0, monto: '0.00' },
  porSucursal: [],
  porMes: [{ mes: '2026-09', facturado: '500.00', cfdis: 2 }],
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

const SUSTITUTO = 'AAAAAAAA-396D-4725-8521-CDC4BDD20C99';
const PAGINA: PaginaCfdis = {
  total: 4,
  pagina: 1,
  porPagina: 20,
  cfdis: [
    cfdi(1),
    cfdi(2, { origen: 'manual', folioTicket: null }),
    cfdi(3, { sustituidoPor: SUSTITUTO, sustitucionPendiente: true }),
    cfdi(4, {
      estado: 'cancelado',
      motivoCancelacion: '01',
      sustituidoPor: SUSTITUTO,
    }),
  ],
};

const EMITIDA: FacturaEmitidaAdmin = {
  id: 'cfdi-9',
  uuid: '6F1C2A57-3B8E-4D2A-9C41-7E0B5D3A2F10',
  serieFolio: 'A-120',
  total: '580.00',
  origen: 'manual',
  email: null,
  descargas: { xml: null, pdf: null },
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
    'GET /facturacion/catalogos-sat': () => json(200, CATALOGOS),
    'GET /facturacion/tablero': () => json(200, TABLERO),
    'GET /facturacion/cfdis': () => json(200, PAGINA),
    'GET /facturacion/por-facturar': () =>
      json(200, { total: 0, monto: '0.00', pagina: 1, porPagina: 20, cuentas: [] }),
    'GET /facturacion/envios': () => json(200, []),
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

async function llenarReceptor(u: ReturnType<typeof userEvent.setup>, rfc = 'EKU9003173C9') {
  const rfcInput = screen.getByLabelText('RFC del receptor');
  await u.clear(rfcInput);
  await u.type(rfcInput, rfc);
  await u.type(screen.getByLabelText('Nombre o razón social'), 'ESCUELA KEMPER URGATE');
  await u.selectOptions(screen.getByLabelText('Régimen fiscal'), '601');
  await u.type(screen.getByLabelText('Código postal fiscal'), '42501');
  await u.selectOptions(screen.getByLabelText('Uso del CFDI'), 'G03');
}

describe('factura sin ticket (F2-107)', () => {
  const RUTA = `/facturacion?empresa=${A}&tab=manual`;

  it('valida al instante sin llamar al api; el total nunca pasa por número', async () => {
    const a = api();
    const u = userEvent.setup();
    montar(RUTA);
    await screen.findByRole('tab', { name: 'Sin ticket', selected: true });
    await screen.findByRole('option', { name: /601/ });
    await u.type(screen.getByLabelText('Total con IVA'), '12.345');
    await u.click(screen.getByRole('button', { name: 'Emitir factura' }));
    expect(await screen.findByText(/hasta dos decimales/)).toBeInTheDocument();
    expect(screen.getByText('Escribe tu RFC.')).toBeInTheDocument();
    expect(a.contar('POST', '/facturacion/cfdis/manual')).toBe(0);
  });

  it('emite con el total como texto y sin correo; un reintento repite la llave y "Capturar otra" la cambia', async () => {
    let intento = 0;
    const a = api({
      'POST /facturacion/cfdis/manual': () =>
        ++intento === 1
          ? json(502, { statusCode: 502, message: 'El servicio de timbrado no confirmó a tiempo.' })
          : json(201, EMITIDA),
    });
    const u = userEvent.setup();
    montar(RUTA);
    await screen.findByRole('option', { name: /601/ });
    await u.type(screen.getByLabelText('Total con IVA'), '580.00');
    await u.selectOptions(screen.getByLabelText('Forma de pago'), 'tarjeta');
    await llenarReceptor(u);
    await u.click(screen.getByRole('button', { name: 'Emitir factura' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no confirmó a tiempo');
    await u.click(screen.getByRole('button', { name: 'Emitir factura' }));
    expect(await screen.findByRole('status')).toHaveTextContent('A-120');
    expect(screen.getByRole('status')).toHaveTextContent('Sin correo');

    const posts = a.llamadas.filter((l) => l.ruta === '/facturacion/cfdis/manual');
    expect(posts).toHaveLength(2);
    const cuerpo = posts[0].cuerpo as Record<string, unknown>;
    expect(cuerpo).toMatchObject({
      empresaId: A,
      sucursalId: SUCURSAL_A1.id,
      total: '580.00',
      formaPago: 'tarjeta',
      receptor: {
        rfc: 'EKU9003173C9',
        razonSocial: 'ESCUELA KEMPER URGATE',
        regimenFiscal: '601',
        cp: '42501',
        usoCfdi: 'G03',
        email: null,
      },
    });
    expect(typeof cuerpo.total).toBe('string');
    expect(cuerpo.solicitudId).toMatch(UUID_V4);
    // El reintento lleva la MISMA llave: el api no emite dos veces.
    expect((posts[1].cuerpo as Record<string, unknown>).solicitudId).toBe(cuerpo.solicitudId);

    await u.click(screen.getByRole('button', { name: 'Capturar otra' }));
    await u.type(screen.getByLabelText('Total con IVA'), '99.99');
    await llenarReceptor(u);
    await u.click(screen.getByRole('button', { name: 'Emitir factura' }));
    await screen.findByRole('status');
    const tercera = a.llamadas.filter((l) => l.ruta === '/facturacion/cfdis/manual')[2];
    expect((tercera.cuerpo as Record<string, unknown>).solicitudId).not.toBe(cuerpo.solicitudId);
  });

  it('los errores del api salen por campo', async () => {
    api({
      'POST /facturacion/cfdis/manual': () =>
        json(400, {
          statusCode: 400,
          error: 'Bad Request',
          message: ['El RFC del receptor no está inscrito.'],
          campos: { rfc: 'El RFC del receptor no está inscrito.' },
        }),
    });
    const u = userEvent.setup();
    montar(RUTA);
    await screen.findByRole('option', { name: /601/ });
    await u.type(screen.getByLabelText('Total con IVA'), '100');
    await llenarReceptor(u);
    await u.click(screen.getByRole('button', { name: 'Emitir factura' }));
    expect(await screen.findByText('El RFC del receptor no está inscrito.')).toBeInTheDocument();
    expect(screen.getByLabelText('RFC del receptor')).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('tabla del tablero y refacturación (F2-107)', () => {
  const RUTA = `/facturacion?empresa=${A}&periodo=mes`;

  it('distingue las manuales y la sustitución, y filtra por origen', async () => {
    const a = api();
    const u = userEvent.setup();
    montar(RUTA);
    const tabla = await screen.findByTestId('tabla-cfdis');
    const filas = within(tabla).getAllByRole('row').slice(1);
    expect(within(filas[1]).getByText('Manual')).toBeInTheDocument();
    expect(within(filas[0]).queryByText('Manual')).toBeNull();
    expect(within(filas[2]).getByText(/Sustituida por AAAAAAAA/)).toBeInTheDocument();
    expect(within(filas[2]).getByText(/Cancelación pendiente/)).toBeInTheDocument();
    expect(within(filas[3]).getByText('Cancelada (motivo 01)')).toBeInTheDocument();
    // Acciones: vigente sin sustituto → Refacturar; pendiente → Reintentar; cancelada → nada.
    expect(within(filas[0]).getByRole('button', { name: 'Refacturar' })).toBeInTheDocument();
    expect(
      within(filas[2]).getByRole('button', { name: 'Reintentar cancelación' }),
    ).toBeInTheDocument();
    expect(within(filas[3]).queryByRole('button', { name: /Refacturar|Reintentar/ })).toBeNull();

    await u.selectOptions(screen.getByLabelText('Origen'), 'manual');
    await waitFor(() =>
      expect(
        a.llamadas.some(
          (l) => l.ruta === '/facturacion/cfdis' && l.query.get('origen') === 'manual',
        ),
      ).toBe(true),
    );
  });

  it('F2-108: la factura global se distingue, no se refactura y se filtra', async () => {
    const a = api({
      'GET /facturacion/cfdis': () =>
        json(200, {
          ...PAGINA,
          total: 2,
          cfdis: [
            cfdi(1),
            cfdi(5, {
              origen: 'global',
              folioTicket: null,
              receptorRfc: 'XAXX010101000',
              receptorNombre: 'PUBLICO EN GENERAL',
            }),
          ],
        }),
    });
    const u = userEvent.setup();
    montar(RUTA);
    const tabla = await screen.findByTestId('tabla-cfdis');
    const filas = within(tabla).getAllByRole('row').slice(1);
    expect(within(filas[1]).getByText('Global')).toBeInTheDocument();
    expect(within(filas[0]).queryByText('Global')).toBeNull();
    expect(within(filas[0]).getByRole('button', { name: 'Refacturar' })).toBeInTheDocument();
    expect(within(filas[1]).queryByRole('button', { name: /Refacturar|Reintentar/ })).toBeNull();
    await u.selectOptions(screen.getByLabelText('Origen'), 'global');
    await waitFor(() =>
      expect(
        a.llamadas.some(
          (l) => l.ruta === '/facturacion/cfdis' && l.query.get('origen') === 'global',
        ),
      ).toBe(true),
    );
  });

  it('el diálogo precarga el receptor, manda el corregido y dice si la cancelación quedó pendiente', async () => {
    const resultado: ResultadoRefacturacion = {
      anterior: { id: 'cfdi-1', uuid: cfdi(1).uuid, estado: 'vigente' },
      nuevo: { id: 'cfdi-7', uuid: SUSTITUTO, serieFolio: 'A-121', total: '100.00' },
      cancelacion: 'pendiente',
      mensaje: 'El sustituto ya se emitió, pero el PAC no confirmó la cancelación.',
    };
    const a = api({
      'POST /facturacion/cfdis/cfdi-1/refacturar': () => json(201, resultado),
    });
    const u = userEvent.setup();
    montar(RUTA);
    const tabla = await screen.findByTestId('tabla-cfdis');
    await u.click(within(tabla).getAllByRole('button', { name: 'Refacturar' })[0]);
    const dialogo = await screen.findByRole('dialog', { name: 'Refacturar A-101' });
    await within(dialogo).findByRole('option', { name: /601/ });
    expect(within(dialogo).getByLabelText('RFC del receptor')).toHaveValue('EKU9003173C9');
    expect(within(dialogo).getByLabelText('Correo (opcional)')).toHaveValue('kemper@ejemplo.test');
    await u.clear(within(dialogo).getByLabelText('Nombre o razón social'));
    await u.type(within(dialogo).getByLabelText('Nombre o razón social'), 'ESCUELA KEMPER');
    await u.click(within(dialogo).getByRole('button', { name: 'Emitir sustituto y cancelar' }));
    expect(await within(dialogo).findByRole('status')).toHaveTextContent('A-121');
    expect(within(dialogo).getByText(/no confirmó la cancelación/)).toBeInTheDocument();
    const post = a.llamadas.find((l) => l.ruta === '/facturacion/cfdis/cfdi-1/refacturar')!;
    expect(post.cuerpo).toEqual({
      receptor: {
        rfc: 'EKU9003173C9',
        razonSocial: 'ESCUELA KEMPER',
        regimenFiscal: '601',
        cp: '42501',
        usoCfdi: 'G03',
        email: 'kemper@ejemplo.test',
      },
    });
  });

  it('con la cancelación pendiente sólo la reintenta (sin pedir datos); un 409 se explica', async () => {
    const a = api({
      'POST /facturacion/cfdis/cfdi-3/refacturar': () =>
        json(409, {
          statusCode: 409,
          message: 'El PAC no tiene registro de esta factura. No se emitió nada.',
        }),
    });
    const u = userEvent.setup();
    montar(RUTA);
    const tabla = await screen.findByTestId('tabla-cfdis');
    await u.click(within(tabla).getByRole('button', { name: 'Reintentar cancelación' }));
    const dialogo = await screen.findByRole('dialog', { name: 'Reintentar la cancelación' });
    expect(within(dialogo).queryByLabelText('RFC del receptor')).toBeNull();
    expect(within(dialogo).getByText(/no se emite otra factura/)).toBeInTheDocument();
    await u.click(within(dialogo).getByRole('button', { name: 'Reintentar cancelación' }));
    expect(await within(dialogo).findByRole('alert')).toHaveTextContent(
      'El PAC no tiene registro de esta factura',
    );
    expect(a.contar('POST', '/facturacion/cfdis/cfdi-3/refacturar')).toBe(1);
  });
});
