import { Prisma, type CanalNegocio, type CatalogoSr } from '@prisma/client';

import type { AgenteAutenticado } from '../auth/request-autenticado';
import type { Contenido, FilaExistente, PlanPagina } from '../ingesta/catalogos';
import type { EmpresaScope } from './empresa-scope';
import { COLUMNAS_INTOCABLES, encontradoOr404, whereScoped } from './scope.helper';

/**
 * Las escrituras de los catálogos espejo (F2-230). Son parte del helper obligatorio de
 * scope: sólo `ScopedPrismaService.catalogosDeSucursal(agente)` y `.catalogos(scope)`
 * construyen estas clases.
 *
 * - `IngestaCatalogos`: clavada a la SUCURSAL del agente (como `EscrituraSucursal`). Cada
 *   lectura y escritura pone `sucursalId` y `empresaId` ella misma, desde la API key; el
 *   contenido que llega no puede traerlos (`sinIntocables`). Página y cierre del mismo
 *   catálogo corren en UNA transacción bajo `pg_advisory_xact_lock(sucursal, catálogo)`:
 *   van en serie también entre réplicas. La unique `(sucursal_id, origen_sr_id)` es la que
 *   protege al final: un choque sale como transitorio, nunca como fila doble.
 * - `EscrituraCatalogos`: lo que escribe el panel (metadata propia de un producto y la
 *   solicitud de sincronización), con la empresa, la sucursal y el producto verificados CON
 *   el scope del usuario: fuera de alcance = 404, igual que inexistente.
 */

/** Cuánto se espera el candado del catálogo antes de rendirse (`lock_timeout`). */
export const ESPERA_CANDADO_CATALOGO_MS = 4000;
const TIMEOUT_SENTENCIA_MS = 5000;
const TIMEOUT_TRANSACCION_MS = 30_000;
const ESPERA_CONEXION_MS = 5000;

/** No se consiguió el candado del catálogo a tiempo: otra página o cierre lo tiene. */
export class CandadoCatalogoOcupado extends Error {
  constructor() {
    super('Otra página o cierre de este catálogo se está aplicando; reintentar.');
  }
}

/** El cierre no cuadra: faltan páginas de esa sincronización. No se desactivó nada. */
export class CierreIncompleto extends Error {
  constructor(
    readonly vistos: number,
    readonly rechazados: number,
    readonly total: number,
  ) {
    super(
      `El cierre dice ${total} registros y sólo hay ${vistos} filas de esa sincronización más ` +
        `${rechazados} rechazados: faltan páginas. No se dio de baja nada; reintentar.`,
    );
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
    throw new Error(`Escritura de catálogos: ${nombre} vacío o ausente en un filtro.`);
  }
  return valor;
}

function exigirFecha(nombre: string, valor: unknown): Date {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) {
    throw new Error(`Escritura de catálogos: ${nombre} no es una fecha válida.`);
  }
  return valor;
}

function sinIntocables(contenido: Contenido): Contenido {
  const tocadas = Object.keys(contenido).filter((c) => COLUMNAS_INTOCABLES.includes(c));
  if (tocadas.length > 0) {
    throw new Error(
      `Escritura de catálogos: el contenido no puede traer ${tocadas.join(', ')}. ` +
        'La sucursal y la empresa las pone el helper desde la API key.',
    );
  }
  return contenido;
}

type Tx = Prisma.TransactionClient;

/**
 * La forma común de los seis delegados espejo. Prisma genera un tipo por modelo; todos
 * comparten estas columnas y operaciones, y el helper sólo usa éstas.
 */
interface DelegadoCatalogo {
  findMany(args: {
    where: Record<string, unknown>;
    select: Record<string, true>;
  }): Promise<FilaExistente[]>;
  createMany(args: { data: Record<string, unknown>[] }): Promise<{ count: number }>;
  updateMany(args: {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  }): Promise<{ count: number }>;
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

export function delegadoDe(tx: Tx, catalogo: CatalogoSr): DelegadoCatalogo {
  const delegados: Record<CatalogoSr, unknown> = {
    grupos: tx.grupoProducto,
    productos: tx.producto,
    meseros: tx.meseroCatalogo,
    clientes: tx.clienteCatalogo,
    areas: tx.areaCatalogo,
    canales: tx.canalVentaCatalogo,
  };
  return delegados[catalogo] as DelegadoCatalogo;
}

const SELECT_EXISTENTE = {
  id: true,
  origenSrId: true,
  hash: true,
  activo: true,
  vistoAt: true,
  sincronizacionId: true,
} as const;

export interface EstadoSincronizacion {
  sincronizacionId: string;
  ultimaCompletaAt: Date;
  desactivados: number;
}

/** Las operaciones de UN catálogo de UNA sucursal, dentro de su transacción y su candado. */
export class TransaccionCatalogo {
  readonly #tx: Tx;
  readonly #catalogo: CatalogoSr;
  readonly #delegado: DelegadoCatalogo;
  readonly #deLaSucursal: { readonly sucursalId: string; readonly empresaId: string };

  constructor(tx: Tx, catalogo: CatalogoSr, sucursalId: string, empresaId: string) {
    this.#tx = tx;
    this.#catalogo = catalogo;
    this.#delegado = delegadoDe(tx, catalogo);
    this.#deLaSucursal = Object.freeze({
      sucursalId: exigir('sucursalId', sucursalId),
      empresaId: exigir('empresaId', empresaId),
    });
  }

  estado(): Promise<EstadoSincronizacion | null> {
    return this.#tx.sincronizacionCatalogo.findFirst({
      where: { ...this.#deLaSucursal, catalogo: this.#catalogo },
      select: { sincronizacionId: true, ultimaCompletaAt: true, desactivados: true },
    });
  }

  /** Las filas de ESTA sucursal y catálogo con esos `origenSrId`, en una sola consulta. */
  existentes(origenes: readonly string[]): Promise<FilaExistente[]> {
    if (origenes.length === 0) {
      return Promise.resolve([]);
    }
    return this.#delegado.findMany({
      where: {
        ...this.#deLaSucursal,
        origenSrId: { in: origenes.map((o) => exigir('origenSrId', o)) },
      },
      select: SELECT_EXISTENTE,
    });
  }

  /** Aplica el plan de `decidir()`. `ahora` (reloj del API) es el `updatedAt` de lo que cambia. */
  async aplicar(
    plan: PlanPagina,
    capturadoAt: Date,
    sincronizacionId: string,
    ahora: Date,
  ): Promise<void> {
    const visto = exigirFecha('capturadoAt', capturadoAt);
    const sinc = exigir('sincronizacionId', sincronizacionId);
    const cuando = exigirFecha('ahora', ahora);
    const marcas = { vistoAt: visto, sincronizacionId: sinc };
    if (plan.crear.length > 0) {
      await this.#delegado.createMany({
        data: plan.crear.map((r) => ({
          ...sinIntocables(r.contenido),
          origenSrId: exigir('origenSrId', r.origenSrId),
          hash: r.hash,
          activo: true,
          ...marcas,
          updatedAt: cuando,
          ...this.#deLaSucursal,
        })),
      });
    }
    for (const { id, registro } of plan.actualizar) {
      const { count } = await this.#delegado.updateMany({
        where: { id: exigir('id', id), ...this.#deLaSucursal },
        data: {
          ...sinIntocables(registro.contenido),
          hash: registro.hash,
          activo: true,
          ...marcas,
          updatedAt: cuando,
        },
      });
      if (count !== 1) {
        throw new Error(`Escritura de catálogos: la fila ${id} no es de esta sucursal.`);
      }
    }
    if (plan.marcar.length > 0) {
      await this.#delegado.updateMany({
        where: { id: { in: plan.marcar.map((id) => exigir('id', id)) }, ...this.#deLaSucursal },
        data: marcas,
      });
    }
  }

  contarDeSincronizacion(sincronizacionId: string): Promise<number> {
    return this.#delegado.count({
      where: {
        ...this.#deLaSucursal,
        sincronizacionId: exigir('sincronizacionId', sincronizacionId),
      },
    });
  }

  contarActivos(): Promise<number> {
    return this.#delegado.count({ where: { ...this.#deLaSucursal, activo: true } });
  }

  /**
   * Da de baja (nunca borra) lo que NO vio la sincronización completa `X`: filas activas
   * con otra sincronización y un `vistoAt` anterior a su `capturadoAt`. Una fila que ya
   * vio una sincronización más nueva no se toca. `vistoAt` se queda como estaba.
   */
  async desactivarNoVistas(
    sincronizacionId: string,
    capturadoAt: Date,
    ahora: Date,
  ): Promise<number> {
    const { count } = await this.#delegado.updateMany({
      where: {
        ...this.#deLaSucursal,
        activo: true,
        sincronizacionId: { not: exigir('sincronizacionId', sincronizacionId) },
        vistoAt: { lt: exigirFecha('capturadoAt', capturadoAt) },
      },
      data: { activo: false, updatedAt: exigirFecha('ahora', ahora) },
    });
    return count;
  }

  async guardarEstado(d: {
    sincronizacionId: string;
    ultimaCompletaAt: Date;
    total: number;
    rechazados: number;
    desactivados: number;
    recibidaAt: Date;
  }): Promise<void> {
    await this.#tx.sincronizacionCatalogo.upsert({
      where: {
        sucursalId_catalogo: {
          sucursalId: this.#deLaSucursal.sucursalId,
          catalogo: this.#catalogo,
        },
      },
      create: { ...d, ...this.#deLaSucursal, catalogo: this.#catalogo },
      update: d,
    });
  }
}

/** Lo que el helper necesita del cliente crudo. */
export interface ClienteCatalogos {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
  solicitudSincronizacion: Pick<Prisma.TransactionClient['solicitudSincronizacion'], 'findFirst'>;
  sincronizacionCatalogo: Pick<Prisma.TransactionClient['sincronizacionCatalogo'], 'findMany'>;
}

/** Lo que devuelve `ScopedPrismaService.catalogosDeSucursal(agente)`. */
export class IngestaCatalogos {
  readonly #cliente: ClienteCatalogos;
  readonly #sucursalId: string;
  readonly #empresaId: string;

  constructor(cliente: ClienteCatalogos, agente: AgenteAutenticado) {
    this.#cliente = cliente;
    this.#sucursalId = exigir('sucursalId', agente.sucursalId);
    this.#empresaId = exigir('empresaId', agente.empresaId);
  }

  /** Corre `fn` en UNA transacción con el candado de (sucursal, catálogo). */
  async bajoCandado<T>(
    catalogo: CatalogoSr,
    fn: (tx: TransaccionCatalogo) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.#cliente.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT set_config('lock_timeout', ${String(ESPERA_CANDADO_CATALOGO_MS)}, true)`;
          await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(TIMEOUT_SENTENCIA_MS)}, true)`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalogos:${this.#sucursalId}`}), hashtext(${catalogo}))`;
          return fn(new TransaccionCatalogo(tx, catalogo, this.#sucursalId, this.#empresaId));
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

  /** La solicitud de sincronización de ESTA sucursal y la recepción del último cierre de cada catálogo. */
  async solicitud(): Promise<{
    solicitadaAt: Date | null;
    recibidas: Array<{ catalogo: CatalogoSr; recibidaAt: Date }>;
  }> {
    const deLaSucursal = { sucursalId: this.#sucursalId, empresaId: this.#empresaId };
    const [s, recibidas] = await Promise.all([
      this.#cliente.solicitudSincronizacion.findFirst({
        where: deLaSucursal,
        select: { solicitadaAt: true },
      }),
      this.#cliente.sincronizacionCatalogo.findMany({
        where: deLaSucursal,
        select: { catalogo: true, recibidaAt: true },
      }),
    ]);
    return { solicitadaAt: s?.solicitadaAt ?? null, recibidas };
  }
}

// ---------------------------------------------------------------------------
// escrituras del panel
// ---------------------------------------------------------------------------

export interface DatosMetadata {
  descripcion: string | null;
  fotoUrl: string | null;
  etiquetas: string[];
  minimo: Prisma.Decimal | null;
  maximo: Prisma.Decimal | null;
}

type ClientePanel = Pick<
  Prisma.TransactionClient,
  | 'empresa'
  | 'sucursal'
  | 'producto'
  | 'productoMetadata'
  | 'solicitudSincronizacion'
  | 'areaCatalogo'
  | 'areaCanal'
>;

/** Lo que devuelve `ScopedPrismaService.catalogos(scope)`. */
export class EscrituraCatalogos {
  readonly #cliente: ClientePanel;
  readonly #scope: EmpresaScope;

  constructor(cliente: ClientePanel, scope: EmpresaScope) {
    this.#cliente = cliente;
    this.#scope = scope;
  }

  /**
   * Reemplaza la metadata propia de un producto. El producto se busca CON el scope y
   * dentro de la empresa pedida: de otra empresa, o de una empresa fuera de alcance = 404.
   */
  async guardarMetadata(
    empresaId: string,
    productoId: string,
    datos: DatosMetadata,
    actorId: string,
    ahora: Date,
  ): Promise<void> {
    const producto = encontradoOr404(
      await this.#cliente.producto.findFirst({
        where: whereScoped(this.#scope, 'Producto', {
          id: exigir('productoId', productoId),
          empresaId: exigir('empresaId', empresaId),
        }),
        select: { id: true, empresaId: true },
      }),
    );
    const valores = { ...datos, actualizadoPor: exigir('actorId', actorId), updatedAt: ahora };
    await this.#cliente.productoMetadata.upsert({
      where: { productoId: producto.id },
      create: { ...valores, productoId: producto.id, empresaId: producto.empresaId },
      update: valores,
    });
  }

  /**
   * Asigna (o, con `null`, quita) el canal de negocio de un área del espejo (F2-233). El área se
   * busca CON el scope y dentro de la empresa pedida: de otra empresa, fuera de alcance o
   * inexistente = el mismo 404. Quitar un canal que no estaba no es error.
   */
  async asignarCanalArea(
    empresaId: string,
    areaId: string,
    canal: CanalNegocio | null,
    actorId: string,
    ahora: Date,
  ): Promise<void> {
    const area = encontradoOr404(
      await this.#cliente.areaCatalogo.findFirst({
        where: whereScoped(this.#scope, 'AreaCatalogo', {
          id: exigir('areaId', areaId),
          empresaId: exigir('empresaId', empresaId),
        }),
        select: { id: true, empresaId: true },
      }),
    );
    if (canal === null) {
      await this.#cliente.areaCanal.deleteMany({
        where: whereScoped(this.#scope, 'AreaCanal', {
          areaId: area.id,
          empresaId: area.empresaId,
        }),
      });
      return;
    }
    const valores = { canal, actualizadoPor: exigir('actorId', actorId), updatedAt: ahora };
    await this.#cliente.areaCanal.upsert({
      where: { areaId: area.id },
      create: { ...valores, areaId: area.id, empresaId: area.empresaId },
      update: valores,
    });
  }

  /**
   * Pide al agente de la sucursal una sincronización completa. La sucursal tiene que ser
   * de esa empresa y estar en el alcance: si no, 404. Pedirlo otra vez mueve la hora.
   */
  async solicitarSincronizacion(
    empresaId: string,
    sucursalId: string,
    actorId: string,
    ahora: Date,
  ): Promise<void> {
    const sucursal = encontradoOr404(
      await this.#cliente.sucursal.findFirst({
        where: whereScoped(this.#scope, 'Sucursal', {
          id: exigir('sucursalId', sucursalId),
          empresaId: exigir('empresaId', empresaId),
        }),
        select: { id: true, empresaId: true },
      }),
    );
    const valores = { solicitadaAt: ahora, solicitadaPor: exigir('actorId', actorId) };
    await this.#cliente.solicitudSincronizacion.upsert({
      where: { sucursalId: sucursal.id },
      create: { ...valores, sucursalId: sucursal.id, empresaId: sucursal.empresaId },
      update: valores,
    });
  }
}
