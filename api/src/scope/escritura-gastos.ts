import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { EmpresaScope } from './empresa-scope';
import { encontradoOr404, whereScoped } from './scope.helper';

/**
 * Las escrituras de categorías de gasto y gastos (F2-126). Son parte del helper obligatorio de
 * scope: sólo `ScopedPrismaService.gastos(scope)` construye esta clase.
 *
 * - Todo se verifica CON el scope del usuario y dentro de la empresa pedida: una empresa, una
 *   sucursal, una categoría o un gasto de otra empresa (o inexistente) dan el mismo 404.
 * - Cada operación corre en UNA transacción con timeouts cortos. Editar y anular escriben con
 *   `updateMany` condicionado a `anulado_at IS NULL`: dos operaciones sobre el mismo gasto no
 *   pisan una anulación (la segunda ve 0 filas y responde 409).
 * - Es dato NUESTRO: nada de esto escribe a SoftRestaurant ni al espejo de SR.
 */

const TIMEOUT_SENTENCIA_MS = 5000;
const TIMEOUT_TRANSACCION_MS = 15_000;
const ESPERA_CONEXION_MS = 5000;

type Tx = Prisma.TransactionClient;
type D = Prisma.Decimal;

/** Lo que el helper necesita del cliente crudo. */
export interface ClienteGastos {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
}

function exigir(nombre: string, valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new Error(`Escritura de gastos: ${nombre} vacío o ausente en un filtro.`);
  }
  return valor;
}

/** Violación de una unique (`P2002`). */
function esDuplicado(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/** El nombre con los espacios colapsados, y su clave en minúsculas: "Luz" y " luz " son la misma. */
export function nombreYClave(nombre: string): { nombre: string; nombreClave: string } {
  const limpio = nombre.trim().replace(/\s+/g, ' ');
  return { nombre: limpio, nombreClave: limpio.toLocaleLowerCase('es-MX') };
}

/** Un día `YYYY-MM-DD` como la fecha que guarda la columna DATE (medianoche UTC de ese día). */
export function fechaDeDia(dia: string): Date {
  return new Date(`${dia}T00:00:00.000Z`);
}

export interface NuevoGasto {
  empresaId: string;
  sucursalId: string;
  categoriaId: string;
  /** Día contable local de la sucursal, `YYYY-MM-DD` ya validado. */
  dia: string;
  concepto: string;
  /** > 0, a 2 decimales (lo valida el servicio). */
  monto: D;
  /** Sólo el seed lo manda: la llave de su idempotencia. */
  folio?: string | null;
}

export interface CambiosGasto {
  categoriaId?: string;
  dia?: string;
  concepto?: string;
  monto?: D;
}

export class EscrituraGastos {
  readonly #cliente: ClienteGastos;
  readonly #scope: EmpresaScope;

  constructor(cliente: ClienteGastos, scope: EmpresaScope) {
    this.#cliente = cliente;
    this.#scope = scope;
  }

  #enTransaccion<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.#cliente.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(TIMEOUT_SENTENCIA_MS)}, true)`;
        return fn(tx);
      },
      { maxWait: ESPERA_CONEXION_MS, timeout: TIMEOUT_TRANSACCION_MS },
    );
  }

  async #empresa(tx: Tx, empresaId: string) {
    return encontradoOr404(
      await tx.empresa.findFirst({
        where: whereScoped(this.#scope, 'Empresa', { id: exigir('empresaId', empresaId) }),
        select: { id: true },
      }),
    );
  }

  async #sucursal(tx: Tx, empresaId: string, sucursalId: string) {
    return encontradoOr404(
      await tx.sucursal.findFirst({
        where: whereScoped(this.#scope, 'Sucursal', {
          id: exigir('sucursalId', sucursalId),
          empresaId: exigir('empresaId', empresaId),
        }),
        select: { id: true },
      }),
    );
  }

  /** La categoría de la empresa; de otra empresa = 404. Inactiva = 400 (no admite gastos). */
  async #categoriaActiva(tx: Tx, empresaId: string, categoriaId: string) {
    const c = encontradoOr404(
      await tx.categoriaGasto.findFirst({
        where: whereScoped(this.#scope, 'CategoriaGasto', {
          id: exigir('categoriaId', categoriaId),
          empresaId: exigir('empresaId', empresaId),
        }),
        select: { id: true, activa: true },
      }),
    );
    if (!c.activa) {
      throw new BadRequestException('La categoría está inactiva: no admite gastos nuevos.');
    }
    return c;
  }

  async crearCategoria(empresaId: string, nombre: string, ahora: Date): Promise<string> {
    try {
      return await this.#enTransaccion(async (tx) => {
        await this.#empresa(tx, empresaId);
        const { id } = await tx.categoriaGasto.create({
          data: { empresaId, ...nombreYClave(nombre), activa: true, updatedAt: ahora },
          select: { id: true },
        });
        return id;
      });
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException('Ya existe una categoría con ese nombre en la empresa.');
      }
      throw error;
    }
  }

  async cambiarCategoria(
    empresaId: string,
    categoriaId: string,
    cambios: { nombre?: string; activa?: boolean },
    ahora: Date,
  ): Promise<void> {
    try {
      await this.#enTransaccion(async (tx) => {
        const donde = whereScoped(this.#scope, 'CategoriaGasto', {
          id: exigir('categoriaId', categoriaId),
          empresaId: exigir('empresaId', empresaId),
        });
        const { count } = await tx.categoriaGasto.updateMany({
          where: donde,
          data: {
            ...(cambios.nombre !== undefined ? nombreYClave(cambios.nombre) : {}),
            ...(cambios.activa !== undefined ? { activa: cambios.activa } : {}),
            updatedAt: ahora,
          },
        });
        if (count !== 1) encontradoOr404(null);
      });
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException('Ya existe una categoría con ese nombre en la empresa.');
      }
      throw error;
    }
  }

  /**
   * Registra un gasto y devuelve su id. Con `folio` (sólo el seed) es idempotente: si la sucursal
   * ya tiene un gasto con ese folio, lo deja igual a lo pedido (sin cambiar su id) y no duplica; si
   * ese gasto está anulado, no lo toca.
   */
  async crear(nuevo: NuevoGasto, actorId: string | null, ahora: Date): Promise<string> {
    try {
      return await this.#enTransaccion(async (tx) => {
        await this.#sucursal(tx, nuevo.empresaId, nuevo.sucursalId);
        await this.#categoriaActiva(tx, nuevo.empresaId, nuevo.categoriaId);
        const datos = {
          categoriaId: nuevo.categoriaId,
          dia: fechaDeDia(nuevo.dia),
          concepto: nuevo.concepto.trim(),
          monto: nuevo.monto,
        };
        if (nuevo.folio) {
          const existente = await tx.gasto.findFirst({
            where: whereScoped(this.#scope, 'Gasto', {
              empresaId: nuevo.empresaId,
              sucursalId: nuevo.sucursalId,
              folio: nuevo.folio,
            }),
            select: {
              id: true,
              categoriaId: true,
              dia: true,
              concepto: true,
              monto: true,
              anuladoAt: true,
            },
          });
          if (existente) {
            // Un gasto anulado en el panel se queda anulado: el seed no lo revive.
            const igual =
              existente.anuladoAt !== null ||
              (existente.categoriaId === datos.categoriaId &&
                existente.dia.getTime() === datos.dia.getTime() &&
                existente.concepto === datos.concepto &&
                existente.monto.equals(datos.monto));
            if (!igual) {
              await tx.gasto.updateMany({
                where: { id: existente.id, empresaId: nuevo.empresaId, anuladoAt: null },
                data: { ...datos, updatedAt: ahora },
              });
            }
            return existente.id;
          }
        }
        const { id } = await tx.gasto.create({
          data: {
            empresaId: nuevo.empresaId,
            sucursalId: nuevo.sucursalId,
            ...datos,
            folio: nuevo.folio ?? null,
            creadoPor: actorId,
            creadoAt: ahora,
            updatedAt: ahora,
          },
          select: { id: true },
        });
        return id;
      });
    } catch (error) {
      if (esDuplicado(error)) {
        throw new ConflictException('Ya existe un gasto con ese folio en la sucursal.');
      }
      throw error;
    }
  }

  /** El gasto de la empresa (con su sucursal); de otra empresa o inexistente = 404. */
  async #gasto(tx: Tx, empresaId: string, gastoId: string) {
    return encontradoOr404(
      await tx.gasto.findFirst({
        where: whereScoped(this.#scope, 'Gasto', {
          id: exigir('gastoId', gastoId),
          empresaId: exigir('empresaId', empresaId),
        }),
        select: { id: true, sucursalId: true, categoriaId: true, anuladoAt: true },
      }),
    );
  }

  /** Edita un gasto vigente. Anulado = 409. Una categoría nueva tiene que estar activa. */
  async editar(
    empresaId: string,
    gastoId: string,
    cambios: CambiosGasto,
    actorId: string,
    ahora: Date,
  ): Promise<{ sucursalId: string }> {
    return this.#enTransaccion(async (tx) => {
      const g = await this.#gasto(tx, empresaId, gastoId);
      if (g.anuladoAt !== null) {
        throw new ConflictException('El gasto está anulado: ya no se puede editar.');
      }
      if (cambios.categoriaId !== undefined && cambios.categoriaId !== g.categoriaId) {
        await this.#categoriaActiva(tx, empresaId, cambios.categoriaId);
      }
      const { count } = await tx.gasto.updateMany({
        where: { id: g.id, empresaId, anuladoAt: null },
        data: {
          ...(cambios.categoriaId !== undefined ? { categoriaId: cambios.categoriaId } : {}),
          ...(cambios.dia !== undefined ? { dia: fechaDeDia(cambios.dia) } : {}),
          ...(cambios.concepto !== undefined ? { concepto: cambios.concepto.trim() } : {}),
          ...(cambios.monto !== undefined ? { monto: cambios.monto } : {}),
          actualizadoPor: actorId,
          updatedAt: ahora,
        },
      });
      if (count !== 1) {
        throw new ConflictException('El gasto está anulado: ya no se puede editar.');
      }
      return { sucursalId: g.sucursalId };
    });
  }

  /** Baja lógica: el gasto se queda, marcado, y deja de sumar. Ya anulado = 409. */
  async anular(empresaId: string, gastoId: string, actorId: string, ahora: Date): Promise<void> {
    await this.#enTransaccion(async (tx) => {
      const g = await this.#gasto(tx, empresaId, gastoId);
      const { count } = await tx.gasto.updateMany({
        where: { id: g.id, empresaId, anuladoAt: null },
        data: { anuladoAt: ahora, anuladoPor: actorId, updatedAt: ahora },
      });
      if (count !== 1) {
        throw new ConflictException('El gasto ya estaba anulado.');
      }
    });
  }
}
