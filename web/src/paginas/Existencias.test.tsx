import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { Existencias, FilaExistencia, Resumen, UsuarioActual } from '../api/tipos';
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

// F2-121 en el web, contra el router y la app reales: la vista Existencias (`/existencias`).
// Cifras escritas a mano (que el servidor las calcule bien lo prueban los e2e del api).

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-22T18:00:00Z');
const RUTA = `/existencias?empresa=${A}`;

const resumen: Resumen = {
  venta: '0.00',
  cuentas: 0,
  ticketPromedio: null,
  subtotal: '0.00',
  impuestos: '0.00',
  propina: '0.00',
  descuentos: { monto: '0.00', cuentas: 0 },
  cortesias: null,
  comensales: { total: 0, cuentasConDato: 0, promedioPorComensal: null },
  cancelados: { cuentas: 0 },
};

function fila(
  p: Partial<FilaExistencia> & Pick<FilaExistencia, 'insumoOrigenSrId'>,
): FilaExistencia {
  return {
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    almacenOrigenSrId: 'A1-GEN',
    almacen: 'Almacén general',
    insumo: null,
    clave: null,
    unidad: 'kg',
    cantidad: '1.000',
    costoPromedio: '10.00',
    valor: '10.00',
    minimo: null,
    maximo: null,
    estado: 'sin_limites',
    ...p,
  };
}

const FILAS: FilaExistencia[] = [
  fila({
    insumoOrigenSrId: 'I040',
    insumo: 'Tomate',
    cantidad: '2.500',
    costoPromedio: '30.00',
    valor: '75.00',
    minimo: '6.000',
    maximo: '20.000',
    estado: 'bajo_minimo',
  }),
  fila({
    insumoOrigenSrId: 'I027',
    insumo: 'Queso',
    cantidad: '0.000',
    costoPromedio: '120.00',
    valor: '0.00',
    estado: 'sin_existencia',
  }),
  fila({ insumoOrigenSrId: 'I001', insumo: 'Arroz', cantidad: '10.000', valor: '100.00' }),
  fila({
    insumoOrigenSrId: 'I099',
    cantidad: null,
    costoPromedio: null,
    valor: null,
    minimo: '1.000',
    estado: 'sin_lectura',
  }),
];

function existencias(p: Partial<Existencias> = {}): Existencias {
  return {
    kpis: {
      articulos: 3,
      valor: '175.00',
      atencion: 1,
      sinExistencia: 1,
      sobreMaximo: 0,
      sinLectura: 1,
    },
    filas: FILAS,
    almacenes: [
      {
        sucursalId: SUCURSAL_A1.id,
        almacenOrigenSrId: 'A1-GEN',
        almacen: 'Almacén general',
        // 15:30 UTC = 09:30 en CDMX.
        capturadoAt: '2026-09-22T15:30:00.000Z',
        recibidaAt: '2026-09-22T15:31:00.000Z',
        atrasada: true,
      },
    ],
    sucursales: [
      {
        sucursalId: SUCURSAL_A1.id,
        sucursal: 'Centro',
        zonaHoraria: 'America/Mexico_City',
        almacenesLeidos: 1,
      },
      {
        sucursalId: SUCURSAL_A2.id,
        sucursal: 'Tijuana',
        zonaHoraria: 'America/Tijuana',
        almacenesLeidos: 0,
      },
    ],
    ...p,
  };
}

function api(u: UsuarioActual, datos: () => Existencias = () => existencias()) {
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /usuarios': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /mesas/abiertas': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /ventas/resumen': () => json(200, resumen),
    'GET /ventas/por-hora': () =>
      json(
        200,
        Array.from({ length: 24 }, (_, hora) => ({ hora, venta: '0.00', cuentas: 0 })),
      ),
    'GET /inventario/existencias': () => json(200, datos()),
    'PUT /inventario/existencias/limites': ((l: Llamada) =>
      json(200, { ...FILAS[2], ...(l.cuerpo as object) })) as Manejador,
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

const filas = () =>
  screen
    .getAllByRole('row')
    .filter((r) => r.getAttribute('data-insumo') !== null)
    .map((r) => r.getAttribute('data-insumo'));

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

describe('Existencias (F2-121)', () => {
  it('KPIs con el valor en pesos y el semáforo con palabras (no sólo color)', async () => {
    api(usuario('visor'));
    montar(RUTA);
    expect(await screen.findByTestId('kpi-valor', undefined, { timeout: 5000 })).toHaveTextContent(
      '$175.00',
    );
    expect(screen.getByTestId('kpi-todos')).toHaveTextContent('3');
    expect(screen.getByTestId('kpi-bajo_minimo')).toHaveTextContent('1');
    expect(screen.getByTestId('kpi-sin_existencia')).toHaveTextContent('1');
    const tomate = screen
      .getAllByRole('row')
      .find((r) => r.getAttribute('data-insumo') === 'I040')!;
    expect(tomate).toHaveTextContent('Tomate');
    expect(tomate).toHaveTextContent('Bajo mínimo');
    expect(tomate).toHaveTextContent('2.5');
    expect(tomate).toHaveTextContent('6 / 20');
    expect(tomate).toHaveTextContent('$75.00');
  });

  it('AC: "Atención requerida" filtra la tabla a los artículos bajo mínimo', async () => {
    const user = userEvent.setup();
    api(usuario('visor'));
    montar(RUTA);
    await screen.findByTestId('kpi-valor', undefined, { timeout: 5000 });
    expect(filas()).toEqual(['I040', 'I027', 'I001', 'I099']);
    await user.click(screen.getByRole('button', { name: /Atención requerida/ }));
    expect(filas()).toEqual(['I040']);
    await user.click(screen.getByRole('button', { name: /Atención requerida/ }));
    expect(filas()).toHaveLength(4);
  });

  it('un artículo sin lectura se muestra (no se oculta ni se inventa un 0)', async () => {
    api(usuario('visor'));
    montar(RUTA);
    await screen.findByTestId('kpi-valor', undefined, { timeout: 5000 });
    const sin = screen.getAllByRole('row').find((r) => r.getAttribute('data-insumo') === 'I099')!;
    expect(sin).toHaveTextContent('Insumo I099 (sin catálogo)');
    expect(sin).toHaveTextContent('Sin lectura del artículo');
    expect(sin).not.toHaveTextContent('$0.00');
    expect(screen.getByRole('button', { name: /ya no viene en la lectura/ })).toBeInTheDocument();
  });

  it('la hora de la lectura va en la zona de la SUCURSAL; la atrasada y la sucursal sin lectura se avisan', async () => {
    api(usuario('visor'));
    montar(RUTA);
    const lecturas = await screen.findByTestId('existencias-lecturas', undefined, {
      timeout: 5000,
    });
    // 15:30 UTC → 09:30 en CDMX (nunca la hora del navegador ni UTC).
    expect(lecturas).toHaveTextContent('Almacén general 22/09/2026 09:30');
    expect(lecturas).toHaveTextContent('recibida 22/09/2026 09:31');
    expect(lecturas).toHaveTextContent('Lectura atrasada');
    expect(lecturas).toHaveTextContent('Sin lectura de existencias todavía: Tijuana');
  });

  it('sin ninguna lectura dice por qué y qué falta, sin pintar $0.00', async () => {
    api(usuario('visor'), () =>
      existencias({
        kpis: {
          articulos: 0,
          valor: '0.00',
          atencion: 0,
          sinExistencia: 0,
          sobreMaximo: 0,
          sinLectura: 0,
        },
        filas: [],
        almacenes: [],
        sucursales: [
          {
            sucursalId: SUCURSAL_A1.id,
            sucursal: 'Centro',
            zonaHoraria: 'America/Mexico_City',
            almacenesLeidos: 0,
          },
        ],
      }),
    );
    montar(RUTA);
    const vacio = await screen.findByTestId('existencias-vacio', undefined, { timeout: 5000 });
    expect(vacio).toHaveTextContent('Centro todavía no ha mandado existencias');
    expect(vacio).toHaveTextContent('F2-241');
    expect(screen.queryByText('$0.00')).not.toBeInTheDocument();
    expect(screen.queryByTestId('existencias-kpis')).not.toBeInTheDocument();
  });

  it('el visor no edita límites', async () => {
    api(usuario('visor'));
    montar(RUTA);
    await screen.findByTestId('kpi-valor', undefined, { timeout: 5000 });
    expect(screen.queryByRole('button', { name: /Mínimo y máximo de/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Sólo un administrador puede cambiar/)).toBeInTheDocument();
  });

  it('el admin guarda mínimo y máximo: manda el PUT con la llave del artículo y relee', async () => {
    const user = userEvent.setup();
    const a = api(usuario('admin_empresa'));
    montar(RUTA);
    await screen.findByTestId('kpi-valor', undefined, { timeout: 5000 });
    const antes = a.contar('GET', '/inventario/existencias');
    await user.click(screen.getByRole('button', { name: 'Mínimo y máximo de Arroz' }));
    const form = screen.getByRole('button', { name: 'Guardar' }).closest('form')!;
    await user.type(within(form).getByLabelText('Mínimo (kg)'), '2.5');
    await user.type(within(form).getByLabelText('Máximo (kg)'), '12');
    await user.click(within(form).getByRole('button', { name: 'Guardar' }));
    expect(a.llamadas.find((l) => l.metodo === 'PUT')).toMatchObject({
      ruta: '/inventario/existencias/limites',
      cuerpo: {
        empresaId: A,
        sucursalId: SUCURSAL_A1.id,
        almacenOrigenSrId: 'A1-GEN',
        insumoOrigenSrId: 'I001',
        minimo: '2.5',
        maximo: '12',
      },
    });
    await vi.waitFor(() =>
      expect(a.contar('GET', '/inventario/existencias')).toBeGreaterThan(antes),
    );
    expect(screen.queryByRole('button', { name: 'Guardar' })).not.toBeInTheDocument();
  });

  it('elegir un almacén acota la consulta a su sucursal', async () => {
    const user = userEvent.setup();
    const a = api(usuario('visor'));
    montar(RUTA);
    await screen.findByTestId('kpi-valor', undefined, { timeout: 5000 });
    await user.selectOptions(screen.getByLabelText('Almacén'), 'Almacén general · Centro');
    await vi.waitFor(() => {
      const ultima = a.llamadas.filter((l) => l.ruta === '/inventario/existencias').at(-1)!;
      expect(ultima.query.get('almacenOrigenSrId')).toBe('A1-GEN');
      expect(ultima.query.get('sucursalId')).toBe(SUCURSAL_A1.id);
    });
  });
});
