import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Alerta, MesasSucursal, ProductoTop, Resumen, VentaSucursal } from '../api/tipos';
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

// F2-220 contra el router y la app reales.
//
// Qué prueba y qué no (honestidad del AC1): el Resumen no calcula nada propio; pide los
// MISMOS endpoints, con los MISMOS parámetros (y llaves de caché), que Inicio y Reportes, y
// pinta con el mismo formato. Este test compara lo pintado en /resumen contra lo pintado en
// Inicio y Reportes con una sola API falsa: prueba eso. Que las cifras del servidor cuadren
// entre sí y que el corte "a la misma altura" sea correcto lo prueban los e2e de la API
// (`api/src/ventas/altura.e2e.spec.ts`, `lectura.e2e.spec.ts`) contra Postgres.

const A = EMPRESA_A.id;
// Lunes 21-sep-2026, 14:30:30 en CDMX.
const AHORA = new Date('2026-09-21T20:30:30Z');
const ALTURA = '2026-09-21T20:30:00.000Z';
const HOY = '2026-09-21';
const A2 = { ...SUCURSAL_A2, zonaHoraria: 'America/Mexico_City' };

function resumen(
  venta: string,
  cuentas: number,
  ticket: string | null,
  comensales: number,
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
    comensales: { total: comensales, cuentasConDato: cuentas, promedioPorComensal: null },
    cancelados: { cuentas: 0 },
  };
}
const VACIO = resumen('0.00', 0, null, 0);

const hace = (segundos: number) => new Date(AHORA.getTime() - segundos * 1000).toISOString();
function mesa(numero: string, total: string, min: number) {
  return {
    mesa: numero,
    mesero: 'Ana',
    folio: `F-${numero}`,
    abiertoAt: hace(min * 60),
    total,
    comensales: 2,
    impreso: false,
    partidas: [],
  };
}
function snapshot(edad: number, mesas: Record<string, unknown>[]) {
  return {
    capturadoAt: hace(edad),
    recibidoAt: hace(edad),
    edadSegundos: edad,
    edadRecepcionSegundos: edad,
    mesas,
  };
}
const MESAS: MesasSucursal[] = [
  {
    sucursalId: SUCURSAL_A1.id,
    nombre: 'Centro',
    zonaHoraria: 'America/Mexico_City',
    // 60 min justos NO es alerta (el backlog dice "más de 60"); 65 y 130 sí.
    snapshot: snapshot(30, [
      mesa('12', '350.50', 15),
      mesa('3', '1200.00', 65),
      mesa('7', '80.00', 60),
      mesa('9', '99.50', 130),
    ]),
  },
  // Tijuana dejó de reportar hace 5 min: desconectada.
  {
    sucursalId: A2.id,
    nombre: 'Tijuana',
    zonaHoraria: 'America/Mexico_City',
    snapshot: snapshot(300, [mesa('1', '500.00', 10)]),
  },
];

const clave = (l: Llamada) =>
  [l.query.get('desde'), l.query.get('hasta'), l.query.get('alturaAl') ?? ''].join('|');

/** Las cifras del escenario lleno, por `desde|hasta|alturaAl`. Todo lo demás: vacío. */
const RESUMENES: Record<string, Resumen> = {
  [`${HOY}|${HOY}|`]: resumen('12500.00', 25, '500.00', 60),
  [`2026-09-14|2026-09-14|${ALTURA}`]: resumen('10000.00', 20, '400.00', 50),
  [`2026-09-01|${HOY}|`]: resumen('250000.00', 500, '500.00', 1200),
  [`2026-08-01|2026-08-21|${ALTURA}`]: resumen('200000.00', 400, '500.00', 1000),
};
const SUCURSALES: Record<string, VentaSucursal[]> = {
  [`${HOY}|${HOY}|`]: [
    {
      sucursalId: SUCURSAL_A1.id,
      nombre: 'Centro',
      venta: '9000.00',
      cuentas: 18,
      ticketPromedio: '500.00',
      comensales: 40,
    },
    {
      sucursalId: A2.id,
      nombre: 'Tijuana',
      venta: '3500.00',
      cuentas: 7,
      ticketPromedio: '500.00',
      comensales: 20,
    },
  ],
  [`2026-09-14|2026-09-14|${ALTURA}`]: [
    {
      sucursalId: SUCURSAL_A1.id,
      nombre: 'Centro',
      venta: '8000.00',
      cuentas: 16,
      ticketPromedio: '500.00',
      comensales: 40,
    },
    // Tijuana no vendió la semana pasada a esta hora: su Δ es "—", no "+100 %".
    {
      sucursalId: A2.id,
      nombre: 'Tijuana',
      venta: '0.00',
      cuentas: 0,
      ticketPromedio: null,
      comensales: 0,
    },
  ],
};
const producto = (nombre: string, importe: string): ProductoTop => ({
  producto: nombre,
  importe,
  cantidad: '1.000',
});
const TOP: Record<string, ProductoTop[]> = {
  [`${HOY}|${HOY}|`]: [
    producto('Arrachera', '3000.00'),
    producto('Tacos al pastor (orden)', '2000.00'),
    producto('Mole poblano', '1500.00'),
    producto('Pozole rojo', '1200.00'),
    producto('Chiles en nogada', '900.00'),
    producto('Café de olla', '100.00'),
  ],
  [`2026-09-14|2026-09-14|${ALTURA}`]: [
    producto('Arrachera', '2500.00'),
    producto('Tacos al pastor (orden)', '2000.00'),
    producto('Mole poblano', '1600.00'),
    producto('Pozole rojo', '1000.00'),
    // Chiles en nogada no está entre los 50 de la base.
  ],
};

function api(lleno = true, extra: Record<string, Manejador> = {}) {
  const u = usuario('admin_empresa');
  const porSucursal = <T,>(filas: T[], l: Llamada) => {
    const s = l.query.get('sucursalId');
    return s ? filas.filter((f) => (f as { sucursalId?: string }).sucursalId === s) : filas;
  };
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, A2]),
    'GET /usuarios': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /ventas/resumen': (l) => json(200, (lleno && RESUMENES[clave(l)]) || VACIO),
    'GET /ventas/por-hora': () =>
      json(
        200,
        Array.from({ length: 24 }, (_, hora) => ({ hora, venta: '0.00', cuentas: 0 })),
      ),
    'GET /ventas/formas-pago': () => json(200, { formas: [], sinCatalogo: [] }),
    'GET /ventas/por-dia': () => json(200, []),
    'GET /ventas/comparativo-sucursales': (l) =>
      json(
        200,
        porSucursal(
          (lleno && SUCURSALES[clave(l)]) || [
            {
              sucursalId: SUCURSAL_A1.id,
              nombre: 'Centro',
              venta: '0.00',
              cuentas: 0,
              ticketPromedio: null,
              comensales: 0,
            },
            {
              sucursalId: A2.id,
              nombre: 'Tijuana',
              venta: '0.00',
              cuentas: 0,
              ticketPromedio: null,
              comensales: 0,
            },
          ],
          l,
        ),
      ),
    'GET /ventas/top-productos': (l) =>
      json(200, ((lleno && TOP[clave(l)]) || []).slice(0, Number(l.query.get('limite') ?? 10))),
    'GET /ventas/tickets': () =>
      json(200, { total: 0, pagina: 1, porPagina: 50, corte: AHORA.toISOString(), items: [] }),
    'GET /mesas/abiertas': (l) => json(200, porSucursal(MESAS, l)),
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
const tarjeta = (nombre: string) => screen.getByRole('region', { name: nombre });

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
});

async function resumenCompleto() {
  await screen.findByTestId('resumen-venta-hoy-delta');
  await screen.findByTestId('resumen-venta-mes-delta');
  await screen.findByTestId('resumen-ticket-promedio-delta');
  await screen.findByTestId('resumen-mejor-delta');
  await screen.findByTestId('resumen-top-5-delta');
  await screen.findByTestId('venta-en-vivo');
}

describe('AC1 · cada cifra es la misma que en Inicio y Reportes', () => {
  it('hoy, mes, ticket promedio, venta en curso, sucursales y top: mismo texto, mismas consultas', async () => {
    const a = api();
    montar(`/resumen?empresa=${A}`);
    await resumenCompleto();

    const enResumen = {
      hoy: texto('resumen-venta-hoy'),
      mes: texto('resumen-venta-mes'),
      ticket: texto('resumen-ticket-promedio'),
      comensales: texto('resumen-comensales'),
      vivo: texto('venta-en-vivo'),
      mejor: texto('resumen-mejor-venta'),
      peor: texto('resumen-peor-venta'),
    };
    expect(enResumen).toEqual({
      hoy: '$12,500.00',
      mes: '$250,000.00',
      ticket: '$500.00',
      comensales: '60',
      // Centro: 350.50 + 1200 + 80 + 99.50. Tijuana está desconectada y no suma.
      vivo: '$1,730.00',
      mejor: '$9,000.00',
      peor: '$3,500.00',
    });
    const topResumen = [1, 2, 3, 4, 5].map((i) => texto(`resumen-top-${i}`));

    // Las consultas "actuales" son EXACTAMENTE las de Inicio: sin alturaAl. Las bases, con él.
    const resumenes = a.llamadas.filter((l) => l.ruta === '/ventas/resumen');
    const conAltura = resumenes
      .filter((l) => l.query.has('alturaAl'))
      .map(clave)
      .sort();
    expect(conAltura).toEqual([
      `2026-08-01|2026-08-21|${ALTURA}`,
      `2026-09-14|2026-09-14|${ALTURA}`,
    ]);
    // El resumen de "hoy" del bloque fijo y el del periodo "Hoy" son la misma consulta: una sola.
    expect(resumenes.filter((l) => clave(l) === `${HOY}|${HOY}|`)).toHaveLength(1);
    cleanup();

    // Inicio con "Hoy": venta total, ticket promedio, comensales y venta en vivo.
    montar(`/?empresa=${A}`);
    await screen.findByTestId('venta-total');
    await screen.findByTestId('venta-en-vivo');
    expect(texto('venta-total')).toBe(enResumen.hoy);
    expect(texto('ticket-promedio')).toBe(enResumen.ticket);
    expect(texto('comensales')).toBe(enResumen.comensales);
    expect(texto('venta-en-vivo')).toBe(enResumen.vivo);
    cleanup();

    // Inicio con "Este mes".
    montar(`/?empresa=${A}&periodo=mes`);
    await screen.findByTestId('venta-total');
    expect(texto('venta-total')).toBe(enResumen.mes);
    cleanup();

    // Reportes con "Hoy": la fila de cada sucursal y el top.
    montar(`/reportes?empresa=${A}`);
    const centro = await screen.findByTestId(`sucursal-${SUCURSAL_A1.id}`);
    expect(centro).toHaveTextContent(enResumen.mejor);
    expect(screen.getByTestId(`sucursal-${A2.id}`)).toHaveTextContent(enResumen.peor);
    await screen.findByTestId('top-5');
    for (const [i, fila] of topResumen.entries()) {
      const enReportes = screen.getByTestId(`top-${i + 1}`);
      const [nombre, importe] = [
        within(enReportes).getAllByRole('cell')[1].textContent ?? '',
        within(enReportes).getAllByRole('cell')[2].textContent ?? '',
      ];
      expect(fila).toContain(nombre);
      expect(fila).toContain(importe);
    }
  });

  it('los Δ comparan contra su base, a la misma altura, con el porqué cuando no hay base', async () => {
    api();
    montar(`/resumen?empresa=${A}`);
    await resumenCompleto();

    // 12,500 vs 10,000.
    expect(texto('resumen-venta-hoy-delta')).toContain('+25.0 % (+$2,500.00)');
    expect(texto('resumen-venta-hoy-delta')).toContain(
      'el mismo día de la semana pasada a esta hora',
    );
    // 250,000 vs 200,000.
    expect(texto('resumen-venta-mes-delta')).toContain('+25.0 % (+$50,000.00)');
    expect(texto('resumen-venta-mes-delta')).toContain('el mes anterior a la misma altura');
    // 500 vs 400; 60 vs 50 comensales.
    expect(texto('resumen-ticket-promedio-delta')).toContain('+25.0 % (+$100.00)');
    expect(texto('resumen-comensales-delta')).toContain('+20.0 % (+10)');
    // Centro 9,000 vs 8,000; Tijuana sin ventas en la base: "—".
    expect(texto('resumen-mejor-delta')).toContain('+12.5 % (+$1,000.00)');
    expect(texto('resumen-peor-delta')).toMatch(/^—.*Tijuana no tuvo ventas/);
    // Top: Mole bajó; Chiles en nogada no está en los 50 de la base.
    expect(texto('resumen-top-3-delta')).toContain('-6.3 % (-$100.00)');
    expect(texto('resumen-top-5-delta')).toMatch(/^—.*fuera de los 50 más vendidos/);
    expect(document.body.textContent).not.toMatch(/\+100(\.0)? ?%/);
  });

  it('la vista tiene su selector de periodo en la cabecera, uno solo', async () => {
    api();
    montar(`/resumen?empresa=${A}`);
    await screen.findByTestId('resumen-venta-hoy');
    expect(screen.getAllByRole('group', { name: 'Periodo' })).toHaveLength(1);
    expect(texto('resumen-periodo')).toContain('comparado con el mismo día de la semana pasada');
  });
});

describe('AC2 · un periodo sin ventas dice "sin ventas", nunca $0.00', () => {
  it('Hoy, Este mes, ticket, sucursales y top', async () => {
    api(false);
    montar(`/resumen?empresa=${A}`);
    await screen.findByTestId('venta-en-vivo');
    for (const nombre of [
      'Hoy',
      'Este mes',
      'Ticket promedio y comensales',
      'Mejor y peor sucursal',
      'Top 5 productos',
    ]) {
      await waitFor(() => expect(tarjeta(nombre)).toHaveTextContent('Sin ventas en el periodo.'));
      expect(tarjeta(nombre)).not.toHaveTextContent('$0.00');
    }
  });
});

describe('AC3 · sin datos en la base, el Δ es "—", no "+100 %"', () => {
  it('base sin cuentas en todo', async () => {
    const lleno: Record<string, Resumen> = { [`${HOY}|${HOY}|`]: RESUMENES[`${HOY}|${HOY}|`] };
    api(true, {
      'GET /ventas/resumen': (l) => json(200, lleno[clave(l)] ?? VACIO),
      'GET /ventas/comparativo-sucursales': (l) =>
        json(
          200,
          l.query.has('alturaAl')
            ? SUCURSALES[`2026-09-14|2026-09-14|${ALTURA}`].map((s) => ({
                ...s,
                venta: '0.00',
                cuentas: 0,
                ticketPromedio: null,
              }))
            : SUCURSALES[`${HOY}|${HOY}|`],
        ),
      'GET /ventas/top-productos': (l) =>
        json(200, l.query.has('alturaAl') ? [] : TOP[`${HOY}|${HOY}|`].slice(0, 5)),
    });
    montar(`/resumen?empresa=${A}`);
    await screen.findByTestId('resumen-venta-hoy-delta');
    await screen.findByTestId('resumen-top-1-delta');
    await screen.findByTestId('resumen-mejor-delta');
    for (const id of [
      'resumen-venta-hoy-delta',
      'resumen-ticket-promedio-delta',
      'resumen-comensales-delta',
      'resumen-mejor-delta',
      'resumen-peor-delta',
      'resumen-top-1-delta',
    ]) {
      expect(texto(id)).toMatch(/^—/);
    }
    expect(texto('resumen-venta-hoy-delta')).toContain(
      'sin ventas en el mismo día de la semana pasada',
    );
    // El top sin ventas en la base dice eso, no "fuera de los 50".
    expect(texto('resumen-top-1-delta')).toContain('sin ventas en');
    expect(document.body.textContent).not.toMatch(/\+100(\.0)? ?%/);
  });
});

// F2-224: las alertas del Resumen son las del centro de alertas (misma consulta que la campana),
// ya no el cálculo provisional de F2-220 sobre las mesas. Qué abre una alerta (> 60 min, sin
// reporte, etc.) lo prueba el API (`api/src/alertas/*.spec.ts`); aquí, que se pintan tal cual.
const ALERTAS: Alerta[] = [
  {
    id: 'al-1',
    sucursalId: A2.id,
    sucursal: 'Tijuana',
    tipo: 'sucursal_sin_reporte',
    severidad: 'critica',
    llave: '',
    umbral: 10,
    detalle: { nunca: false, edadSegundos: 900 },
    abiertaAt: hace(300),
    cerradaAt: null,
    motivoCierre: null,
  },
  {
    id: 'al-2',
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    tipo: 'mesa_abierta',
    severidad: 'advertencia',
    llave: 'F-9',
    umbral: 60,
    detalle: { folio: 'F-9', mesa: '9', minutos: 61 },
    abiertaAt: hace(600),
    cerradaAt: null,
    motivoCierre: null,
  },
];

describe('Alertas activas', () => {
  it('pinta las abiertas del centro de alertas, con enlaces al centro y al monitor', async () => {
    const falsa = api(true, { 'GET /alertas/abiertas': () => json(200, ALERTAS) });
    montar(`/resumen?empresa=${A}`);
    const lista = await screen.findByTestId('resumen-alertas');
    const items = within(lista)
      .getAllByRole('listitem')
      .map((li) => li.textContent);
    expect(items).toEqual([
      'Crítica: Tijuana: sin reportar (última lectura hace 15 min al abrir).',
      'Advertencia: Mesa 9 (folio F-9, Centro): abierta 61 min al abrir la alerta.',
    ]);
    expect(screen.getByRole('link', { name: 'Ver el centro de alertas' })).toHaveAttribute(
      'href',
      `/alertas?empresa=${A}`,
    );
    expect(screen.getByRole('link', { name: 'Ver el monitor de mesas' })).toHaveAttribute(
      'href',
      `/mesas?empresa=${A}`,
    );
    // Una sola consulta de alertas aunque la campana y la tarjeta las pinten (misma llave).
    await waitFor(() => expect(falsa.contar('GET', '/alertas/abiertas')).toBe(1));
    // La venta de hoy sigue avisando que Tijuana no reporta (eso sale de las mesas).
    expect(texto('resumen-venta-hoy-aviso')).toContain('Sin lectura reciente de Tijuana');
  });

  it('sin alertas abiertas lo dice; si la API falla, lo dice: no "sin alertas"', async () => {
    api(true, { 'GET /alertas/abiertas': () => json(200, []) });
    montar(`/resumen?empresa=${A}`);
    await waitFor(() =>
      expect(tarjeta('Alertas activas')).toHaveTextContent('Sin alertas abiertas'),
    );
    cleanup();

    api(true, { 'GET /alertas/abiertas': () => json(500, { statusCode: 500, message: 'caída' }) });
    montar(`/resumen?empresa=${A}`);
    await waitFor(() =>
      expect(tarjeta('Alertas activas')).toHaveTextContent('No se pudo cargar este dato.'),
    );
    expect(tarjeta('Alertas activas')).not.toHaveTextContent('Sin alertas');
  });
});

describe('alcance y periodo', () => {
  it('con una sucursal elegida no hay mejor ni peor: se explica', async () => {
    api();
    montar(`/resumen?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    await waitFor(() =>
      expect(tarjeta('Mejor y peor sucursal')).toHaveTextContent('Elige “Todas” para compararlas'),
    );
  });

  it('un rango invertido no consulta el periodo, y lo fijo (hoy, mes) sigue', async () => {
    const a = api();
    montar(`/resumen?empresa=${A}&periodo=rango&desde=2026-09-20&hasta=2026-09-10`);
    await screen.findByTestId('resumen-venta-hoy');
    expect(
      screen.getByText('Corrige el rango de fechas para ver las cifras del periodo.'),
    ).toBeInTheDocument();
    expect(a.llamadas.some((l) => l.query.get('desde') === '2026-09-20')).toBe(false);
    expect(a.llamadas.some((l) => l.ruta === '/ventas/top-productos')).toBe(false);
  });

  it('"Este mes" compara contra el mes anterior a la misma altura', async () => {
    const a = api();
    montar(`/resumen?empresa=${A}&periodo=mes`);
    await screen.findByTestId('resumen-ticket-promedio-delta');
    expect(texto('resumen-periodo')).toContain('comparado con el mes anterior a la misma altura');
    const top = a.llamadas.filter((l) => l.ruta === '/ventas/top-productos').map(clave);
    expect(top).toContain(`2026-09-01|${HOY}|`);
    expect(top).toContain(`2026-08-01|2026-08-21|${ALTURA}`);
  });
});

describe('auto-refresco (bloqueo B1 del revisor)', () => {
  const actuales = (a: ReturnType<typeof api>, ruta: string) =>
    a.llamadas.filter((l) => l.ruta === ruta && !l.query.has('alturaAl')).length;
  const alturas = (a: ReturnType<typeof api>, ruta: string) =>
    new Set(a.llamadas.filter((l) => l.ruta === ruta).map((l) => l.query.get('alturaAl')));

  it('con "Hoy", sucursales y top actuales se vuelven a pedir a la par que su base avanza', async () => {
    // Los intervalos (reloj de la vista y refetch de React Query) también son falsos aquí.
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(AHORA);
    const a = api();
    montar(`/resumen?empresa=${A}`);
    await resumenCompleto();
    const antes = {
      sucursales: actuales(a, '/ventas/comparativo-sucursales'),
      top: actuales(a, '/ventas/top-productos'),
    };

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });

    // La base ya va en el minuto siguiente…
    await waitFor(() =>
      expect(alturas(a, '/ventas/comparativo-sucursales')).toContain('2026-09-21T20:31:00.000Z'),
    );
    // …y la cifra actual contra la que se compara también se volvió a pedir.
    await waitFor(() =>
      expect(actuales(a, '/ventas/comparativo-sucursales')).toBeGreaterThan(antes.sucursales),
    );
    await waitFor(() => expect(actuales(a, '/ventas/top-productos')).toBeGreaterThan(antes.top));
  });

  it('Reportes sigue sin refrescarse solo (es un reporte)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
    vi.setSystemTime(AHORA);
    const a = api();
    montar(`/reportes?empresa=${A}`);
    await screen.findByTestId('top-5');
    const antes = actuales(a, '/ventas/comparativo-sucursales');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(actuales(a, '/ventas/comparativo-sucursales')).toBe(antes);
  });
});
