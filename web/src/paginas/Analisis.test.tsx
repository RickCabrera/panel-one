import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  CeldaHoraDia,
  Resumen,
  VentaHoraDia,
  VentaMesero,
  VentaPorMesa,
  VentaPorProducto,
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
  SUCURSAL_A2,
  usuario,
  type Llamada,
  type Manejador,
} from '../test/apiFalsa';

// F2-221 contra el router y la app reales, con una API falsa COHERENTE: cada desglose suma lo
// mismo que el resumen de ese alcance (los números son los del e2e a mano de la API,
// `api/src/ventas/analisis.e2e.spec.ts`). Qué prueba y qué no: la vista no calcula ninguna cifra
// de venta; aquí se afirma que lo que pinta como Σ de cada bloque es lo mismo que Inicio pinta
// como "Venta total" para el mismo periodo y sucursal. Que el servidor devuelva desgloses que
// sumen la venta, calculados a mano sobre Postgres, lo prueban los e2e de la API.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-21T20:30:30Z');
// Tijuana en CDMX para que el "hoy" del panel no cambie al elegirla.
const A2 = { ...SUCURSAL_A2, zonaHoraria: 'America/Mexico_City' };
const AGOSTO = '2026-08-01|2026-08-31';
const JULIO = '2026-07-01|2026-07-31';
const RUTA = `/analisis?empresa=${A}&periodo=mes-anterior`;

function resumen(venta: string, cuentas: number): Resumen {
  return {
    venta,
    cuentas,
    ticketPromedio: cuentas === 0 ? null : '142.40',
    subtotal: venta,
    impuestos: '0.00',
    propina: '0.00',
    descuentos: { monto: '0.00', cuentas: 0 },
    cortesias: null,
    comensales: { total: 0, cuentasConDato: 0, promedioPorComensal: null },
    cancelados: { cuentas: 2 },
  };
}

function mesero(
  s: { id: string; nombre: string },
  nombre: string | null,
  venta: string,
  cuentas: number,
  cancelados = { cuentas: 0, monto: '0.00' },
): VentaMesero {
  return {
    sucursalId: s.id,
    sucursal: s.nombre,
    mesero: nombre,
    venta,
    cuentas,
    ticketPromedio: cuentas === 0 ? null : venta,
    comensales: 2,
    cuentasConComensales: 1,
    propina: '10.00',
    descuentos: { monto: '5.00', cuentas: 1 },
    cancelados,
    minutosPromedio: null,
    cuentasConDuracion: 0,
  };
}

const MESEROS: VentaMesero[] = [
  mesero(SUCURSAL_A1, 'Ana', '322.00', 2, { cuentas: 1, monto: '70.00' }),
  mesero(A2, 'Ana', '300.00', 1),
  mesero(SUCURSAL_A1, null, '50.00', 1),
  mesero(SUCURSAL_A1, 'Luis', '40.00', 1, { cuentas: 1, monto: '30.00' }),
];

const PRODUCTOS: VentaPorProducto = {
  venta: '712.00',
  cuentas: 5,
  productos: [
    { producto: 'Taco', importe: '530.00', cantidad: '9.000' },
    { producto: 'Agua', importe: '124.00', cantidad: '3.000' },
    { producto: 'Café', importe: '45.00', cantidad: '1.000' },
  ],
  diferenciaCuentas: '13.00',
};
const PRODUCTOS_JULIO: VentaPorProducto = {
  venta: '650.00',
  cuentas: 4,
  productos: [
    { producto: 'Taco', importe: '400.00', cantidad: '8.000' },
    { producto: 'Agua', importe: '200.00', cantidad: '4.000' },
    { producto: 'Torta', importe: '50.00', cantidad: '1.000' },
  ],
  diferenciaCuentas: '0.00',
};

function mapa(ventas: Partial<CeldaHoraDia>[], dias = [5, 4, 4, 4, 5, 5, 4]): VentaHoraDia {
  const celdas: CeldaHoraDia[] = [];
  for (let d = 1; d <= 7; d++) {
    for (let h = 0; h < 24; h++) {
      const c = ventas.find((x) => x.diaSemana === d && x.hora === h);
      celdas.push({ diaSemana: d, hora: h, venta: '0.00', cuentas: 0, ...c });
    }
  }
  return { celdas, diasEnRango: dias.map((n, i) => ({ diaSemana: i + 1, dias: n })) };
}

const MAPA = mapa([
  { diaSemana: 1, hora: 14, venta: '222.00', cuentas: 1 },
  { diaSemana: 1, hora: 21, venta: '100.00', cuentas: 1 },
  { diaSemana: 2, hora: 9, venta: '50.00', cuentas: 1 },
  { diaSemana: 2, hora: 11, venta: '40.00', cuentas: 1 },
  { diaSemana: 2, hora: 23, venta: '300.00', cuentas: 1 },
  { diaSemana: 3, hora: 12, venta: '0.00', cuentas: 2 },
]);

const MESAS: VentaPorMesa = {
  filas: [
    {
      sucursalId: SUCURSAL_A1.id,
      sucursal: 'Centro',
      mesa: '5',
      cuentas: 2,
      venta: '322.00',
      minutosPromedio: '75.0',
      cuentasConDuracion: 2,
    },
    {
      sucursalId: SUCURSAL_A1.id,
      sucursal: 'Centro',
      mesa: '7',
      cuentas: 1,
      venta: '40.00',
      minutosPromedio: null,
      cuentasConDuracion: 0,
    },
    {
      sucursalId: A2.id,
      sucursal: 'Tijuana',
      mesa: '5',
      cuentas: 1,
      venta: '300.00',
      minutosPromedio: '60.0',
      cuentasConDuracion: 1,
    },
  ],
  sinMesa: { cuentas: 1, venta: '50.00' },
  global: {
    venta: '712.00',
    cuentas: 5,
    minutosPromedio: '52.5',
    cuentasConDuracion: 4,
    duracionesInvalidas: 1,
    mesas: 3,
    cuentasConMesa: 4,
    rotacion: '1.33',
  },
};

const rango = (l: Llamada) => `${l.query.get('desde')}|${l.query.get('hasta')}`;
const deA2 = (l: Llamada) => l.query.get('sucursalId') === A2.id;

/** Por alcance: la empresa entera o sólo Tijuana (su fila de cada desglose). */
function datos(l: Llamada) {
  if (rango(l) !== AGOSTO && rango(l) !== JULIO) return null;
  if (rango(l) === JULIO) return { productos: PRODUCTOS_JULIO };
  if (!deA2(l)) {
    return {
      resumen: resumen('712.00', 5),
      meseros: MESEROS,
      productos: PRODUCTOS,
      mapa: MAPA,
      mesas: MESAS,
    };
  }
  return {
    resumen: resumen('300.00', 1),
    meseros: [mesero(A2, 'Ana', '300.00', 1)],
    productos: {
      venta: '300.00',
      cuentas: 1,
      productos: [{ producto: 'Taco', importe: '280.00', cantidad: '4.000' }],
      diferenciaCuentas: '20.00',
    },
    mapa: mapa([{ diaSemana: 2, hora: 23, venta: '300.00', cuentas: 1 }]),
    mesas: {
      filas: [MESAS.filas[2]],
      sinMesa: { cuentas: 0, venta: '0.00' },
      global: { ...MESAS.global, venta: '300.00', cuentas: 1, mesas: 1, cuentasConMesa: 1 },
    },
  };
}

const VACIOS = {
  resumen: resumen('0.00', 0),
  meseros: [] as VentaMesero[],
  productos: { venta: '0.00', cuentas: 0, productos: [], diferenciaCuentas: '0.00' },
  mapa: mapa([], [5, 4, 4, 4, 5, 5, 4]),
  mesas: {
    filas: [],
    sinMesa: { cuentas: 0, venta: '0.00' },
    global: {
      venta: '0.00',
      cuentas: 0,
      minutosPromedio: null,
      cuentasConDuracion: 0,
      duracionesInvalidas: 0,
      mesas: 0,
      cuentasConMesa: 0,
      rotacion: null,
    },
  },
};

function api(extra: Record<string, Manejador> = {}) {
  const u = usuario('admin_empresa');
  const de = (l: Llamada) => ({ ...VACIOS, ...datos(l) });
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, A2]),
    'GET /usuarios': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /ventas/resumen': (l) => json(200, de(l).resumen),
    'GET /ventas/por-hora': () =>
      json(
        200,
        Array.from({ length: 24 }, (_, hora) => ({ hora, venta: '0.00', cuentas: 0 })),
      ),
    'GET /ventas/formas-pago': () => json(200, { formas: [], sinCatalogo: [] }),
    'GET /ventas/por-mesero': (l) => json(200, de(l).meseros),
    'GET /ventas/por-producto': (l) => json(200, de(l).productos),
    'GET /ventas/hora-dia': (l) => json(200, de(l).mapa),
    'GET /ventas/por-mesa': (l) => json(200, de(l).mesas),
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
const bloque = (nombre: string) => screen.getByRole('region', { name: nombre });

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

describe('AC · cada desglose cuadra con la venta total del mismo periodo y sucursal', () => {
  it.each([
    ['la empresa', RUTA],
    ['una sucursal', `${RUTA}&sucursal=${A2.id}`],
  ])(
    '%s: Σ meseros, productos (+ diferencia) y mesas (+ sin mesa) = "Venta total" de Inicio',
    async (_caso, ruta) => {
      api();
      montar(ruta);
      await screen.findByTestId('cuadre-meseros');
      await screen.findByTestId('cuadre-productos');
      await screen.findByTestId('cuadre-mesas');
      const meseros = texto('cuadre-meseros').match(/\$[\d,]+\.\d{2}/)?.[0];
      const productos = texto('productos-venta');
      expect(texto('cuadre-productos')).toMatch(/^Σ del desglose = venta del periodo: /);
      expect(texto('cuadre-mesas')).toMatch(/^Σ del desglose = venta del periodo: /);
      const mesas = texto('cuadre-mesas').match(/\$[\d,]+\.\d{2}/)?.[0];
      cleanup();

      montar(ruta.replace('/analisis', '/'));
      await screen.findByTestId('venta-total');
      const inicio = texto('venta-total');
      expect([meseros, productos, mesas]).toEqual([inicio, inicio, inicio]);
    },
  );

  it('la sucursal elegida viaja en TODAS las consultas del análisis (y la base de productos)', async () => {
    const a = api();
    montar(`${RUTA}&sucursal=${A2.id}`);
    await screen.findByTestId('cuadre-mesas');
    await within(bloque('Por producto')).findByTestId('subieron');
    const analisis = a.llamadas.filter((l) =>
      [
        '/ventas/por-mesero',
        '/ventas/por-producto',
        '/ventas/hora-dia',
        '/ventas/por-mesa',
      ].includes(l.ruta),
    );
    expect(new Set(analisis.map((l) => l.ruta)).size).toBe(4);
    expect(analisis.every((l) => l.query.get('sucursalId') === A2.id)).toBe(true);
    expect(new Set(analisis.map(rango))).toEqual(new Set([AGOSTO, JULIO]));
    expect(screen.getAllByTestId('fila-mesero')).toHaveLength(1);
  });
});

describe('meseros', () => {
  it('cancelados fuera de la venta y visibles aparte; detalle al tocar la fila', async () => {
    const user = userEvent.setup();
    api();
    montar(RUTA);
    await screen.findByTestId('tabla-meseros');
    expect(texto('cancelados-meseros')).toBe(
      'Cancelaciones del periodo (fuera de la venta): 2 cuentas por $100.00.',
    );
    const filas = screen.getAllByTestId('fila-mesero');
    // Dos "Ana" en sucursales distintas: se distinguen por la columna Sucursal.
    expect(filas.map((f) => within(f).getAllByRole('cell')[2].textContent)).toEqual([
      'Centro',
      'Tijuana',
      'Centro',
      'Centro',
    ]);
    expect(within(filas[2]).getByText('Sin mesero')).toBeInTheDocument();
    await user.click(filas[0]);
    expect(texto('detalle-mesero')).toContain('1 cuentas por $70.00');
    expect(texto('detalle-mesero')).toContain('$10.00 (3.1 % de su venta)');
    expect(texto('nota-cortesias')).toContain('Cortesías');
  });

  it('ordenar por cancelaciones cambia el ranking', async () => {
    const user = userEvent.setup();
    api();
    montar(RUTA);
    await screen.findByTestId('tabla-meseros');
    await user.selectOptions(
      within(bloque('Por mesero')).getByRole('combobox', { name: 'Ordenar por' }),
      'cancelados',
    );
    const primeros = screen
      .getAllByTestId('fila-mesero')
      .slice(0, 2)
      .map((f) => within(f).getAllByRole('cell')[1].textContent);
    expect(primeros).toEqual(['Ana', 'Luis']);
  });
});

describe('productos', () => {
  it('participación sobre Σ partidas, renglón de diferencia y Δ contra el periodo comparable', async () => {
    api();
    montar(RUTA);
    const tabla = await screen.findByTestId('tabla-productos');
    const primera = within(tabla).getAllByTestId('fila-producto')[0];
    expect(
      within(primera)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Taco', '$530.00', '9.000', '75.8 %']);
    expect(texto('fila-diferencia')).toContain('$13.00');
    const subieron = await within(bloque('Por producto')).findByTestId('subieron');
    expect(subieron).toHaveTextContent('Taco');
    expect(subieron).toHaveTextContent('+$130.00 (+32.5 %)');
    expect(subieron).toHaveTextContent('Café');
    expect(subieron).toHaveTextContent('nuevo');
    const cayeron = screen.getByTestId('cayeron');
    expect(cayeron).toHaveTextContent('Agua');
    expect(cayeron).toHaveTextContent('Torta');
    expect(cayeron).toHaveTextContent('dejó de venderse');
  });

  it('con 600 productos pagina de 50 en 50 y el CSV lleva los 600', async () => {
    const user = userEvent.setup();
    const muchos: VentaPorProducto = {
      venta: '180300.00',
      cuentas: 900,
      productos: Array.from({ length: 600 }, (_, i) => ({
        producto: `Producto ${String(i).padStart(3, '0')}`,
        importe: `${600 - i}.00`,
        cantidad: '1.000',
      })),
      diferenciaCuentas: '0.00',
    };
    const blobs: Blob[] = [];
    const nombres: string[] = [];
    const originales = { crear: URL.createObjectURL, revocar: URL.revokeObjectURL };
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
    try {
      api({
        'GET /ventas/por-producto': (l) =>
          json(200, rango(l) === AGOSTO ? muchos : PRODUCTOS_JULIO),
      });
      montar(RUTA);
      const tabla = await screen.findByTestId('tabla-productos');
      expect(within(tabla).getAllByTestId('fila-producto')).toHaveLength(50);
      expect(texto('pagina-productos')).toBe('Página 1 de 12 · 600 filas');
      const paginas = screen.getByRole('navigation', { name: 'Páginas de productos' });
      await user.click(within(paginas).getByRole('button', { name: 'Siguiente' }));
      expect(texto('pagina-productos')).toBe('Página 2 de 12 · 600 filas');
      expect(within(tabla).getAllByTestId('fila-producto')[0]).toHaveTextContent('Producto 050');
      expect(within(tabla).getAllByTestId('fila-producto')).toHaveLength(50);

      await user.click(screen.getByTestId('csv-productos'));
      expect(nombres).toEqual(['analisis-productos_2026-08-01_2026-08-31.csv']);
      const contenido = new TextDecoder().decode(new Uint8Array(await blobs[0].arrayBuffer()));
      // Encabezado + 600 productos + diferencia + fin de línea final.
      expect(contenido.slice(1).split('\r\n')).toHaveLength(603);
    } finally {
      URL.createObjectURL = originales.crear;
      URL.revokeObjectURL = originales.revocar;
    }
  });
});

describe('mapa de calor', () => {
  it('distingue sin ventas, cero pesos y venta; el día de la cuenta es el local', async () => {
    api();
    montar(RUTA);
    await screen.findByTestId('mapa-calor');
    const celda = (id: string) => screen.getByTestId(id);
    expect(celda('celda-lunes-14')).toHaveAttribute('data-tipo', 'venta');
    expect(celda('celda-lunes-14')).toHaveAccessibleName('lunes 14:00: $222.00 en 1 cuentas');
    expect(celda('celda-lunes-0')).toHaveAttribute('data-tipo', 'sinVentas');
    expect(celda('celda-lunes-0')).toHaveAccessibleName('lunes 0:00: sin ventas');
    expect(celda('celda-lunes-0')).toHaveTextContent('');
    expect(celda('celda-miércoles-12')).toHaveAttribute('data-tipo', 'ceroPesos');
    expect(celda('celda-miércoles-12')).toHaveTextContent('0');
  });

  it('un día de la semana que no cae en el periodo se dice, no se pinta como "sin ventas"', async () => {
    api({
      'GET /ventas/hora-dia': () =>
        json(
          200,
          mapa([{ diaSemana: 1, hora: 14, venta: '10.00', cuentas: 1 }], [1, 0, 0, 0, 0, 0, 0]),
        ),
    });
    montar(`/analisis?empresa=${A}&periodo=rango&desde=2026-09-14&hasta=2026-09-14`);
    await screen.findByTestId('mapa-calor');
    expect(screen.getByTestId('celda-martes-14')).toHaveAttribute('data-tipo', 'fueraDePeriodo');
    expect(screen.getByTestId('celda-martes-14')).toHaveTextContent('—');
    expect(screen.getByTestId('celda-lunes-13')).toHaveAttribute('data-tipo', 'sinVentas');
  });
});

describe('mesas', () => {
  it('duración promedio, rotación, sin mesa aparte y duraciones inválidas avisadas', async () => {
    api();
    montar(RUTA);
    await screen.findByTestId('tabla-mesas');
    expect(texto('minutos-promedio')).toBe('52.5 min');
    expect(texto('rotacion')).toBe('1.33');
    expect(texto('sin-mesa')).toContain('1 cuentas por $50.00');
    expect(texto('duraciones-invalidas')).toContain('1 cuentas');
    // Por cuentas: la 5 de Centro (2) primero.
    const primera = screen.getAllByTestId('fila-mesa')[0];
    expect(
      within(primera)
        .getAllByRole('cell')
        .map((c) => c.textContent),
    ).toEqual(['Centro', '5', '2', '$322.00', '75.0']);
  });
});

describe('estados vacíos y errores', () => {
  it('sin ventas: cada bloque dice por qué está vacío, sin $0.00; área y canal explican su pendiente', async () => {
    api({
      'GET /ventas/por-mesero': () => json(200, VACIOS.meseros),
      'GET /ventas/por-producto': () => json(200, VACIOS.productos),
      'GET /ventas/hora-dia': () => json(200, VACIOS.mapa),
      'GET /ventas/por-mesa': () => json(200, VACIOS.mesas),
    });
    montar(RUTA);
    for (const id of ['meseros-vacio', 'productos-vacio', 'mapa-vacio', 'mesas-vacio']) {
      expect(await screen.findByTestId(id)).toHaveTextContent('Sin ventas en el periodo');
    }
    expect(texto('area-pendiente')).toContain('F2-233');
    for (const nombre of [
      'Por mesero',
      'Por producto',
      'Por hora y día de la semana',
      'Por área y canal',
      'Por tiempo de mesa',
    ]) {
      expect(bloque(nombre)).not.toHaveTextContent('$0.00');
    }
    expect(screen.queryByTestId('csv-productos')).toBeNull();
  });

  it('un bloque que falla muestra su error y los demás siguen', async () => {
    api({ 'GET /ventas/por-mesero': () => json(500, { statusCode: 500, message: 'Falla' }) });
    montar(RUTA);
    const meseros = await screen.findByRole('region', { name: 'Por mesero' }, { timeout: 5000 });
    expect(await within(meseros).findByRole('alert')).toHaveTextContent(
      'No se pudo cargar este dato.',
    );
    expect(await screen.findByTestId('tabla-productos')).toBeInTheDocument();
    expect(await screen.findByTestId('mapa-calor')).toBeInTheDocument();
  });

  it('al cambiar de sucursal nunca se ven las filas del alcance anterior', async () => {
    const user = userEvent.setup();
    let soltar: () => void = () => {};
    const pausa = new Promise<void>((r) => {
      soltar = r;
    });
    api({
      'GET /ventas/por-mesero': async (l) => {
        if (deA2(l)) await pausa;
        return json(200, deA2(l) ? [mesero(A2, 'Ana', '300.00', 1)] : MESEROS);
      },
    });
    montar(RUTA);
    await screen.findByTestId('tabla-meseros');
    expect(screen.getAllByTestId('fila-mesero')).toHaveLength(4);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Sucursal' }), A2.id);
    await waitFor(() => expect(screen.queryByTestId('tabla-meseros')).toBeNull());
    expect(within(bloque('Por mesero')).getByTestId('esqueleto')).toBeInTheDocument();
    soltar();
    await screen.findByTestId('tabla-meseros');
    expect(screen.getAllByTestId('fila-mesero')).toHaveLength(1);
  });

  it('un rango invertido no consulta nada', async () => {
    const a = api();
    montar(`/analisis?empresa=${A}&periodo=rango&desde=2026-09-10&hasta=2026-09-01`);
    await screen.findByText('Corrige el rango de fechas de la cabecera para ver el análisis.');
    expect(a.llamadas.some((l) => l.ruta.startsWith('/ventas/'))).toBe(false);
  });
});
