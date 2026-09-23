import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { EstadoFolios, ReporteFolios, Rol } from '../api/tipos';
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

// F2-110 en el web, contra el router y la app reales: Facturación → "Folios" (sólo admin_global).
// Lo que se prueba: el saldo con su estado en palabras, los paquetes con su último día útil en la
// zona de CDMX, el alta con validación, el consumo por empresa, el reporte mensual, que la pestaña
// no exista para otros roles, y que "sin control" no se pinte como un cero.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-23T18:00:00Z');
const RUTA = `/facturacion?empresa=${A}&tab=folios`;

const ESTADO: EstadoFolios = {
  control: true,
  umbralPct: 20,
  estado: 'ok',
  disponible: 4745,
  vigenteTotal: 5400,
  enEmision: 1,
  sobregiro: 0,
  avisoUmbralAt: null,
  paquetes: [
    {
      id: 'p-actual',
      cantidad: 5000,
      compradoAt: '2026-07-10T06:00:00.000Z',
      venceAt: '2027-07-10T06:00:00.000Z',
      nota: 'Paquete anual',
      consumidos: 0,
      restantes: 5000,
      estado: 'vigente',
      diasParaVencer: 289,
    },
    {
      id: 'p-vence',
      cantidad: 400,
      compradoAt: '2025-10-13T06:00:00.000Z',
      venceAt: '2026-10-13T06:00:00.000Z',
      nota: null,
      consumidos: 255,
      restantes: 145,
      estado: 'por_vencer',
      diasParaVencer: 19,
    },
    {
      id: 'p-viejo',
      cantidad: 300,
      compradoAt: '2025-08-24T06:00:00.000Z',
      venceAt: '2026-08-24T06:00:00.000Z',
      nota: null,
      consumidos: 280,
      restantes: 20,
      estado: 'vencido',
      diasParaVencer: null,
    },
  ],
  consumoPorEmpresa: [{ empresaId: A, empresa: 'Empresa A', mesActual: 12, ultimos12Meses: 255 }],
};

const REPORTE: ReporteFolios = {
  desde: '2025-10',
  hasta: '2026-09',
  filas: [
    {
      empresaId: A,
      empresa: 'Empresa A',
      mes: '2026-08',
      vigentes: 90,
      cancelados: 8,
      total: 98,
      ticket: 80,
      manual: 2,
      global: 2,
      sustitutos: 14,
    },
  ],
  totales: [
    ...Array.from({ length: 10 }, (_, i) => ({
      mes: `${i < 3 ? 2025 : 2026}-${String(((i + 9) % 12) + 1).padStart(2, '0')}`,
      vigentes: 0,
      cancelados: 0,
      total: 0,
    })),
    { mes: '2026-08', vigentes: 90, cancelados: 8, total: 98 },
    { mes: '2026-09', vigentes: 0, cancelados: 0, total: 0 },
  ],
};

function api(rol: Rol = 'admin_global', extra: Record<string, Manejador> = {}) {
  const u = usuario(rol);
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1]),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /facturacion/tablero': () => json(500, { statusCode: 500, message: 'no aplica' }),
    'GET /facturacion/cfdis': () => json(500, { statusCode: 500, message: 'no aplica' }),
    'GET /facturacion/por-facturar': () => json(500, { statusCode: 500, message: 'no aplica' }),
    'GET /facturacion/envios': () => json(200, []),
    'GET /facturacion/folios': () => json(200, ESTADO),
    'GET /facturacion/folios/reporte': () => json(200, REPORTE),
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

describe('folios del PAC (F2-110)', () => {
  it('saldo, paquetes con su último día útil (CDMX), consumo por empresa y reporte', async () => {
    const a = api();
    montar();
    expect(await screen.findByRole('tab', { name: 'Folios' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(await screen.findByTestId('disponible')).toHaveTextContent('4,745');
    expect(screen.getByText(/de 5,400 folios vigentes · 87 %/)).toBeInTheDocument();
    expect(screen.getByText('Saldo suficiente')).toBeInTheDocument();
    expect(screen.getByTestId('en-emision')).toHaveTextContent('1 factura en emisión');
    expect(screen.queryByTestId('aviso-saldo')).toBeNull();

    // `venceAt` es exclusivo: el paquete sirve hasta el día ANTERIOR en CDMX.
    const vence = filaDe('13/10/2025');
    expect(within(vence).getByText('12/10/2026')).toBeInTheDocument();
    expect(within(vence).getByText(/Por vencer/)).toBeInTheDocument();
    expect(within(vence).getByText(/19 días/)).toBeInTheDocument();
    // Con consumo no se puede borrar.
    expect(within(vence).queryByRole('button', { name: 'Borrar' })).toBeNull();
    const viejo = filaDe('24/08/2025');
    expect(within(viejo).getByText(/se perdieron 20/)).toBeInTheDocument();
    expect(within(filaDe('10/07/2026')).getByRole('button', { name: 'Borrar' })).toBeEnabled();

    const consumo = filaDe('Empresa A');
    expect(within(consumo).getByText('12')).toBeInTheDocument();
    expect(within(consumo).getByText('255')).toBeInTheDocument();

    // Reporte: los 12 meses que terminan en el mes en curso (CDMX).
    await screen.findByTestId('total-2026-08');
    const pedido = a.llamadas.find((l) => l.ruta === '/facturacion/folios/reporte')!;
    expect(pedido.query.get('desde')).toBe('2025-10');
    expect(pedido.query.get('hasta')).toBe('2026-09');
    expect(within(screen.getByTestId('total-2026-08')).getByText('98')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('total-2026-09')).getByText('Sin facturas'),
    ).toBeInTheDocument();
  });

  it('sin control: explica que no hay paquete y no pinta un cero', async () => {
    api('admin_global', {
      'GET /facturacion/folios': () =>
        json(200, {
          ...ESTADO,
          control: false,
          estado: 'sin_control',
          disponible: 0,
          vigenteTotal: 0,
          enEmision: 0,
          paquetes: [],
          consumoPorEmpresa: [],
        }),
      'GET /facturacion/folios/reporte': () =>
        json(200, {
          ...REPORTE,
          filas: [],
          totales: REPORTE.totales.map((t) => ({ ...t, vigentes: 0, cancelados: 0, total: 0 })),
        }),
    });
    montar();
    expect(await screen.findByTestId('sin-control')).toHaveTextContent(
      /no hay ningún paquete de folios registrado: el control está apagado/i,
    );
    expect(screen.queryByTestId('disponible')).toBeNull();
    expect(screen.getByText('Todavía no se ha registrado ningún paquete.')).toBeInTheDocument();
    expect(
      screen.getByText('Ninguna empresa ha emitido facturas en los últimos 12 meses.'),
    ).toBeInTheDocument();
    expect(
      await screen.findByText(/No se emitió ninguna factura en estos meses/),
    ).toBeInTheDocument();
  });

  it('agotado: aviso de peligro con qué hacer', async () => {
    api('admin_global', {
      'GET /facturacion/folios': () =>
        json(200, { ...ESTADO, estado: 'agotado', disponible: 0, enEmision: 0 }),
    });
    montar();
    expect(await screen.findByTestId('aviso-saldo')).toHaveTextContent(
      /se quedó sin folios: ninguna empresa puede emitir facturas hasta que registres un paquete/,
    );
  });

  it('registrar un paquete: valida en el navegador y manda cantidad, fecha y nota', async () => {
    const u = userEvent.setup();
    const a = api('admin_global', {
      'POST /facturacion/folios/paquetes': () => json(201, { id: 'p-nuevo' }),
    });
    montar();
    await screen.findByTestId('disponible');
    const cantidad = screen.getByLabelText('Folios');
    const fecha = screen.getByLabelText('Día de compra');
    await u.click(screen.getByRole('button', { name: 'Registrar paquete' }));
    expect(screen.getByText(/Escribe cuántos folios compraste/)).toBeInTheDocument();
    expect(a.contar('POST', '/facturacion/folios/paquetes')).toBe(0);

    await u.type(cantidad, '1000');
    await u.clear(fecha);
    await u.type(fecha, '2026-09-24');
    await u.click(screen.getByRole('button', { name: 'Registrar paquete' }));
    expect(screen.getByText('La fecha de compra no puede ser futura.')).toBeInTheDocument();
    expect(a.contar('POST', '/facturacion/folios/paquetes')).toBe(0);

    await u.clear(fecha);
    await u.type(fecha, '2026-09-01');
    await u.type(screen.getByLabelText('Nota (opcional)'), 'Paquete 2026');
    await u.click(screen.getByRole('button', { name: 'Registrar paquete' }));
    await waitFor(() => expect(a.contar('POST', '/facturacion/folios/paquetes')).toBe(1));
    expect(
      a.llamadas.find((l) => l.metodo === 'POST' && l.ruta === '/facturacion/folios/paquetes')!
        .cuerpo,
    ).toEqual({
      cantidad: 1000,
      fechaCompra: '2026-09-01',
      nota: 'Paquete 2026',
    });
  });

  it('el umbral se guarda por PUT', async () => {
    const u = userEvent.setup();
    const a = api('admin_global', {
      'PUT /facturacion/folios/configuracion': () =>
        json(200, { ...ESTADO, umbralPct: 30, estado: 'ok' }),
    });
    montar();
    await screen.findByTestId('disponible');
    const campo = screen.getByLabelText('Avisar por correo cuando quede menos de (%)');
    await u.clear(campo);
    await u.type(campo, '30');
    await u.click(screen.getByRole('button', { name: 'Guardar aviso' }));
    await waitFor(() => expect(a.contar('PUT', '/facturacion/folios/configuracion')).toBe(1));
    expect(a.llamadas.find((l) => l.metodo === 'PUT')!.cuerpo).toEqual({ umbralPct: 30 });
  });

  it('admin_empresa: no hay pestaña Folios y ?tab=folios cae en el tablero sin pedir folios', async () => {
    const a = api('admin_empresa');
    montar();
    expect(await screen.findByRole('tab', { name: 'Tablero' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.queryByRole('tab', { name: 'Folios' })).toBeNull();
    expect(a.contar('GET', '/facturacion/folios')).toBe(0);
  });
});
