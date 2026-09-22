import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { EmpresaScope } from './empresa-scope';
import { encontradoOr404, whereScoped } from './scope.helper';

/**
 * Las escrituras de los conteos físicos (F2-123). Son parte del helper obligatorio de scope:
 * sólo `ScopedPrismaService.conteos(scope)` construye esta clase.
 *
 * - Todo se verifica CON el scope del usuario y dentro de la empresa pedida: una sucursal, un
 *   almacén, un grupo o un conteo de otra empresa (o inexistente) dan el mismo 404.
 * - Cada operación corre en UNA transacción con los timeouts de F2-121. Capturar, cerrar y
 *   cancelar toman el MISMO candado del conteo (`pg_advisory_xact_lock`) y leen el estado ya con
 *   el candado puesto: una captura no puede escribir sobre un conteo que otro cerró en el mismo
 *   instante. Crear toma el candado de folios de la sucursal (folio = máximo + 1).
 * - Es dato NUESTRO: nada de esto escribe a SoftRestaurant, ni al espejo de SR (existencias,
 *   lecturas, pólizas, movimientos, catálogos), que aquí sólo se LEE.
 */

export const ESPERA_CANDADO_CONTEOS_MS = 4000;
const TIMEOUT_SENTENCIA_MS = 5000;
const TIMEOUT_TRANSACCION_MS = 30_000;
const ESPERA_CONEXION_MS = 5000;

/** Tope de renglones de un conteo (un almacén real tiene cientos a pocos miles de insumos). */
export const MAX_PARTIDAS_CONTEO = 5000;

type Tx = Prisma.TransactionClient;
type D = Prisma.Decimal;

/** Lo que el helper necesita del cliente crudo. */
export interface ClienteConteos {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
}

function exigir(nombre: string, valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new Error(`Escritura de conteos: ${nombre} vacío o ausente en un filtro.`);
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

export interface NuevoConteo {
  empresaId: string;
  sucursalId: string;
  almacenOrigenSrId: string;
  grupoOrigenSrId: string | null;
  nota: string | null;
}

export interface Captura {
  insumoOrigenSrId: string;
  /** Nulo = borrar lo capturado (vuelve a "sin contar"). */
  contado: D | null;
}

export class EscrituraConteos {
  readonly #cliente: ClienteConteos;
  readonly #scope: EmpresaScope;

  constructor(cliente: ClienteConteos, scope: EmpresaScope) {
    this.#cliente = cliente;
    this.#scope = scope;
  }

  async #enTransaccion<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.#cliente.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', ${String(ESPERA_CANDADO_CONTEOS_MS)}, true)`;
          await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(TIMEOUT_SENTENCIA_MS)}, true)`;
          return fn(tx);
        },
        { maxWait: ESPERA_CONEXION_MS, timeout: TIMEOUT_TRANSACCION_MS },
      );
    } catch (error) {
      if (esCandadoOcupado(error)) {
        throw new ServiceUnavailableException(
          'El conteo está ocupado por otra operación; reintenta.',
        );
      }
      throw error;
    }
  }

  async #sucursal(tx: Tx, empresaId: string, sucursalId: string) {
    return encontradoOr404(
      await tx.sucursal.findFirst({
        where: whereScoped(this.#scope, 'Sucursal', {
          id: exigir('sucursalId', sucursalId),
          empresaId: exigir('empresaId', empresaId),
        }),
        select: { id: true, empresaId: true },
      }),
    );
  }

  /**
   * El conteo, buscado CON el scope, con su candado puesto y su estado leído DESPUÉS del candado.
   * De otra empresa o inexistente = 404.
   */
  async #conteoBloqueado(tx: Tx, empresaId: string, conteoId: string) {
    const visto = encontradoOr404(
      await tx.conteoFisico.findFirst({
        where: whereScoped(this.#scope, 'ConteoFisico', {
          id: exigir('conteoId', conteoId),
          empresaId: exigir('empresaId', empresaId),
        }),
        select: { id: true },
      }),
    );
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('conteo'), hashtext(${visto.id}))`;
    return encontradoOr404(
      await tx.conteoFisico.findFirst({
        where: whereScoped(this.#scope, 'ConteoFisico', { id: visto.id, empresaId }),
        select: { id: true, empresaId: true, sucursalId: true, estado: true },
      }),
    );
  }

  /**
   * Crea un conteo con el teórico CONGELADO: la foto de existencias del almacén en este momento
   * (cantidad y costo promedio), con su `capturado_at`. Devuelve el id.
   *
   * - Almacén que no es de la sucursal (ni en su catálogo ni en sus lecturas) = 404. Grupo que
   *   no es de la sucursal = 404.
   * - Almacén propio SIN ninguna lectura de existencias = 409: no hay teórico contra qué comparar.
   * - Artículos: los insumos ACTIVOS del catálogo de la sucursal ∪ los que vienen en la foto
   *   del almacén; con grupo, sólo los de ese grupo según el catálogo (un artículo que sólo está
   *   en la foto no tiene grupo conocido y queda fuera de un conteo por grupo). Un insumo del
   *   catálogo sin fila en la foto va con teórico nulo ("sin teórico"), nunca 0.
   */
  async crear(nuevo: NuevoConteo, actorId: string, ahora: Date): Promise<string> {
    return this.#enTransaccion(async (tx) => {
      const sucursal = await this.#sucursal(tx, nuevo.empresaId, nuevo.sucursalId);
      const deLaSucursal = { sucursalId: sucursal.id, empresaId: sucursal.empresaId };
      const almacen = exigir('almacenOrigenSrId', nuevo.almacenOrigenSrId);
      const [enCatalogo, lectura] = await Promise.all([
        tx.almacenCatalogo.findFirst({
          where: whereScoped(this.#scope, 'AlmacenCatalogo', {
            ...deLaSucursal,
            origenSrId: almacen,
          }),
          select: { id: true },
        }),
        tx.lecturaExistencias.findFirst({
          where: whereScoped(this.#scope, 'LecturaExistencias', {
            ...deLaSucursal,
            almacenOrigenSrId: almacen,
          }),
          select: { capturadoAt: true },
        }),
      ]);
      encontradoOr404(enCatalogo ?? lectura);
      if (nuevo.grupoOrigenSrId !== null) {
        encontradoOr404(
          await tx.grupoInsumo.findFirst({
            where: whereScoped(this.#scope, 'GrupoInsumo', {
              ...deLaSucursal,
              origenSrId: exigir('grupoOrigenSrId', nuevo.grupoOrigenSrId),
            }),
            select: { id: true },
          }),
        );
      }
      if (lectura === null) {
        // DECISION PROVISIONAL (nocturno): sin ninguna foto del almacén no se crea el conteo
        // (no daría diferencias). esquema-sr §10.
        throw new ConflictException(
          'Este almacén todavía no tiene lectura de existencias: no hay teórico contra qué comparar.',
        );
      }

      const [catalogo, foto] = await Promise.all([
        tx.insumo.findMany({
          where: whereScoped(this.#scope, 'Insumo', {
            ...deLaSucursal,
            ...(nuevo.grupoOrigenSrId !== null ? { grupoOrigenSrId: nuevo.grupoOrigenSrId } : {}),
          }),
          select: { origenSrId: true, activo: true },
        }),
        tx.existencia.findMany({
          where: whereScoped(this.#scope, 'Existencia', {
            ...deLaSucursal,
            almacenOrigenSrId: almacen,
          }),
          select: { insumoOrigenSrId: true, cantidad: true, costoPromedio: true },
        }),
      ]);
      const delGrupo = new Set(catalogo.map((i) => i.origenSrId));
      const fotoDe = new Map(foto.map((e) => [e.insumoOrigenSrId, e]));
      const articulos = new Set([
        ...catalogo.filter((i) => i.activo).map((i) => i.origenSrId),
        ...foto
          .map((e) => e.insumoOrigenSrId)
          .filter((i) => nuevo.grupoOrigenSrId === null || delGrupo.has(i)),
      ]);
      if (articulos.size === 0) {
        throw new BadRequestException('No hay artículos que contar en ese almacén y grupo.');
      }
      if (articulos.size > MAX_PARTIDAS_CONTEO) {
        throw new BadRequestException(
          `Más de ${MAX_PARTIDAS_CONTEO} artículos: crea el conteo por grupo.`,
        );
      }

      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('conteo-folio'), hashtext(${sucursal.id}))`;
      const max = await tx.conteoFisico.aggregate({
        where: whereScoped(this.#scope, 'ConteoFisico', deLaSucursal),
        _max: { folio: true },
      });
      const conteo = await tx.conteoFisico.create({
        data: {
          ...deLaSucursal,
          folio: (max._max.folio ?? 0) + 1,
          almacenOrigenSrId: almacen,
          grupoOrigenSrId: nuevo.grupoOrigenSrId,
          nota: nuevo.nota,
          estado: 'en_captura',
          teoricoCapturadoAt: lectura.capturadoAt,
          creadoPor: exigir('actorId', actorId),
          createdAt: ahora,
          updatedAt: ahora,
        },
        select: { id: true },
      });
      await tx.partidaConteo.createMany({
        data: [...articulos].map((insumo) => {
          const e = fotoDe.get(insumo);
          return {
            ...deLaSucursal,
            conteoId: conteo.id,
            insumoOrigenSrId: insumo,
            teorico: e?.cantidad ?? null,
            costoPromedio: e?.costoPromedio ?? null,
          };
        }),
      });
      return conteo.id;
    });
  }

  /**
   * Guarda lo capturado de un lote de renglones: todo o nada. Un insumo que no es del conteo =
   * 400 sin escribir nada; un conteo que ya no está en captura = 409. Poner el mismo valor otra
   * vez no mueve nada (ni `capturado_at`).
   *
   * DECISION PROVISIONAL (nocturno): el último en llegar gana, por renglón. Un conteo lo captura
   * normalmente un solo dispositivo; si dos capturan el mismo renglón, se pisan. esquema-sr §10.
   */
  async capturar(
    empresaId: string,
    conteoId: string,
    capturas: readonly Captura[],
    actorId: string,
    ahora: Date,
  ): Promise<{ sucursalId: string }> {
    return this.#enTransaccion(async (tx) => {
      const conteo = await this.#conteoBloqueado(tx, empresaId, conteoId);
      if (conteo.estado !== 'en_captura') {
        throw new ConflictException(`El conteo está ${conteo.estado}: ya no admite captura.`);
      }
      const delConteo = {
        conteoId: conteo.id,
        sucursalId: conteo.sucursalId,
        empresaId: conteo.empresaId,
      };
      const pedidos = capturas.map((c) => exigir('insumoOrigenSrId', c.insumoOrigenSrId));
      const guardadas = await tx.partidaConteo.findMany({
        where: whereScoped(this.#scope, 'PartidaConteo', {
          ...delConteo,
          insumoOrigenSrId: { in: pedidos },
        }),
        select: { id: true, insumoOrigenSrId: true, contado: true },
      });
      const guardadaDe = new Map(guardadas.map((g) => [g.insumoOrigenSrId, g]));
      const ajenos = pedidos.filter((p) => !guardadaDe.has(p));
      if (ajenos.length > 0) {
        throw new BadRequestException(
          `${ajenos.length} artículo(s) no son de este conteo; no se guardó nada del lote.`,
        );
      }
      for (const c of capturas) {
        const g = guardadaDe.get(c.insumoOrigenSrId)!;
        const igual =
          c.contado === null
            ? g.contado === null
            : g.contado !== null && g.contado.equals(c.contado);
        if (igual) continue;
        await tx.partidaConteo.updateMany({
          where: whereScoped(this.#scope, 'PartidaConteo', { ...delConteo, id: g.id }),
          data: {
            contado: c.contado,
            capturadoPor: exigir('actorId', actorId),
            capturadoAt: ahora,
          },
        });
      }
      await tx.conteoFisico.updateMany({
        where: whereScoped(this.#scope, 'ConteoFisico', { id: conteo.id, estado: 'en_captura' }),
        data: { updatedAt: ahora },
      });
      return { sucursalId: conteo.sucursalId };
    });
  }

  /** Cierra (final): después ya no se captura. Sólo desde `en_captura`; si no, 409. */
  cerrar(empresaId: string, conteoId: string, actorId: string, ahora: Date): Promise<void> {
    return this.#terminar(empresaId, conteoId, 'cerrado', actorId, ahora);
  }

  /** Cancela (final): el conteo queda visible, sin reporte válido. Sólo desde `en_captura`. */
  cancelar(empresaId: string, conteoId: string, actorId: string, ahora: Date): Promise<void> {
    return this.#terminar(empresaId, conteoId, 'cancelado', actorId, ahora);
  }

  #terminar(
    empresaId: string,
    conteoId: string,
    estado: 'cerrado' | 'cancelado',
    actorId: string,
    ahora: Date,
  ): Promise<void> {
    return this.#enTransaccion(async (tx) => {
      const conteo = await this.#conteoBloqueado(tx, empresaId, conteoId);
      if (conteo.estado !== 'en_captura') {
        throw new ConflictException(`El conteo ya está ${conteo.estado}.`);
      }
      const actor = exigir('actorId', actorId);
      const marcas =
        estado === 'cerrado'
          ? { cerradoPor: actor, cerradoAt: ahora }
          : { canceladoPor: actor, canceladoAt: ahora };
      const r = await tx.conteoFisico.updateMany({
        where: whereScoped(this.#scope, 'ConteoFisico', { id: conteo.id, estado: 'en_captura' }),
        data: { estado, ...marcas, updatedAt: ahora },
      });
      if (r.count !== 1) {
        throw new ConflictException('El conteo cambió de estado; recarga.');
      }
    });
  }
}
