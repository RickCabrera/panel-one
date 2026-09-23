import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  ConfiguracionGlobal,
  FacturaGlobalEmitida,
  PeriodosGlobal,
  ResumenPeriodoGlobal,
  VistaPreviaGlobal,
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

// F2-108 en el web, contra el router y la app reales: Facturación → "Factura global". Lo que se
// prueba: la configuración (periodicidad y automática), los periodos con su estado y POR QUÉ, la
// vista previa con la estructura periodicidad/meses/año, la emisión SÓLO tras confirmar, y que
// nada vacío se pinte como cero.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-23T18:00:00Z');
const RUTA = `/facturacion?empresa=${A}&tab=global`;

const CONFIG: ConfiguracionGlobal = {
  periodicidad: 'mensual',
  automatica: false,
  automaticaDesde: null,
  vigencia: { regla: 'fin_de_mes', dias: null },
  aviso: null,
};

function periodo(p: Partial<ResumenPeriodoGlobal> & { clave: string }): ResumenPeriodoGlobal {
  return {
    ultimoDia: '2026-08-31',
    periodicidad: 'mensual',
    etiqueta: 'agosto de 2026',
    desde: '2026-08-01T06:00:00.000Z',
    hasta: '2026-09-01T06:00:00.000Z',
    periodicidadSat: '04',
    meses: '08',
    anio: 2026,
    estado: 'lista',
    tickets: 4,
    total: '294.01',
    vigentes: 0,
    vigentesHasta: null,
    globalesPrevias: 0,
    globalesCanceladas: 0,
    ...p,
  };
}

const PERIODOS: PeriodosGlobal = {
  sucursal: { id: SUCURSAL_A1.id, nombre: SUCURSAL_A1.nombre, zonaHoraria: 'America/Mexico_City' },
  periodicidad: 'mensual',
  periodos: [
    periodo({
      clave: '2026-09-01',
      etiqueta: 'septiembre de 2026',
      estado: 'en_curso',
      tickets: 0,
      total: '0.00',
      vigentes: 12,
      vigentesHasta: '2026-10-01T06:00:00.000Z',
    }),
    periodo({ clave: '2026-08-01' }),
    periodo({
      clave: '2026-06-01',
      etiqueta: 'junio de 2026',
      tickets: 1,
      total: '30.00',
      globalesPrevias: 1,
    }),
  ],
  emitidas: [
    {
      id: 'g-1',
      uuid: 'AAAAAAAA-0000-4000-8000-000000000001',
      serieFolio: 'A-101',
      estado: 'vigente',
      total: '5000.00',
      emitidoAt: '2026-08-01T08:00:00.000Z',
      etiqueta: 'julio de 2026',
      periodicidad: 'mensual',
      tickets: 120,
      conArchivos: true,
    },
  ],
};

const VISTA: VistaPreviaGlobal = {
  sucursal: PERIODOS.sucursal,
  periodo: {
    clave: '2026-08-01',
    ultimoDia: '2026-08-31',
    periodicidad: 'mensual',
    etiqueta: 'agosto de 2026',
    desde: '2026-08-01T06:00:00.000Z',
    hasta: '2026-09-01T06:00:00.000Z',
    periodicidadSat: '04',
    meses: '08',
    anio: 2026,
  },
  estado: 'lista',
  tickets: [
    // 5 de agosto 13:00 en CDMX (19:00 UTC).
    { folio: 'T-G1', cerradoAt: '2026-08-05T19:00:00.000Z', total: '116.00' },
    // 31 de agosto 23:30 en CDMX = 1 de septiembre en UTC: la tabla dice 31/08.
    { folio: 'T-G2', cerradoAt: '2026-09-01T05:30:00.000Z', total: '178.01' },
  ],
  vigentes: 0,
  vigentesHasta: null,
  formaPago: '01',
  subtotal: '253.46',
  iva: '40.55',
  total: '294.01',
  globalesPrevias: 0,
};

const EMITIDA: FacturaGlobalEmitida = {
  id: 'g-2',
  uuid: 'BBBBBBBB-0000-4000-8000-000000000002',
  serieFolio: 'A-102',
  total: '294.01',
  tickets: 2,
  etiqueta: 'agosto de 2026',
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
    'GET /facturacion/global/configuracion': () => json(200, CONFIG),
    'GET /facturacion/global/periodos': () => json(200, PERIODOS),
    'GET /facturacion/global/periodos/2026-08-01': () => json(200, VISTA),
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

const filaDe = (texto: string) => screen.getByText(texto).closest('tr')!;

describe('factura global (F2-108)', () => {
  it('lista los periodos con su estado y POR QUÉ, y las globales emitidas', async () => {
    const a = api();
    montar();
    expect(await screen.findByRole('tab', { name: 'Factura global' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await screen.findByText('agosto de 2026');
    const agosto = filaDe('agosto de 2026');
    expect(within(agosto).getByText('Lista para emitir')).toBeInTheDocument();
    expect(within(agosto).getByText(/4 tickets que nadie facturó a tiempo/)).toBeInTheDocument();
    expect(within(agosto).getByText('$294.01')).toBeInTheDocument();
    const septiembre = filaDe('septiembre de 2026');
    expect(within(septiembre).getByText('En curso')).toBeInTheDocument();
    expect(
      within(septiembre).getByText(/12 tickets todavía se pueden facturar en el portal/),
    ).toBeInTheDocument();
    // Sin tickets para la global: no hay vista previa que abrir.
    expect(within(septiembre).queryByRole('button', { name: 'Vista previa' })).toBeNull();
    const junio = filaDe('junio de 2026');
    expect(within(junio).getByText(/\(complementaria\)/)).toBeInTheDocument();
    expect(
      within(junio).getByText(/ya tiene una factura global; 1 ticket llegó/),
    ).toBeInTheDocument();
    const julio = filaDe('julio de 2026');
    expect(within(julio).getByText('A-101')).toBeInTheDocument();
    expect(within(julio).getByText('Vigente')).toBeInTheDocument();
    // La periodicidad configurada viaja al api.
    const pedida = a.llamadas.find((l) => l.ruta === '/facturacion/global/periodos')!;
    expect(pedida.query.get('empresaId')).toBe(A);
    expect(pedida.query.get('sucursalId')).toBe(SUCURSAL_A1.id);
    expect(pedida.query.get('periodicidad')).toBe('mensual');
    expect(screen.getByText(/Apagada: cada factura global se emite a mano/)).toBeInTheDocument();
  });

  it('vista previa con Periodicidad · Meses · Año; emite SÓLO tras confirmar', async () => {
    const a = api({ 'POST /facturacion/global': () => json(201, EMITIDA) });
    const u = userEvent.setup();
    montar();
    await screen.findByText('agosto de 2026');
    await u.click(within(filaDe('agosto de 2026')).getByRole('button', { name: 'Vista previa' }));
    expect(await screen.findByTestId('informacion-global')).toHaveTextContent('04 · 08 · 2026');
    expect(screen.getByText('Efectivo (01)')).toBeInTheDocument();
    expect(screen.getByText('$253.46 · $40.55 · $294.01')).toBeInTheDocument();
    // La fecha del ticket en la zona de la SUCURSAL: el 31 de agosto, aunque en UTC ya sea 1 de sept.
    expect(within(filaDe('T-G2')).getByText('31/08/2026')).toBeInTheDocument();

    await u.click(screen.getByRole('button', { name: 'Emitir factura global' }));
    expect(a.contar('POST', '/facturacion/global')).toBe(0);
    expect(screen.getByText(/gasta un folio/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Sí, emitir' }));
    expect(await screen.findByRole('status')).toHaveTextContent('A-102');
    expect(screen.getByRole('status')).toHaveTextContent('ya no se pueden facturar en el portal');
    const post = a.llamadas.find((l) => l.metodo === 'POST' && l.ruta === '/facturacion/global')!;
    expect(post.cuerpo).toEqual({
      empresaId: A,
      sucursalId: SUCURSAL_A1.id,
      periodicidad: 'mensual',
      clave: '2026-08-01',
    });
  });

  it('un 409 del api se dice tal cual', async () => {
    api({
      'POST /facturacion/global': () =>
        json(409, {
          statusCode: 409,
          message: 'No hay tickets que incluir en la factura global de este periodo.',
        }),
    });
    const u = userEvent.setup();
    montar();
    await screen.findByText('agosto de 2026');
    await u.click(within(filaDe('agosto de 2026')).getByRole('button', { name: 'Vista previa' }));
    await u.click(await screen.findByRole('button', { name: 'Emitir factura global' }));
    await u.click(screen.getByRole('button', { name: 'Sí, emitir' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No hay tickets que incluir');
  });

  it('una complementaria lo avisa en la vista previa; un periodo que no está listo no se emite', async () => {
    api({
      'GET /facturacion/global/periodos/2026-08-01': () =>
        json(200, { ...VISTA, globalesPrevias: 1, estado: 'esperando' }),
    });
    const u = userEvent.setup();
    montar();
    await screen.findByText('agosto de 2026');
    await u.click(within(filaDe('agosto de 2026')).getByRole('button', { name: 'Vista previa' }));
    expect(await screen.findByText(/Ésta sería complementaria/)).toBeInTheDocument();
    expect(screen.getByText(/todavía no se puede emitir \(esperando\)/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Emitir factura global' })).toBeNull();
  });

  it('la configuración guarda periodicidad y automática, y muestra el aviso de la vigencia', async () => {
    let conf: ConfiguracionGlobal = CONFIG;
    const a = api({
      'GET /facturacion/global/configuracion': () => json(200, conf),
      'PUT /facturacion/global/configuracion': (l) => {
        const c = l.cuerpo as {
          periodicidad: ConfiguracionGlobal['periodicidad'];
          automatica: boolean;
        };
        conf = {
          ...CONFIG,
          periodicidad: c.periodicidad,
          automatica: c.automatica,
          automaticaDesde: c.automatica ? '2026-09-23T18:00:00.000Z' : null,
          aviso:
            c.periodicidad === 'mensual'
              ? null
              : 'Los tickets se pueden facturar hasta el fin del mes: la factura global espera al fin de mes para salir.',
        };
        return json(200, conf);
      },
    });
    const u = userEvent.setup();
    montar();
    await screen.findByText('agosto de 2026');
    await u.click(screen.getByLabelText('Emitir sola cada periodo que quede listo'));
    await waitFor(() => expect(a.contar('PUT', '/facturacion/global/configuracion')).toBe(1));
    expect(a.llamadas.find((l) => l.metodo === 'PUT')!.cuerpo).toEqual({
      empresaId: A,
      periodicidad: 'mensual',
      automatica: true,
    });
    expect(
      await screen.findByText(/Encendida desde el 23 de septiembre de 2026/),
    ).toBeInTheDocument();
    await u.selectOptions(screen.getByLabelText('Periodicidad'), 'semanal');
    expect(await screen.findByRole('note')).toHaveTextContent('espera al fin de mes');
  });

  it('sin periodos pendientes dice por qué (nunca un cero mudo)', async () => {
    api({
      'GET /facturacion/global/periodos': () =>
        json(200, { ...PERIODOS, periodos: [], emitidas: [] }),
    });
    montar();
    expect(await screen.findByTestId('sin-periodos')).toHaveTextContent(
      'todos se facturaron o ya están en una global',
    );
    expect(
      screen.getByText('Esta sucursal todavía no tiene facturas globales.'),
    ).toBeInTheDocument();
  });
});
