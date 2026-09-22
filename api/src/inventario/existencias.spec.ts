import { Prisma } from '@prisma/client';

import { atrasada, estadoDe, kpisDe, LECTURA_ATRASADA_MS } from './existencias';

const D = (v: string) => new Prisma.Decimal(v);

describe('existencias del panel (pura, F2-121)', () => {
  it('estadoDe: bordes del semáforo', () => {
    expect(estadoDe(null, D('5'), null)).toBe('sin_lectura');
    expect(estadoDe(D('0'), D('5'), null)).toBe('sin_existencia');
    expect(estadoDe(D('-1'), null, null)).toBe('sin_existencia');
    expect(estadoDe(D('4.999'), D('5'), null)).toBe('bajo_minimo');
    // En el mínimo exacto NO está bajo mínimo.
    expect(estadoDe(D('5'), D('5'), null)).toBe('ok');
    expect(estadoDe(D('10'), D('5'), D('10'))).toBe('ok');
    expect(estadoDe(D('10.001'), D('5'), D('10'))).toBe('sobre_maximo');
    expect(estadoDe(D('10.001'), null, null)).toBe('sin_limites');
    expect(estadoDe(D('3'), null, D('10'))).toBe('ok');
  });

  it('kpisDe: valor con negativos, atención = bajo mínimo, sin lectura aparte', () => {
    const k = kpisDe([
      { estado: 'bajo_minimo', valor: D('0.13') },
      { estado: 'sin_existencia', valor: D('-21.00') },
      { estado: 'ok', valor: D('8.16') },
      { estado: 'sobre_maximo', valor: D('123.50') },
      { estado: 'sin_lectura', valor: null },
    ]);
    expect(k).toEqual({
      articulos: 4,
      valor: '110.79',
      atencion: 1,
      sinExistencia: 1,
      sobreMaximo: 1,
      sinLectura: 1,
    });
    expect(kpisDe([]).valor).toBe('0.00');
  });

  it('atrasada: recibida hace más de 90 min (reloj del API)', () => {
    const ahora = Date.UTC(2026, 8, 22, 12);
    expect(atrasada(null, ahora)).toBe(false);
    expect(atrasada(new Date(ahora - LECTURA_ATRASADA_MS), ahora)).toBe(false);
    expect(atrasada(new Date(ahora - LECTURA_ATRASADA_MS - 1), ahora)).toBe(true);
  });
});
