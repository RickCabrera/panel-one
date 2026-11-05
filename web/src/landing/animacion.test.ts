import landingHtml from '../../landing/index.html?raw';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { asomo, centavosDe, formatoPesos, iniciarAnimacion, VENTAS } from './animacion';

// La demo del hero de la landing (UI-03): el contador en centavos enteros, la pupila acotada y
// el respeto a `prefers-reduced-motion`.

function montar() {
  document.body.innerHTML = landingHtml.slice(
    landingHtml.indexOf('<body>') + 6,
    landingHtml.indexOf('</body>'),
  );
}

function movimientoReducido(reducido: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: reducido }) as unknown as MediaQueryList),
  );
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('cifras de la demo', () => {
  it('el contador se lleva en centavos y se muestra en pesos mexicanos', () => {
    expect(centavosDe('$48,215.50')).toBe(4821550);
    expect(formatoPesos(4821550)).toBe('$48,215.50');
    // Sumar 0.1 + 0.2 en centavos no deja basura de coma flotante.
    expect(formatoPesos(10 + 20)).toBe('$0.30');
  });

  it('las ventas de demostración son importes con a lo más dos decimales', () => {
    for (const v of VENTAS) expect(Math.round(v.importe * 100) / 100).toBe(v.importe);
  });

  it('la pupila nunca sale de su alcance', () => {
    expect(asomo(0, 0, 22)).toEqual({ x: 0, y: 0 });
    const lejos = asomo(3000, 4000, 22);
    expect(Math.hypot(lejos.x, lejos.y)).toBeCloseTo(22);
    const cerca = asomo(26, 0, 22);
    expect(cerca.x).toBeCloseTo(2.2);
  });
});

describe('iniciarAnimacion', () => {
  it('con movimiento reducido no cae ningún ticket ni cambia la cifra', () => {
    vi.useFakeTimers();
    movimientoReducido(true);
    montar();
    const antes = document.getElementById('demo-lista')!.innerHTML;
    iniciarAnimacion();
    vi.advanceTimersByTime(20_000);
    expect(document.getElementById('demo-lista')!.innerHTML).toBe(antes);
    expect(document.getElementById('demo-venta')!.textContent).toBe('$48,215.50');
    // Nada que pausar: el botón sigue oculto.
    expect(document.getElementById('demo-pausa')!.hidden).toBe(true);
  });

  it('el botón de pausa detiene la demo y la reanuda (WCAG 2.2.2)', () => {
    vi.useFakeTimers();
    movimientoReducido(false);
    vi.stubGlobal('IntersectionObserver', undefined);
    montar();
    iniciarAnimacion();
    const boton = document.getElementById('demo-pausa') as HTMLButtonElement;
    expect(boton.hidden).toBe(false);
    boton.click();
    expect(boton.getAttribute('aria-pressed')).toBe('true');
    expect(boton.textContent).toBe('Reanudar animación');
    expect(document.querySelector('.demo')!.classList.contains('en-pausa')).toBe(true);
    vi.advanceTimersByTime(2800 * 3);
    expect(document.getElementById('demo-tickets')!.textContent).toBe('127');
    boton.click();
    expect(boton.textContent).toBe('Pausar animación');
    vi.advanceTimersByTime(2800);
    expect(document.getElementById('demo-tickets')!.textContent).toBe('128');
  });

  it('sin movimiento reducido entra una venta: ticket arriba, a lo más 4, y cuenta un ticket más', () => {
    vi.useFakeTimers();
    movimientoReducido(false);
    vi.stubGlobal('IntersectionObserver', undefined);
    montar();
    iniciarAnimacion();
    vi.advanceTimersByTime(2800);
    const lista = document.getElementById('demo-lista')!;
    expect(lista.firstElementChild?.querySelector('.t-mesa')?.textContent).toBe(VENTAS[0].mesa);
    expect(document.getElementById('demo-tickets')!.textContent).toBe('128');
    vi.advanceTimersByTime(2800 * 5);
    expect(lista.children.length).toBe(4);
  });
});
