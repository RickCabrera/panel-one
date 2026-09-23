import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MesasSucursal, Resumen, VentaSucursal } from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import {
  UTILIDAD_CORTADA,
  UTILIDAD_SIN_COSTO,
  UTILIDAD_SIN_LECTURA,
  UTILIDAD_SOBRESTIMADA,
} from './comparativos/matriz';
import {
  EMPRESA_A,
  EMPRESA_B,
  instalarApiFalsa,
  json,
  sesion,
  SUCURSAL_A1,
  SUCURSAL_A2,
  SUCURSAL_B1,
  usuario,
  type Llamada,
  type Manejador,
} from '../test/apiFalsa';

// F2-140 contra el router y la app reales.
//
// Qué prueba y qué no (igual que el Resumen, F2-220): Comparativos no calcula ninguna cifra de
// venta. Pide los MISMOS endpoints, con los MISMOS parámetros (y llaves de caché), que Inicio y
// Reportes, y aquí se compara lo pintado en /comparativos contra lo pintado en Inicio con una
// sola API falsa, coherente por sucursal (el resumen de una sucursal ES su fila del comparativo).
// Que el servidor devuelva para cada sucursal lo mismo en los dos endpoints, sobre Postgres y con
// el esperado calculado a mano, lo prueba `api/src/ventas/lectura.e2e.spec.ts` (F2-140).

const A = EMPRESA_A.id;
// Lunes 21-sep-2026, 14:30:30 en CDMX.
const AHORA = new Date('2026-09-21T20:30:30Z');
const ALTURA = '2026-09-21T20:30:00.000Z';
const A2 = { ...SUCURSAL_A2, zonaHoraria: 'America/Mexico_City' };

const ESTE_MES = '2026-09-01|2026-09-21|';
const MES_ANTERIOR = '2026-08-01|2026-08-31|';
const COMPARABLE = `2026-08-01|2026-08-21|${ALTURA}`;

function fila(
  s: { id: string; nombre: string },
  venta: string,
  cuentas: number,
  ticket: string | null,
  comensales: number,
): VentaSucursal {
  return { sucursalId: s.id, nombre: s.nombre, venta, cuentas, ticketPromedio: ticket, comensales };
}
const sinCuentas = (s: { id: string; nombre: string }) => fila(s, '0.00', 0, null, 0);

/** Por `desde|hasta|alturaAl`. Lo que no esté aquí: todas las sucursales sin cuentas. */
const SUCURSALES: Record<string, VentaSucursal[]> = {
  // Tijuana vendió pero no registró comensales.
  [ESTE_MES]: [
    fila(SUCURSAL_A1, '30000.00', 60, '500.00', 150),
    fila(A2, '10000.00', 25, '400.00', 0),
  ],
  // Tijuana no tuvo cuentas el mes anterior: "—", no $0.00.
  [MES_ANTERIOR]: [fila(SUCURSAL_A1, '40000.00', 80, '500.00', 200), sinCuentas(A2)],
  [COMPARABLE]: [
    fila(SUCURSAL_A1, '20000.00', 40, '500.00', 100),
    fila(A2, '5000.00', 10, '500.00', 20),
  ],
};

/** El total de la empresa, calculado a mano (Σ de sus filas). */
const TOTALES: Record<string, Resumen> = {
  [ESTE_MES]: resumen('40000.00', 85, '470.59', 150, 60),
  [MES_ANTERIOR]: resumen('40000.00', 80, '500.00', 200, 80),
  [COMPARABLE]: resumen('25000.00', 50, '500.00', 120, 50),
};

function resumen(
  venta: string,
  cuentas: number,
  ticket: string | null,
  comensales: number,
  conDato: number,
): Resumen {
  return {
    venta,
    cuentas,
    ticketPromedio: ticket,
    subtotal: venta,
    impuestos: '0.00',
    propina: '0.00',
    descuentos: { monto: '0.00', cuentas: 0 },
    cortesias: null,
    comensales: { total: comensales, cuentasConDato: conDato, promedioPorComensal: null },
    cancelados: { cuentas: 0 },
  };
}

/** Una fila del estado de resultados (F2-126): sólo importa la utilidad de operación. */
function er(cuentas: number, utilidad: string | null, sobrestimada = false) {
  return {
    cuentas,
    venta: '0.00',
    ventaNeta: '0.00',
    costo: {
      importe: utilidad === null ? null : '0.00',
      completo: !sobrestimada,
      insumosSinCosto: sobrestimada ? 1 : 0,
      productosSinCosto: 0,
      ventaSinCosto: '0.00',
    },
    gastos: '0.00',
    compras: '0.00',
    utilidadBruta: utilidad,
    utilidadOperacion: utilidad,
    margenBruto: null,
    margenOperacion: null,
    utilidadSobrestimada: sobrestimada,
    sinVentas: cuentas === 0,
  };
}

/**
 * Por `desde|hasta` (el estado de resultados no se corta a la misma altura). Este mes: Centro
 * con costo incompleto y Tijuana sin recetas, así que el TOTAL del API es nulo aunque Centro
 * tenga cifra. Mes anterior: Tijuana sin ventas (su −gastos no se pinta: sin cuentas es "—").
 */
const ESTADOS: Record<string, { sucursales: unknown[]; total: unknown }> = {
  '2026-09-01|2026-09-21': {
    sucursales: [
      { sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', motivo: null, ...er(60, '9000.00', true) },
      { sucursalId: A2.id, sucursal: 'Tijuana', motivo: 'sin_recetas', ...er(25, null) },
    ],
    total: { sucursalesSinCalculo: ['Tijuana'], ...er(85, null) },
  },
  '2026-08-01|2026-08-31': {
    sucursales: [
      { sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', motivo: null, ...er(80, '12000.00') },
      { sucursalId: A2.id, sucursal: 'Tijuana', motivo: null, ...er(0, '-500.00') },
    ],
    total: { sucursalesSinCalculo: [], ...er(80, '11500.00') },
  },
};

function estadoDe(l: Llamada) {
  const e = ESTADOS[`${l.query.get('desde')}|${l.query.get('hasta')}`] ?? {
    sucursales: [],
    total: { sucursalesSinCalculo: [], ...er(0, '0.00') },
  };
  const s = l.query.get('sucursalId');
  const sucursales = s
    ? e.sucursales.filter((x) => (x as { sucursalId: string }).sucursalId === s)
    : e.sucursales;
  return { sucursales, total: s ? sucursales[0] : e.total, gastosPorCategoria: [] };
}

const clave = (l: Llamada) =>
  [l.query.get('desde'), l.query.get('hasta'), l.query.get('alturaAl') ?? ''].join('|');

/**
 * Tasa de facturación (F2-106) por `desde|hasta|alturaAl`, como la manda `/facturacion/tablero`:
 * el total y la de cada sucursal. Lo que no esté aquí: sin venta (tasa nula).
 */
const TASAS: Record<
  string,
  { total: string | null; centro: string | null; tijuana: string | null }
> = {
  [ESTE_MES]: { total: '0.4500', centro: '0.5000', tijuana: '0.2500' },
  // Tijuana no tuvo cuentas el mes anterior: sin venta, sin tasa.
  [MES_ANTERIOR]: { total: '0.4000', centro: '0.4000', tijuana: null },
  [COMPARABLE]: { total: '0.4800', centro: '0.5000', tijuana: '0.4000' },
};

function tableroDe(l: Llamada) {
  const t = TASAS[clave(l)] ?? { total: null, centro: null, tijuana: null };
  const suc = (s: { id: string; nombre: string }, tasa: string | null) => ({
    sucursalId: s.id,
    nombre: s.nombre,
    venta: '0.00',
    cuentas: 0,
    facturado: '0.00',
    cfdis: 0,
    cancelados: { monto: '0.00', cfdis: 0 },
    tasa,
  });
  const porSucursal = [suc(SUCURSAL_A1, t.centro), suc(A2, t.tijuana)];
  const s = l.query.get('sucursalId');
  const filas = s ? porSucursal.filter((x) => x.sucursalId === s) : porSucursal;
  return {
    ventas: { venta: '0.00', cuentas: 0 },
    facturado: { monto: '0.00', cfdis: 0 },
    cancelados: { monto: '0.00', cfdis: 0 },
    tasa: s ? (filas[0]?.tasa ?? null) : t.total,
    porFacturar: { cuentas: 0, monto: '0.00' },
    porSucursal: filas,
    porMes: [],
    porHora: [],
  };
}

function filasDe(l: Llamada, datos: Record<string, VentaSucursal[]>): VentaSucursal[] {
  const filas = datos[clave(l)] ?? [sinCuentas(SUCURSAL_A1), sinCuentas(A2)];
  const s = l.query.get('sucursalId');
  return s ? filas.filter((f) => f.sucursalId === s) : filas;
}

/** El resumen de una sucursal ES su fila; el de la empresa, el total a mano. */
function resumenDe(l: Llamada, datos: Record<string, VentaSucursal[]>, totales = TOTALES) {
  const s = l.query.get('sucursalId');
  if (!s) return totales[clave(l)] ?? resumen('0.00', 0, null, 0, 0);
  const f = filasDe(l, datos)[0];
  return resumen(f.venta, f.cuentas, f.ticketPromedio, f.comensales, f.cuentas);
}

const MESAS: MesasSucursal[] = [
  {
    sucursalId: SUCURSAL_A1.id,
    nombre: 'Centro',
    zonaHoraria: 'America/Mexico_City',
    snapshot: {
      capturadoAt: new Date(AHORA.getTime() - 30_000).toISOString(),
      recibidoAt: new Date(AHORA.getTime() - 30_000).toISOString(),
      edadSegundos: 30,
      edadRecepcionSegundos: 30,
      mesas: [],
    },
  },
  // Tijuana nunca ha reportado.
  { sucursalId: A2.id, nombre: 'Tijuana', zonaHoraria: 'America/Mexico_City', snapshot: null },
];

function api(extra: Record<string, Manejador> = {}, datos = SUCURSALES, totales = TOTALES) {
  const u = usuario('admin_empresa');
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, A2]),
    'GET /usuarios': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /ventas/resumen': (l) => json(200, resumenDe(l, datos, totales)),
    'GET /ventas/por-hora': () =>
      json(
        200,
        Array.from({ length: 24 }, (_, hora) => ({ hora, venta: '0.00', cuentas: 0 })),
      ),
    'GET /ventas/formas-pago': () => json(200, { formas: [], sinCatalogo: [] }),
    'GET /ventas/comparativo-sucursales': (l) => json(200, filasDe(l, datos)),
    'GET /finanzas/estado-resultados': (l) => json(200, estadoDe(l)),
    'GET /facturacion/tablero': (l) => json(200, tableroDe(l)),
    'GET /mesas/abiertas': (l) => {
      const s = l.query.get('sucursalId');
      return json(200, s ? MESAS.filter((m) => m.sucursalId === s) : MESAS);
    },
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

const texto = (testId: string) => screen.getByTestId(testId).textContent ?? '';
const celda = (filaId: string, id: string) =>
  within(screen.getByTestId(filaId)).getByTestId(id).textContent ?? '';
const ventaTotal = () => screen.getByRole('region', { name: 'Venta total' });
const CENTRO = `fila-${SUCURSAL_A1.id}`;
const TIJUANA = `fila-${A2.id}`;
const ordenFilas = () =>
  screen
    .getAllByTestId(/^fila-/)
    .map((f) => f.getAttribute('data-testid'))
    .filter((id) => id !== 'fila-total');

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

describe('AC · "este mes vs mes anterior" cuadra con los dashboards individuales', () => {
  it('total y cada sucursal, en A y en B, son lo que Inicio pinta para ese periodo y sucursal', async () => {
    const a = api();
    montar(`/comparativos?empresa=${A}&periodo=mes&b=mes-anterior`);
    await screen.findByTestId('fila-total');

    expect(texto('comparativos-periodos')).toBe(
      'A: Este mes (2026-09-01 a 2026-09-21) · B: el mes anterior a A (agosto de 2026, completo) (2026-08-01 a 2026-08-31)',
    );
    const total = {
      ventaA: celda('fila-total', 'venta-a'),
      ventaB: celda('fila-total', 'venta-b'),
      ticketsA: celda('fila-total', 'cuentas-a'),
      ticketsB: celda('fila-total', 'cuentas-b'),
      ticketA: celda('fila-total', 'ticketPromedio-a'),
      ticketB: celda('fila-total', 'ticketPromedio-b'),
      comensalesA: celda('fila-total', 'comensales-a'),
      comensalesB: celda('fila-total', 'comensales-b'),
    };
    expect(total).toEqual({
      ventaA: '$40,000.00',
      ventaB: '$40,000.00',
      ticketsA: '85',
      ticketsB: '80',
      ticketA: '$470.59',
      ticketB: '$500.00',
      comensalesA: '150',
      comensalesB: '200',
    });
    expect(texto('cobertura-comensales')).toBe('Periodo A: 60 de 85 cuentas traían comensales.');
    const centro = {
      a: celda(CENTRO, 'venta-a'),
      b: celda(CENTRO, 'venta-b'),
      ticketsA: celda(CENTRO, 'cuentas-a'),
      ticketsB: celda(CENTRO, 'cuentas-b'),
    };
    expect(centro).toEqual({ a: '$30,000.00', b: '$40,000.00', ticketsA: '60', ticketsB: '80' });
    expect(celda(TIJUANA, 'venta-a')).toBe('$10,000.00');
    const tijuanaTicketsA = celda(TIJUANA, 'cuentas-a');
    expect(tijuanaTicketsA).toBe('25');
    // Tijuana sin cuentas en B: "—" en las cuatro métricas y en sus Δ, nunca $0.00 ni 0.
    for (const m of ['venta', 'cuentas', 'ticketPromedio', 'comensales']) {
      expect(celda(TIJUANA, `${m}-b`)).toBe('—');
      expect(celda(TIJUANA, `${m}-delta`)).toMatch(/^—/);
    }
    // A va a medio mes y B está completo: la vista lo dice junto al Δ.
    expect(screen.getByTestId('aviso-a-medias')).toBeInTheDocument();

    // Mismas consultas que Inicio: los dos resúmenes van sin `alturaAl`.
    const resumenes = a.llamadas.filter(
      (l) => l.ruta === '/ventas/resumen' && !l.query.has('sucursalId'),
    );
    expect(new Set(resumenes.map(clave))).toEqual(new Set([ESTE_MES, MES_ANTERIOR]));
    cleanup();

    // Inicio con "Este mes" y con "Mes anterior": venta total, tickets, ticket y comensales.
    for (const [periodo, lado] of [
      ['mes', 'A'],
      ['mes-anterior', 'B'],
    ] as const) {
      montar(`/?empresa=${A}&periodo=${periodo}`);
      await screen.findByTestId('venta-total');
      expect(texto('venta-total')).toBe(total[`venta${lado}`]);
      expect(ventaTotal()).toHaveTextContent(`${total[`tickets${lado}`]} cuentas cerradas`);
      expect(texto('ticket-promedio')).toBe(total[`ticket${lado}`]);
      expect(texto('comensales')).toBe(total[`comensales${lado}`]);
      cleanup();
    }

    // Inicio por sucursal: Centro en A y en B, Tijuana en A.
    for (const [sucursal, periodo, esperado, tickets] of [
      [SUCURSAL_A1.id, 'mes', centro.a, centro.ticketsA],
      [SUCURSAL_A1.id, 'mes-anterior', centro.b, centro.ticketsB],
      [A2.id, 'mes', '$10,000.00', tijuanaTicketsA],
    ] as const) {
      montar(`/?empresa=${A}&sucursal=${sucursal}&periodo=${periodo}`);
      await screen.findByTestId('venta-total');
      expect(texto('venta-total')).toBe(esperado);
      expect(ventaTotal()).toHaveTextContent(`${tickets} cuentas cerradas`);
      cleanup();
    }

    // Tijuana en "Mes anterior": Inicio tampoco pinta una cifra (estado vacío), igual que el "—".
    montar(`/?empresa=${A}&sucursal=${A2.id}&periodo=mes-anterior`);
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Venta total' })).toHaveTextContent(/sin ventas/i),
    );
    expect(screen.queryByTestId('venta-total')).toBeNull();
  });

  it('con una sucursal elegida, la tabla es sólo esa fila y su total la nombra', async () => {
    api();
    montar(`/comparativos?empresa=${A}&periodo=mes&b=mes-anterior&sucursal=${SUCURSAL_A1.id}`);
    await screen.findByTestId('fila-total');
    expect(ordenFilas()).toEqual([CENTRO]);
    expect(within(screen.getByTestId('fila-total')).getByRole('rowheader')).toHaveTextContent(
      'Total (Centro)',
    );
    expect(celda('fila-total', 'venta-a')).toBe(celda(CENTRO, 'venta-a'));
  });
});

describe('periodo B', () => {
  it('por defecto es el comparable del Resumen, cortado a la misma altura', async () => {
    const a = api();
    montar(`/comparativos?empresa=${A}&periodo=mes`);
    await screen.findByTestId('fila-total');
    expect(texto('comparativos-periodos')).toContain(
      'B: el mes anterior a la misma altura (2026-08-01 a 2026-08-21)',
    );
    const conAltura = a.llamadas
      .filter((l) => l.query.has('alturaAl'))
      .map((l) => `${l.ruta} ${clave(l)}`);
    // F2-106: la tasa de B también se corta a la misma altura (el tablero lo soporta).
    expect(new Set(conAltura)).toEqual(
      new Set([
        `/ventas/resumen ${COMPARABLE}`,
        `/ventas/comparativo-sucursales ${COMPARABLE}`,
        `/facturacion/tablero ${COMPARABLE}`,
      ]),
    );
    // Tasa: total 45 % contra 48 % (−3 pp); Tijuana 25 % contra 40 %.
    expect(celda('fila-total', 'tasaFacturacion-a')).toBe('45.00 %');
    expect(celda('fila-total', 'tasaFacturacion-b')).toBe('48.00 %');
    expect(celda('fila-total', 'tasaFacturacion-delta')).toBe('-6.3 %-3.00 pp');
    expect(celda(TIJUANA, 'tasaFacturacion-delta')).toBe('-37.5 %-15.00 pp');
    // 40,000 vs 25,000; Tijuana 10,000 vs 5,000.
    expect(celda('fila-total', 'venta-delta')).toBe('+60.0 %+$15,000.00');
    expect(celda(TIJUANA, 'venta-delta')).toBe('+100.0 %+$5,000.00');
    // Cortado a la misma altura: no hay aviso de "a medias".
    expect(screen.queryByTestId('aviso-a-medias')).toBeNull();
    // Tijuana no reporta y A incluye hoy: se avisa.
    expect(texto('aviso-incompleta')).toContain('Tijuana');
  });

  it('A = "Mes anterior" y B comparable: ninguno incluye hoy, sin aviso de "a medias"', async () => {
    api();
    montar(`/comparativos?empresa=${A}&periodo=mes-anterior`);
    await screen.findByTestId('fila-total');
    expect(texto('comparativos-periodos')).toContain('B: el mes previo completo');
    expect(screen.queryByTestId('aviso-a-medias')).toBeNull();
    expect(screen.queryByTestId('aviso-incompleta')).toBeNull();
  });

  it('otro rango: se elige en la vista, vive en la URL y es de días completos', async () => {
    const user = userEvent.setup();
    const a = api();
    montar(`/comparativos?empresa=${A}&periodo=mes`);
    await screen.findByTestId('fila-total');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Comparar contra' }), 'rango');
    // Se precarga el B que se estaba viendo.
    expect(screen.getByLabelText('B desde')).toHaveValue('2026-08-01');
    expect(screen.getByLabelText('B hasta')).toHaveValue('2026-08-21');
    await waitFor(() =>
      expect(texto('comparativos-periodos')).toContain(
        'B: del 2026-08-01 al 2026-08-21 (días completos)',
      ),
    );
    await screen.findByTestId('fila-total');
    expect(a.llamadas.some((l) => clave(l) === '2026-08-01|2026-08-21|')).toBe(true);
    expect(screen.getByTestId('aviso-a-medias')).toBeInTheDocument();
  });

  it('un rango B invertido se explica y no se consulta', async () => {
    const a = api();
    montar(`/comparativos?empresa=${A}&periodo=mes&b=rango&bdesde=2026-08-31&bhasta=2026-08-01`);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Periodo B: La fecha de inicio no puede ser posterior a la de fin.',
    );
    await waitFor(() =>
      expect(a.contar('GET', '/ventas/comparativo-sucursales')).toBeGreaterThan(0),
    );
    expect(a.llamadas.filter((l) => l.query.get('desde') === '2026-08-31')).toHaveLength(0);
    expect(screen.queryByTestId('tabla-comparativos')).toBeNull();
  });

  it('el B propio no viaja a otras vistas; el periodo de la cabecera sí', async () => {
    const user = userEvent.setup();
    api();
    montar(`/comparativos?empresa=${A}&periodo=mes&b=mes-anterior`);
    await screen.findByTestId('fila-total');
    const enlace = screen.getByRole('link', { name: /Resumen/ });
    expect(enlace.getAttribute('href')).toContain('periodo=mes');
    expect(enlace.getAttribute('href')).not.toContain('b=');
    await user.click(enlace);
    await screen.findByTestId('resumen-periodo');
  });

  it('una sola fila de periodo en la cabecera (la vista no pinta la suya)', async () => {
    api();
    montar(`/comparativos?empresa=${A}&periodo=mes`);
    await screen.findByTestId('fila-total');
    expect(screen.getAllByRole('group', { name: 'Periodo' })).toHaveLength(1);
  });
});

describe('ranking', () => {
  it('ordena por el criterio elegido; la fila de total queda fuera y arriba', async () => {
    const user = userEvent.setup();
    api();
    montar(`/comparativos?empresa=${A}&periodo=mes`);
    await screen.findByTestId('fila-total');
    // Venta A: Centro 30,000 > Tijuana 10,000.
    expect(ordenFilas()).toEqual([CENTRO, TIJUANA]);
    expect(celda(CENTRO, 'posicion')).toBe('1');

    // Δ % de venta: Tijuana +100 % > Centro +50 %.
    const orden = screen.getByRole('combobox', { name: 'Ordenar por' });
    await user.selectOptions(orden, 'deltaVenta');
    expect(ordenFilas()).toEqual([TIJUANA, CENTRO]);
    expect(celda(TIJUANA, 'posicion')).toBe('1');
    expect(screen.getAllByRole('row')[2]).toHaveAttribute('data-testid', 'fila-total');
  });

  it('con B "mes anterior", Tijuana (sin B) queda fuera del ranking por Δ %, no de los de A', async () => {
    const user = userEvent.setup();
    api();
    montar(`/comparativos?empresa=${A}&periodo=mes&b=mes-anterior`);
    await screen.findByTestId('fila-total');
    expect(celda(TIJUANA, 'posicion')).toBe('2');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ordenar por' }), 'deltaVenta');
    expect(ordenFilas()).toEqual([CENTRO, TIJUANA]);
    expect(celda(TIJUANA, 'posicion')).toBe('—');
  });
});

describe('estados vacíos', () => {
  it('sin ventas en A ni en B: lo dice, y todo es "—", nunca $0.00 ni 0', async () => {
    api({}, {}, {});
    montar(`/comparativos?empresa=${A}&periodo=mes`);
    await screen.findByTestId('fila-total');
    expect(texto('sin-ventas-a')).toContain('Sin ventas en el periodo A');
    expect(texto('sin-ventas-b')).toContain('elige otro periodo de comparación');
    // Sin ninguna cifra, tampoco hay un Δ de "$0.00" que pintar.
    expect(screen.getByTestId('tabla-comparativos')).not.toHaveTextContent('$0.00');
    for (const f of ['fila-total', CENTRO, TIJUANA]) {
      for (const m of ['venta', 'cuentas', 'ticketPromedio', 'comensales']) {
        expect(celda(f, `${m}-a`)).toBe('—');
        expect(celda(f, `${m}-b`)).toBe('—');
      }
    }
    // F2-106 construyó la tasa: ya no queda nota de pendientes, y la tasa tiene la suya.
    expect(screen.queryByTestId('nota-pendientes')).toBeNull();
    expect(texto('nota-tasa')).toContain('Tasa de facturación: lo facturado en el periodo');
    expect(texto('nota-utilidad')).toContain('Utilidad: la de operación');
  });

  it('comensales en 0 con cuentas se pintan como Inicio (0) y avisan que no distinguen', async () => {
    api();
    montar(`/comparativos?empresa=${A}&periodo=mes&b=mes-anterior`);
    await screen.findByTestId('fila-total');
    const c = within(screen.getByTestId(TIJUANA)).getByTestId('comensales-a');
    expect(c).toHaveTextContent('0');
    expect(c.getAttribute('title')).toContain('no distingue');
    // Con B comparable (Tijuana 20 comensales) el Δ sale −100 % y lleva la misma salvedad.
    cleanup();
    montar(`/comparativos?empresa=${A}&periodo=mes`);
    await screen.findByTestId('fila-total');
    const d = within(screen.getByTestId(TIJUANA)).getByTestId('comensales-delta');
    expect(d).toHaveTextContent('-100.0 %');
    expect(d.getAttribute('title')).toContain('no distingue');
    // Centro sí registró comensales: su Δ no lleva salvedad.
    expect(
      within(screen.getByTestId(CENTRO)).getByTestId('comensales-delta').getAttribute('title'),
    ).toBeNull();
  });

  it('si una consulta falla, se ve el error y no una tabla a medias', async () => {
    api({
      'GET /ventas/comparativo-sucursales': (l) =>
        l.query.has('alturaAl')
          ? json(500, { statusCode: 500, message: 'Falla' })
          : json(200, filasDe(l, SUCURSALES)),
    });
    montar(`/comparativos?empresa=${A}&periodo=mes`);
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar este dato.');
    expect(screen.queryByTestId('tabla-comparativos')).toBeNull();
  });
});

describe('alcance', () => {
  it('al cambiar de sucursal nunca se ven las filas del alcance anterior', async () => {
    const user = userEvent.setup();
    let soltar: () => void = () => {};
    const pausa = new Promise<void>((r) => {
      soltar = r;
    });
    api({
      'GET /ventas/comparativo-sucursales': async (l) => {
        if (l.query.get('sucursalId')) await pausa;
        return json(200, filasDe(l, SUCURSALES));
      },
    });
    montar(`/comparativos?empresa=${A}&periodo=mes`);
    await screen.findByTestId(CENTRO);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sucursal' }), A2.id);
    await waitFor(() => expect(screen.queryByTestId('tabla-comparativos')).toBeNull());
    expect(screen.queryByTestId(CENTRO)).toBeNull();
    expect(screen.getByTestId('esqueleto')).toBeInTheDocument();
    soltar();
    await screen.findByTestId(TIJUANA);
    expect(ordenFilas()).toEqual([TIJUANA]);
  });

  it('al cambiar de empresa (admin_global) nunca se ven las filas de la anterior', async () => {
    const user = userEvent.setup();
    const B = { ...EMPRESA_B, activo: true };
    let soltar: () => void = () => {};
    const pausa = new Promise<void>((r) => {
      soltar = r;
    });
    const deB = (l: Llamada) => l.query.get('empresaId') === B.id;
    api({
      'POST /auth/refresh': () => json(200, sesion(usuario('admin_global'))),
      'GET /empresas': () => json(200, [EMPRESA_A, B]),
      'GET /sucursales': (l) =>
        json(200, l.query.get('empresaId') === B.id ? [SUCURSAL_B1] : [SUCURSAL_A1, A2]),
      'GET /ventas/resumen': (l) =>
        json(200, deB(l) ? resumen('7000.00', 7, '1000.00', 14, 7) : resumenDe(l, SUCURSALES)),
      'GET /ventas/comparativo-sucursales': async (l) => {
        if (!deB(l)) return json(200, filasDe(l, SUCURSALES));
        await pausa;
        return json(200, [fila(SUCURSAL_B1, '7000.00', 7, '1000.00', 14)]);
      },
      'GET /mesas/abiertas': () => json(200, []),
    });
    montar(`/comparativos?empresa=${A}&periodo=mes`);
    await screen.findByTestId(CENTRO);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Empresa' }), B.id);
    await waitFor(() => expect(screen.queryByTestId('tabla-comparativos')).toBeNull());
    expect(screen.queryByTestId(CENTRO)).toBeNull();
    expect(screen.queryByTestId(TIJUANA)).toBeNull();
    soltar();
    await screen.findByTestId(`fila-${SUCURSAL_B1.id}`);
    expect(ordenFilas()).toEqual([`fila-${SUCURSAL_B1.id}`]);
    expect(celda('fila-total', 'venta-a')).toBe('$7,000.00');
  });

  it('el visor de la empresa A ve la matriz de su empresa y nada consulta otra', async () => {
    const a = api({
      'POST /auth/refresh': () => json(200, sesion(usuario('visor', 'Vero Visor'))),
    });
    montar(`/comparativos?empresa=${A}&periodo=mes`);
    await screen.findByTestId('fila-total');
    expect(ordenFilas()).toEqual([CENTRO, TIJUANA]);
    const ventas = a.llamadas.filter((l) => l.ruta.startsWith('/ventas/'));
    expect(ventas.length).toBeGreaterThan(0);
    expect(new Set(ventas.map((l) => l.query.get('empresaId')))).toEqual(new Set([A]));
  });
});

describe('utilidad (F2-126)', () => {
  const titulo = (filaId: string, id: string) =>
    within(screen.getByTestId(filaId)).getByTestId(id).getAttribute('title') ?? '';

  it('la del estado de resultados; nula = "—" con su porqué; el total es el del API, no una suma', async () => {
    const a = api();
    montar(`/comparativos?empresa=${A}&periodo=mes&b=mes-anterior`);
    await screen.findByTestId('fila-total');

    // Centro: costo incompleto en A → cifra con asterisco y la salvedad.
    expect(celda(CENTRO, 'utilidad-a')).toBe(`$9,000.00* (${UTILIDAD_SOBRESTIMADA})`);
    expect(titulo(CENTRO, 'utilidad-a')).toBe(UTILIDAD_SOBRESTIMADA);
    expect(celda(CENTRO, 'utilidad-b')).toBe('$12,000.00');
    expect(celda(CENTRO, 'utilidad-delta')).toBe('-25.0 %-$3,000.00');
    // Tijuana sin recetas en A: "—" con el porqué, nunca $0.00; sin cuentas en B: "—".
    expect(celda(TIJUANA, 'utilidad-a')).toBe('—');
    expect(titulo(TIJUANA, 'utilidad-a')).toBe(UTILIDAD_SIN_COSTO);
    expect(celda(TIJUANA, 'utilidad-b')).toBe('—');
    expect(celda(TIJUANA, 'utilidad-delta')).toMatch(/^—/);
    // Total de A: el API lo manda nulo (falta Tijuana) aunque Centro tenga cifra.
    expect(celda('fila-total', 'utilidad-a')).toBe('—');
    expect(celda('fila-total', 'utilidad-b')).toBe('$11,500.00');
    expect(celda('fila-total', 'utilidad-delta')).toContain('Periodo A:');
    // Una petición por periodo, con la misma llave que "Gastos y utilidad".
    const estados = a.llamadas.filter((l) => l.ruta === '/finanzas/estado-resultados');
    expect(estados.map((l) => `${l.query.get('desde')}|${l.query.get('hasta')}`).sort()).toEqual([
      '2026-08-01|2026-08-31',
      '2026-09-01|2026-09-21',
    ]);
  });

  it('con B cortado a la misma altura, la de B no se pide y se dice por qué', async () => {
    const a = api();
    montar(`/comparativos?empresa=${A}&periodo=mes`);
    await screen.findByTestId('fila-total');
    expect(celda(CENTRO, 'utilidad-b')).toBe('—');
    expect(titulo(CENTRO, 'utilidad-b')).toBe(UTILIDAD_CORTADA);
    expect(celda('fila-total', 'utilidad-b')).toBe('—');
    expect(celda(CENTRO, 'utilidad-delta')).toContain(`Periodo B: ${UTILIDAD_CORTADA}`);
    const estados = a.llamadas.filter((l) => l.ruta === '/finanzas/estado-resultados');
    expect(estados.every((l) => l.query.get('desde') === '2026-09-01')).toBe(true);
  });

  it('si el estado de resultados falla, la tabla se ve y la utilidad dice que no se pudo leer', async () => {
    api({ 'GET /finanzas/estado-resultados': () => json(500, { statusCode: 500, message: 'x' }) });
    montar(`/comparativos?empresa=${A}&periodo=mes&b=mes-anterior`);
    await screen.findByTestId('fila-total');
    expect(celda(CENTRO, 'venta-a')).toBe('$30,000.00');
    expect(celda(CENTRO, 'utilidad-a')).toBe('—');
    expect(titulo(CENTRO, 'utilidad-a')).toBe(UTILIDAD_SIN_LECTURA);
    expect(celda(CENTRO, 'utilidad-b')).toBe('—');
    expect(celda('fila-total', 'utilidad-a')).toBe('—');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('se puede ordenar por la utilidad de A', async () => {
    const user = userEvent.setup();
    api();
    montar(`/comparativos?empresa=${A}&periodo=mes&b=mes-anterior`);
    await screen.findByTestId('fila-total');
    await user.selectOptions(screen.getByRole('combobox', { name: 'Ordenar por' }), 'utilidad');
    expect(ordenFilas()).toEqual([CENTRO, TIJUANA]);
    expect(celda(TIJUANA, 'posicion')).toBe('—');
  });
});

describe('export CSV', () => {
  const originales = { crear: URL.createObjectURL, revocar: URL.revokeObjectURL };
  afterEach(() => {
    URL.createObjectURL = originales.crear;
    URL.revokeObjectURL = originales.revocar;
  });

  it('baja lo que se ve, en el orden del ranking, con los dos rangos en el nombre', async () => {
    const user = userEvent.setup();
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
    api();
    montar(`/comparativos?empresa=${A}&periodo=mes&b=mes-anterior`);
    await screen.findByTestId('fila-total');
    await user.click(screen.getByRole('button', { name: 'Exportar CSV' }));

    expect(nombres).toEqual(['comparativos_2026-09-01_2026-09-21_vs_2026-08-01_2026-08-31.csv']);
    const contenido = new TextDecoder().decode(new Uint8Array(await blobs[0].arrayBuffer()));
    const lineas = contenido.slice(1).split('\r\n');
    // Utilidad: Centro 9000 (sobrestimada; el CSV lleva la cifra) contra 12000; Tijuana sin
    // costo en A y sin cuentas en B: vacías, nunca 0. Tasa al final (F2-106): Centro 50 % contra
    // 40 % (+10 pp, +25 %); Tijuana 25 % en A y sin cuentas en B.
    expect(lineas[1]).toBe(
      '1,Centro,30000.00,40000.00,-10000.00,-25.0,60,80,-20,-25.0,500.00,500.00,0.00,0.0,150,200,-50,-25.0,9000.00,12000.00,-3000.00,-25.0,50.00,40.00,10.00,25.0',
    );
    expect(lineas[2]).toBe('2,Tijuana,10000.00,,,,25,,,,400.00,,,,0,,,,,,,,25.00,,,');
    expect(lineas).toHaveLength(4);
  });
});

describe('tasa de facturación (F2-106)', () => {
  it('sin venta es "—" con su porqué; si el tablero falla, la tabla sigue y la tasa dice por qué', async () => {
    api({ 'GET /facturacion/tablero': () => json(500, { statusCode: 500, message: 'x' }) });
    montar(`/comparativos?empresa=${A}&periodo=mes&b=mes-anterior`);
    await screen.findByTestId('fila-total');
    // La venta se pinta igual.
    expect(celda(CENTRO, 'venta-a')).toBe('$30,000.00');
    const tasa = within(screen.getByTestId(CENTRO)).getByTestId('tasaFacturacion-a');
    expect(tasa).toHaveTextContent('—');
    expect(tasa).toHaveAttribute('title', 'La tasa de facturación no se pudo leer.');
    expect(tasa).not.toHaveTextContent('0');
  });
});

describe('auto-refresco', () => {
  it('con A hasta hoy, las cifras de A se vuelven a pedir a la par que la base avanza', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(AHORA);
    const a = api();
    montar(`/comparativos?empresa=${A}&periodo=mes`);
    await screen.findByTestId('fila-total');
    const actuales = () =>
      a.llamadas.filter(
        (l) => l.ruta === '/ventas/comparativo-sucursales' && !l.query.has('alturaAl'),
      ).length;
    const antes = actuales();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    await waitFor(() =>
      expect(a.llamadas.some((l) => l.query.get('alturaAl') === '2026-09-21T20:31:00.000Z')).toBe(
        true,
      ),
    );
    await waitFor(() => expect(actuales()).toBeGreaterThan(antes));
  });
});
