import { randomUUID } from 'node:crypto';

import { Prisma, type FormaPago } from '@prisma/client';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import { expiracionDe, VIGENCIA_DEFAULT, type VigenciaCodigos } from '../facturacion/codigo';
import { COLUMNAS_INTOCABLES } from './scope.helper';

/**
 * Escrituras de la ingesta (F1-031), clavadas a UNA sucursal: la del agente
 * que resolvió la API key. Es parte del helper obligatorio de scope, no un
 * atajo: nadie fuera de `ScopedPrismaService.deSucursal()` puede conseguir el
 * cliente de transacción que recibe.
 *
 * Reglas que aplica cada operación, sin que el caller las recuerde:
 * - `sucursalId` y `empresaId` los pone ESTE archivo, desde el agente. Los
 *   datos del caller no pueden traerlos (`sinIntocables`) ni por tipo ni en
 *   runtime.
 * - Toda llave de un `where` se exige no vacía (`exigir`). Prisma ignora un
 *   filtro `undefined`: un `deleteMany({ where: { chequeId: undefined } })`
 *   borraría las partidas de toda la empresa (riesgo del log de F1-012).
 * - Partidas y pagos se tocan SÓLO por el id de un cheque que salió de un
 *   upsert o una lectura hecha con la sucursal del agente, y además por su
 *   empresa (la FK compuesta de F1-030 los ata al cheque).
 */

export type ChequeGuardado = Prisma.ChequeGetPayload<{
  include: { partidas: true; pagos: true };
}>;

/** Columnas del cheque que manda la ingesta. Sin identidad ni pertenencia. */
export interface DatosCheque {
  folio: string;
  abiertoAt: Date;
  cerradoAt: Date | null;
  mesa: string | null;
  mesero: string | null;
  comensales: number | null;
  /** F2-232: id del cliente en el POS (el `origenSrId` del catálogo); nulo = sin cliente. */
  clienteOrigenSrId: string | null;
  /** F2-233: id del área en el POS (el `origenSrId` del catálogo); nulo = sin área. */
  areaOrigenSrId: string | null;
  subtotal: Prisma.Decimal;
  impuestos: Prisma.Decimal;
  descuentos: Prisma.Decimal;
  propina: Prisma.Decimal;
  total: Prisma.Decimal;
  cancelado: boolean;
}

/** Una partida. `orden` no va aquí: lo pone el helper con la posición en el arreglo. */
export interface DatosPartida {
  producto: string;
  categoria: string | null;
  cantidad: Prisma.Decimal;
  precioUnit: Prisma.Decimal;
  total: Prisma.Decimal;
  modificadores: Prisma.InputJsonValue;
}

export interface DatosPago {
  forma: FormaPago;
  formaRaw: string;
  monto: Prisma.Decimal;
}

export interface DatosEstado {
  versionAgente: string;
  versionSr: string | null;
  ultimaLecturaAt: Date | null;
  ultimoError: string | null;
  /** Eventos en la cola local del agente (F1-061). `null` = no lo reportó. */
  tamanoCola: number | null;
  /** Latencia de la consulta a SR del ciclo, en ms (F1-025). `null` = sin medición. */
  latenciaQueryMs: number | null;
}

/** F2-143: lo que reporta el agente de su último intento de auto-actualización. */
export interface DatosActualizacion {
  resultado: 'aplicada' | 'fallida';
  version: string;
  /** Sólo con `fallida` (y obligatorio con ella). */
  motivo:
    | 'hash_invalido'
    | 'descarga'
    | 'detener'
    | 'reemplazo'
    | 'arranque'
    | 'version_distinta'
    | null;
  detalle: string | null;
}

/** Intentos de generar un código de facturación que no choque con otro ya guardado (F2-101). */
export const INTENTOS_CODIGO = 5;

/** Cómo terminó el intento de dar código de facturación a un cheque (F2-101). */
export type ResultadoCodigo =
  { ok: true; resultado: 'creado' | 'existente' } | { ok: false; error: unknown };

/** Cuánto histórico de snapshots se conserva además del último (F1-030). */
export const HISTORICO_SNAPSHOTS_MS = 24 * 60 * 60 * 1000;

function exigir(nombre: string, valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new Error(`Escritura de sucursal: ${nombre} vacío o ausente en un filtro.`);
  }
  return valor;
}

function exigirFecha(nombre: string, valor: unknown): Date {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) {
    throw new Error(`Escritura de sucursal: ${nombre} no es una fecha válida.`);
  }
  return valor;
}

/** Los datos del caller no pueden traer identidad ni pertenencia, aunque el tipo lo impida. */
function sinIntocables<T extends object>(modelo: string, datos: T): T {
  const tocadas = Object.keys(datos).filter((c) => COLUMNAS_INTOCABLES.includes(c));
  if (tocadas.length > 0) {
    throw new Error(
      `Escritura de sucursal en ${modelo}: los datos no pueden traer ${tocadas.join(', ')}. ` +
        'La sucursal y la empresa las pone el helper desde la API key.',
    );
  }
  return datos;
}

/** Las operaciones disponibles dentro de UNA transacción de la sucursal. */
export class OperacionesSucursal {
  readonly #tx: Prisma.TransactionClient;
  readonly #sucursalId: string;
  readonly #empresaId: string;
  /** El filtro de tenant de toda operación de esta clase. */
  readonly #deLaSucursal: { readonly sucursalId: string; readonly empresaId: string };

  constructor(tx: Prisma.TransactionClient, sucursalId: string, empresaId: string) {
    this.#tx = tx;
    this.#sucursalId = exigir('sucursalId', sucursalId);
    this.#empresaId = exigir('empresaId', empresaId);
    this.#deLaSucursal = Object.freeze({
      sucursalId: this.#sucursalId,
      empresaId: this.#empresaId,
    });
  }

  /** El cheque de ESTA sucursal con ese `folioSr`, con partidas en orden de ticket. */
  leerCheque(folioSr: string): Promise<ChequeGuardado | null> {
    return this.#tx.cheque.findFirst({
      where: { ...this.#deLaSucursal, folioSr: exigir('folioSr', folioSr) },
      include: { partidas: { orderBy: { orden: 'asc' } }, pagos: true },
    });
  }

  /**
   * Upsert del cheque por la unique `(sucursal_id, folio_sr)` y REEMPLAZO de
   * sus partidas y pagos (nunca se acumulan). Devuelve el id del cheque.
   *
   * La forma del upsert es la que Prisma ejecuta como `INSERT ... ON CONFLICT
   * DO UPDATE` nativo: un solo campo único en el `where` (la compuesta), con
   * los mismos valores que el `create`, y sin escrituras anidadas. Lo fija un
   * test que mira el SQL (`escritura-sucursal.spec.ts`). Con dos lotes en vuelo,
   * el segundo espera el bloqueo de fila del primero y reemplaza sobre él.
   */
  async guardarCheque(
    folioSr: string,
    datos: DatosCheque,
    partidas: readonly DatosPartida[],
    pagos: readonly DatosPago[],
  ): Promise<string> {
    const folio = exigir('folioSr', folioSr);
    sinIntocables('Cheque', datos);
    partidas.forEach((p) => sinIntocables('ChequePartida', p));
    pagos.forEach((p) => sinIntocables('ChequePago', p));

    const { id } = await this.#tx.cheque.upsert({
      where: { sucursalId_folioSr: { sucursalId: this.#sucursalId, folioSr: folio } },
      create: { ...datos, folioSr: folio, ...this.#deLaSucursal },
      update: { ...datos },
      select: { id: true },
    });
    const chequeId = exigir('chequeId', id);
    const delCheque = { chequeId, empresaId: this.#empresaId };

    await this.#tx.chequePartida.deleteMany({ where: delCheque });
    await this.#tx.chequePago.deleteMany({ where: delCheque });
    if (partidas.length > 0) {
      await this.#tx.chequePartida.createMany({
        data: partidas.map((p, orden) => ({ ...p, orden, ...delCheque })),
      });
    }
    if (pagos.length > 0) {
      await this.#tx.chequePago.createMany({
        data: pagos.map((p) => ({ ...p, ...delCheque })),
      });
    }
    return chequeId;
  }

  /** Upsert por `(sucursal_id, capturado_at)`: reenviar el mismo snapshot no lo duplica. */
  async guardarSnapshot(capturadoAt: Date, payload: Prisma.InputJsonValue): Promise<void> {
    const cuando = exigirFecha('capturadoAt', capturadoAt);
    await this.#tx.mesaSnapshot.upsert({
      where: {
        sucursalId_capturadoAt: { sucursalId: this.#sucursalId, capturadoAt: cuando },
      },
      create: { ...this.#deLaSucursal, capturadoAt: cuando, payload },
      // Sólo el payload: `recibido_at` es de la primera recepción y un reenvío no lo mueve.
      update: { payload },
    });
  }

  /**
   * Borra los snapshots de ESTA sucursal con más de 24 h respecto a `ahora`,
   * salvo el último (el de mayor `capturado_at`), que se conserva siempre:
   * un agente que vuelve de dos días sin red no deja la sucursal sin foto.
   */
  async purgarSnapshots(ahora: Date): Promise<number> {
    const referencia = exigirFecha('ahora', ahora);
    const ultimo = await this.#tx.mesaSnapshot.findFirst({
      where: this.#deLaSucursal,
      orderBy: { capturadoAt: 'desc' },
      select: { capturadoAt: true },
    });
    if (!ultimo) {
      return 0;
    }
    const hace24h = referencia.getTime() - HISTORICO_SNAPSHOTS_MS;
    const limite = new Date(Math.min(hace24h, ultimo.capturadoAt.getTime()));
    const { count } = await this.#tx.mesaSnapshot.deleteMany({
      where: { ...this.#deLaSucursal, capturadoAt: { lt: limite } },
    });
    return count;
  }

  /**
   * El código corto de facturación del cheque `chequeId` de ESTA sucursal (F2-101), AISLADO en un
   * savepoint de la transacción de la ingesta.
   *
   * DECISION PROVISIONAL (nocturno): una falla del código (zona inválida, CHECK de formato, FK,
   * cinco colisiones seguidas, un bug del generador) NUNCA tumba la venta. Se hace
   * `ROLLBACK TO SAVEPOINT`, el cheque con sus partidas y pagos se confirma igual y el resultado
   * dice `ok: false` para que la ingesta lo loguee. El cheque se queda sin código hasta su
   * siguiente reenvío (el camino de "reenvío idéntico" vuelve a intentarlo). Si falla el propio
   * `ROLLBACK TO SAVEPOINT` (conexión caída), ESA excepción se propaga: la transacción ya no sirve y
   * el evento sigue el camino normal de `esTransitorio()`.
   *
   * El nombre del savepoint va literal (nada interpolado).
   */
  async intentarCodigoFacturacion(
    chequeId: string,
    cerradoAt: Date,
    generar: () => string,
  ): Promise<ResultadoCodigo> {
    await this.#tx.$executeRaw`SAVEPOINT codigo_facturacion`;
    let resultado: 'creado' | 'existente';
    try {
      resultado = await this.#asegurarCodigo(chequeId, cerradoAt, generar);
    } catch (error) {
      await this.#tx.$executeRaw`ROLLBACK TO SAVEPOINT codigo_facturacion`;
      return { ok: false, error };
    }
    await this.#tx.$executeRaw`RELEASE SAVEPOINT codigo_facturacion`;
    return { ok: true, resultado };
  }

  /**
   * Si el cheque ya tiene código, no hace NADA (el código y su expiración no cambian nunca: un
   * reenvío deja la base igual). Si no, hasta `INTENTOS_CODIGO` inserciones con
   * `ON CONFLICT DO NOTHING` sin target: cubre la unique de `codigo` Y la de `cheque_id` sin
   * abortar la transacción. Sin fila devuelta: si el cheque ya tiene código, otro lote en vuelo
   * lo creó; si no, fue colisión de código y se prueba otro.
   */
  async #asegurarCodigo(
    chequeId: string,
    cerradoAt: Date,
    generar: () => string,
  ): Promise<'creado' | 'existente'> {
    const cheque = exigir('chequeId', chequeId);
    const cierre = exigirFecha('cerradoAt', cerradoAt);
    // El cheque tiene que ser de ESTA sucursal: las FK sólo atan la empresa.
    const propio = await this.#tx.cheque.findFirst({
      where: { ...this.#deLaSucursal, id: cheque },
      select: { id: true },
    });
    if (!propio) throw new Error('Escritura de sucursal: el cheque no es de esta sucursal.');
    if (await this.#codigoDe(cheque)) return 'existente';

    const expiraAt = expiracionDe(cierre, await this.#zona(), await this.#vigencia());
    for (let intento = 0; intento < INTENTOS_CODIGO; intento++) {
      const codigo = generar();
      const filas = await this.#tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO codigos_facturacion
          (id, codigo, cheque_id, sucursal_id, empresa_id, estado, expira_at, created_at, updated_at)
        VALUES (${randomUUID()}::uuid, ${codigo}, ${cheque}::uuid, ${this.#sucursalId}::uuid,
          ${this.#empresaId}::uuid, 'pendiente', ${expiraAt}, now(), now())
        ON CONFLICT DO NOTHING
        RETURNING id`);
      if (filas.length > 0) return 'creado';
      if (await this.#codigoDe(cheque)) return 'existente';
    }
    throw new Error(
      `No se generó un código de facturación único en ${INTENTOS_CODIGO} intentos (colisiones).`,
    );
  }

  #codigoDe(chequeId: string) {
    return this.#tx.codigoFacturacion.findFirst({
      where: { ...this.#deLaSucursal, chequeId },
      select: { id: true },
    });
  }

  async #zona(): Promise<string> {
    const sucursal = await this.#tx.sucursal.findFirstOrThrow({
      where: { id: this.#sucursalId, empresaId: this.#empresaId },
      select: { zonaHoraria: true },
    });
    return sucursal.zonaHoraria;
  }

  /** La regla de vigencia de la empresa del agente; sin configuración, fin de mes. */
  async #vigencia(): Promise<VigenciaCodigos> {
    const config = await this.#tx.configuracionFacturacion.findFirst({
      where: { empresaId: this.#empresaId },
      select: { vigenciaCodigos: true, vigenciaDias: true },
    });
    if (!config) return VIGENCIA_DEFAULT;
    return config.vigenciaCodigos === 'dias'
      ? // NaN a propósito: el CHECK de la base impide `dias` sin número, y si llegara así,
        // `expiracionDe` lanza y cae en el savepoint en vez de inventar un default silencioso.
        { regla: 'dias', dias: config.vigenciaDias ?? Number.NaN }
      : { regla: 'fin_de_mes' };
  }

  leerEstado() {
    return this.#tx.agenteEstado.findFirst({ where: this.#deLaSucursal });
  }

  /** Upsert del estado del agente de ESTA sucursal. */
  async guardarEstado(datos: DatosEstado): Promise<void> {
    sinIntocables('AgenteEstado', datos);
    await this.#tx.agenteEstado.upsert({
      where: { sucursalId: this.#sucursalId },
      create: { ...datos, ...this.#deLaSucursal },
      update: { ...datos },
    });
  }

  /**
   * Registra que el agente de ESTA sucursal nos habló a las `ahora` (reloj del
   * servidor, F1-061). Un solo `INSERT ... ON CONFLICT` por la PK: dos lotes en
   * paralelo de una sucursal sin fila no chocan (nada de buscar-y-crear), y
   * `GREATEST` impide que un lote que entró antes pero termina después deje el
   * contacto más viejo.
   */
  async registrarContacto(ahora: Date): Promise<void> {
    const t = exigirFecha('ahora', ahora);
    await this.#tx.$executeRaw(Prisma.sql`
      INSERT INTO agente_contacto (sucursal_id, empresa_id, ultimo_contacto_at)
      VALUES (${this.#sucursalId}::uuid, ${this.#empresaId}::uuid, ${t})
      ON CONFLICT (sucursal_id) DO UPDATE
        SET ultimo_contacto_at = GREATEST(agente_contacto.ultimo_contacto_at, EXCLUDED.ultimo_contacto_at)`);
  }

  /**
   * F2-143: el resultado del último intento de auto-actualización de ESTA sucursal. Un solo
   * `INSERT ... ON CONFLICT` por la PK (dos reportes en paralelo no chocan). La racha de fallas
   * (`primera_falla_at`) se CONSERVA si ya había una falla de la MISMA versión: un reenvío del
   * mismo reporte, o una falla nueva de esa versión, no la reinician. Otra versión o `aplicada`
   * sí. El CHECK de la tabla ata `motivo` y `primera_falla_at` al resultado.
   */
  async reportarActualizacion(datos: DatosActualizacion, ahora: Date): Promise<void> {
    const t = exigirFecha('ahora', ahora);
    const fallida = datos.resultado === 'fallida';
    if (fallida !== (datos.motivo !== null)) {
      throw new Error('Reporte de actualización: `motivo` va si y sólo si el resultado es fallida.');
    }
    const version = exigir('version', datos.version);
    await this.#tx.$executeRaw(Prisma.sql`
      INSERT INTO agente_actualizacion
        (sucursal_id, empresa_id, resultado, version, motivo, detalle, primera_falla_at, reportada_at)
      VALUES (
        ${this.#sucursalId}::uuid, ${this.#empresaId}::uuid,
        ${datos.resultado}::resultado_actualizacion, ${version},
        ${datos.motivo}::motivo_falla_actualizacion, ${datos.detalle},
        ${fallida ? t : null}, ${t})
      ON CONFLICT (sucursal_id) DO UPDATE SET
        resultado = EXCLUDED.resultado,
        version = EXCLUDED.version,
        motivo = EXCLUDED.motivo,
        detalle = EXCLUDED.detalle,
        primera_falla_at = CASE
          WHEN EXCLUDED.resultado = 'fallida'
            AND agente_actualizacion.resultado = 'fallida'
            AND agente_actualizacion.version = EXCLUDED.version
          THEN agente_actualizacion.primera_falla_at
          ELSE EXCLUDED.primera_falla_at
        END,
        reportada_at = EXCLUDED.reportada_at`);
  }
}

type Ejecutor = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;

/** Lo que devuelve `ScopedPrismaService.deSucursal(agente)`. */
export class EscrituraSucursal {
  readonly #ejecutar: Ejecutor;
  readonly #agente: AgenteAutenticado;

  constructor(ejecutar: Ejecutor, agente: AgenteAutenticado) {
    exigir('sucursalId', agente.sucursalId);
    exigir('empresaId', agente.empresaId);
    this.#ejecutar = ejecutar;
    this.#agente = { sucursalId: agente.sucursalId, empresaId: agente.empresaId };
  }

  /** Corre `fn` en UNA transacción: si truena, no queda nada de lo que hizo. */
  enTransaccion<T>(fn: (ops: OperacionesSucursal) => Promise<T>): Promise<T> {
    return this.#ejecutar((tx) =>
      fn(new OperacionesSucursal(tx, this.#agente.sucursalId, this.#agente.empresaId)),
    );
  }
}
