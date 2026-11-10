import { Prisma } from '@prisma/client';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import type { FilaFormaPago, PlanFormasPago } from '../ingesta/formas-pago';
import { CandadoCatalogoOcupado, ESPERA_CANDADO_CATALOGO_MS } from './escritura-catalogos';

/**
 * Las escrituras del catálogo de formas de pago que manda el agente (PAG-01). Son parte del
 * helper obligatorio de scope: sólo `ScopedPrismaService.formasPagoDeAgente(agente)` construye
 * esta clase.
 *
 * Clavada a la EMPRESA y la SUCURSAL del agente (de la API key): cada lectura y escritura pone
 * `empresaId` ella misma, y las filas nuevas llevan `sucursalOrigenId` = la sucursal del agente.
 * Nada de lo que llega puede moverlas. Una página corre en UNA transacción bajo
 * `pg_advisory_xact_lock` de la EMPRESA: dos sucursales de la misma empresa que mandan su
 * catálogo a la vez van en serie (el catálogo es por empresa), y la unique
 * `(empresa_id, forma_raw)` protege al final: un choque sale como transitorio, nunca como fila
 * doble.
 *
 * Las filas `manual` no se tocan nunca: el `updateMany` exige `origen = pos` además del id, y si
 * no actualiza exactamente una fila, la transacción entera se revierte.
 */

const TIMEOUT_SENTENCIA_MS = 5000;
const TIMEOUT_TRANSACCION_MS = 30_000;
const ESPERA_CONEXION_MS = 5000;

type Tx = Prisma.TransactionClient;

function exigir(nombre: string, valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new Error(`Escritura de formas de pago: ${nombre} vacío o ausente en un filtro.`);
  }
  return valor;
}

function esCandadoOcupado(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  const meta = error.meta as { code?: unknown } | undefined;
  return meta?.code === '55P03' || error.message.includes('55P03');
}

/** Las operaciones dentro de la transacción y el candado de la empresa. */
export class TransaccionFormasPago {
  readonly #tx: Tx;
  readonly #empresaId: string;
  readonly #sucursalId: string;

  constructor(tx: Tx, empresaId: string, sucursalId: string) {
    this.#tx = tx;
    this.#empresaId = exigir('empresaId', empresaId);
    this.#sucursalId = exigir('sucursalId', sucursalId);
  }

  /** Las filas de ESTA empresa con esos textos, en una sola consulta. */
  existentes(textos: readonly string[]): Promise<FilaFormaPago[]> {
    if (textos.length === 0) {
      return Promise.resolve([]);
    }
    return this.#tx.formaPagoCatalogo.findMany({
      where: { empresaId: this.#empresaId, formaRaw: { in: [...textos] } },
      select: {
        id: true,
        formaRaw: true,
        forma: true,
        origen: true,
        tipoSr: true,
        sucursalOrigenId: true,
      },
    });
  }

  /** Aplica el plan de `planearFormasPago()`. `ahora` (reloj del API) es el `updatedAt` de lo que cambia. */
  async aplicar(plan: PlanFormasPago, ahora: Date): Promise<void> {
    if (plan.crear.length > 0) {
      await this.#tx.formaPagoCatalogo.createMany({
        data: plan.crear.map((c) => ({
          formaRaw: exigir('formaRaw', c.formaRaw),
          forma: c.forma,
          tipoSr: c.tipoSr,
          origen: 'pos' as const,
          empresaId: this.#empresaId,
          sucursalOrigenId: this.#sucursalId,
          updatedAt: ahora,
        })),
      });
    }
    for (const a of plan.actualizar) {
      const { count } = await this.#tx.formaPagoCatalogo.updateMany({
        where: {
          id: exigir('id', a.id),
          empresaId: this.#empresaId,
          sucursalOrigenId: this.#sucursalId,
          origen: 'pos',
        },
        data: { forma: a.forma, tipoSr: a.tipoSr, updatedAt: ahora },
      });
      if (count !== 1) {
        throw new Error(
          `Escritura de formas de pago: la fila ${a.id} no es una fila pos de esta sucursal.`,
        );
      }
    }
  }

  /** Cuántas filas tiene el catálogo de la empresa (las `pos` y las `manual`). */
  contar(): Promise<number> {
    return this.#tx.formaPagoCatalogo.count({ where: { empresaId: this.#empresaId } });
  }
}

/** Lo que el helper necesita del cliente crudo. */
export interface ClienteFormasPago {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
}

/** Lo que devuelve `ScopedPrismaService.formasPagoDeAgente(agente)`. */
export class IngestaFormasPago {
  readonly #cliente: ClienteFormasPago;
  readonly #empresaId: string;
  readonly #sucursalId: string;

  constructor(cliente: ClienteFormasPago, agente: AgenteAutenticado) {
    this.#cliente = cliente;
    this.#empresaId = exigir('empresaId', agente.empresaId);
    this.#sucursalId = exigir('sucursalId', agente.sucursalId);
  }

  /** Corre `fn` en UNA transacción con el candado del catálogo de formas de pago de la empresa. */
  async bajoCandado<T>(fn: (tx: TransaccionFormasPago) => Promise<T>): Promise<T> {
    try {
      return await this.#cliente.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', ${String(ESPERA_CANDADO_CATALOGO_MS)}, true)`;
          await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(TIMEOUT_SENTENCIA_MS)}, true)`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`formas_pago:${this.#empresaId}`}), 0)`;
          return fn(new TransaccionFormasPago(tx, this.#empresaId, this.#sucursalId));
        },
        { maxWait: ESPERA_CONEXION_MS, timeout: TIMEOUT_TRANSACCION_MS },
      );
    } catch (error) {
      if (esCandadoOcupado(error)) {
        throw new CandadoCatalogoOcupado();
      }
      throw error;
    }
  }
}
