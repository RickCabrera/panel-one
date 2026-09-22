import { Prisma } from '@prisma/client';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import type { ExistenciaGuardada, PlanFoto } from '../ingesta/existencias';
import type { EmpresaScope } from './empresa-scope';
import { encontradoOr404, whereScoped } from './scope.helper';

/**
 * Las escrituras de existencias (F2-121). Son parte del helper obligatorio de scope: sólo
 * `ScopedPrismaService.existenciasDeSucursal(agente)` y `.existencias(scope)` construyen estas
 * clases.
 *
 * - `IngestaExistencias`: clavada a la SUCURSAL del agente (como `IngestaCatalogos`). Cada
 *   lectura y escritura pone `sucursalId` y `empresaId` ella misma, desde la API key. La foto de
 *   un almacén corre en UNA transacción bajo `pg_advisory_xact_lock(sucursal, almacén)`: dos
 *   fotos del mismo almacén van en serie, también entre réplicas. La unique
 *   `(sucursal_id, almacen_origen_sr_id, insumo_origen_sr_id)` protege al final.
 * - `EscrituraExistencias`: los límites (mínimo/máximo) que edita el panel, con la sucursal
 *   verificada CON el scope del usuario: fuera de alcance = 404, igual que inexistente. Nunca
 *   escriben a SoftRestaurant: viven sólo en Postgres.
 */

/** Cuánto se espera el candado del almacén antes de rendirse (`lock_timeout`). */
export const ESPERA_CANDADO_EXISTENCIAS_MS = 4000;
const TIMEOUT_SENTENCIA_MS = 5000;
const TIMEOUT_TRANSACCION_MS = 30_000;
const ESPERA_CONEXION_MS = 5000;

/** No se consiguió el candado del almacén a tiempo: otra foto del mismo almacén se aplica. */
export class CandadoExistenciasOcupado extends Error {
  constructor() {
    super('Otra foto de este almacén se está aplicando; reintentar.');
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
    throw new Error(`Escritura de existencias: ${nombre} vacío o ausente en un filtro.`);
  }
  return valor;
}

function exigirFecha(nombre: string, valor: unknown): Date {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) {
    throw new Error(`Escritura de existencias: ${nombre} no es una fecha válida.`);
  }
  return valor;
}

type Tx = Prisma.TransactionClient;

export interface LecturaAlmacen {
  capturadoAt: Date;
  recibidaAt: Date;
}

/** Las operaciones de UN almacén de UNA sucursal, dentro de su transacción y su candado. */
export class TransaccionExistencias {
  readonly #tx: Tx;
  readonly #delAlmacen: {
    readonly sucursalId: string;
    readonly empresaId: string;
    readonly almacenOrigenSrId: string;
  };

  constructor(tx: Tx, sucursalId: string, empresaId: string, almacenOrigenSrId: string) {
    this.#tx = tx;
    this.#delAlmacen = Object.freeze({
      sucursalId: exigir('sucursalId', sucursalId),
      empresaId: exigir('empresaId', empresaId),
      almacenOrigenSrId: exigir('almacenOrigenSrId', almacenOrigenSrId),
    });
  }

  lectura(): Promise<LecturaAlmacen | null> {
    return this.#tx.lecturaExistencias.findFirst({
      where: this.#delAlmacen,
      select: { capturadoAt: true, recibidaAt: true },
    });
  }

  existentes(): Promise<ExistenciaGuardada[]> {
    return this.#tx.existencia.findMany({
      where: this.#delAlmacen,
      select: {
        id: true,
        insumoOrigenSrId: true,
        cantidad: true,
        costoPromedio: true,
        valor: true,
      },
    });
  }

  /** Aplica el plan de `decidirFoto()`. `ahora` (reloj del API) es el `updatedAt` de lo que cambia. */
  async aplicar(plan: PlanFoto, ahora: Date): Promise<void> {
    const cuando = exigirFecha('ahora', ahora);
    if (plan.crear.length > 0) {
      await this.#tx.existencia.createMany({
        data: plan.crear.map((r) => ({
          insumoOrigenSrId: exigir('insumoOrigenSrId', r.insumoOrigenSrId),
          cantidad: r.cantidad,
          costoPromedio: r.costoPromedio,
          valor: r.valor,
          updatedAt: cuando,
          ...this.#delAlmacen,
        })),
      });
    }
    for (const { id, r } of plan.actualizar) {
      const { count } = await this.#tx.existencia.updateMany({
        where: { id: exigir('id', id), ...this.#delAlmacen },
        data: {
          cantidad: r.cantidad,
          costoPromedio: r.costoPromedio,
          valor: r.valor,
          updatedAt: cuando,
        },
      });
      if (count !== 1) {
        throw new Error(`Escritura de existencias: la fila ${id} no es de este almacén.`);
      }
    }
    if (plan.borrar.length > 0) {
      await this.#tx.existencia.deleteMany({
        where: { id: { in: plan.borrar.map((id) => exigir('id', id)) }, ...this.#delAlmacen },
      });
    }
  }

  contar(): Promise<number> {
    return this.#tx.existencia.count({ where: this.#delAlmacen });
  }

  async guardarLectura(d: { capturadoAt: Date; recibidaAt: Date; filas: number }): Promise<void> {
    const valores = {
      capturadoAt: exigirFecha('capturadoAt', d.capturadoAt),
      recibidaAt: exigirFecha('recibidaAt', d.recibidaAt),
      filas: d.filas,
    };
    await this.#tx.lecturaExistencias.upsert({
      where: {
        sucursalId_almacenOrigenSrId: {
          sucursalId: this.#delAlmacen.sucursalId,
          almacenOrigenSrId: this.#delAlmacen.almacenOrigenSrId,
        },
      },
      create: { ...valores, ...this.#delAlmacen },
      update: valores,
    });
  }
}

/** Lo que el helper necesita del cliente crudo. */
export interface ClienteExistencias {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
}

/** Lo que devuelve `ScopedPrismaService.existenciasDeSucursal(agente)`. */
export class IngestaExistencias {
  readonly #cliente: ClienteExistencias;
  readonly #sucursalId: string;
  readonly #empresaId: string;

  constructor(cliente: ClienteExistencias, agente: AgenteAutenticado) {
    this.#cliente = cliente;
    this.#sucursalId = exigir('sucursalId', agente.sucursalId);
    this.#empresaId = exigir('empresaId', agente.empresaId);
  }

  /** Corre `fn` en UNA transacción con el candado de (sucursal, almacén). */
  async bajoCandado<T>(
    almacenOrigenSrId: string,
    fn: (tx: TransaccionExistencias) => Promise<T>,
  ): Promise<T> {
    const almacen = exigir('almacenOrigenSrId', almacenOrigenSrId);
    try {
      return await this.#cliente.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', ${String(ESPERA_CANDADO_EXISTENCIAS_MS)}, true)`;
          await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(TIMEOUT_SENTENCIA_MS)}, true)`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`existencias:${this.#sucursalId}`}), hashtext(${almacen}))`;
          return fn(new TransaccionExistencias(tx, this.#sucursalId, this.#empresaId, almacen));
        },
        { maxWait: ESPERA_CONEXION_MS, timeout: TIMEOUT_TRANSACCION_MS },
      );
    } catch (error) {
      if (esCandadoOcupado(error)) {
        throw new CandadoExistenciasOcupado();
      }
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// escrituras del panel
// ---------------------------------------------------------------------------

export interface LlaveArticulo {
  empresaId: string;
  sucursalId: string;
  almacenOrigenSrId: string;
  insumoOrigenSrId: string;
}

type ClientePanel = Pick<Prisma.TransactionClient, 'sucursal' | 'existencia' | 'limiteExistencia'>;

/** Lo que devuelve `ScopedPrismaService.existencias(scope)`. */
export class EscrituraExistencias {
  readonly #cliente: ClientePanel;
  readonly #scope: EmpresaScope;

  constructor(cliente: ClientePanel, scope: EmpresaScope) {
    this.#cliente = cliente;
    this.#scope = scope;
  }

  /**
   * Guarda (o, con los dos nulos, borra) el mínimo y el máximo de un artículo en su almacén. La
   * sucursal se busca CON el scope y dentro de la empresa pedida, y el artículo tiene que existir
   * en ese almacén (con existencia leída o con un límite ya guardado): si no, el mismo 404.
   */
  async guardarLimites(
    llave: LlaveArticulo,
    minimo: Prisma.Decimal | null,
    maximo: Prisma.Decimal | null,
    actorId: string,
    ahora: Date,
  ): Promise<void> {
    const sucursal = encontradoOr404(
      await this.#cliente.sucursal.findFirst({
        where: whereScoped(this.#scope, 'Sucursal', {
          id: exigir('sucursalId', llave.sucursalId),
          empresaId: exigir('empresaId', llave.empresaId),
        }),
        select: { id: true, empresaId: true },
      }),
    );
    const delArticulo = {
      sucursalId: sucursal.id,
      empresaId: sucursal.empresaId,
      almacenOrigenSrId: exigir('almacenOrigenSrId', llave.almacenOrigenSrId),
      insumoOrigenSrId: exigir('insumoOrigenSrId', llave.insumoOrigenSrId),
    };
    const [existencia, limite] = await Promise.all([
      this.#cliente.existencia.findFirst({
        where: whereScoped(this.#scope, 'Existencia', delArticulo),
        select: { id: true },
      }),
      this.#cliente.limiteExistencia.findFirst({
        where: whereScoped(this.#scope, 'LimiteExistencia', delArticulo),
        select: { id: true },
      }),
    ]);
    encontradoOr404(existencia ?? limite);
    if (minimo === null && maximo === null) {
      await this.#cliente.limiteExistencia.deleteMany({
        where: whereScoped(this.#scope, 'LimiteExistencia', delArticulo),
      });
      return;
    }
    const valores = {
      minimo,
      maximo,
      actualizadoPor: exigir('actorId', actorId),
      updatedAt: exigirFecha('ahora', ahora),
    };
    await this.#cliente.limiteExistencia.upsert({
      where: {
        sucursalId_almacenOrigenSrId_insumoOrigenSrId: {
          sucursalId: delArticulo.sucursalId,
          almacenOrigenSrId: delArticulo.almacenOrigenSrId,
          insumoOrigenSrId: delArticulo.insumoOrigenSrId,
        },
      },
      create: { ...valores, ...delArticulo },
      update: valores,
    });
  }
}
