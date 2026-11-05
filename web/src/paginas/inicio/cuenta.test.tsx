import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { formatearPesos } from '../../dinero/dinero';
import { CifraAnimada } from './CifraAnimada';
import { intermedio } from './cuenta';
import { Sparkline } from './Sparkline';

describe('intermedio (UI-05): el conteo es en bigint, sin float', () => {
  it('va de `desde` a `objetivo` en milésimas y termina EXACTO', () => {
    expect(intermedio(100_00n, 200_00n, 0)).toBe(100_00n);
    expect(intermedio(100_00n, 200_00n, 500)).toBe(150_00n);
    expect(intermedio(100_00n, 200_00n, 1000)).toBe(200_00n);
    // Un importe que en float se desviaría: el final es el objetivo tal cual.
    expect(intermedio(0n, 9_007_199_254_740_993n, 1000)).toBe(9_007_199_254_740_993n);
  });

  it('también hacia abajo, redondeando hacia el punto de partida', () => {
    expect(intermedio(200_00n, 100_01n, 333)).toBe(200_00n - (99_99n * 333n) / 1000n);
  });
});

describe('CifraAnimada', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('sin movimiento permitido (o sin matchMedia), cambia de golpe al valor nuevo', () => {
    const { rerender } = render(
      <span data-testid="c">
        <CifraAnimada valor={123_45n} formato={formatearPesos} sinValor="Sin dato" />
      </span>,
    );
    expect(screen.getByTestId('c')).toHaveTextContent('$123.45');
    rerender(
      <span data-testid="c">
        <CifraAnimada valor={999_99n} formato={formatearPesos} sinValor="Sin dato" />
      </span>,
    );
    expect(screen.getByTestId('c')).toHaveTextContent('$999.99');
    rerender(
      <span data-testid="c">
        <CifraAnimada valor={null} formato={formatearPesos} sinValor="Sin dato" />
      </span>,
    );
    expect(screen.getByTestId('c')).toHaveTextContent('Sin dato');
  });

  it('con movimiento permitido cuenta desde el valor anterior y termina en el nuevo', async () => {
    const cuadros: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => cuadros.push(cb));
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const original = window.matchMedia;
    window.matchMedia = ((q: string) => ({
      ...original(q),
      matches: q === '(prefers-reduced-motion: no-preference)',
    })) as typeof window.matchMedia;
    const inicio = performance.now();

    const { rerender } = render(
      <span data-testid="c">
        <CifraAnimada valor={100_00n} formato={formatearPesos} sinValor="—" />
      </span>,
    );
    rerender(
      <span data-testid="c">
        <CifraAnimada valor={200_00n} formato={formatearPesos} sinValor="—" />
      </span>,
    );
    // El primer render del valor nuevo todavía muestra el de partida: no hay salto.
    expect(screen.getByTestId('c')).toHaveTextContent('$100.00');
    await act(async () => cuadros.shift()?.(inicio + 10_000));
    expect(screen.getByTestId('c')).toHaveTextContent('$200.00');
    window.matchMedia = original;
  });
});

describe('Sparkline', () => {
  it('con menos de dos puntos legibles no dibuja nada', () => {
    const { container } = render(<Sparkline valores={[null, 5, null]} etiqueta="x" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('con datos dibuja la línea, nombrada para el lector de pantalla', () => {
    render(<Sparkline valores={[1, 3, null, 2, 4]} etiqueta="Tendencia del ticket" />);
    const svg = screen.getByRole('img', { name: 'Tendencia del ticket' });
    // Un hueco (null) parte la línea en dos tramos.
    expect(svg.querySelectorAll('path[fill="none"]')).toHaveLength(2);
  });
});
