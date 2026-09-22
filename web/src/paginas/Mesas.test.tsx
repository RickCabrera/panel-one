import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MesasSucursal } from '../api/tipos';
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

const A = EMPRESA_A.id;

// 2026-09-21 03:30 UTC = 20-sep 21:30 en CDMX (la zona del panel con "Todas", porque
// Centro y Tijuana no comparten zona).
const AHORA = Date.parse('2026-09-21T03:30:00Z');
const hace = (segundos: number) => new Date(AHORA - segundos * 1000).toISOString();

/** Una cuenta abierta hace `min` minutos (la captura + su edad = AHORA). */
function mesa(numero: string, total: string, min: number, extra: Record<string, unknown> = {}) {
  return {
    mesa: numero,
    mesero: `Mesero de la ${numero}`,
    folio: `F-${numero}`,
    abiertoAt: hace(min * 60),
    total,
    comensales: 2,
    impreso: false,
    partidas: [{ producto: 'Guacamole', cantidad: '1' }],
    ...extra,
  };
}

const PARTIDAS_5 = [
  { producto: 'Tacos al pastor (orden)', cantidad: '2' },
  { producto: 'Arrachera', cantidad: '0.750' },
  { producto: 'Refresco', cantidad: 3 },
  { producto: 'Flan napolitano', cantidad: '1' },
  { producto: 'Café de olla', cantidad: '2' },
];

function centro(
  edad = 30,
  mesas = [
    mesa('12', '350.50', 15),
    mesa('3', '1200.00', 65, { impreso: true, partidas: PARTIDAS_5 }),
    mesa('7', '0.20', 40),
    mesa('10', '0.10', 39),
  ],
): MesasSucursal {
  return {
    sucursalId: SUCURSAL_A1.id,
    nombre: 'Centro',
    zonaHoraria: 'America/Mexico_City',
    snapshot: {
      capturadoAt: hace(edad),
      recibidoAt: hace(edad),
      edadSegundos: edad,
      edadRecepcionSegundos: edad,
      mesas,
    },
  };
}

function tijuana(edad: number | null): MesasSucursal {
  return {
    sucursalId: SUCURSAL_A2.id,
    nombre: 'Tijuana',
    zonaHoraria: 'America/Tijuana',
    snapshot:
      edad === null
        ? null
        : {
            capturadoAt: hace(edad),
            recibidoAt: hace(edad),
            edadSegundos: edad,
            edadRecepcionSegundos: edad,
            mesas: [mesa('99', '9999.00', 150)],
          },
  };
}

function apiMesas(mesas: Manejador) {
  const u = usuario('admin_empresa');
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /mesas/abiertas': mesas,
  });
}

function montar(ruta: string) {
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  render(
    <MemoryRouter initialEntries={[ruta]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
      </Proveedores>
    </MemoryRouter>,
  );
}

const kpi = (id: string) => screen.getByTestId(id);
const tarjetaMesa = (nombre: string) => screen.getByRole('listitem', { name: nombre });
const pedidas = (api: ReturnType<typeof apiMesas>) =>
  api.llamadas.filter((l) => l.ruta === '/mesas/abiertas');

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

describe('Monitor de mesas: KPIs y grid', () => {
  it('pinta las cifras de las mesas abiertas (calculadas a mano)', async () => {
    apiMesas(() => json(200, [centro(), tijuana(null)]));
    montar(`/mesas?empresa=${A}`);

    expect(await screen.findByTestId('kpi-mesas')).toHaveTextContent('4');
    // 350.50 + 1200.00 + 0.20 + 0.10
    expect(kpi('kpi-en-curso')).toHaveTextContent('$1,550.80');
    expect(kpi('kpi-sin-imprimir')).toHaveTextContent('3');
    expect(kpi('kpi-atencion')).toHaveTextContent('1');
    expect(screen.queryByTestId('kpi-sin-hora')).not.toBeInTheDocument();
    // Recibido 03:29:30 UTC = 21:29 en CDMX; 30 s = fresca (≤ 60 s).
    expect(kpi('kpi-lectura')).toHaveTextContent('21:29');
    expect(kpi('kpi-lectura')).toHaveAttribute('data-frescura', 'fresca');
    // Tijuana nunca reportó: se dice, y no entra en las cifras.
    expect(screen.getByTestId('banner-sin-reporte')).toHaveTextContent(
      'Tijuana: todavía no llegan datos del agente.',
    );
    expect(screen.getByRole('region', { name: 'Mesas abiertas' })).toHaveTextContent(
      'Sin contar: Tijuana.',
    );
  });

  it('cada tarjeta: número, total, mesero, minutos, semáforo y primeras 3 partidas', async () => {
    apiMesas(() => json(200, [centro(), tijuana(null)]));
    montar(`/mesas?empresa=${A}`);
    await screen.findByTestId('kpi-mesas');

    // Orden natural por número de mesa.
    const grid = screen.getByRole('list', { name: 'Mesas abiertas' });
    expect(
      within(grid)
        .getAllByRole('listitem')
        .filter((li) => li.parentElement === grid)
        .map((li) => li.getAttribute('aria-label')),
    ).toEqual(['Mesa 3 · Centro', 'Mesa 7 · Centro', 'Mesa 10 · Centro', 'Mesa 12 · Centro']);

    const tres = tarjetaMesa('Mesa 3 · Centro');
    expect(tres).toHaveAttribute('data-semaforo', 'rojo');
    expect(tres).toHaveClass('border-semaforo-rojo');
    expect(within(tres).getByTestId('mesa-total')).toHaveTextContent('$1,200.00');
    expect(within(tres).getByTestId('mesa-minutos')).toHaveTextContent('65 min');
    expect(tres).toHaveTextContent('Mesero de la 3');
    expect(tres).toHaveTextContent('2 × Tacos al pastor (orden)');
    expect(tres).toHaveTextContent('0.75 × Arrachera');
    expect(tres).toHaveTextContent('3 × Refresco');
    expect(tres).not.toHaveTextContent('Flan napolitano');
    expect(tres).toHaveTextContent('2 partidas más');

    expect(tarjetaMesa('Mesa 7 · Centro')).toHaveAttribute('data-semaforo', 'alerta');
    expect(tarjetaMesa('Mesa 10 · Centro')).toHaveAttribute('data-semaforo', 'ok');
    expect(tarjetaMesa('Mesa 12 · Centro')).toHaveAttribute('data-semaforo', 'ok');
    expect(tarjetaMesa('Mesa 12 · Centro')).not.toHaveTextContent('partidas más');
  });

  it('con una sucursal elegida, las tarjetas no repiten el nombre de la sucursal', async () => {
    apiMesas((l: Llamada) => {
      expect(l.query.get('sucursalId')).toBe(SUCURSAL_A1.id);
      return json(200, [centro()]);
    });
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    await screen.findByTestId('kpi-mesas');
    expect(tarjetaMesa('Mesa 3')).toBeInTheDocument();
  });

  it('un total ilegible: la tarjeta y el KPI dicen "Sin dato", nunca $0.00', async () => {
    apiMesas(() =>
      json(200, [centro(30, [mesa('1', '100.00', 5), mesa('2', 'cien', 5, { impreso: 'sí' })])]),
    );
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    expect(await screen.findByTestId('kpi-en-curso')).toHaveTextContent('Sin dato');
    expect(kpi('kpi-sin-imprimir')).toHaveTextContent('Sin dato');
    expect(within(tarjetaMesa('Mesa 2')).getByTestId('mesa-total')).toHaveTextContent('Sin dato');
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
  });

  it('una mesa sin hora de apertura se reporta aparte', async () => {
    apiMesas(() =>
      json(200, [centro(30, [mesa('1', '1.00', 70), mesa('2', '1.00', 5, { abiertoAt: null })])]),
    );
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    expect(await screen.findByTestId('kpi-atencion')).toHaveTextContent('1');
    expect(kpi('kpi-sin-hora')).toHaveTextContent('1 mesa sin hora de apertura legible.');
    expect(within(tarjetaMesa('Mesa 2')).getByTestId('mesa-minutos')).toHaveTextContent(
      'Tiempo: sin dato',
    );
  });

  it('sin mesas abiertas lo dice', async () => {
    apiMesas(() => json(200, [centro(30, [])]));
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    expect(await screen.findByText('No hay mesas abiertas.')).toBeInTheDocument();
    expect(kpi('kpi-mesas')).toHaveTextContent('0');
  });
});

describe('Monitor de mesas: sucursal desconectada', () => {
  it('un snapshot de hace 2 h: banner en lugar de sus mesas, y no suma', async () => {
    apiMesas(() => json(200, [centro(), tijuana(7200)]));
    montar(`/mesas?empresa=${A}`);

    const banner = await screen.findByTestId('banner-desconectada');
    // Recibido 01:30 UTC = 19:30 en CDMX.
    expect(banner).toHaveTextContent(
      'Tijuana: sucursal desconectada. Última lectura hace 2 h (19:30). Sus mesas no se muestran',
    );
    expect(screen.queryByRole('listitem', { name: 'Mesa 99 · Tijuana' })).not.toBeInTheDocument();
    expect(screen.queryByText('$9,999.00')).not.toBeInTheDocument();
    expect(kpi('kpi-mesas')).toHaveTextContent('4');
    expect(kpi('kpi-en-curso')).toHaveTextContent('$1,550.80');
    // La última lectura es la de lo que SE SUMA (Centro, 21:29), no las 2 h de Tijuana.
    expect(kpi('kpi-lectura')).toHaveTextContent('21:29');
    expect(kpi('kpi-lectura')).toHaveAttribute('data-frescura', 'fresca');
  });

  it('si la única sucursal está desconectada no hay KPIs en cero, sólo el aviso', async () => {
    apiMesas(() => json(200, [tijuana(7200)]));
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A2.id}`);
    expect(await screen.findByTestId('banner-desconectada')).toBeInTheDocument();
    expect(screen.getByText('No hay datos en vivo que mostrar.')).toBeInTheDocument();
    expect(screen.queryByTestId('kpi-mesas')).not.toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'Mesas abiertas' })).not.toBeInTheDocument();
  });

  it('91 s ya es desconectada; 90 s no', async () => {
    apiMesas(() => json(200, [centro(90), tijuana(91)]));
    montar(`/mesas?empresa=${A}`);
    const banner = await screen.findByTestId('banner-desconectada');
    expect(banner).toHaveTextContent('Tijuana');
    expect(screen.getAllByTestId('banner-desconectada')).toHaveLength(1);
    // La lectura que cuenta es la de Centro: 90 s, todavía conectada pero con retraso.
    expect(kpi('kpi-lectura')).toHaveAttribute('data-frescura', 'demorada');
    expect(kpi('kpi-mesas')).toHaveTextContent('4');
  });
});

describe('Monitor de mesas: polling y datos viejos', () => {
  it('se consulta cada 20 s', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    const api = apiMesas(() => json(200, [centro()]));
    montar(`/mesas?empresa=${A}`);
    await screen.findByTestId('kpi-mesas');
    expect(pedidas(api)).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await waitFor(() => expect(pedidas(api)).toHaveLength(2));
  });

  it('si el API deja de contestar, al pasar el umbral sale el banner (no la última foto como viva)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    let caido = false;
    apiMesas(() =>
      caido
        ? json(503, { statusCode: 503, message: 'Service Unavailable' })
        : json(200, [centro(10)]),
    );
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    await screen.findByTestId('kpi-mesas');
    expect(screen.queryByTestId('banner-desconectada')).not.toBeInTheDocument();

    caido = true;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(40_000);
    });
    // 10 + 40 s: todavía conectada, pero ya se avisa que no se pudo actualizar.
    await waitFor(() => expect(screen.getByTestId('sin-actualizar')).toBeInTheDocument());
    expect(screen.queryByTestId('banner-desconectada')).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(45_000);
    });
    // 10 + 85 s > 90 s: la vista envejece sola la última respuesta.
    await waitFor(() => expect(screen.getByTestId('banner-desconectada')).toBeInTheDocument());
    expect(screen.queryByRole('listitem', { name: 'Mesa 3' })).not.toBeInTheDocument();
  });

  it('cambiar de sucursal muestra skeletons, nunca las mesas del alcance anterior', async () => {
    let soltar: (() => void) | undefined;
    const api = apiMesas((l: Llamada) => {
      if (l.query.get('sucursalId') !== SUCURSAL_A2.id) return json(200, [centro()]);
      return new Promise<Response>((resolver) => {
        soltar = () =>
          resolver(
            json(200, [
              {
                ...tijuana(20),
                snapshot: { ...tijuana(20).snapshot!, mesas: [mesa('50', '5.00', 5)] },
              },
            ]),
          );
      });
    });
    const usuarioEvt = userEvent.setup();
    montar(`/mesas?empresa=${A}`);
    await screen.findByTestId('kpi-mesas');
    expect(tarjetaMesa('Mesa 3 · Centro')).toBeInTheDocument();

    const selector = screen.getByLabelText('Sucursal');
    await waitFor(() => expect(selector).toBeEnabled());
    await usuarioEvt.selectOptions(selector, SUCURSAL_A2.id);

    await waitFor(() => expect(pedidas(api).at(-1)?.query.get('sucursalId')).toBe(SUCURSAL_A2.id));
    expect(screen.getAllByTestId('esqueleto').length).toBeGreaterThan(0);
    expect(screen.queryByRole('listitem', { name: /Mesa 3/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId('kpi-mesas')).not.toBeInTheDocument();

    await act(async () => soltar!());
    expect(await screen.findByRole('listitem', { name: 'Mesa 50' })).toBeInTheDocument();
  });
});

describe('Detalle de consumo (modal, F1-051)', () => {
  /** La mesa 5: partidas con categoría, precios y modificadores anidados (sintéticos). */
  const CON_DETALLE = mesa('5', '612.00', 45, {
    mesero: 'Mesero Cinco',
    folio: 'F-5',
    comensales: 3,
    partidas: [
      {
        producto: 'Paquete familiar',
        categoria: 'Paquetes',
        cantidad: '1',
        precioUnit: '450.00',
        total: '462.00',
        modificadores: [
          {
            nombre: 'Bebida: limonada',
            precio: '0.00',
            modificadores: [
              { nombre: 'Sin hielo', precio: '0.00' },
              {
                nombre: 'Jarra grande',
                precio: '12.00',
                modificadores: [{ nombre: 'Con chía', precio: '0.00' }],
              },
            ],
          },
        ],
      },
      {
        producto: 'Refresco',
        categoria: 'Bebidas',
        cantidad: '3',
        precioUnit: '50.00',
        total: '150.00',
        modificadores: [],
      },
    ],
  });

  const centroCon = (mesas: ReturnType<typeof mesa>[], edad = 30) => centro(edad, mesas);

  async function abrir(nombre: string) {
    const usuarioEvt = userEvent.setup();
    await screen.findByTestId('kpi-mesas');
    await usuarioEvt.click(screen.getByRole('button', { name: `Ver consumo de ${nombre}` }));
    return { usuarioEvt, dialogo: screen.getByRole('dialog', { name: nombre }) };
  }

  it('clic en la mesa: encabezado, partidas y total de la cuenta', async () => {
    apiMesas(() => json(200, [centroCon([CON_DETALLE, mesa('12', '350.50', 15)])]));
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    const { dialogo } = await abrir('Mesa 5');

    const d = (id: string) => within(dialogo).getByTestId(id);
    expect(d('detalle-mesa')).toHaveTextContent('5');
    expect(d('detalle-mesero')).toHaveTextContent('Mesero Cinco');
    expect(d('detalle-folio')).toHaveTextContent('F-5');
    expect(d('detalle-comensales')).toHaveTextContent('3');
    expect(d('detalle-minutos')).toHaveTextContent('45 min');
    expect(d('detalle-total')).toHaveTextContent('$612.00');
    // El total de la cuenta es el de SR, no una suma de partidas.
    expect(d('detalle-total-cuenta')).toHaveTextContent('$612.00');
    expect(within(dialogo).queryByTestId('detalle-sucursal')).not.toBeInTheDocument();

    const partidas = within(dialogo).getByRole('list', { name: 'Partidas' });
    const refresco = within(partidas).getByRole('listitem', { name: '3 × Refresco, $150.00' });
    expect(refresco).toHaveTextContent('3Refresco');
    expect(refresco).toHaveTextContent('Bebidas · $50.00 c/u');
    expect(refresco).toHaveTextContent('$150.00');
    // Sólo la mesa 5: la 12 no se cuela en el detalle.
    expect(dialogo).not.toHaveTextContent('Guacamole');
  });

  it('modificadores anidados: cada uno dentro de su padre, y los de $0.00 se ven', async () => {
    apiMesas(() => json(200, [centroCon([CON_DETALLE])]));
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    const { dialogo } = await abrir('Mesa 5');

    const paquete = within(dialogo).getByRole('listitem', {
      name: '1 × Paquete familiar, $462.00',
    });
    expect(paquete).toHaveTextContent('Paquetes · $450.00 c/u');
    expect(paquete).toHaveTextContent('$462.00');

    const bebida = within(paquete).getByRole('listitem', { name: 'Bebida: limonada, $0.00' });
    expect(bebida).toHaveTextContent('+ Bebida: limonada$0.00');
    // Segundo nivel: dentro de la bebida, no al lado.
    const sinHielo = within(bebida).getByRole('listitem', { name: 'Sin hielo, $0.00' });
    expect(sinHielo).toHaveTextContent('+ Sin hielo$0.00');
    const jarra = within(bebida).getByRole('listitem', { name: 'Jarra grande, $12.00' });
    expect(jarra).toHaveTextContent('$12.00');
    // Tercer nivel: dentro de la jarra, y no dentro de "Sin hielo".
    expect(within(jarra).getByRole('listitem', { name: 'Con chía, $0.00' })).toHaveTextContent(
      '+ Con chía$0.00',
    );
    expect(
      within(sinHielo).queryByRole('listitem', { name: 'Con chía, $0.00' }),
    ).not.toBeInTheDocument();
    // Cada nivel es una lista dentro del renglón de su padre.
    expect(sinHielo.parentElement?.closest('li')).toBe(bebida);
    expect(bebida.parentElement?.closest('li')).toBe(paquete);
  });

  it('lo que falta dice "Sin dato", nunca $0.00 ni 0', async () => {
    apiMesas(() =>
      json(200, [
        centroCon([
          mesa('8', 'mucho', 5, {
            mesero: null,
            folio: null,
            comensales: null,
            abiertoAt: null,
            partidas: [{ producto: 'Flan', cantidad: '1', precioUnit: '40.00' }],
          }),
        ]),
      ]),
    );
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    const { dialogo } = await abrir('Mesa 8');

    const d = (id: string) => within(dialogo).getByTestId(id);
    for (const id of [
      'detalle-mesero',
      'detalle-folio',
      'detalle-comensales',
      'detalle-minutos',
      'detalle-total',
      'detalle-total-cuenta',
    ]) {
      expect(d(id)).toHaveTextContent('Sin dato');
    }
    const flan = within(dialogo).getByRole('listitem', { name: '1 × Flan, Sin dato' });
    // Sin total de partida: no se calcula con cantidad × precio.
    expect(flan).toHaveTextContent('Categoría: sin dato · $40.00 c/u');
    expect(flan).toHaveTextContent(/c\/uSin dato$/);
    expect(dialogo).not.toHaveTextContent('$0.00');
    expect(dialogo).not.toHaveTextContent('$40.00$40.00');
  });

  it('con "Todas", el modal dice de qué sucursal es', async () => {
    apiMesas(() => json(200, [centroCon([CON_DETALLE]), tijuana(null)]));
    montar(`/mesas?empresa=${A}`);
    const { dialogo } = await abrir('Mesa 5 · Centro');
    expect(within(dialogo).getByTestId('detalle-sucursal')).toHaveTextContent('Centro');
  });

  it('abrir y cerrar (botón, Escape, fondo) no pide nada al API ni remonta el grid', async () => {
    const api = apiMesas(() => json(200, [centroCon([CON_DETALLE, mesa('12', '350.50', 15)])]));
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    await screen.findByTestId('kpi-mesas');
    const grid = screen.getByRole('list', { name: 'Mesas abiertas' });
    expect(pedidas(api)).toHaveLength(1);

    const usuarioEvt = userEvent.setup();
    const boton5 = screen.getByRole('button', { name: 'Ver consumo de Mesa 5' });

    // 1) Botón Cerrar.
    await usuarioEvt.click(boton5);
    const dialogo = screen.getByRole('dialog', { name: 'Mesa 5' });
    const cerrar = within(dialogo).getByRole('button', { name: 'Cerrar' });
    expect(cerrar).toHaveFocus();
    await usuarioEvt.click(cerrar);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(boton5).toHaveFocus();

    // 2) Escape.
    await usuarioEvt.click(screen.getByRole('button', { name: 'Ver consumo de Mesa 12' }));
    expect(screen.getByRole('dialog', { name: 'Mesa 12' })).toBeInTheDocument();
    await usuarioEvt.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ver consumo de Mesa 12' })).toHaveFocus();

    // 3) Clic en el fondo; un clic DENTRO del panel no cierra.
    await usuarioEvt.click(boton5);
    await usuarioEvt.click(screen.getByRole('dialog', { name: 'Mesa 5' }));
    expect(screen.getByRole('dialog', { name: 'Mesa 5' })).toBeInTheDocument();
    await usuarioEvt.click(screen.getByTestId('detalle-fondo'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Ni una consulta más (el reloj no avanzó: ninguna la pidió el polling), y el grid
    // es el MISMO nodo: no se desmontó.
    expect(pedidas(api)).toHaveLength(1);
    expect(screen.getByRole('list', { name: 'Mesas abiertas' })).toBe(grid);
  });

  it('el foco no sale del modal y el scroll de la página vuelve como estaba', async () => {
    apiMesas(() => json(200, [centroCon([CON_DETALLE])]));
    document.body.style.overflow = 'scroll';
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    const { usuarioEvt, dialogo } = await abrir('Mesa 5');
    expect(document.body.style.overflow).toBe('hidden');

    const cerrar = within(dialogo).getByRole('button', { name: 'Cerrar' });
    expect(cerrar).toHaveFocus();
    await usuarioEvt.tab();
    expect(cerrar).toHaveFocus();
    await usuarioEvt.tab({ shift: true });
    expect(cerrar).toHaveFocus();

    // Un clic sobre texto del modal no saca el foco a <body>: Tab vuelve a entrar y
    // Escape sigue cerrando.
    await usuarioEvt.click(within(dialogo).getByText('Paquete familiar'));
    expect(document.activeElement).not.toBe(document.body);
    await usuarioEvt.tab();
    expect(cerrar).toHaveFocus();
    // Shift+Tab desde el panel tampoco sale hacia las tarjetas de atrás.
    await usuarioEvt.click(within(dialogo).getByText('Paquete familiar'));
    await usuarioEvt.tab({ shift: true });
    expect(cerrar).toHaveFocus();
    await usuarioEvt.click(within(dialogo).getByText('Paquete familiar'));
    await usuarioEvt.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('scroll');

    await usuarioEvt.click(screen.getByRole('button', { name: 'Ver consumo de Mesa 5' }));
    await usuarioEvt.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Cerrar' }),
    );
    expect(document.body.style.overflow).toBe('scroll');
    document.body.style.overflow = '';
  });

  it('abierto, sigue al poll: partidas nuevas se ven; si la cuenta se va, lo dice', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    const conPostre = {
      ...CON_DETALLE,
      total: '702.00',
      partidas: [
        ...CON_DETALLE.partidas,
        {
          producto: 'Pastel',
          categoria: 'Postres',
          cantidad: '1',
          precioUnit: '90.00',
          total: '90.00',
        },
      ],
    };
    let respuesta = [centroCon([CON_DETALLE])];
    const api = apiMesas(() => json(200, respuesta));
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    const usuarioEvt = userEvent.setup();
    await screen.findByTestId('kpi-mesas');
    await usuarioEvt.click(screen.getByRole('button', { name: 'Ver consumo de Mesa 5' }));
    const dialogo = screen.getByRole('dialog', { name: 'Mesa 5' });
    expect(dialogo).not.toHaveTextContent('Pastel');

    // La siguiente lectura trae un postre (misma cuenta, mismo folio, otra posición).
    respuesta = [centroCon([mesa('1', '10.00', 5), conPostre])];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await waitFor(() => expect(pedidas(api)).toHaveLength(2));
    await waitFor(() => expect(dialogo).toHaveTextContent('Pastel'));
    expect(within(dialogo).getByTestId('detalle-total-cuenta')).toHaveTextContent('$702.00');

    // Luego la cuenta se cierra en el POS: el modal no se queda con la foto vieja.
    respuesta = [centroCon([mesa('1', '10.00', 5)])];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await waitFor(() =>
      expect(within(dialogo).getByRole('status')).toHaveTextContent(
        'Esta cuenta ya no aparece entre las abiertas en vivo',
      ),
    );
    expect(dialogo).not.toHaveTextContent('Pastel');
    expect(screen.getByRole('dialog', { name: 'Mesa 5' })).toBe(dialogo);
  });

  it('si la sucursal se desconecta con el modal abierto, el modal lo dice (no desaparece)', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'], shouldAdvanceTime: true });
    vi.setSystemTime(AHORA);
    let respuesta = [centroCon([CON_DETALLE])];
    apiMesas(() => json(200, respuesta));
    montar(`/mesas?empresa=${A}&sucursal=${SUCURSAL_A1.id}`);
    const usuarioEvt = userEvent.setup();
    await screen.findByTestId('kpi-mesas');
    const boton = screen.getByRole('button', { name: 'Ver consumo de Mesa 5' });
    await usuarioEvt.click(boton);

    respuesta = [centroCon([CON_DETALLE], 7200)];
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    await waitFor(() => expect(screen.getByTestId('banner-desconectada')).toBeInTheDocument());
    const dialogo = screen.getByRole('dialog', { name: 'Mesa 5' });
    expect(within(dialogo).getByRole('status')).toHaveTextContent('ya no aparece');
    expect(dialogo).not.toHaveTextContent('Paquete familiar');

    // La tarjeta ya no existe: el foco cae en el contenido de la vista, no en <body>.
    await usuarioEvt.click(within(dialogo).getByRole('button', { name: 'Cerrar' }));
    expect(boton).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toHaveAttribute('tabindex', '-1');
  });

  it('cambiar de sucursal descarta el modal', async () => {
    apiMesas((l: Llamada) =>
      l.query.get('sucursalId') === SUCURSAL_A2.id
        ? json(200, [tijuana(20)])
        : json(200, [centroCon([CON_DETALLE]), tijuana(20)]),
    );
    montar(`/mesas?empresa=${A}`);
    const { usuarioEvt } = await abrir('Mesa 5 · Centro');

    const selector = screen.getByLabelText('Sucursal');
    await waitFor(() => expect(selector).toBeEnabled());
    await usuarioEvt.selectOptions(selector, SUCURSAL_A2.id);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(await screen.findByRole('listitem', { name: 'Mesa 99' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Y al volver a "Todas" tampoco reaparece: la selección se descartó, no se escondió.
    await usuarioEvt.selectOptions(selector, '');
    expect(await screen.findByRole('listitem', { name: 'Mesa 5 · Centro' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
