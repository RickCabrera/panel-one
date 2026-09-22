import { Prisma } from '@prisma/client';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import type { PolizaGuardada, PolizaNormalizada } from '../ingesta/movimientos';

/**
 * Las escrituras de pólizas y movimientos de inventario (F2-122). Son parte del helper
 * obligatorio de scope: sólo `ScopedPrismaService.movimientosDeSucursal(agente)` construye
 * `IngestaMovimientos`.
 *
 * Clavada a la SUCURSAL del agente (como `IngestaExistencias`): cada lectura y escritura pone
 * `sucursalId` y `empresaId` ella misma, desde la API key. Un lote corre en UNA transacción bajo
 * `pg_advisory_xact_lock(movimientos:<sucursal>)`: dos lotes de la misma sucursal van en serie,
 * también entre réplicas. La unique `(sucursal_id, origen_sr_id)` protege al final, y la FK
 * compuesta de las partidas impide colgarlas de una póliza de otra sucursal.
 *
 * El panel nunca escribe aquí: pólizas y movimientos son sólo lo que leyó el agente.
 */

/** Cuánto se espera el candado de la sucursal antes de rendirse (`lock_timeout`). */
export const ESPERA_CANDADO_MOVIMIENTOS_MS = 4000;
const TIMEOUT_SENTENCIA_MS = 5000;
const TIMEOUT_TRANSACCION_MS = 30_000;
const ESPERA_CONEXION_MS = 5000;

/** No se consiguió el candado a tiempo: otro lote de la misma sucursal se aplica. */
export class CandadoMovimientosOcupado extends Error {
  constructor() {
    super('Otro lote de movimientos de esta sucursal se está aplicando; reintentar.');
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
    throw new Error(`Escritura de movimientos: ${nombre} vacío o ausente en un filtro.`);
  }
  return valor;
}

function exigirFecha(nombre: string, valor: unknown): Date {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) {
    throw new Error(`Escritura de movimientos: ${nombre} no es una fecha válida.`);
  }
  return valor;
}

type Tx = Prisma.TransactionClient;

/** Las operaciones de UNA sucursal, dentro de su transacción y su candado. */
export class TransaccionMovimientos {
  readonly #tx: Tx;
  readonly #deLaSucursal: { readonly sucursalId: string; readonly empresaId: string };

  constructor(tx: Tx, sucursalId: string, empresaId: string) {
    this.#tx = tx;
    this.#deLaSucursal = Object.freeze({
      sucursalId: exigir('sucursalId', sucursalId),
      empresaId: exigir('empresaId', empresaId),
    });
  }

  /** Las pólizas guardadas de esta sucursal con esos `origenSrId`. */
  guardadas(origenes: readonly string[]): Promise<PolizaGuardada[]> {
    if (origenes.length === 0) return Promise.resolve([]);
    return this.#tx.polizaInventario.findMany({
      where: {
        origenSrId: { in: origenes.map((o) => exigir('origenSrId', o)) },
        ...this.#deLaSucursal,
      },
      select: { id: true, origenSrId: true, hash: true, leidaAt: true },
    });
  }

  #cabecera(p: PolizaNormalizada, leidaAt: Date, ahora: Date) {
    return {
      folio: p.folio,
      tipo: p.tipo,
      tipoSr: p.tipoSr,
      almacenOrigenSrId: exigir('almacenOrigenSrId', p.almacenOrigenSrId),
      fecha: exigirFecha('fecha', p.fecha),
      referencia: p.referencia,
      cancelada: p.cancelada,
      partidas: p.partidas.length,
      hash: p.hash,
      leidaAt: exigirFecha('leidaAt', leidaAt),
      recibidaAt: exigirFecha('ahora', ahora),
      updatedAt: ahora,
    };
  }

  async #escribirPartidas(polizaId: string, p: PolizaNormalizada): Promise<void> {
    if (p.partidas.length === 0) return;
    await this.#tx.movimientoInventario.createMany({
      data: p.partidas.map((x) => ({
        polizaId: exigir('polizaId', polizaId),
        renglon: x.renglon,
        almacenOrigenSrId: p.almacenOrigenSrId,
        insumoOrigenSrId: exigir('insumoOrigenSrId', x.insumoOrigenSrId),
        fecha: p.fecha,
        cantidad: x.cantidad,
        costoUnitario: x.costoUnitario,
        importe: x.importe,
        ...this.#deLaSucursal,
      })),
    });
  }

  async crear(p: PolizaNormalizada, leidaAt: Date, ahora: Date): Promise<void> {
    const { id } = await this.#tx.polizaInventario.create({
      data: {
        origenSrId: exigir('origenSrId', p.origenSrId),
        ...this.#cabecera(p, leidaAt, ahora),
        ...this.#deLaSucursal,
      },
      select: { id: true },
    });
    await this.#escribirPartidas(id, p);
  }

  /** Reescribe la cabecera y REEMPLAZA las partidas: una corrección no duplica ni deja renglones viejos. */
  async reemplazar(id: string, p: PolizaNormalizada, leidaAt: Date, ahora: Date): Promise<void> {
    const deLaPoliza = { id: exigir('id', id), origenSrId: p.origenSrId, ...this.#deLaSucursal };
    const { count } = await this.#tx.polizaInventario.updateMany({
      where: deLaPoliza,
      data: this.#cabecera(p, leidaAt, ahora),
    });
    if (count !== 1) {
      throw new Error(`Escritura de movimientos: la póliza ${id} no es de esta sucursal.`);
    }
    await this.#tx.movimientoInventario.deleteMany({
      where: { polizaId: deLaPoliza.id, ...this.#deLaSucursal },
    });
    await this.#escribirPartidas(deLaPoliza.id, p);
  }

  /** Mismo contenido leído más tarde: sólo avanza `leida_at` (ni `updated_at` ni las partidas). */
  async avanzarLectura(id: string, leidaAt: Date): Promise<void> {
    const { count } = await this.#tx.polizaInventario.updateMany({
      where: { id: exigir('id', id), ...this.#deLaSucursal },
      data: { leidaAt: exigirFecha('leidaAt', leidaAt) },
    });
    if (count !== 1) {
      throw new Error(`Escritura de movimientos: la póliza ${id} no es de esta sucursal.`);
    }
  }
}

/** Lo que el helper necesita del cliente crudo. */
export interface ClienteMovimientos {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
}

/** Lo que devuelve `ScopedPrismaService.movimientosDeSucursal(agente)`. */
export class IngestaMovimientos {
  readonly #cliente: ClienteMovimientos;
  readonly #sucursalId: string;
  readonly #empresaId: string;

  constructor(cliente: ClienteMovimientos, agente: AgenteAutenticado) {
    this.#cliente = cliente;
    this.#sucursalId = exigir('sucursalId', agente.sucursalId);
    this.#empresaId = exigir('empresaId', agente.empresaId);
  }

  /** Corre `fn` en UNA transacción con el candado de la sucursal. */
  async bajoCandado<T>(fn: (tx: TransaccionMovimientos) => Promise<T>): Promise<T> {
    try {
      return await this.#cliente.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', ${String(ESPERA_CANDADO_MOVIMIENTOS_MS)}, true)`;
          await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(TIMEOUT_SENTENCIA_MS)}, true)`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`movimientos:${this.#sucursalId}`}))`;
          return fn(new TransaccionMovimientos(tx, this.#sucursalId, this.#empresaId));
        },
        { maxWait: ESPERA_CONEXION_MS, timeout: TIMEOUT_TRANSACCION_MS },
      );
    } catch (error) {
      if (esCandadoOcupado(error)) {
        throw new CandadoMovimientosOcupado();
      }
      throw error;
    }
  }
}
