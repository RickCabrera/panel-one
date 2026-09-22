import { Prisma } from '@prisma/client';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import type { RecetaGuardada, RecetaNormalizada } from '../ingesta/recetas';

/**
 * Las escrituras de recetas (F2-125). Son parte del helper obligatorio de scope: sólo
 * `ScopedPrismaService.recetasDeSucursal(agente)` construye `IngestaRecetas`.
 *
 * Clavada a la SUCURSAL del agente (como `IngestaMovimientos`): cada lectura y escritura pone
 * `sucursalId` y `empresaId` ella misma, desde la API key. Un lote corre en UNA transacción bajo
 * `pg_advisory_xact_lock(recetas:<sucursal>)`: dos lotes de la misma sucursal van en serie. La
 * unique `(sucursal_id, producto_origen_sr_id)` protege al final, y la FK compuesta de los
 * renglones impide colgarlos de una receta de otra sucursal.
 *
 * El panel nunca escribe aquí: las recetas son sólo lo que leyó el agente.
 */

/** Cuánto se espera el candado de la sucursal antes de rendirse (`lock_timeout`). */
export const ESPERA_CANDADO_RECETAS_MS = 4000;
const TIMEOUT_SENTENCIA_MS = 5000;
const TIMEOUT_TRANSACCION_MS = 30_000;
const ESPERA_CONEXION_MS = 5000;

/** No se consiguió el candado a tiempo: otro lote de recetas de la misma sucursal se aplica. */
export class CandadoRecetasOcupado extends Error {
  constructor() {
    super('Otro lote de recetas de esta sucursal se está aplicando; reintentar.');
  }
}

function esCandadoOcupado(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  const meta = error.meta as { code?: unknown } | undefined;
  return meta?.code === '55P03' || error.message.includes('55P03');
}

function exigir(nombre: string, valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new Error(`Escritura de recetas: ${nombre} vacío o ausente en un filtro.`);
  }
  return valor;
}

function exigirFecha(nombre: string, valor: unknown): Date {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) {
    throw new Error(`Escritura de recetas: ${nombre} no es una fecha válida.`);
  }
  return valor;
}

type Tx = Prisma.TransactionClient;

/** Las operaciones de UNA sucursal, dentro de su transacción y su candado. */
export class TransaccionRecetas {
  readonly #tx: Tx;
  readonly #deLaSucursal: { readonly sucursalId: string; readonly empresaId: string };

  constructor(tx: Tx, sucursalId: string, empresaId: string) {
    this.#tx = tx;
    this.#deLaSucursal = Object.freeze({
      sucursalId: exigir('sucursalId', sucursalId),
      empresaId: exigir('empresaId', empresaId),
    });
  }

  /** Las recetas guardadas de esta sucursal de esos productos. */
  guardadas(productos: readonly string[]): Promise<RecetaGuardada[]> {
    if (productos.length === 0) return Promise.resolve([]);
    return this.#tx.receta.findMany({
      where: {
        productoOrigenSrId: { in: productos.map((p) => exigir('productoOrigenSrId', p)) },
        ...this.#deLaSucursal,
      },
      select: { id: true, productoOrigenSrId: true, hash: true, leidaAt: true },
    });
  }

  #cabecera(r: RecetaNormalizada, leidaAt: Date, ahora: Date) {
    return {
      renglones: r.renglones.length,
      hash: r.hash,
      leidaAt: exigirFecha('leidaAt', leidaAt),
      recibidaAt: exigirFecha('ahora', ahora),
      updatedAt: ahora,
    };
  }

  async #escribirRenglones(recetaId: string, r: RecetaNormalizada): Promise<void> {
    if (r.renglones.length === 0) return;
    await this.#tx.renglonReceta.createMany({
      data: r.renglones.map((x) => ({
        recetaId: exigir('recetaId', recetaId),
        renglon: x.renglon,
        insumoOrigenSrId: exigir('insumoOrigenSrId', x.insumoOrigenSrId),
        cantidad: x.cantidad,
        ...this.#deLaSucursal,
      })),
    });
  }

  async crear(r: RecetaNormalizada, leidaAt: Date, ahora: Date): Promise<void> {
    const { id } = await this.#tx.receta.create({
      data: {
        productoOrigenSrId: exigir('productoOrigenSrId', r.productoOrigenSrId),
        ...this.#cabecera(r, leidaAt, ahora),
        ...this.#deLaSucursal,
      },
      select: { id: true },
    });
    await this.#escribirRenglones(id, r);
  }

  /** Reescribe la cabecera y REEMPLAZA los renglones: una corrección no deja renglones viejos. */
  async reemplazar(id: string, r: RecetaNormalizada, leidaAt: Date, ahora: Date): Promise<void> {
    const deLaReceta = {
      id: exigir('id', id),
      productoOrigenSrId: r.productoOrigenSrId,
      ...this.#deLaSucursal,
    };
    const { count } = await this.#tx.receta.updateMany({
      where: deLaReceta,
      data: this.#cabecera(r, leidaAt, ahora),
    });
    if (count !== 1) {
      throw new Error(`Escritura de recetas: la receta ${id} no es de esta sucursal.`);
    }
    await this.#tx.renglonReceta.deleteMany({
      where: { recetaId: deLaReceta.id, ...this.#deLaSucursal },
    });
    await this.#escribirRenglones(deLaReceta.id, r);
  }

  /** Mismo contenido leído más tarde: sólo avanza `leida_at` (ni `updated_at` ni los renglones). */
  async avanzarLectura(id: string, leidaAt: Date): Promise<void> {
    const { count } = await this.#tx.receta.updateMany({
      where: { id: exigir('id', id), ...this.#deLaSucursal },
      data: { leidaAt: exigirFecha('leidaAt', leidaAt) },
    });
    if (count !== 1) {
      throw new Error(`Escritura de recetas: la receta ${id} no es de esta sucursal.`);
    }
  }
}

/** Lo que el helper necesita del cliente crudo. */
export interface ClienteRecetas {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
}

/** Lo que devuelve `ScopedPrismaService.recetasDeSucursal(agente)`. */
export class IngestaRecetas {
  readonly #cliente: ClienteRecetas;
  readonly #sucursalId: string;
  readonly #empresaId: string;

  constructor(cliente: ClienteRecetas, agente: AgenteAutenticado) {
    this.#cliente = cliente;
    this.#sucursalId = exigir('sucursalId', agente.sucursalId);
    this.#empresaId = exigir('empresaId', agente.empresaId);
  }

  /** Corre `fn` en UNA transacción con el candado de recetas de la sucursal. */
  async bajoCandado<T>(fn: (tx: TransaccionRecetas) => Promise<T>): Promise<T> {
    try {
      return await this.#cliente.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', ${String(ESPERA_CANDADO_RECETAS_MS)}, true)`;
          await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(TIMEOUT_SENTENCIA_MS)}, true)`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`recetas:${this.#sucursalId}`}))`;
          return fn(new TransaccionRecetas(tx, this.#sucursalId, this.#empresaId));
        },
        { maxWait: ESPERA_CONEXION_MS, timeout: TIMEOUT_TRANSACCION_MS },
      );
    } catch (error) {
      if (esCandadoOcupado(error)) {
        throw new CandadoRecetasOcupado();
      }
      throw error;
    }
  }
}
