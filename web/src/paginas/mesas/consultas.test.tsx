import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { PULSO_MS, useAhora, useConReloj } from './consultas';

const T0 = Date.parse('2026-09-21T18:00:00Z');

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  vi.setSystemTime(T0);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Pulsos de reloj, uno por `act`, para que cada uno pueda pintar por separado. */
function pulsos(n: number) {
  for (let i = 0; i < n; i++) {
    act(() => {
      vi.advanceTimersByTime(PULSO_MS);
    });
  }
}

describe('useConReloj', () => {
  it('no vuelve a pintar mientras el valor no cambia, y pinta UNA vez al cambiar', () => {
    let renders = 0;
    // "¿Ya pasaron 40 s desde T0?": cambia una sola vez.
    const { result } = renderHook(() => {
      renders += 1;
      return useConReloj((ahora) => ahora - T0 > 40_000);
    });
    expect(result.current).toBe(false);
    const iniciales = renders;

    pulsos(6); // 30 s: sigue en false.
    expect(renders).toBe(iniciales);

    pulsos(3); // 45 s: cruza el umbral en el pulso de los 45.
    expect(result.current).toBe(true);
    expect(renders).toBe(iniciales + 1);

    pulsos(4);
    expect(renders).toBe(iniciales + 1);
  });

  it('control: con useAhora el mismo reloj pinta en cada pulso (lo que se evitó)', () => {
    let renders = 0;
    renderHook(() => {
      renders += 1;
      return useAhora() - T0 > 40_000;
    });
    const iniciales = renders;
    pulsos(6);
    expect(renders).toBe(iniciales + 6);
  });

  it('al desmontar deja de escuchar el reloj', () => {
    const { unmount } = renderHook(() => useConReloj(() => 1));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
