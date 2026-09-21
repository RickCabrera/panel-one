import { NotFoundException } from '@nestjs/common';

import { Reloj } from '../comun/reloj';
import type { EmpresaScope } from '../scope/empresa-scope';
import { CacheAgregados, MAX_ENTRADAS_CACHE, TTL_CACHE_MS } from './cache-agregados';

class RelojFijo extends Reloj {
  t = 1_000_000;
  override ahora(): number {
    return this.t;
  }
}

const A: EmpresaScope = { tipo: 'empresa', empresaId: 'a' };
const B: EmpresaScope = { tipo: 'empresa', empresaId: 'b' };
const GLOBAL: EmpresaScope = { tipo: 'global' };

describe('CacheAgregados (F1-033)', () => {
  let reloj: RelojFijo;
  let cache: CacheAgregados;
  let calculos: number;
  const calcular = () => {
    calculos += 1;
    return Promise.resolve({ n: calculos });
  };

  beforeEach(() => {
    reloj = new RelojFijo();
    cache = new CacheAgregados(reloj);
    calculos = 0;
  });

  it('dentro de los 15 s devuelve lo guardado; al cumplirse, recalcula', async () => {
    await expect(cache.obtener(A, 'resumen', ['x'], calcular)).resolves.toEqual({ n: 1 });
    reloj.t += TTL_CACHE_MS - 1;
    await expect(cache.obtener(A, 'resumen', ['x'], calcular)).resolves.toEqual({ n: 1 });
    reloj.t += 1;
    await expect(cache.obtener(A, 'resumen', ['x'], calcular)).resolves.toEqual({ n: 2 });
    expect(TTL_CACHE_MS).toBe(15_000);
  });

  it('la llave lleva el SCOPE: A, B y admin_global nunca comparten entrada', async () => {
    await cache.obtener(A, 'resumen', ['x'], calcular);
    await expect(cache.obtener(B, 'resumen', ['x'], calcular)).resolves.toEqual({ n: 2 });
    await expect(cache.obtener(GLOBAL, 'resumen', ['x'], calcular)).resolves.toEqual({ n: 3 });
    expect(CacheAgregados.llave(A, 'r', ['x'])).not.toBe(CacheAgregados.llave(B, 'r', ['x']));
    expect(CacheAgregados.llave(A, 'r', ['x'])).not.toBe(CacheAgregados.llave(GLOBAL, 'r', ['x']));
  });

  it('la llave lleva el endpoint y todos los parámetros', async () => {
    await cache.obtener(A, 'resumen', ['x', 'y'], calcular);
    await expect(cache.obtener(A, 'por-hora', ['x', 'y'], calcular)).resolves.toEqual({ n: 2 });
    await expect(cache.obtener(A, 'resumen', ['x', 'z'], calcular)).resolves.toEqual({ n: 3 });
    // Un parámetro ausente no se confunde con la cadena "null" ni se corre de lugar.
    expect(CacheAgregados.llave(A, 'r', [undefined, 'a'])).not.toBe(
      CacheAgregados.llave(A, 'r', ['a', undefined]),
    );
    expect(CacheAgregados.llave(A, 'r', [undefined])).not.toBe(
      CacheAgregados.llave(A, 'r', ['null']),
    );
  });

  it('un error NO se cachea: el siguiente intento vuelve a calcular', async () => {
    const falla = jest.fn().mockRejectedValue(new NotFoundException());
    await expect(cache.obtener(A, 'resumen', ['x'], falla)).rejects.toThrow(NotFoundException);
    await expect(cache.obtener(A, 'resumen', ['x'], falla)).rejects.toThrow(NotFoundException);
    expect(falla).toHaveBeenCalledTimes(2);
    expect(cache.tamano).toBe(0);
  });

  it('congela lo guardado: una mutación accidental truena', async () => {
    const v = await cache.obtener(A, 'resumen', ['x'], () =>
      Promise.resolve({ lista: [{ monto: '1.00' }] }),
    );
    expect(() => {
      (v.lista[0] as { monto: string }).monto = '2.00';
    }).toThrow(TypeError);
  });

  it(`no pasa de ${MAX_ENTRADAS_CACHE} entradas: purga vencidas y luego la más vieja`, async () => {
    for (let i = 0; i < MAX_ENTRADAS_CACHE; i++) {
      await cache.obtener(A, 'resumen', [String(i)], calcular);
    }
    expect(cache.tamano).toBe(MAX_ENTRADAS_CACHE);
    // Lleno y nada vencido: sale la más vieja ('0'), las demás siguen.
    await cache.obtener(A, 'resumen', ['nueva'], calcular);
    expect(cache.tamano).toBe(MAX_ENTRADAS_CACHE);
    const antes = calculos;
    await cache.obtener(A, 'resumen', ['1'], calcular);
    expect(calculos).toBe(antes);
    await cache.obtener(A, 'resumen', ['0'], calcular);
    expect(calculos).toBe(antes + 1);
    // Todo vencido: la siguiente escritura purga las vencidas.
    reloj.t += TTL_CACHE_MS;
    await cache.obtener(A, 'resumen', ['otra'], calcular);
    expect(cache.tamano).toBe(1);
  });
});
