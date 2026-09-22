import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FilaMapeoArea, MapeoAreas, Resumen, UsuarioActual, VentaPorArea } from '../api/tipos';
import { Proveedores, Rutas } from '../App';
import { terminarSesion } from '../auth/sesion';
import { crearQueryClient } from '../consultas/queryClient';
import { aCentavos } from '../dinero/dinero';
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

// F2-233 en el web, contra el router y la app reales: la vista Áreas y canales (`/areas`) y su
// editor del mapeo área → canal. Cifras escritas a mano y coherentes con el resumen de Inicio:
// Comedor 322.00 (2) + Mostrador 20.00 (1) + Barra sin canal 40.00 (1) + sin área 50.00 (1)
// = 432.00 en 5 cuentas. Que el servidor devuelva cifras que cuadren lo prueban los e2e del api.

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-21T20:30:30Z');
// Tijuana en CDMX para que el "hoy" del panel no cambie al elegirla.
const A2 = { ...SUCURSAL_A2, zonaHoraria: 'America/Mexico_City' };
const RUTA = `/areas?empresa=${A}&periodo=mes-anterior`;

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

function areaMapeo(id: string, nombre: string, canal: FilaMapeoArea['canal']): FilaMapeoArea {
  return {
    id,
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    origenSrId: id.toUpperCase(),
    clave: null,
    nombre,
    activo: true,
    activoPos: null,
    canal,
    canalActualizadoAt: canal === null ? null : '2026-09-01T10:00:00.000Z',
  };
}

/** Estado del "servidor": el canal de cada área del mapeo. Un PUT lo cambia. */
let canales: Record<string, FilaMapeoArea['canal']>;

function mapeo(): MapeoAreas {
  return {
    sucursales: [
      { sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', ultimaCompletaAt: '2026-09-01T10:00:00.000Z' },
      { sucursalId: A2.id, sucursal: 'Tijuana', ultimaCompletaAt: null },
    ],
    areas: [
      areaMapeo('a01', 'Comedor', canales.a01),
      areaMapeo('a03', 'Barra', canales.a03),
      areaMapeo('a04', 'Mostrador', canales.a04),
    ],
    truncado: false,
  };
}

function fila(origen: string, nombre: string, venta: string, cuentas: number) {
  return {
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    areaOrigenSrId: origen.toUpperCase(),
    areaId: origen,
    clave: null,
    nombre,
    cruce: 'catalogo' as const,
    activo: true,
    canal: canales[origen],
    venta,
    cuentas,
  };
}

/** La venta por área con el mapeo de ESE momento (el API lo aplica al leer). */
function porArea(): VentaPorArea {
  const areas = [
    fila('a01', 'Comedor', '322.00', 2),
    fila('a03', 'Barra', '40.00', 1),
    fila('a04', 'Mostrador', '20.00', 1),
  ];
  // En centavos exactos (bigint), como el resto del panel: nunca dinero en `number`.
  const suma = (xs: typeof areas) => {
    const c = xs.reduce((s, a) => s + aCentavos(a.venta)!, 0n);
    return {
      venta: `${c / 100n}.${(c % 100n).toString().padStart(2, '0')}`,
      cuentas: xs.reduce((n, a) => n + a.cuentas, 0),
    };
  };
  const orden = ['comedor', 'mostrador', 'domicilio', 'plataformas'] as const;
  return {
    venta: '432.00',
    cuentas: 5,
    areas,
    sinArea: { venta: '50.00', cuentas: 1 },
    canales: orden
      .filter((c) => areas.some((a) => a.canal === c))
      .map((c) => ({ canal: c, ...suma(areas.filter((a) => a.canal === c)) })),
    sinCanal: suma(areas.filter((a) => a.canal === null)),
    catalogo: [
      { sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', sincronizado: true },
      { sucursalId: A2.id, sucursal: 'Tijuana', sincronizado: false },
    ],
  };
}

function api(u: UsuarioActual, extra: Record<string, Manejador> = {}) {
  const put: Manejador = (l: Llamada) => {
    const id = l.ruta.split('/')[3];
    canales[id] = (l.cuerpo as { canal: FilaMapeoArea['canal'] }).canal;
    return json(200, mapeo().areas.find((a) => a.id === id));
  };
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
    'GET /ventas/por-area': () => json(200, porArea()),
    'GET /catalogos/areas/mapeo': () => json(200, mapeo()),
    'PUT /catalogos/areas/a01/canal': put,
    'PUT /catalogos/areas/a03/canal': put,
    'PUT /catalogos/areas/a04/canal': put,
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

const filaCanal = (llave: string) =>
  within(screen.getByTestId('tabla-canales'))
    .getAllByRole('row')
    .find((r) => r.getAttribute('data-canal') === llave);

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(AHORA);
  canales = { a01: 'comedor', a03: null, a04: 'mostrador' };
});

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Áreas y canales (F2-233)', () => {
  it('AC: la Σ por canal (+ sin canal + sin clasificar) es la "Venta total" de Inicio', async () => {
    api(usuario('admin_empresa'));
    montar(RUTA);
    const cuadre = await screen.findByTestId('cuadre-areas', undefined, { timeout: 5000 });
    expect(cuadre).toHaveTextContent(/^Σ del desglose = venta del periodo: /);
    const areas = cuadre.textContent?.match(/\$[\d,]+\.\d{2}/)?.[0];
    // Los dos renglones aparte, con su importe exacto: nada repartido a ojo.
    expect(filaCanal('sin-area')).toHaveTextContent('Sin clasificar (la cuenta no trae área)$50.00');
    expect(filaCanal('sin-canal')).toHaveTextContent('Área sin canal asignado$40.00');
    expect(filaCanal('comedor')).toHaveTextContent('Comedor$322.00274.5 %');
    cleanup();

    montar(`/?empresa=${A}&periodo=mes-anterior`);
    expect(await screen.findByTestId('venta-total')).toHaveTextContent(areas!);
  });

  it('la sucursal elegida viaja en la venta y en el mapeo', async () => {
    const a = api(usuario('admin_empresa'));
    montar(`${RUTA}&sucursal=${A2.id}`);
    await screen.findByTestId('cuadre-areas', undefined, { timeout: 5000 });
    await screen.findByTestId('mapeo-areas');
    const llamadas = a.llamadas.filter((l) =>
      ['/ventas/por-area', '/catalogos/areas/mapeo'].includes(l.ruta),
    );
    expect(new Set(llamadas.map((l) => l.ruta)).size).toBe(2);
    expect(llamadas.every((l) => l.query.get('sucursalId') === A2.id)).toBe(true);
    expect(llamadas.every((l) => l.query.get('empresaId') === A)).toBe(true);
  });

  it('el admin asigna un canal: manda el PUT y la venta se recalcula sin recargar', async () => {
    const user = userEvent.setup();
    const a = api(usuario('admin_empresa'));
    montar(RUTA);
    await screen.findByTestId('cuadre-areas', undefined, { timeout: 5000 });
    const antes = a.contar('GET', '/ventas/por-area');
    await user.selectOptions(await screen.findByLabelText('Canal de Barra'), 'mostrador');
    expect(a.llamadas.find((l) => l.metodo === 'PUT')).toMatchObject({
      ruta: '/catalogos/areas/a03/canal',
      cuerpo: { empresaId: A, canal: 'mostrador' },
    });
    // Barra (40.00) pasa de "sin canal" a Mostrador (20.00 + 40.00).
    expect(await screen.findByText('$60.00')).toBeInTheDocument();
    expect(filaCanal('sin-canal')).toBeUndefined();
    expect(a.contar('GET', '/ventas/por-area')).toBeGreaterThan(antes);
    expect(screen.getByTestId('cuadre-areas')).toHaveTextContent(/^Σ del desglose = venta/);
  });

  it('"Sin asignar" quita el canal: el PUT lleva canal null y la venta vuelve a "sin canal"', async () => {
    const user = userEvent.setup();
    const a = api(usuario('admin_global'));
    montar(RUTA);
    await screen.findByTestId('cuadre-areas', undefined, { timeout: 5000 });
    await user.selectOptions(await screen.findByLabelText('Canal de Mostrador'), '');
    expect(a.llamadas.find((l) => l.metodo === 'PUT')?.cuerpo).toEqual({ empresaId: A, canal: null });
    expect(await screen.findByText('$60.00')).toBeInTheDocument();
    expect(filaCanal('mostrador')).toBeUndefined();
  });

  it('si el PUT falla se dice, y el canal no cambia', async () => {
    const user = userEvent.setup();
    api(usuario('admin_empresa'), {
      'PUT /catalogos/areas/a03/canal': () => json(404, { statusCode: 404, message: 'No existe' }),
    });
    montar(RUTA);
    await screen.findByTestId('cuadre-areas', undefined, { timeout: 5000 });
    await user.selectOptions(await screen.findByLabelText('Canal de Barra'), 'domicilio');
    expect(await screen.findByRole('alert')).toHaveTextContent('No se guardó el canal de Barra.');
    expect(filaCanal('sin-canal')).toHaveTextContent('$40.00');
  });

  it('el visor ve el canal de cada área pero no lo puede cambiar', async () => {
    const a = api(usuario('visor'));
    montar(RUTA);
    const m = await screen.findByTestId('mapeo-areas', undefined, { timeout: 5000 });
    expect(within(m).queryByRole('combobox')).toBeNull();
    expect(m).toHaveTextContent('Sólo un administrador puede cambiar el canal de un área.');
    const barra = m.querySelector('[data-area="A03"]')!;
    expect(barra).toHaveTextContent('Sin asignar');
    expect(a.llamadas.some((l) => l.metodo === 'PUT')).toBe(false);
  });

  it('estados vacíos: sucursal sin catálogo, estaciones y periodo sin ventas, sin $0.00', async () => {
    api(usuario('admin_empresa'), {
      'GET /ventas/por-area': () =>
        json(200, {
          venta: '0.00',
          cuentas: 0,
          areas: [],
          sinArea: { venta: '0.00', cuentas: 0 },
          canales: [],
          sinCanal: { venta: '0.00', cuentas: 0 },
          catalogo: [{ sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', sincronizado: true }],
        } satisfies VentaPorArea),
    });
    montar(RUTA);
    expect(await screen.findByTestId('areas-vacio', undefined, { timeout: 5000 })).toHaveTextContent(
      'No hubo cuentas cerradas en el periodo',
    );
    expect(screen.queryByTestId('tabla-canales')).toBeNull();
    expect(screen.queryByTestId('areas-csv')).toBeNull();
    expect(screen.getByRole('region', { name: 'Venta del periodo por canal y por área' })).not.toHaveTextContent('$0.00');
    // Tijuana nunca mandó su catálogo de áreas: se dice, sin tabla vacía.
    expect(await screen.findByTestId('mapeo-sin-catalogo')).toHaveTextContent(
      'Esta sucursal todavía no manda su catálogo de áreas',
    );
    expect(screen.getByTestId('estaciones-pendiente')).toHaveTextContent(
      'el panel todavía no recibe las estaciones del POS',
    );
  });

  it('todas las cuentas sin área: lo dice y muestra la venta entera como "sin clasificar"', async () => {
    api(usuario('admin_empresa'), {
      'GET /ventas/por-area': () =>
        json(200, {
          venta: '432.00',
          cuentas: 5,
          areas: [],
          sinArea: { venta: '432.00', cuentas: 5 },
          canales: [],
          sinCanal: { venta: '0.00', cuentas: 0 },
          catalogo: [{ sucursalId: SUCURSAL_A1.id, sucursal: 'Centro', sincronizado: true }],
        } satisfies VentaPorArea),
    });
    montar(RUTA);
    expect(await screen.findByTestId('areas-vacio', undefined, { timeout: 5000 })).toHaveTextContent(
      'Ninguna cuenta del periodo trae el área',
    );
    expect(filaCanal('sin-area')).toHaveTextContent('$432.00');
    expect(screen.getByTestId('cuadre-areas')).toHaveTextContent(/^Σ del desglose = venta/);
  });

  it('una sucursal sin catálogo sincronizado se avisa junto a la venta', async () => {
    api(usuario('admin_empresa'));
    montar(RUTA);
    expect(await screen.findByTestId('areas-sin-catalogo', undefined, { timeout: 5000 })).toHaveTextContent(
      'Tijuana: el agente todavía no ha mandado su catálogo de áreas',
    );
  });
});
