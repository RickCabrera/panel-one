import { MotivoCierreAlerta, Prisma, type TipoAlerta } from '@prisma/client';

import type { EmpresaScope } from './empresa-scope';
import { encontradoOr404, whereScoped } from './scope.helper';

/**
 * Las escrituras del centro de alertas (F2-224), con scope. Es parte del helper
 * obligatorio: sólo `ScopedPrismaService.alertas(scope)` construye esta clase.
 *
 * Todo pasa por `bajoCandado(empresaId, fn)`:
 * 1. La empresa se verifica CON el scope de quien llama (fuera de alcance = 404).
 * 2. Se abre UNA transacción que toma `pg_advisory_xact_lock` de esa empresa. Así la
 *    evaluación periódica, el cambio de una regla y otra réplica del API van en serie:
 *    lo que se lee adentro (reglas, abiertas, qué está activo) ya no puede cambiar
 *    hasta el commit.
 * 3. `fn` recibe una `TransaccionAlertas`, clavada a ESA empresa: cada lectura y cada
 *    escritura pone `empresaId` ella misma, nunca el caller.
 */

/** No se consiguió el candado de la empresa a tiempo (otra evaluación lo tiene). */
export class CandadoAlertasOcupado extends Error {
  constructor() {
    super('El centro de alertas de esta empresa está ocupado; intenta de nuevo.');
  }
}

/** Cuánto se espera el candado antes de rendirse (`lock_timeout` de Postgres). */
export const ESPERA_CANDADO_MS = 4000;
/** Tope de cada sentencia dentro de la transacción. */
const TIMEOUT_SENTENCIA_MS = 5000;
/** Tope de la transacción completa (Prisma). Mayor que la espera del candado. */
const TIMEOUT_TRANSACCION_MS = 20_000;
/** Cuánto espera Prisma una conexión del pool para abrirla. */
const ESPERA_CONEXION_MS = 5000;

export interface AlertaAbierta {
  id: string;
  sucursalId: string;
  tipo: TipoAlerta;
  llave: string;
}

export interface NuevaAlerta {
  sucursalId: string;
  tipo: TipoAlerta;
  severidad: Prisma.AlertaCreateManyInput['severidad'];
  llave: string;
  umbral: number;
  detalle: Prisma.InputJsonObject;
}

/** Una alerta recién abierta: lo que el push necesita para armar su texto (F2-146). */
export interface AlertaRecienAbierta {
  id: string;
  empresaId: string;
  sucursalId: string;
  tipo: TipoAlerta;
  detalle: Prisma.JsonValue;
}

type Tx = Prisma.TransactionClient;

export class TransaccionAlertas {
  readonly #tx: Tx;
  readonly empresaId: string;

  constructor(tx: Tx, empresaId: string) {
    this.#tx = tx;
    this.empresaId = empresaId;
  }

  /** ¿La empresa sigue activa? Leído DENTRO del candado. */
  async empresaActiva(): Promise<boolean> {
    const e = await this.#tx.empresa.findFirst({
      where: { id: this.empresaId },
      select: { activo: true },
    });
    return e?.activo === true;
  }

  /** Las sucursales activas de la empresa, leídas DENTRO del candado. */
  async sucursalesActivas(): Promise<Set<string>> {
    const filas = await this.#tx.sucursal.findMany({
      where: { empresaId: this.empresaId, activo: true },
      select: { id: true },
    });
    return new Set(filas.map((f) => f.id));
  }

  async reglas(): Promise<Array<{ tipo: TipoAlerta; activa: boolean; umbral: number }>> {
    return this.#tx.reglaAlerta.findMany({
      where: { empresaId: this.empresaId },
      select: { tipo: true, activa: true, umbral: true },
    });
  }

  async abiertas(): Promise<AlertaAbierta[]> {
    return this.#tx.alerta.findMany({
      where: { empresaId: this.empresaId, cerradaAt: null },
      select: { id: true, sucursalId: true, tipo: true, llave: true },
    });
  }

  /**
   * Abre alertas. Una condición que ya tiene su fila abierta NO se duplica: el único
   * `(sucursal, tipo, llave_abierta)` la descarta (`skipDuplicates`). Una sucursal de otra
   * empresa la rechaza la FK compuesta `(sucursal_id, empresa_id)`: error, nunca fila.
   *
   * Devuelve SÓLO las filas que esta llamada abrió de verdad (las descartadas no vienen):
   * F2-146 manda el push de cada una, después del commit.
   */
  async abrir(filas: readonly NuevaAlerta[], ahora: Date): Promise<AlertaRecienAbierta[]> {
    if (filas.length === 0) {
      return [];
    }
    return this.#tx.alerta.createManyAndReturn({
      data: filas.map((f) => ({
        empresaId: this.empresaId,
        sucursalId: f.sucursalId,
        tipo: f.tipo,
        severidad: f.severidad,
        llave: f.llave,
        llaveAbierta: f.llave,
        umbral: f.umbral,
        detalle: f.detalle,
        abiertaAt: ahora,
      })),
      skipDuplicates: true,
      select: { id: true, empresaId: true, sucursalId: true, tipo: true, detalle: true },
    });
  }

  /** Cierra (nunca borra) las alertas indicadas que sigan abiertas y sean de esta empresa. */
  async cerrar(ids: readonly string[], ahora: Date, motivo: MotivoCierreAlerta): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const { count } = await this.#tx.alerta.updateMany({
      where: { empresaId: this.empresaId, id: { in: [...ids] }, cerradaAt: null },
      data: { cerradaAt: ahora, motivoCierre: motivo, llaveAbierta: null },
    });
    return count;
  }

  /** La marca de agua: el instante de la última observación aplicada (ms), o null. */
  async marcaDeAgua(): Promise<number | null> {
    const fila = await this.#tx.alertaEvaluacion.findFirst({
      where: { empresaId: this.empresaId },
      select: { observadoAt: true },
    });
    return fila?.observadoAt.getTime() ?? null;
  }

  /** Avanza la marca de agua (nunca la retrocede: el caller ya comparó bajo el candado). */
  async avanzarMarca(instante: Date): Promise<void> {
    await this.#tx.alertaEvaluacion.upsert({
      where: { empresaId: this.empresaId },
      create: { empresaId: this.empresaId, observadoAt: instante },
      update: { observadoAt: instante },
    });
  }

  async guardarRegla(tipo: TipoAlerta, activa: boolean, umbral: number): Promise<void> {
    await this.#tx.reglaAlerta.upsert({
      where: { empresaId_tipo: { empresaId: this.empresaId, tipo } },
      create: { empresaId: this.empresaId, tipo, activa, umbral },
      update: { activa, umbral },
    });
  }
}

/** Lo que el helper necesita del cliente crudo. */
export interface ClienteAlertas {
  empresa: Pick<Prisma.TransactionClient['empresa'], 'findFirst'>;
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
}

/**
 * ¿El error es el `lock_timeout` de Postgres (55P03) esperando el candado? Sólo ése: una
 * transacción que expira por otra causa (P2028 por una sentencia lenta, el pool sin
 * conexiones) NO es "otra evaluación tiene el candado" y sale como el error que es.
 */
function esCandadoOcupado(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  const meta = error.meta as { code?: unknown } | undefined;
  return meta?.code === '55P03' || error.message.includes('55P03');
}

export class EscrituraAlertas {
  readonly #cliente: ClienteAlertas;
  readonly #scope: EmpresaScope;

  constructor(cliente: ClienteAlertas, scope: EmpresaScope) {
    this.#cliente = cliente;
    this.#scope = scope;
  }

  async bajoCandado<T>(empresaId: string, fn: (tx: TransaccionAlertas) => Promise<T>): Promise<T> {
    const empresa = encontradoOr404(
      await this.#cliente.empresa.findFirst({
        where: whereScoped(this.#scope, 'Empresa', { id: empresaId }),
        select: { id: true },
      }),
    );
    try {
      return await this.#cliente.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', ${String(ESPERA_CANDADO_MS)}, true)`;
          await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(TIMEOUT_SENTENCIA_MS)}, true)`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`alertas:${empresa.id}`}))`;
          return fn(new TransaccionAlertas(tx, empresa.id));
        },
        { maxWait: ESPERA_CONEXION_MS, timeout: TIMEOUT_TRANSACCION_MS },
      );
    } catch (error) {
      if (esCandadoOcupado(error)) {
        throw new CandadoAlertasOcupado();
      }
      throw error;
    }
  }
}
