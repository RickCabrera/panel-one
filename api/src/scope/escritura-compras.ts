import { Prisma } from '@prisma/client';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import type { CompraGuardada, CompraNormalizada } from '../ingesta/compras';

/**
 * Las escrituras de las compras leídas de SR (F2-126), calcadas de `escritura-movimientos.ts`
 * (F2-122). Son parte del helper obligatorio de scope: sólo
 * `ScopedPrismaService.comprasDeSucursal(agente)` construye `IngestaCompras`.
 *
 * Clavada a la SUCURSAL del agente: cada lectura y escritura pone `sucursalId` y `empresaId` ella
 * misma, desde la API key. Un lote corre en UNA transacción bajo
 * `pg_advisory_xact_lock(compras:<sucursal>)`: dos lotes de la misma sucursal van en serie, también
 * entre réplicas. La unique `(sucursal_id, origen_sr_id)` protege al final, y la FK compuesta de las
 * partidas impide colgarlas de una compra de otra sucursal.
 *
 * El panel nunca escribe aquí: las compras son sólo lo que leyó el agente. Y nada de esto escribe
 * a SoftRestaurant.
 */

/** Cuánto se espera el candado de la sucursal antes de rendirse (`lock_timeout`). */
export const ESPERA_CANDADO_COMPRAS_MS = 4000;
const TIMEOUT_SENTENCIA_MS = 5000;
const TIMEOUT_TRANSACCION_MS = 30_000;
const ESPERA_CONEXION_MS = 5000;

/** No se consiguió el candado a tiempo: otro lote de la misma sucursal se aplica. */
export class CandadoComprasOcupado extends Error {
  constructor() {
    super('Otro lote de compras de esta sucursal se está aplicando; reintentar.');
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
    throw new Error(`Escritura de compras: ${nombre} vacío o ausente en un filtro.`);
  }
  return valor;
}

function exigirFecha(nombre: string, valor: unknown): Date {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) {
    throw new Error(`Escritura de compras: ${nombre} no es una fecha válida.`);
  }
  return valor;
}

type Tx = Prisma.TransactionClient;

/** Las operaciones de UNA sucursal, dentro de su transacción y su candado. */
export class TransaccionCompras {
  readonly #tx: Tx;
  readonly #deLaSucursal: { readonly sucursalId: string; readonly empresaId: string };

  constructor(tx: Tx, sucursalId: string, empresaId: string) {
    this.#tx = tx;
    this.#deLaSucursal = Object.freeze({
      sucursalId: exigir('sucursalId', sucursalId),
      empresaId: exigir('empresaId', empresaId),
    });
  }

  /** Las compras guardadas de esta sucursal con esos `origenSrId`. */
  guardadas(origenes: readonly string[]): Promise<CompraGuardada[]> {
    if (origenes.length === 0) return Promise.resolve([]);
    return this.#tx.compra.findMany({
      where: {
        origenSrId: { in: origenes.map((o) => exigir('origenSrId', o)) },
        ...this.#deLaSucursal,
      },
      select: { id: true, origenSrId: true, hash: true, leidaAt: true },
    });
  }

  #cabecera(c: CompraNormalizada, leidaAt: Date, ahora: Date) {
    return {
      folio: c.folio,
      proveedorOrigenSrId: c.proveedorOrigenSrId,
      almacenOrigenSrId: c.almacenOrigenSrId,
      fecha: exigirFecha('fecha', c.fecha),
      cancelada: c.cancelada,
      total: c.total,
      partidas: c.partidas.length,
      hash: c.hash,
      leidaAt: exigirFecha('leidaAt', leidaAt),
      recibidaAt: exigirFecha('ahora', ahora),
      updatedAt: ahora,
    };
  }

  async #escribirPartidas(compraId: string, c: CompraNormalizada): Promise<void> {
    if (c.partidas.length === 0) return;
    await this.#tx.partidaCompra.createMany({
      data: c.partidas.map((x) => ({
        compraId: exigir('compraId', compraId),
        renglon: x.renglon,
        insumoOrigenSrId: exigir('insumoOrigenSrId', x.insumoOrigenSrId),
        cantidad: x.cantidad,
        costoUnitario: x.costoUnitario,
        importe: x.importe,
        ...this.#deLaSucursal,
      })),
    });
  }

  async crear(c: CompraNormalizada, leidaAt: Date, ahora: Date): Promise<void> {
    const { id } = await this.#tx.compra.create({
      data: {
        origenSrId: exigir('origenSrId', c.origenSrId),
        ...this.#cabecera(c, leidaAt, ahora),
        ...this.#deLaSucursal,
      },
      select: { id: true },
    });
    await this.#escribirPartidas(id, c);
  }

  /** Reescribe la cabecera y REEMPLAZA las partidas: una corrección no duplica ni deja renglones viejos. */
  async reemplazar(id: string, c: CompraNormalizada, leidaAt: Date, ahora: Date): Promise<void> {
    const deLaCompra = { id: exigir('id', id), origenSrId: c.origenSrId, ...this.#deLaSucursal };
    const { count } = await this.#tx.compra.updateMany({
      where: deLaCompra,
      data: this.#cabecera(c, leidaAt, ahora),
    });
    if (count !== 1) {
      throw new Error(`Escritura de compras: la compra ${id} no es de esta sucursal.`);
    }
    await this.#tx.partidaCompra.deleteMany({
      where: { compraId: deLaCompra.id, ...this.#deLaSucursal },
    });
    await this.#escribirPartidas(deLaCompra.id, c);
  }

  /** Mismo contenido leído más tarde: sólo avanza `leida_at` (ni `updated_at` ni las partidas). */
  async avanzarLectura(id: string, leidaAt: Date): Promise<void> {
    const { count } = await this.#tx.compra.updateMany({
      where: { id: exigir('id', id), ...this.#deLaSucursal },
      data: { leidaAt: exigirFecha('leidaAt', leidaAt) },
    });
    if (count !== 1) {
      throw new Error(`Escritura de compras: la compra ${id} no es de esta sucursal.`);
    }
  }
}

/** Lo que el helper necesita del cliente crudo. */
export interface ClienteCompras {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
}

/** Lo que devuelve `ScopedPrismaService.comprasDeSucursal(agente)`. */
export class IngestaCompras {
  readonly #cliente: ClienteCompras;
  readonly #sucursalId: string;
  readonly #empresaId: string;

  constructor(cliente: ClienteCompras, agente: AgenteAutenticado) {
    this.#cliente = cliente;
    this.#sucursalId = exigir('sucursalId', agente.sucursalId);
    this.#empresaId = exigir('empresaId', agente.empresaId);
  }

  /** Corre `fn` en UNA transacción con el candado de la sucursal. */
  async bajoCandado<T>(fn: (tx: TransaccionCompras) => Promise<T>): Promise<T> {
    try {
      return await this.#cliente.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', ${String(ESPERA_CANDADO_COMPRAS_MS)}, true)`;
          await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(TIMEOUT_SENTENCIA_MS)}, true)`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`compras:${this.#sucursalId}`}))`;
          return fn(new TransaccionCompras(tx, this.#sucursalId, this.#empresaId));
        },
        { maxWait: ESPERA_CONEXION_MS, timeout: TIMEOUT_TRANSACCION_MS },
      );
    } catch (error) {
      if (esCandadoOcupado(error)) {
        throw new CandadoComprasOcupado();
      }
      throw error;
    }
  }
}
