import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { BarraRelativa } from './Barra';

/** El relleno de la barra (el `span` con ancho), o `null` si no se dibuja. */
function relleno(container: HTMLElement): HTMLElement | null {
  return container.querySelector<HTMLElement>('[aria-hidden="true"] > span');
}

describe('BarraRelativa (UI-05)', () => {
  it('la cifra va escrita y la barra es decorativa', () => {
    const { container } = render(
      <BarraRelativa parte={50n} maximo={100n}>
        $50.00
      </BarraRelativa>,
    );
    expect(screen.getByText('$50.00')).toBeInTheDocument();
    expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
  });

  it('el ancho es proporcional al máximo de la sucursal', () => {
    const { container } = render(
      <BarraRelativa parte={1n} maximo={3n}>
        x
      </BarraRelativa>,
    );
    // 1/3 en milésimas = 333 → 33.3 %
    expect(relleno(container)?.style.width).toBe('33.3%');
  });

  it('el mejor llena la barra y nunca pasa del 100 %', () => {
    const lleno = render(
      <BarraRelativa parte={100n} maximo={100n}>
        x
      </BarraRelativa>,
    );
    expect(relleno(lleno.container)?.style.width).toBe('100%');
    const pasado = render(
      <BarraRelativa parte={500n} maximo={100n}>
        x
      </BarraRelativa>,
    );
    expect(relleno(pasado.container)?.style.width).toBe('100%');
  });

  it('una parte mínima se ve con al menos 3 %', () => {
    const { container } = render(
      <BarraRelativa parte={1n} maximo={1000n}>
        x
      </BarraRelativa>,
    );
    expect(relleno(container)?.style.width).toBe('3%');
  });

  it('sin dato, cero, negativo o máximo cero: barra vacía, sin relleno', () => {
    const casos: [bigint | null, bigint][] = [
      [null, 100n],
      [0n, 100n],
      [-5n, 100n],
      [10n, 0n],
    ];
    for (const [parte, maximo] of casos) {
      const { container, unmount } = render(
        <BarraRelativa parte={parte} maximo={maximo}>
          x
        </BarraRelativa>,
      );
      expect(container.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(relleno(container)).toBeNull();
      unmount();
    }
  });
});
