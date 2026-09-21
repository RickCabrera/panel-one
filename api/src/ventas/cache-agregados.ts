import { Injectable } from '@nestjs/common';

import { Reloj } from '../comun/reloj';
import type { EmpresaScope } from '../scope/empresa-scope';

/** Vida de una entrada del cache de agregados (F1-033). */
export const TTL_CACHE_MS = 15_000;
/** Tope de entradas: al llenarse se purgan las vencidas y, si no basta, la más vieja. */
export const MAX_ENTRADAS_CACHE = 1_000;

type Parametro = string | number | undefined;

/**
 * Cache in-memory de 15 s para los agregados de ventas (F1-033).
 *
 * LA LLAVE LLEVA EL SCOPE DEL USUARIO (`global` o `empresa:<id>`, el que puso el
 * `JwtAuthGuard` desde el token, nunca un dato del query) además del endpoint y
 * TODOS los parámetros. Un resultado calculado para A sólo se le sirve a otro
 * request con el mismo scope y los mismos parámetros: un visor de B que pide el
 * filtro de A no encuentra nada aquí, recalcula y cae en el 404 del servicio.
 *
 * El controller lo consulta DESPUÉS del ValidationPipe (los parámetros ya son
 * válidos) y sólo guarda resultados exitosos: un 400/404/500 no se cachea.
 * No deduplica cálculos en vuelo: dos requests idénticos simultáneos calculan
 * los dos. Los valores se congelan al guardarlos (nadie los debe mutar).
 */
@Injectable()
export class CacheAgregados {
  readonly #entradas = new Map<string, { vence: number; valor: unknown }>();

  constructor(private readonly reloj: Reloj) {}

  static llave(scope: EmpresaScope, endpoint: string, parametros: Parametro[]): string {
    const tenant = scope.tipo === 'global' ? 'global' : `empresa:${scope.empresaId}`;
    return JSON.stringify([tenant, endpoint, ...parametros.map((p) => p ?? null)]);
  }

  async obtener<T>(
    scope: EmpresaScope,
    endpoint: string,
    parametros: Parametro[],
    calcular: () => Promise<T>,
  ): Promise<T> {
    const llave = CacheAgregados.llave(scope, endpoint, parametros);
    const ahora = this.reloj.ahora();
    const entrada = this.#entradas.get(llave);
    if (entrada && entrada.vence > ahora) {
      return entrada.valor as T;
    }
    this.#entradas.delete(llave);
    const valor = congelar(await calcular());
    this.guardar(llave, valor, this.reloj.ahora());
    return valor;
  }

  /** Entradas guardadas (vencidas incluidas, hasta que se purguen). Para tests. */
  get tamano(): number {
    return this.#entradas.size;
  }

  private guardar(llave: string, valor: unknown, ahora: number): void {
    if (this.#entradas.size >= MAX_ENTRADAS_CACHE) {
      for (const [k, e] of this.#entradas) {
        if (e.vence <= ahora) {
          this.#entradas.delete(k);
        }
      }
    }
    if (this.#entradas.size >= MAX_ENTRADAS_CACHE) {
      // El Map itera en orden de inserción: la primera es la más vieja.
      const masVieja = this.#entradas.keys().next().value;
      if (masVieja !== undefined) {
        this.#entradas.delete(masVieja);
      }
    }
    this.#entradas.set(llave, { vence: ahora + TTL_CACHE_MS, valor });
  }
}

function congelar<T>(valor: T): T {
  if (valor !== null && typeof valor === 'object' && !Object.isFrozen(valor)) {
    Object.freeze(valor);
    for (const hijo of Object.values(valor)) {
      congelar(hijo);
    }
  }
  return valor;
}
