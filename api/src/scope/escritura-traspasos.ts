import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  conciliarRenglones,
  iguales,
  llaveEspejo,
  VENTANA_ESPEJO_MS,
  type MovimientoCandidato,
  type RenglonAConciliar,
} from '../inventario/traspasos';
import type { EmpresaScope } from './empresa-scope';
import { encontradoOr404, whereScoped } from './scope.helper';

/**
 * Las escrituras de los traspasos del panel (F2-124). Son parte del helper obligatorio de scope:
 * sólo `ScopedPrismaService.traspasos(scope)` construye esta clase.
 *
 * - Todo se verifica CON el scope recibido y dentro de la empresa pedida: una sucursal, un
 *   almacén, un insumo o un traspaso de otra empresa (o inexistente) dan el mismo 404.
 * - Cada operación corre en UNA transacción con los timeouts de F2-121 y bajo EL candado de
 *   traspasos de la empresa (`pg_advisory_xact_lock`): enviar (folio = máximo + 1 por empresa),
 *   recibir, cancelar y conciliar van en serie, también entre réplicas. Un traspaso cruza
 *   sucursales, así que el candado es de la empresa, no de una sucursal.
 * - Es dato NUESTRO: nada de esto escribe a SoftRestaurant ni al espejo de SR (existencias,
 *   lecturas, pólizas, movimientos, catálogos), que aquí sólo se LEE. La conciliación sólo apunta
 *   a (póliza, renglón) desde `partidas_traspaso`.
 */

export const ESPERA_CANDADO_TRASPASOS_MS = 4000;
const TIMEOUT_SENTENCIA_MS = 5000;
const TIMEOUT_TRANSACCION_MS = 30_000;
const ESPERA_CONEXION_MS = 5000;

/** Tope de renglones de un traspaso. */
export const MAX_PARTIDAS_TRASPASO = 500;

/**
 * DECISION PROVISIONAL (nocturno): un traspaso YA conciliado se re-verifica en cada vuelta
 * durante 90 días desde su envío (si SR cancela la póliza espejo, vuelve a pendiente). Pasado
 * eso se da por firme: su espejo sigue ocupado y ya no se relee. Un traspaso NO conciliado se
 * busca siempre, sin límite.
 */
export const REVERIFICAR_CONCILIADOS_MS = 90 * 24 * 60 * 60 * 1000;

type Tx = Prisma.TransactionClient;
type D = Prisma.Decimal;

/** Lo que el helper necesita del cliente crudo. */
export interface ClienteTraspasos {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
}

function exigir(nombre: string, valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new Error(`Escritura de traspasos: ${nombre} vacío o ausente en un filtro.`);
  }
  return valor;
}

/** El candado no llegó a tiempo (`55P03`, lock_timeout). */
function esCandadoOcupado(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  const meta = error.meta as { code?: unknown } | undefined;
  return meta?.code === '55P03' || error.message.includes('55P03');
}

export interface RenglonNuevo {
  insumoOrigenSrId: string;
  /** > 0, hasta 3 decimales (lo valida el DTO). */
  cantidad: D;
}

export interface NuevoTraspaso {
  empresaId: string;
  sucursalOrigenId: string;
  almacenOrigenSrId: string;
  sucursalDestinoId: string;
  almacenDestinoSrId: string;
  nota: string | null;
  partidas: readonly RenglonNuevo[];
}

export interface ResultadoConciliacion {
  /** Traspasos revisados en esta vuelta. */
  revisados: number;
  /** Renglones cuyo espejo cambió (se encontró, se soltó o se movió). */
  espejosCambiados: number;
  /** Traspasos que quedaron conciliados en esta vuelta (antes no lo estaban). */
  conciliados: number;
  /** Traspasos que estaban conciliados y dejaron de estarlo. */
  desconciliados: number;
}

export class EscrituraTraspasos {
  readonly #cliente: ClienteTraspasos;
  readonly #scope: EmpresaScope;

  constructor(cliente: ClienteTraspasos, scope: EmpresaScope) {
    this.#cliente = cliente;
    this.#scope = scope;
  }

  async #bajoCandado<T>(empresaId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    const empresa = exigir('empresaId', empresaId);
    try {
      return await this.#cliente.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', ${String(ESPERA_CANDADO_TRASPASOS_MS)}, true)`;
          await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(TIMEOUT_SENTENCIA_MS)}, true)`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('traspasos'), hashtext(${empresa}))`;
          return fn(tx);
        },
        { maxWait: ESPERA_CONEXION_MS, timeout: TIMEOUT_TRANSACCION_MS },
      );
    } catch (error) {
      if (esCandadoOcupado(error)) {
        throw new ServiceUnavailableException(
          'Los traspasos de la empresa están ocupados por otra operación; reintenta.',
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
          empresaId,
        }),
        select: { id: true, empresaId: true },
      }),
    );
  }

  /** Un almacén es de la sucursal si está en su catálogo o en sus lecturas de existencias. */
  async #almacen(tx: Tx, deLaSucursal: { empresaId: string; sucursalId: string }, almacen: string) {
    const origen = exigir('almacenOrigenSrId', almacen);
    const [enCatalogo, lectura] = await Promise.all([
      tx.almacenCatalogo.findFirst({
        where: whereScoped(this.#scope, 'AlmacenCatalogo', { ...deLaSucursal, origenSrId: origen }),
        select: { id: true },
      }),
      tx.lecturaExistencias.findFirst({
        where: whereScoped(this.#scope, 'LecturaExistencias', {
          ...deLaSucursal,
          almacenOrigenSrId: origen,
        }),
        select: { id: true },
      }),
    ]);
    encontradoOr404(enCatalogo ?? lectura);
  }

  /** El traspaso, CON el scope y ya bajo el candado. De otra empresa o inexistente = 404. */
  async #traspaso(tx: Tx, empresaId: string, id: string) {
    return encontradoOr404(
      await tx.traspaso.findFirst({
        where: whereScoped(this.#scope, 'Traspaso', { id: exigir('traspasoId', id), empresaId }),
        select: { id: true, estado: true, sucursalId: true },
      }),
    );
  }

  /**
   * Envía un traspaso (1.ª confirmación). Devuelve el id.
   *
   * - Sucursal origen o destino que no es de la empresa = 404; almacén que no es de su sucursal
   *   (ni en su catálogo ni en sus lecturas) = 404. El mismo almacén de la misma sucursal = 400.
   * - Cada insumo tiene que ser de la sucursal ORIGEN (su catálogo o la foto de ese almacén);
   *   uno ajeno = 400 sin crear nada. El costo se CONGELA del costo promedio de la foto de origen
   *   (nulo si ese artículo no viene en la foto, nunca 0).
   * - NO se valida contra la existencia: la foto puede estar vieja (el web sólo avisa).
   */
  async enviar(nuevo: NuevoTraspaso, actorId: string, ahora: Date): Promise<string> {
    const empresaId = exigir('empresaId', nuevo.empresaId);
    return this.#bajoCandado(empresaId, async (tx) => {
      const origen = await this.#sucursal(tx, empresaId, nuevo.sucursalOrigenId);
      const destino = await this.#sucursal(tx, empresaId, nuevo.sucursalDestinoId);
      const deOrigen = { empresaId, sucursalId: origen.id };
      await this.#almacen(tx, deOrigen, nuevo.almacenOrigenSrId);
      await this.#almacen(tx, { empresaId, sucursalId: destino.id }, nuevo.almacenDestinoSrId);
      if (origen.id === destino.id && nuevo.almacenOrigenSrId === nuevo.almacenDestinoSrId) {
        throw new BadRequestException('El almacén de destino es el mismo que el de origen.');
      }
      if (nuevo.partidas.length === 0 || nuevo.partidas.length > MAX_PARTIDAS_TRASPASO) {
        throw new BadRequestException(
          `Un traspaso lleva de 1 a ${MAX_PARTIDAS_TRASPASO} artículos.`,
        );
      }
      const insumos = nuevo.partidas.map((p) => exigir('insumoOrigenSrId', p.insumoOrigenSrId));
      if (new Set(insumos).size !== insumos.length) {
        throw new BadRequestException('Un artículo viene repetido en el traspaso.');
      }
      const [catalogo, foto] = await Promise.all([
        tx.insumo.findMany({
          where: whereScoped(this.#scope, 'Insumo', { ...deOrigen, origenSrId: { in: insumos } }),
          select: { origenSrId: true },
        }),
        tx.existencia.findMany({
          where: whereScoped(this.#scope, 'Existencia', {
            ...deOrigen,
            almacenOrigenSrId: nuevo.almacenOrigenSrId,
            insumoOrigenSrId: { in: insumos },
          }),
          select: { insumoOrigenSrId: true, costoPromedio: true },
        }),
      ]);
      const conocidos = new Set([
        ...catalogo.map((i) => i.origenSrId),
        ...foto.map((e) => e.insumoOrigenSrId),
      ]);
      const ajenos = insumos.filter((i) => !conocidos.has(i));
      if (ajenos.length > 0) {
        throw new BadRequestException(
          `${ajenos.length} artículo(s) no son de la sucursal de origen; no se envió nada.`,
        );
      }
      // DECISION PROVISIONAL (nocturno): el costo es el promedio de la foto de ORIGEN al enviar.
      // SUPUESTO: la clave del insumo es la misma en la sucursal destino (el catálogo de SR se
      // replica); la entrada se concilia con esa clave. esquema-sr §10 "Traspasos".
      const costoDe = new Map(foto.map((e) => [e.insumoOrigenSrId, e.costoPromedio]));

      const max = await tx.traspaso.aggregate({
        where: whereScoped(this.#scope, 'Traspaso', { empresaId }),
        _max: { folio: true },
      });
      const actor = exigir('actorId', actorId);
      const traspaso = await tx.traspaso.create({
        data: {
          empresaId,
          sucursalId: origen.id,
          folio: (max._max.folio ?? 0) + 1,
          almacenOrigenSrId: nuevo.almacenOrigenSrId,
          sucursalDestinoId: destino.id,
          almacenDestinoSrId: exigir('almacenDestinoSrId', nuevo.almacenDestinoSrId),
          nota: nuevo.nota,
          estado: 'enviado',
          enviadoPor: actor,
          enviadoAt: ahora,
          createdAt: ahora,
          updatedAt: ahora,
        },
        select: { id: true },
      });
      await tx.partidaTraspaso.createMany({
        data: nuevo.partidas.map((p) => ({
          empresaId,
          sucursalId: origen.id,
          sucursalDestinoId: destino.id,
          traspasoId: traspaso.id,
          insumoOrigenSrId: p.insumoOrigenSrId,
          cantidad: p.cantidad,
          costoUnitario: costoDe.get(p.insumoOrigenSrId) ?? null,
        })),
      });
      return traspaso.id;
    });
  }

  /** Confirma la recepción (2.ª confirmación). Sólo desde `enviado`; si no, 409. */
  async recibir(empresaId: string, id: string, actorId: string, ahora: Date): Promise<void> {
    await this.#bajoCandado(empresaId, async (tx) => {
      const t = await this.#traspaso(tx, empresaId, id);
      if (t.estado !== 'enviado') {
        throw new ConflictException(`El traspaso ya está ${t.estado}.`);
      }
      const r = await tx.traspaso.updateMany({
        where: whereScoped(this.#scope, 'Traspaso', { id: t.id, empresaId, estado: 'enviado' }),
        data: {
          estado: 'recibido',
          recibidoPor: exigir('actorId', actorId),
          recibidoAt: ahora,
          updatedAt: ahora,
        },
      });
      if (r.count !== 1) throw new ConflictException('El traspaso cambió de estado; recarga.');
    });
  }

  /**
   * Cancela (final). Sólo desde `enviado` y SIN ningún espejo en SR: si SR ya registró (aunque sea
   * en parte) el traspaso, cancelarlo aquí dejaría a SR con un movimiento que el panel ya no
   * explica. 409 en los dos casos.
   */
  async cancelar(empresaId: string, id: string, actorId: string, ahora: Date): Promise<void> {
    await this.#bajoCandado(empresaId, async (tx) => {
      const t = await this.#traspaso(tx, empresaId, id);
      if (t.estado !== 'enviado') {
        throw new ConflictException(`El traspaso ya está ${t.estado}.`);
      }
      const conEspejo = await tx.partidaTraspaso.count({
        where: whereScoped(this.#scope, 'PartidaTraspaso', {
          empresaId,
          traspasoId: t.id,
          OR: [{ polizaSalidaId: { not: null } }, { polizaEntradaId: { not: null } }],
        }),
      });
      if (conEspejo > 0) {
        throw new ConflictException(
          'SoftRestaurant ya tiene movimientos de este traspaso: no se puede cancelar en el panel.',
        );
      }
      const r = await tx.traspaso.updateMany({
        where: whereScoped(this.#scope, 'Traspaso', { id: t.id, empresaId, estado: 'enviado' }),
        data: {
          estado: 'cancelado',
          canceladoPor: exigir('actorId', actorId),
          canceladoAt: ahora,
          conciliadoAt: null,
          updatedAt: ahora,
        },
      });
      if (r.count !== 1) throw new ConflictException('El traspaso cambió de estado; recarga.');
    });
  }

  /**
   * Concilia los traspasos de UNA empresa contra los movimientos de SR (F2-122): busca el espejo
   * de lo que falta, re-verifica lo que ya tenía (y lo suelta si ya no sirve) y ajusta
   * `conciliado_at` (se conserva mientras siga conciliado). Idempotente: sin datos nuevos, una
   * segunda vuelta no escribe nada. La regla de qué espejo sirve vive en
   * `inventario/traspasos.ts#conciliarRenglones`.
   *
   * La llama la vuelta del centro de alertas ANTES de evaluar (con el scope de la EMPRESA, nunca
   * el global) y el seed. Los GET no concilian.
   */
  async conciliar(empresaId: string, ahora: Date): Promise<ResultadoConciliacion> {
    return this.#bajoCandado(empresaId, async (tx) => {
      const res: ResultadoConciliacion = {
        revisados: 0,
        espejosCambiados: 0,
        conciliados: 0,
        desconciliados: 0,
      };
      const traspasos = await tx.traspaso.findMany({
        where: whereScoped(this.#scope, 'Traspaso', {
          empresaId,
          estado: { not: 'cancelado' },
          OR: [
            { conciliadoAt: null },
            { enviadoAt: { gte: new Date(ahora.getTime() - REVERIFICAR_CONCILIADOS_MS) } },
          ],
        }),
        select: {
          id: true,
          sucursalId: true,
          almacenOrigenSrId: true,
          sucursalDestinoId: true,
          almacenDestinoSrId: true,
          enviadoAt: true,
          recibidoAt: true,
          conciliadoAt: true,
        },
        orderBy: [{ enviadoAt: 'asc' }, { folio: 'asc' }],
      });
      res.revisados = traspasos.length;
      if (traspasos.length === 0) return res;
      const ids = traspasos.map((t) => t.id);
      const partidas = await tx.partidaTraspaso.findMany({
        where: whereScoped(this.#scope, 'PartidaTraspaso', { empresaId, traspasoId: { in: ids } }),
        select: {
          id: true,
          traspasoId: true,
          insumoOrigenSrId: true,
          cantidad: true,
          polizaSalidaId: true,
          renglonSalida: true,
          polizaEntradaId: true,
          renglonEntrada: true,
        },
        orderBy: [{ insumoOrigenSrId: 'asc' }, { id: 'asc' }],
      });
      const orden = new Map(ids.map((id, i) => [id, i]));
      partidas.sort((a, b) => orden.get(a.traspasoId)! - orden.get(b.traspasoId)!);
      const traspasoDe = new Map(traspasos.map((t) => [t.id, t]));

      const renglones: RenglonAConciliar[] = partidas.map((p) => {
        const t = traspasoDe.get(p.traspasoId)!;
        return {
          partidaId: p.id,
          sucursalOrigenId: t.sucursalId,
          almacenOrigen: t.almacenOrigenSrId,
          sucursalDestinoId: t.sucursalDestinoId,
          almacenDestino: t.almacenDestinoSrId,
          insumo: p.insumoOrigenSrId,
          cantidad: p.cantidad,
          enviadoAt: t.enviadoAt.getTime(),
          recibidoAt: t.recibidoAt?.getTime() ?? null,
          salida:
            p.polizaSalidaId !== null
              ? { polizaId: p.polizaSalidaId, renglon: p.renglonSalida! }
              : null,
          entrada:
            p.polizaEntradaId !== null
              ? { polizaId: p.polizaEntradaId, renglon: p.renglonEntrada! }
              : null,
        };
      });

      const porTraspaso = new Map<string, RenglonAConciliar[]>();
      partidas.forEach((p, i) => {
        const lista = porTraspaso.get(p.traspasoId) ?? [];
        lista.push(renglones[i]);
        porTraspaso.set(p.traspasoId, lista);
      });

      const desde = Math.min(...renglones.map((r) => r.enviadoAt)) - VENTANA_ESPEJO_MS;
      const hasta =
        Math.max(...renglones.map((r) => r.recibidoAt ?? r.enviadoAt)) + VENTANA_ESPEJO_MS;
      const sucursales = [
        ...new Set(traspasos.flatMap((t) => [t.sucursalId, t.sucursalDestinoId])),
      ];
      const insumos = [...new Set(renglones.map((r) => r.insumo))];
      const movimientos = await tx.movimientoInventario.findMany({
        where: whereScoped(this.#scope, 'MovimientoInventario', {
          empresaId,
          sucursalId: { in: sucursales },
          insumoOrigenSrId: { in: insumos },
          fecha: { gte: new Date(desde), lte: new Date(hasta) },
          poliza: {
            tipo: { in: ['traspaso_salida', 'traspaso_entrada'] },
            cancelada: false,
          },
        }),
        select: {
          polizaId: true,
          renglon: true,
          sucursalId: true,
          almacenOrigenSrId: true,
          insumoOrigenSrId: true,
          cantidad: true,
          fecha: true,
          poliza: { select: { tipo: true, cancelada: true } },
        },
      });
      const candidatos: MovimientoCandidato[] = movimientos.map((m) => ({
        polizaId: m.polizaId,
        renglon: m.renglon,
        sucursalId: m.sucursalId,
        almacen: m.almacenOrigenSrId,
        insumo: m.insumoOrigenSrId,
        cantidad: m.cantidad,
        fecha: m.fecha.getTime(),
        tipo: m.poliza.tipo as MovimientoCandidato['tipo'],
        cancelada: m.poliza.cancelada,
      }));

      // Espejos ya tomados por renglones que NO están en esta vuelta (conciliados firmes).
      const polizas = [...new Set(candidatos.map((c) => c.polizaId))];
      const ajenos =
        polizas.length === 0
          ? []
          : await tx.partidaTraspaso.findMany({
              where: whereScoped(this.#scope, 'PartidaTraspaso', {
                empresaId,
                traspasoId: { notIn: ids },
                OR: [{ polizaSalidaId: { in: polizas } }, { polizaEntradaId: { in: polizas } }],
              }),
              select: {
                polizaSalidaId: true,
                renglonSalida: true,
                polizaEntradaId: true,
                renglonEntrada: true,
              },
            });
      const ocupados = new Set(
        ajenos.flatMap((a) => [
          ...(a.polizaSalidaId !== null
            ? [llaveEspejo({ polizaId: a.polizaSalidaId, renglon: a.renglonSalida! })]
            : []),
          ...(a.polizaEntradaId !== null
            ? [llaveEspejo({ polizaId: a.polizaEntradaId, renglon: a.renglonEntrada! })]
            : []),
        ]),
      );

      const asignacion = conciliarRenglones(renglones, candidatos, ocupados);
      const cambiados = renglones.filter((r) => {
        const a = asignacion.get(r.partidaId)!;
        return !iguales(r.salida, a.salida) || !iguales(r.entrada, a.entrada);
      });
      res.espejosCambiados = cambiados.length;
      if (cambiados.length > 0) {
        // Primero se sueltan TODOS los que cambian y luego se ponen los nuevos: un espejo que
        // pasa de un renglón a otro no choca con el único (póliza, renglón).
        await tx.partidaTraspaso.updateMany({
          where: whereScoped(this.#scope, 'PartidaTraspaso', {
            empresaId,
            id: { in: cambiados.map((r) => r.partidaId) },
          }),
          data: {
            polizaSalidaId: null,
            renglonSalida: null,
            polizaEntradaId: null,
            renglonEntrada: null,
          },
        });
        for (const r of cambiados) {
          const a = asignacion.get(r.partidaId)!;
          if (a.salida === null && a.entrada === null) continue;
          await tx.partidaTraspaso.updateMany({
            where: whereScoped(this.#scope, 'PartidaTraspaso', { empresaId, id: r.partidaId }),
            data: {
              polizaSalidaId: a.salida?.polizaId ?? null,
              renglonSalida: a.salida?.renglon ?? null,
              polizaEntradaId: a.entrada?.polizaId ?? null,
              renglonEntrada: a.entrada?.renglon ?? null,
            },
          });
        }
      }

      for (const t of traspasos) {
        const suyos = porTraspaso.get(t.id) ?? [];
        const completo =
          suyos.length > 0 &&
          suyos.every((r) => {
            const a = asignacion.get(r.partidaId)!;
            return a.salida !== null && a.entrada !== null;
          });
        const nuevo = completo ? (t.conciliadoAt ?? ahora) : null;
        if ((nuevo?.getTime() ?? null) === (t.conciliadoAt?.getTime() ?? null)) continue;
        await tx.traspaso.updateMany({
          where: whereScoped(this.#scope, 'Traspaso', {
            id: t.id,
            empresaId,
            estado: { not: 'cancelado' },
          }),
          data: { conciliadoAt: nuevo, updatedAt: ahora },
        });
        if (nuevo === null) res.desconciliados++;
        else res.conciliados++;
      }
      return res;
    });
  }
}
