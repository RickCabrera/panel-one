import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Resumen, UsuarioActual, VentaPorArea } from '../api/tipos';
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

// F2-144 en el web, contra el router y la app reales: la vista Ventas por canal (`/canales`).
// Cifras escritas a mano:
// A (agosto): Comedor 322.00 (2) + Domicilio 60.00 (1) + Barra sin canal 40.00 (1) + sin área
//   10.00 (1) = 432.00 en 5 cuentas (la misma "Venta total" que Inicio en el mock).
// B (julio, el comparable de "Mes anterior"): Comedor 300.00 (3) + Mostrador 100.00 (1) = 400.00.
// Que el servidor devuelva cifras que cuadren (y con `alturaAl`) lo prueban los e2e del api.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-21T20:30:30Z');
const A2 = { ...SUCURSAL_A2, zonaHoraria: 'America/Mexico_City' };
const RUTA = `/canales?empresa=${A}&periodo=mes-anterior`;

const resumen = (venta: string, cuentas: number): Resumen => ({
  venta,
  cuentas,
  ticketPromedio: cuentas === 0 ? null : '86.40',
  subtotal: venta,
  impuestos: '0.00',
  propina: '0.00',
  descuentos: { monto: '0.00', cuentas: 0 },
  cortesias: null,
  comensales: { total: 0, cuentasConDato: 0, promedioPorComensal: null },
  cancelados: { cuentas: 0 },
});

const VACIO: VentaPorArea = {
  venta: '0.00',
  cuentas: 0,
  areas: [],
  sinArea: { venta: '0.00', cuentas: 0 },
  canales: [],
  sinCanal: { venta: '0.00', cuentas: 0 },
  catalogo: [{ sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', sincronizado: true }],
};

const VENTA_A: VentaPorArea = {
  ...VACIO,
  venta: '432.00',
  cuentas: 5,
  canales: [
    { canal: 'comedor', venta: '322.00', cuentas: 2 },
    { canal: 'domicilio', venta: '60.00', cuentas: 1 },
  ],
  sinCanal: { venta: '40.00', cuentas: 1 },
  sinArea: { venta: '10.00', cuentas: 1 },
};

const VENTA_B: VentaPorArea = {
  ...VACIO,
  venta: '400.00',
  cuentas: 4,
  canales: [
    { canal: 'comedor', venta: '300.00', cuentas: 3 },
    { canal: 'mostrador', venta: '100.00', cuentas: 1 },
  ],
};

/** `por-area` según el periodo pedido: agosto es A; cualquier otro, B. */
const porPeriodo =
  (a: VentaPorArea, b: VentaPorArea): Manejador =>
  (l: Llamada) =>
    json(200, l.query.get('desde') === '2026-08-01' ? a : b);

function api(u: UsuarioActual, extra: Record<string, Manejador> = {}) {
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, A2]),
    'GET /usuarios': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /ventas/resumen': () => json(200, resumen('432.00', 5)),
    'GET /ventas/por-hora': () =>
      json(
        200,
        Array.from({ length: 24 }, (_, hora) => ({ hora, venta: '0.00', cuentas: 0 })),
      ),
    'GET /ventas/formas-pago': () => json(200, { formas: [], sinCatalogo: [] }),
    'GET /ventas/por-area': porPeriodo(VENTA_A, VENTA_B),
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

const fila = (llave: string) =>
  within(screen.getByTestId('tabla-mezcla'))
    .getAllByRole('row')
    .find((r) => r.getAttribute('data-canal') === llave);

const celdas = (llave: string) =>
  within(fila(llave)!)
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

describe('Ventas por canal (F2-144)', () => {
  it('AC: la mezcla por canal cuadra con la venta total, la misma "Venta total" de Inicio', async () => {
    api(usuario('visor'));
    montar(RUTA);
    const cuadre = await screen.findByTestId('cuadre-canales-a', undefined, { timeout: 5000 });
    expect(cuadre).toHaveTextContent(/^Σ del desglose = venta del periodo: \$432\.00\.$/);
    // Los renglones aparte, con su importe exacto: nada repartido a ojo.
    expect(fila('sin-canal')).toHaveTextContent('Área sin canal asignado$40.00');
    expect(fila('sin-area')).toHaveTextContent('Sin clasificar (la cuenta no trae área)$10.00');
    expect(fila('total')).toHaveTextContent('Venta del periodo$432.00100.0 %5');
    // Comedor: A 322.00 (74.5 %, 2 cuentas, $161.00) contra B 300.00 (75.0 %).
    expect(celdas('comedor')).toEqual([
      '$322.00',
      '74.5 %',
      '2',
      '$161.00',
      '$300.00',
      '75.0 %',
      '+7.3 %+$22.00',
      // 322/432 − 300/400 = 74.537… − 75 = −0.46 → −0.5 pp
      '-0.5 pp',
    ]);
    cleanup();

    montar(`/?empresa=${A}&periodo=mes-anterior`);
    expect(await screen.findByTestId('venta-total')).toHaveTextContent('$432.00');
  });

  it('un canal sin cuentas en un periodo es "—" ahí, sin Δ (nunca $0.00 ni ±100 %)', async () => {
    api(usuario('visor'));
    montar(RUTA);
    await screen.findByTestId('tabla-mezcla', undefined, { timeout: 5000 });
    // Mostrador sólo en B; Domicilio sólo en A.
    expect(celdas('mostrador').slice(0, 4)).toEqual(['—', '—', '—', '—']);
    expect(celdas('mostrador')[4]).toBe('$100.00');
    expect(celdas('mostrador')[6]).toBe('— (Sin cuentas de este canal en el periodo A.)');
    expect(celdas('domicilio').slice(4, 6)).toEqual(['—', '—']);
    expect(celdas('domicilio')[7]).toBe('— (Sin cuentas de este canal en el periodo B.)');
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('pide A y B por el mismo endpoint, con el alcance, y B por defecto es el comparable', async () => {
    const a = api(usuario('admin_empresa'));
    montar(`${RUTA}&sucursal=${A2.id}`);
    await screen.findByTestId('tabla-mezcla', undefined, { timeout: 5000 });
    const pedidas = a.llamadas.filter((l) => l.ruta === '/ventas/por-area');
    expect(new Set(pedidas.map((l) => `${l.query.get('desde')}..${l.query.get('hasta')}`))).toEqual(
      new Set(['2026-08-01..2026-08-31', '2026-07-01..2026-07-31']),
    );
    expect(pedidas.every((l) => l.query.get('empresaId') === A)).toBe(true);
    expect(pedidas.every((l) => l.query.get('sucursalId') === A2.id)).toBe(true);
    expect(screen.getByTestId('canales-periodos')).toHaveTextContent(
      'A: Mes anterior (2026-08-01 a 2026-08-31)',
    );
  });

  it('"Otro rango" pide B con esas fechas, y un rango inválido se explica sin consultarlo', async () => {
    const user = userEvent.setup();
    const a = api(usuario('visor'));
    montar(`${RUTA}&b=rango&bdesde=2026-06-01&bhasta=2026-06-30`);
    await screen.findByTestId('tabla-mezcla', undefined, { timeout: 5000 });
    expect(
      a.llamadas.some(
        (l) =>
          l.ruta === '/ventas/por-area' &&
          l.query.get('desde') === '2026-06-01' &&
          l.query.get('hasta') === '2026-06-30',
      ),
    ).toBe(true);
    cleanup();

    const b = api(usuario('visor'));
    montar(`${RUTA}&b=rango&bdesde=2026-06-30&bhasta=2026-06-01`);
    expect(await screen.findByRole('alert')).toHaveTextContent(/^Periodo B: /);
    // A se sigue viendo, con las columnas de B en "—".
    await screen.findByTestId('tabla-mezcla', undefined, { timeout: 5000 });
    expect(celdas('comedor')[4]).toBe('—');
    expect(b.llamadas.filter((l) => l.ruta === '/ventas/por-area').map((l) => l.query.get('desde'))).toEqual(
      expect.not.arrayContaining(['2026-06-30']),
    );
    await user.selectOptions(screen.getByLabelText('Comparar contra'), 'comparable');
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });

  it('todo sin clasificar: lo dice con su porqué y qué haría falta, y la fila aparte cuadra', async () => {
    const todoSinArea: VentaPorArea = {
      ...VACIO,
      venta: '432.00',
      cuentas: 5,
      sinArea: { venta: '432.00', cuentas: 5 },
    };
    api(usuario('visor'), { 'GET /ventas/por-area': porPeriodo(todoSinArea, VENTA_B) });
    montar(RUTA);
    expect(await screen.findByTestId('canales-vacio-a', undefined, { timeout: 5000 })).toHaveTextContent(
      /Ninguna cuenta del periodo trae el área.*Hace falta que el agente/,
    );
    expect(fila('sin-area')).toHaveTextContent('100.0 %');
    expect(screen.getByTestId('cuadre-canales-a')).toHaveTextContent(/^Σ del desglose = venta/);
  });

  it('sin cuentas en A ni en B no pinta una tabla en cero: dice por qué', async () => {
    api(usuario('visor'), { 'GET /ventas/por-area': porPeriodo(VACIO, VACIO) });
    montar(RUTA);
    expect(await screen.findByTestId('canales-vacio', undefined, { timeout: 5000 })).toHaveTextContent(
      'No hubo cuentas cerradas en el periodo.',
    );
    expect(screen.queryByTestId('tabla-mezcla')).not.toBeInTheDocument();
    expect(screen.queryByTestId('canales-csv')).not.toBeInTheDocument();
  });

  it('B sin cuentas: lo dice y sus columnas son "—"', async () => {
    api(usuario('visor'), { 'GET /ventas/por-area': porPeriodo(VENTA_A, VACIO) });
    montar(RUTA);
    expect(await screen.findByTestId('canales-sin-b', undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(celdas('total').slice(4, 6)).toEqual(['—', '—']);
  });

  it('una sucursal sin catálogo de áreas se avisa', async () => {
    const sinCatalogo: VentaPorArea = {
      ...VENTA_A,
      catalogo: [
        { sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', sincronizado: true },
        { sucursalId: A2.id, sucursal: 'Tijuana', sincronizado: false },
      ],
    };
    api(usuario('visor'), { 'GET /ventas/por-area': porPeriodo(sinCatalogo, VENTA_B) });
    montar(RUTA);
    expect(
      await screen.findByTestId('canales-sin-catalogo', undefined, { timeout: 5000 }),
    ).toHaveTextContent(/^Tijuana: el agente todavía no ha mandado su catálogo de áreas/);
  });

  it('si la consulta falla se dice, no se pinta en cero', async () => {
    api(usuario('visor'), {
      'GET /ventas/por-area': () => json(500, { statusCode: 500, message: 'Falla' }),
    });
    montar(RUTA);
    expect(await screen.findByRole('alert', undefined, { timeout: 5000 })).toHaveTextContent(
      'No se pudo cargar este dato.',
    );
    expect(screen.queryByTestId('tabla-mezcla')).not.toBeInTheDocument();
  });

  it.each(['visor', 'admin_empresa', 'admin_global'] as const)(
    'rol %s: la entrada del menú navega a la vista y la ve (es sólo lectura)',
    async (rol) => {
      const user = userEvent.setup();
      api(usuario(rol));
      montar(`/tickets?empresa=${A}&periodo=mes-anterior`);
      await user.click(await screen.findByRole('link', { name: 'Ventas por canal' }, { timeout: 5000 }));
      expect(await screen.findByRole('heading', { name: 'Ventas por canal' })).toBeInTheDocument();
      await screen.findByTestId('tabla-mezcla', undefined, { timeout: 5000 });
      // Sin controles de edición: el canal de cada área se cambia en Áreas y canales.
      expect(screen.queryByRole('combobox', { name: /^Canal de / })).not.toBeInTheDocument();
      const intro = screen.getByText(/^Cómo se reparte la venta/);
      expect(within(intro).getByRole('link', { name: 'Áreas y canales' })).toHaveAttribute(
        'href',
        `/areas?empresa=${A}&periodo=mes-anterior`,
      );
    },
  );
});
