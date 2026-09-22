import { QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { useVentas } from '../paginas/inicio/consultas';
import { useReporte } from '../paginas/reportes/consultas';
import { EMPRESA_A, instalarApiFalsa, json, SUCURSAL_A1 } from '../test/apiFalsa';
import { crearQueryClient } from './queryClient';
import { llaveConAltura, mantenerSiSoloCambiaLaAltura } from './altura';

// F2-220: `alturaAl` entra en las llaves de React Query sin cambiar las de siempre, y el dato
// del minuto anterior sólo se conserva cuando lo único que cambió fue la altura.

const FILTRO = { empresaId: EMPRESA_A.id, sucursalId: undefined };
const RANGO = { desde: '2026-09-14', hasta: '2026-09-14' };
const ALTURA_1 = '2026-09-21T20:30:00.000Z';
const ALTURA_2 = '2026-09-21T20:31:00.000Z';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('llaveConAltura', () => {
  it('sin altura, la llave es idéntica; con ella, va al final', () => {
    expect(llaveConAltura(['a', 1], undefined)).toEqual(['a', 1]);
    expect(llaveConAltura(['a', 1], ALTURA_1)).toEqual(['a', 1, ALTURA_1]);
  });
});

describe('mantenerSiSoloCambiaLaAltura', () => {
  const llave = ['ventas', 'resumen', 'A', null, '2026-09-14', '2026-09-14', ALTURA_2];

  it('conserva el dato previo si sólo cambió la altura', () => {
    const previa = [...llave.slice(0, -1), ALTURA_1];
    expect(mantenerSiSoloCambiaLaAltura('dato', previa, llave, ALTURA_2)).toBe('dato');
  });

  it('no lo conserva si cambió la empresa, la sucursal o el rango', () => {
    for (const i of [2, 3, 4, 5]) {
      const previa = [...llave];
      previa[i] = 'otro';
      previa[6] = ALTURA_1;
      expect(mantenerSiSoloCambiaLaAltura('dato', previa, llave, ALTURA_2)).toBeUndefined();
    }
  });

  it('no lo conserva sin altura, sin dato previo o con otra forma de llave', () => {
    expect(
      mantenerSiSoloCambiaLaAltura('dato', llave, llave.slice(0, -1), undefined),
    ).toBeUndefined();
    expect(mantenerSiSoloCambiaLaAltura(undefined, llave, llave, ALTURA_2)).toBeUndefined();
    expect(mantenerSiSoloCambiaLaAltura('dato', undefined, llave, ALTURA_2)).toBeUndefined();
    expect(
      mantenerSiSoloCambiaLaAltura('dato', llave.slice(0, -1), llave, ALTURA_2),
    ).toBeUndefined();
  });
});

function envoltorio() {
  const queryClient = crearQueryClient();
  queryClient.setDefaultOptions({
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const Envoltorio = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, Envoltorio };
}

/** Una API que tarda en contestar la segunda altura: deja ver el placeholder. */
function apiLenta() {
  let liberar: () => void = () => {};
  const espera = new Promise<void>((r) => (liberar = r));
  const a = instalarApiFalsa({
    'GET /ventas/resumen': async (l) => {
      if (l.query.get('alturaAl') === ALTURA_2) await espera;
      return json(200, { venta: l.query.get('alturaAl') ?? 'sin' });
    },
    'GET /ventas/comparativo-sucursales': async (l) => {
      if (l.query.get('alturaAl') === ALTURA_2) await espera;
      return json(200, [{ venta: l.query.get('alturaAl') ?? 'sin' }]);
    },
  });
  return { a, liberar };
}

describe('useVentas con alturaAl', () => {
  it('sin altura conserva la llave de Inicio y no manda el parámetro', async () => {
    const { a } = apiLenta();
    const { queryClient, Envoltorio } = envoltorio();
    renderHook(() => useVentas('resumen', FILTRO, RANGO, false), { wrapper: Envoltorio });
    await waitFor(() => expect(a.contar('GET', '/ventas/resumen')).toBe(1));
    expect(a.llamadas[0].query.has('alturaAl')).toBe(false);
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey),
    ).toEqual([['ventas', 'resumen', EMPRESA_A.id, null, RANGO.desde, RANGO.hasta]]);
  });

  it('con altura la manda, la agrega al final, y al cambiar de minuto no vuelve a "cargando"', async () => {
    const { a, liberar } = apiLenta();
    const { queryClient, Envoltorio } = envoltorio();
    const { result, rerender } = renderHook(
      ({ altura }: { altura: string }) => useVentas('resumen', FILTRO, RANGO, false, altura),
      { wrapper: Envoltorio, initialProps: { altura: ALTURA_1 } },
    );
    await waitFor(() => expect(result.current.data).toEqual({ venta: ALTURA_1 }));
    expect(a.llamadas[0].query.get('alturaAl')).toBe(ALTURA_1);

    rerender({ altura: ALTURA_2 });
    // Mientras llega el minuto nuevo, el dato previo sigue en pantalla (placeholder).
    await waitFor(() => expect(a.contar('GET', '/ventas/resumen')).toBe(2));
    expect(result.current.isPending).toBe(false);
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toEqual({ venta: ALTURA_1 });

    liberar();
    await waitFor(() => expect(result.current.data).toEqual({ venta: ALTURA_2 }));
    expect(
      queryClient
        .getQueryCache()
        .find({
          queryKey: [
            ...['ventas', 'resumen', EMPRESA_A.id, null, RANGO.desde, RANGO.hasta],
            ALTURA_2,
          ],
        }),
    ).toBeDefined();
  });

  it('con otra sucursal NO conserva el dato de la anterior', async () => {
    apiLenta();
    const { Envoltorio } = envoltorio();
    const { result, rerender } = renderHook(
      ({ sucursalId }: { sucursalId: string | undefined }) =>
        useVentas('resumen', { empresaId: EMPRESA_A.id, sucursalId }, RANGO, false, ALTURA_1),
      { wrapper: Envoltorio, initialProps: { sucursalId: undefined as string | undefined } },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    rerender({ sucursalId: SUCURSAL_A1.id });
    expect(result.current.data).toBeUndefined();
    expect(result.current.isPending).toBe(true);
  });
});

describe('useReporte con alturaAl', () => {
  it('sin altura conserva la llave de Reportes; con ella la agrega al final y conserva al cambiar de minuto', async () => {
    const { a, liberar } = apiLenta();
    const { queryClient, Envoltorio } = envoltorio();
    renderHook(() => useReporte('comparativo-sucursales', FILTRO, RANGO), { wrapper: Envoltorio });
    await waitFor(() => expect(a.contar('GET', '/ventas/comparativo-sucursales')).toBe(1));
    expect(a.llamadas[0].query.has('alturaAl')).toBe(false);
    expect(queryClient.getQueryCache().getAll()[0].queryKey).toEqual([
      'ventas',
      'comparativo-sucursales',
      EMPRESA_A.id,
      null,
      RANGO.desde,
      RANGO.hasta,
      {},
    ]);

    const { result, rerender } = renderHook(
      ({ altura }: { altura: string }) =>
        useReporte('comparativo-sucursales', FILTRO, RANGO, {}, altura),
      { wrapper: Envoltorio, initialProps: { altura: ALTURA_1 } },
    );
    await waitFor(() => expect(result.current.data).toEqual([{ venta: ALTURA_1 }]));
    rerender({ altura: ALTURA_2 });
    await waitFor(() => expect(a.contar('GET', '/ventas/comparativo-sucursales')).toBe(3));
    expect(result.current.isPlaceholderData).toBe(true);
    expect(result.current.data).toEqual([{ venta: ALTURA_1 }]);
    liberar();
    await waitFor(() => expect(result.current.data).toEqual([{ venta: ALTURA_2 }]));
  });
});
