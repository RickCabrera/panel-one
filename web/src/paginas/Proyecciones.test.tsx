import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { FilaProyeccion, Proyecciones, UsuarioActual } from '../api/tipos';
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
} from '../test/apiFalsa';

// F2-127 en el web, contra el router y la app reales: la vista Proyecciones (`/proyecciones`).
// Cifras escritas a mano (que el servidor las calcule bien lo prueban los e2e del api).

const A = EMPRESA_A.id;
const AHORA = new Date('2026-09-16T18:00:00Z');
const RUTA = `/proyecciones?empresa=${A}`;

function fila(p: Partial<FilaProyeccion> & Pick<FilaProyeccion, 'insumoOrigenSrId'>) {
  return {
    sucursalId: SUCURSAL_A1.id,
    sucursal: 'Centro',
    almacenOrigenSrId: 'ALM1',
    almacen: 'General',
    insumo: 'Carne al pastor',
    clave: 'C-01',
    unidad: 'Kilogramo',
    estado: 'calculada',
    diasHistorial: 46,
    semanas: ['18.500', '20.000', '30.000', '40.000'],
    proyeccion: '23.400',
    existencia: '10.000',
    minimo: '5.000',
    sugerido: '18.400',
    avisos: [],
    ...p,
  } satisfies FilaProyeccion;
}

function datos(p: Partial<Proyecciones> = {}): Proyecciones {
  return {
    horizonte: 7,
    pesos: [4, 3, 2, 1],
    sucursales: [
      {
        sucursalId: SUCURSAL_A1.id,
        sucursal: 'Centro',
        zonaHoraria: 'America/Mexico_City',
        calculada: true,
        motivo: null,
        polizasRecibidas: 20,
        almacenesConFoto: 1,
        hoy: '2026-09-16',
        ventanaDesde: '2026-08-19',
        ventanaHasta: '2026-09-15',
        horizonteDesde: '2026-09-16',
        horizonteHasta: '2026-09-22',
      },
      {
        sucursalId: SUCURSAL_A2.id,
        sucursal: 'Tijuana',
        zonaHoraria: 'America/Tijuana',
        calculada: false,
        motivo: 'sin_polizas',
        polizasRecibidas: 0,
        almacenesConFoto: 0,
        hoy: '2026-09-16',
        ventanaDesde: '2026-08-19',
        ventanaHasta: '2026-09-15',
        horizonteDesde: '2026-09-16',
        horizonteHasta: '2026-09-22',
      },
    ],
    filas: [
      fila({ insumoOrigenSrId: 'I1' }),
      fila({
        insumoOrigenSrId: 'I3',
        insumo: 'Vaso nuevo',
        unidad: 'Pieza',
        estado: 'sin_historial',
        diasHistorial: 10,
        semanas: null,
        proyeccion: null,
        existencia: '20.000',
        sugerido: null,
      }),
      fila({
        insumoOrigenSrId: 'I2',
        insumo: 'Tortilla',
        semanas: ['0.000', '0.000', '0.000', '0.000'],
        proyeccion: '0.000',
        existencia: '100.000',
        minimo: null,
        sugerido: '0.000',
        avisos: ['sin_minimo'],
      }),
      fila({
        almacenOrigenSrId: 'ALM3',
        almacen: null,
        insumoOrigenSrId: 'I1',
        proyeccion: '0.000',
        semanas: ['0.000', '0.000', '0.000', '0.000'],
        existencia: null,
        minimo: null,
        sugerido: null,
        avisos: ['sin_foto', 'sin_minimo'],
      }),
    ],
    kpis: { filas: 4, conSugerido: 1, sinHistorial: 1 },
    ...p,
  };
}

function api(u: UsuarioActual, d: () => Proyecciones = () => datos()) {
  return instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /alertas/abiertas': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /inventario/proyecciones': () => json(200, d()),
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

const filas = async () => screen.findAllByTestId('fila-proyeccion', undefined, { timeout: 5000 });

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

describe('Proyecciones (F2-127)', () => {
  it('tabla: semanas de la más vieja a la reciente, proyección, sugerido; sin datos no es 0', async () => {
    const f = api(usuario('visor'));
    montar();
    const [carne, vaso, tortilla, sinFoto] = await filas();
    expect(carne).toHaveTextContent('Carne al pastor');
    expect(carne).toHaveTextContent('40 · 30 · 20 · 18.5');
    expect(carne).toHaveTextContent('23.4');
    expect(carne).toHaveTextContent('18.4');
    // Sin historial: lo dice, y el sugerido es "Sin datos", no 0.
    expect(vaso).toHaveTextContent('Sin datos: 10 días de historial; la proyección necesita 28.');
    expect(within(vaso).getAllByRole('cell').at(-1)).toHaveTextContent('Sin datos');
    // Sin mínimo: lo avisa en texto.
    expect(tortilla).toHaveTextContent('Sin mínimo en el panel: se toma 0');
    // Almacén sin lectura: sugerido "—" y el porqué.
    expect(sinFoto).toHaveTextContent('Almacén ALM3 (sin catálogo)');
    expect(sinFoto).toHaveTextContent('no tiene lectura de existencias');
    expect(within(sinFoto).getAllByRole('cell').at(-1)).toHaveTextContent('—');
    // KPIs y el aviso de la sucursal sin pólizas.
    expect(screen.getByTestId('kpis-proyecciones')).toHaveTextContent('Por comprar1');
    expect(screen.getByTestId('avisos-proyecciones')).toHaveTextContent(
      'Tijuana: el agente nunca ha mandado pólizas de inventario',
    );
    const q = f.llamadas.find((l) => l.ruta === '/inventario/proyecciones')!.query;
    expect([q.get('empresaId'), q.get('horizonte')]).toEqual([A, '7']);
  });

  it('el horizonte se ajusta a mano: atajo y número escrito vuelven a consultar', async () => {
    const user = userEvent.setup();
    const f = api(usuario('visor'));
    montar();
    await filas();
    await user.click(screen.getByRole('button', { name: '14 días' }));
    const horizontes = () =>
      f.llamadas
        .filter((l) => l.ruta === '/inventario/proyecciones')
        .map((l) => l.query.get('horizonte'));
    await vi.waitFor(() => expect(horizontes()).toContain('14'));
    const campo = screen.getByRole('textbox', { name: /Días a cubrir/ });
    await user.clear(campo);
    await user.type(campo, '30');
    expect(screen.getByRole('alert')).toHaveTextContent('entre 1 y 28');
    expect(screen.getByRole('button', { name: 'Aplicar' })).toBeDisabled();
    await user.clear(campo);
    await user.type(campo, '10');
    await user.click(screen.getByRole('button', { name: 'Aplicar' }));
    await vi.waitFor(() => expect(horizontes()).toContain('10'));
    expect(horizontes()).not.toContain('30');
  });

  it('filtro "sólo lo que hay que comprar" y búsqueda local', async () => {
    const user = userEvent.setup();
    api(usuario('visor'));
    montar();
    await filas();
    await user.click(screen.getByRole('checkbox', { name: 'Sólo lo que hay que comprar' }));
    expect(screen.getAllByTestId('fila-proyeccion')).toHaveLength(1);
    await user.click(screen.getByRole('checkbox', { name: 'Sólo lo que hay que comprar' }));
    await user.type(screen.getByRole('searchbox', { name: 'Buscar insumo' }), 'vaso');
    const quedan = screen.getAllByTestId('fila-proyeccion');
    expect(quedan).toHaveLength(1);
    expect(quedan[0]).toHaveTextContent('Vaso nuevo');
  });

  it('ninguna sucursal con pólizas: dice por qué, sin tabla ni ceros', async () => {
    api(usuario('visor'), () =>
      datos({
        sucursales: datos().sucursales.map((s) => ({
          ...s,
          calculada: false,
          motivo: 'sin_polizas',
        })),
        filas: [],
        kpis: { filas: 0, conSugerido: 0, sinHistorial: 0 },
      }),
    );
    montar();
    const vacio = await screen.findByTestId('proyecciones-vacio', undefined, { timeout: 5000 });
    expect(vacio).toHaveTextContent('Ninguna sucursal ha mandado todavía pólizas de inventario.');
    expect(screen.queryByTestId('fila-proyeccion')).toBeNull();
  });

  describe('orden de compra CSV', () => {
    const originales = { crear: URL.createObjectURL, revocar: URL.revokeObjectURL };
    afterEach(() => {
      URL.createObjectURL = originales.crear;
      URL.revokeObjectURL = originales.revocar;
    });

    it('descarga sólo lo que hay que comprar', async () => {
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
      api(usuario('visor'));
      montar();
      await filas();
      await user.click(screen.getByTestId('csv-orden-compra'));
      expect(nombres).toEqual(['orden-compra_2026-09-16_7d.csv']);
      const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(
        new Uint8Array(await blobs[0].arrayBuffer()),
      );
      expect(csv.slice(1).split('\r\n').slice(1)).toEqual([
        'Centro,General,C-01,Carne al pastor,Kilogramo,18.400,10.000,5.000,23.400,7,2026-09-16,2026-09-22',
        '',
      ]);
    });

    it('sin nada que comprar, el botón se deshabilita y lo dice', async () => {
      api(usuario('visor'), () =>
        datos({ filas: datos().filas.map((f) => ({ ...f, sugerido: f.sugerido && '0.000' })) }),
      );
      montar();
      await filas();
      expect(screen.getByTestId('csv-orden-compra')).toBeDisabled();
      expect(screen.getByText('Nada que comprar en esta vista.')).toBeInTheDocument();
    });
  });
});
