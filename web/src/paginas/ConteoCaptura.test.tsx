import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ConteoDetalle, EstadoConteo, PartidaConteo, UsuarioActual } from '../api/tipos';
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

// F2-123 en el web: la captura de un conteo de 50 artículos (`/conteos/:id`) y su reporte. El AC:
// "un conteo de 50 artículos se captura en móvil sin perder datos al bloquearse la pantalla". El
// bloqueo se simula como lo vive la página: la petición falla (sin red) y la vista se desmonta; al
// volver, lo capturado reaparece y se reenvía.

const A = EMPRESA_A.id;
const ID = 'c-50';
const RUTA = `/conteos/${ID}?empresa=${A}`;
const X = Array.from({ length: 50 }, (_, i) => `X${String(i + 1).padStart(2, '0')}`);

function partida(insumo: string, contado: string | null = null): PartidaConteo {
  return {
    insumoOrigenSrId: insumo,
    insumo: `Artículo ${insumo}`,
    clave: insumo,
    unidad: 'kg',
    grupo: null,
    teorico: '10.000',
    costoPromedio: '1.50',
    contado,
    estado: contado === null ? 'sin_contar' : 'cuadra',
    diferencia: null,
    importe: null,
    capturadoAt: null,
  };
}

function detalle(estado: EstadoConteo, contados: Record<string, string | null>): ConteoDetalle {
  const partidas = X.map((x) => partida(x, contados[x] ?? null));
  const n = partidas.filter((p) => p.contado !== null).length;
  return {
    conteo: {
      id: ID,
      folio: 3,
      sucursalId: SUCURSAL_A1.id,
      sucursal: 'Centro',
      almacenOrigenSrId: 'A1-BAR',
      almacen: 'Barra',
      grupoOrigenSrId: null,
      grupo: null,
      nota: null,
      estado,
      teoricoCapturadoAt: '2026-09-22T15:00:00.000Z',
      teoricoAtrasado: false,
      creadoAt: '2026-09-22T15:05:00.000Z',
      cerradoAt: estado === 'cerrado' ? '2026-09-22T16:00:00.000Z' : null,
      canceladoAt: null,
      articulos: 50,
      contados: n,
    },
    zonaHoraria: 'America/Mexico_City',
    partidas,
    totales: {
      articulos: 50,
      contados: n,
      sinContar: 50 - n,
      sinTeorico: 0,
      conDiferencia: 0,
      sinValuar: 0,
      faltante: '0.00',
      sobrante: '0.00',
      neto: '0.00',
    },
  };
}

/** Un servidor en memoria: GET devuelve lo guardado; PUT guarda (o falla, según `modo`). */
function servidor(u: UsuarioActual) {
  const guardado: Record<string, string | null> = {};
  const estado = {
    modo: 'ok' as 'ok' | 'sin-red' | 'cerrado',
    conteo: 'en_captura' as EstadoConteo,
  };
  const falsa = instalarApiFalsa({
    'POST /auth/refresh': () => json(200, sesion(u)),
    'GET /empresas': () => json(200, [EMPRESA_A]),
    'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
    'GET /usuarios': () => json(200, []),
    'GET /agentes/estado': () => json(200, []),
    'GET /alertas/abiertas': () => json(200, []),
    [`GET /inventario/conteos/${ID}`]: () => json(200, detalle(estado.conteo, guardado)),
    [`PUT /inventario/conteos/${ID}/partidas`]: ((l: Llamada) => {
      if (estado.modo === 'sin-red') return json(503, { statusCode: 503, message: 'Sin red' });
      if (estado.modo === 'cerrado') return json(409, { statusCode: 409, message: 'cerrado' });
      const cuerpo = l.cuerpo as {
        partidas: Array<{ insumoOrigenSrId: string; contado: string | null }>;
      };
      for (const p of cuerpo.partidas) {
        guardado[p.insumoOrigenSrId] = p.contado === null ? null : Number(p.contado).toFixed(3);
      }
      return json(200, {
        guardadas: cuerpo.partidas.map((p) => ({
          insumoOrigenSrId: p.insumoOrigenSrId,
          contado: guardado[p.insumoOrigenSrId],
        })),
      });
    }) as Manejador,
    [`POST /inventario/conteos/${ID}/cerrar`]: (() => {
      estado.conteo = 'cerrado';
      return json(200, detalle('cerrado', guardado));
    }) as Manejador,
  });
  const puts = () =>
    falsa.llamadas.filter((l) => l.metodo === 'PUT') as Array<
      Llamada & { cuerpo: { partidas: Array<{ insumoOrigenSrId: string; contado: string }> } }
    >;
  return { falsa, guardado, estado, puts };
}

function montar() {
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  return render(
    <MemoryRouter initialEntries={[RUTA]}>
      <Proveedores queryClient={queryClient}>
        <Rutas />
      </Proveedores>
    </MemoryRouter>,
  );
}

const entrada = (x: string) =>
  screen.getByRole('textbox', { name: `Contado de Artículo ${x}` }) as HTMLInputElement;

/** Captura los 50 renglones como lo haría el teclado del celular (coma decimal en algunos). */
function capturar50() {
  X.forEach((x, i) => {
    fireEvent.change(entrada(x), { target: { value: i % 2 === 0 ? `${i}` : `${i},5` } });
  });
}
const esperado = (i: number) => (i % 2 === 0 ? `${i}` : `${i}.5`);
/** Montar y teclear 50 renglones en jsdom tarda más que los 5 s por omisión. */
const LENTO = 30_000;

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  terminarSesion('cerrada');
  window.localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('Captura de un conteo (F2-123)', () => {
  it(
    '50 artículos: se capturan, salen en lote y quedan guardados',
    async () => {
      const s = servidor(usuario('admin_empresa'));
      montar();
      await screen.findByTestId('conteo-avance', undefined, { timeout: 5000 });
      expect(screen.getByTestId('conteo-avance')).toHaveTextContent('0 de 50 artículos contados');
      capturar50();
      expect(screen.getByTestId('conteo-avance')).toHaveTextContent('50 de 50 artículos contados');
      await waitFor(() => expect(s.puts()).toHaveLength(1), { timeout: 3000 });
      expect(s.puts()[0].cuerpo.partidas).toHaveLength(50);
      expect(s.puts()[0].cuerpo.partidas[1]).toEqual({ insumoOrigenSrId: 'X02', contado: '1.5' });
      await waitFor(() =>
        expect(screen.getByTestId('conteo-envio')).toHaveTextContent(
          'Todo lo capturado está guardado.',
        ),
      );
      expect(Object.keys(s.guardado)).toHaveLength(50);
      // No se muestra el teórico mientras se captura (conteo ciego).
      expect(screen.queryByText('10')).not.toBeInTheDocument();
    },
    LENTO,
  );

  it(
    'AC: sin red y con la pantalla bloqueada (la vista se desmonta) no se pierde nada',
    async () => {
      const s = servidor(usuario('admin_empresa'));
      s.estado.modo = 'sin-red';
      montar();
      await screen.findByTestId('conteo-avance', undefined, { timeout: 5000 });
      capturar50();
      await waitFor(
        () => expect(screen.getByTestId('conteo-envio')).toHaveTextContent('Sin conexión'),
        { timeout: 3000 },
      );
      expect(screen.getByTestId('conteo-envio')).toHaveTextContent('(50 pendiente(s))');
      expect(Object.keys(s.guardado)).toHaveLength(0);

      // Se bloquea la pantalla y el navegador descarta la página. Al desbloquear se recarga,
      // TODAVÍA sin red.
      cleanup();
      montar();
      await screen.findByTestId('conteo-avance', undefined, { timeout: 5000 });
      // Lo capturado reaparece sobre lo del servidor (que no tiene nada), sin volver a teclear.
      X.forEach((x, i) => expect(entrada(x).value).toBe(esperado(i)));
      expect(screen.getByTestId('conteo-avance')).toHaveTextContent('50 de 50 artículos contados');
      await waitFor(() =>
        expect(screen.getByTestId('conteo-envio')).toHaveTextContent('Sin conexión'),
      );
      expect(Object.keys(s.guardado)).toHaveLength(0);
      // Vuelve la red: se reenvía solo.
      s.estado.modo = 'ok';
      act(() => {
        window.dispatchEvent(new Event('online'));
      });
      await waitFor(() => expect(Object.keys(s.guardado)).toHaveLength(50), { timeout: 3000 });
      X.forEach((x, i) => expect(s.guardado[x]).toBe(Number(esperado(i)).toFixed(3)));
      await waitFor(() =>
        expect(screen.getByTestId('conteo-envio')).toHaveTextContent(
          'Todo lo capturado está guardado.',
        ),
      );
      // Y lo que se ve sigue siendo lo capturado (ahora ya del servidor).
      X.forEach((x, i) => expect(entrada(x).value).toBe(esperado(i)));
    },
    LENTO,
  );

  it('al volver a la pestaña (desbloquear) reintenta lo pendiente', async () => {
    const s = servidor(usuario('admin_empresa'));
    s.estado.modo = 'sin-red';
    montar();
    await screen.findByTestId('conteo-avance', undefined, { timeout: 5000 });
    fireEvent.change(entrada('X07'), { target: { value: '3' } });
    await waitFor(() => expect(s.puts()).toHaveLength(1), { timeout: 3000 });
    s.estado.modo = 'ok';
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(s.guardado.X07).toBe('3.000'), { timeout: 3000 });
  });

  it('conteo ya cerrado (409): "no enviado", sin reintentar en bucle; el usuario descarta', async () => {
    const user = userEvent.setup();
    const s = servidor(usuario('admin_empresa'));
    s.estado.modo = 'cerrado';
    montar();
    await screen.findByTestId('conteo-avance', undefined, { timeout: 5000 });
    fireEvent.change(entrada('X01'), { target: { value: '2' } });
    const alerta = await screen.findByRole('alert', undefined, { timeout: 3000 });
    expect(alerta).toHaveTextContent('No enviado: el conteo ya está cerrado o cancelado.');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(s.puts()).toHaveLength(1);
    await user.click(within(alerta).getByRole('button', { name: 'Descartar lo no enviado' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('una cantidad inválida se marca y NO se manda (ni se redondea)', async () => {
    const s = servidor(usuario('admin_empresa'));
    montar();
    await screen.findByTestId('conteo-avance', undefined, { timeout: 5000 });
    fireEvent.change(entrada('X03'), { target: { value: '1.2345' } });
    const fila = entrada('X03').closest('li')!;
    expect(fila).toHaveTextContent('Escribe una cantidad sin signo, con hasta 3 decimales.');
    await new Promise((r) => setTimeout(r, 1200));
    expect(s.puts()).toHaveLength(0);
  });

  it('el visor ve el avance sin poder capturar', async () => {
    servidor(usuario('visor'));
    montar();
    await screen.findByTestId('conteo-avance', undefined, { timeout: 5000 });
    expect(screen.queryByRole('textbox', { name: /Contado de/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cerrar conteo' })).not.toBeInTheDocument();
  });

  it('cerrar pide confirmación en la página y avisa lo que queda sin contar', async () => {
    const user = userEvent.setup();
    const s = servidor(usuario('admin_empresa'));
    s.guardado.X01 = '10.000';
    montar();
    await user.click(
      await screen.findByRole('button', { name: 'Cerrar conteo' }, { timeout: 5000 }),
    );
    expect(screen.getByTestId('conteo-confirmar')).toHaveTextContent(
      '49 artículo(s) sin contar se reportarán aparte (no como 0).',
    );
    await user.click(screen.getByRole('button', { name: 'Sí, cerrar' }));
    expect(
      await screen.findByTestId('conteo-kpis', undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('conteo-estado')).toHaveTextContent('Cerrado');
    expect(s.falsa.contar('POST', `/inventario/conteos/${ID}/cerrar`)).toBe(1);
  });
});

describe('Reporte de un conteo cerrado (F2-123)', () => {
  it('KPIs en pesos, diferencias en unidades y $, y lo sin contar / sin teórico aparte', async () => {
    const d = detalle('cerrado', {});
    d.partidas = [
      {
        ...partida('X01', '7.500'),
        teorico: '10.000',
        estado: 'con_diferencia',
        diferencia: '-2.500',
        importe: '-3.75',
      },
      {
        ...partida('X02', '11.000'),
        estado: 'con_diferencia',
        diferencia: '1.000',
        importe: '1.50',
      },
      partida('X03'),
      { ...partida('X04', '2.000'), teorico: null, costoPromedio: null, estado: 'sin_teorico' },
    ];
    d.totales = {
      articulos: 4,
      contados: 3,
      sinContar: 1,
      sinTeorico: 1,
      conDiferencia: 2,
      sinValuar: 0,
      faltante: '-3.75',
      sobrante: '1.50',
      neto: '-2.25',
    };
    instalarApiFalsa({
      'POST /auth/refresh': () => json(200, sesion(usuario('visor'))),
      'GET /empresas': () => json(200, [EMPRESA_A]),
      'GET /sucursales': () => json(200, [SUCURSAL_A1, SUCURSAL_A2]),
      'GET /alertas/abiertas': () => json(200, []),
      'GET /agentes/estado': () => json(200, []),
      [`GET /inventario/conteos/${ID}`]: () => json(200, d),
    });
    montar();
    const kpis = await screen.findByTestId('conteo-kpis', undefined, { timeout: 5000 });
    expect(within(kpis).getByTestId('kpi-faltante')).toHaveTextContent('-$3.75');
    expect(within(kpis).getByTestId('kpi-sobrante')).toHaveTextContent('$1.50');
    expect(within(kpis).getByTestId('kpi-neto')).toHaveTextContent('-$2.25');
    expect(within(kpis).getByTestId('kpi-contados')).toHaveTextContent('3 de 4');
    const fila = screen.getAllByRole('row').find((r) => r.getAttribute('data-insumo') === 'X01')!;
    expect(fila).toHaveTextContent('10');
    expect(fila).toHaveTextContent('7.5');
    expect(fila).toHaveTextContent('-2.5');
    expect(fila).toHaveTextContent('-$3.75');
    expect(screen.getByTestId('aparte-sin_contar')).toHaveTextContent('Artículo X03');
    expect(screen.getByTestId('aparte-sin_teorico')).toHaveTextContent('Artículo X04 · contado 2');
    expect(screen.getByRole('button', { name: 'Descargar CSV' })).toBeInTheDocument();
    // En el reporte ya no hay captura.
    expect(screen.queryByRole('textbox', { name: /Contado de/ })).not.toBeInTheDocument();
  });
});
