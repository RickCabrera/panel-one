import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { EmpresaScope } from './empresa-scope';
import type { AgenteAutenticado } from '../auth/request-autenticado';
import { ConsultaVentas, type FiltroVentas } from './consulta-ventas';
import { EscrituraAdmin } from './escritura-admin';
import { EscrituraAlertas } from './escritura-alertas';
import { EscrituraCatalogos, IngestaCatalogos } from './escritura-catalogos';
import { EscrituraConteos } from './escritura-conteos';
import { EscrituraExistencias, IngestaExistencias } from './escritura-existencias';
import { IngestaCompras } from './escritura-compras';
import { EscrituraFacturacion } from './escritura-facturacion';
import { EscrituraGastos } from './escritura-gastos';
import { EscrituraFolios, LecturaFoliosPlataforma } from './folios-plataforma';
import { IngestaMovimientos } from './escritura-movimientos';
import { IngestaRecetas } from './escritura-recetas';
import { EscrituraPush } from './escritura-push';
import { EscrituraReportes } from './escritura-reportes';
import { EscrituraTraspasos } from './escritura-traspasos';
import { EscrituraSucursal } from './escritura-sucursal';
import {
  COLUMNAS_INTOCABLES,
  LLAVE_EMPRESA,
  whereScoped,
  type WhereGenerico,
} from './scope.helper';

/**
 * Las únicas operaciones que el cliente con scope deja pasar. Todas aceptan
 * `where`, y ahí es donde se inyecta el filtro de empresa. La única escritura
 * es `updateMany` (F1-012, rotar la API key de una sucursal): lleva el mismo
 * filtro en el WHERE y pasa por `validarEscritura`. create/update/upsert/delete
 * y las búsquedas por llave única (findUnique, que no admite un AND extra) se
 * rechazan: la tarea que las necesite las agrega con su propio filtro y sus
 * tests, no por un atajo. La ingesta (F1-031) escribe por `deSucursal()` y las
 * altas de la administración (F1-060) por `admin()`.
 */
const OPERACIONES_PERMITIDAS = [
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'updateMany',
] as const;
type OperacionPermitida = (typeof OPERACIONES_PERMITIDAS)[number];

function esObjetoPlano(valor: unknown): valor is WhereGenerico {
  return (
    typeof valor === 'object' && valor !== null && Object.getPrototypeOf(valor) === Object.prototype
  );
}

/**
 * ¿El `where` ACOTA de verdad qué filas se escriben? Contar llaves no alcanza
 * (riesgo anotado en el log de F1-012, resuelto en F1-060): Prisma ignora un
 * filtro `undefined`, así que `{ id: undefined }`, `{ id: { equals: undefined } }`
 * o `{ AND: [{ id: undefined }] }` se vuelven "todas las filas".
 *
 * - Un valor `undefined` no acota.
 * - Un objeto de operador (`{ equals, in, ... }`) o de relación acota si alguna
 *   de sus llaves acota. `not`/`NOT` nunca cuentan: "todas menos X" no acota.
 * - `AND` acota si alguno de sus elementos acota; `OR` sólo si TODOS acotan (un
 *   `{}` entre las ramas vuelve el OR "todas las filas") y hay al menos uno.
 * - Cualquier otro valor (texto, número, `null`, fecha, arreglo de `in`) acota.
 */
export function whereAcota(where: unknown): boolean {
  if (!esObjetoPlano(where)) {
    return false;
  }
  return Object.entries(where).some(([llave, valor]) => {
    if (valor === undefined || llave === 'NOT' || llave === 'not') {
      return false;
    }
    if (llave === 'AND') {
      const ramas: unknown[] = Array.isArray(valor) ? valor : [valor];
      return ramas.some(whereAcota);
    }
    if (llave === 'OR') {
      const ramas: unknown[] = Array.isArray(valor) ? valor : [valor];
      return ramas.length > 0 && ramas.every(whereAcota);
    }
    return esObjetoPlano(valor) ? whereAcota(valor) : true;
  });
}

/**
 * Valida una escritura antes de mandarla: un `where` que acote de verdad (para
 * admin_global el filtro de empresa es `{}` y un where vacío, o hecho de puros
 * `undefined`, actualizaría la tabla entera) y un `data` que no toque identidad
 * ni pertenencia.
 */
function validarEscritura(
  modelo: Prisma.ModelName,
  args: { where?: WhereGenerico; data?: WhereGenerico },
): void {
  if (!whereAcota(args.where)) {
    throw new Error(`${modelo}.updateMany con scope exige un where no vacío.`);
  }
  const prohibidas = new Set([...COLUMNAS_INTOCABLES, LLAVE_EMPRESA[modelo]]);
  const tocadas = Object.keys(args.data ?? {}).filter((c) => prohibidas.has(c));
  if (tocadas.length > 0) {
    throw new Error(
      `${modelo}.updateMany con scope no puede escribir ${tocadas.join(', ')}: ` +
        'una escritura con scope no cambia la identidad ni la pertenencia de una fila.',
    );
  }
}
const PERMITIDAS: ReadonlySet<string> = new Set(OPERACIONES_PERMITIDAS);

function extenderConScope(prisma: PrismaService, scope: EmpresaScope) {
  return prisma.$extends({
    name: 'empresa-scope',
    query: {
      $allModels: {
        $allOperations({ model, operation, args, query }) {
          if (!PERMITIDAS.has(operation)) {
            throw new Error(
              `${model}.${operation} no está permitido con scope de empresa. ` +
                `Usa ${OPERACIONES_PERMITIDAS.join('/')}.`,
            );
          }
          const original = (args ?? {}) as { where?: WhereGenerico; data?: WhereGenerico };
          if (operation === 'updateMany') {
            validarEscritura(model as Prisma.ModelName, original);
          }
          return query({
            ...original,
            where: whereScoped(scope, model as Prisma.ModelName, original.where),
          } as typeof args);
        },
      },
    },
  });
}

type ClienteConScope = ReturnType<typeof extenderConScope>;
type Delegado = Uncapitalize<Prisma.ModelName>;

/** Sólo los modelos, las lecturas y `updateMany`: ni `$queryRaw`, ni `$transaction`, ni create/delete. */
export type DatosScoped = {
  readonly [M in Delegado]: Pick<ClienteConScope[M], OperacionPermitida>;
};

/**
 * Lo ÚNICO que la consulta pública de un código de facturación (F2-101) puede leer: lista
 * blanca. Ni folio, ni mesa, ni partidas, ni pagos, ni la empresa más allá de si está activa.
 */
const SELECCION_CODIGO_PUBLICO = {
  codigo: true,
  estado: true,
  expiraAt: true,
  cheque: { select: { abiertoAt: true, cerradoAt: true, total: true, cancelado: true } },
  // F2-104: si hay una reserva o un CFDI, el estado público lo dice (`en_proceso`).
  cfdi: { select: { estado: true } },
  // F2-108: si el ticket entró a una factura global, su estado y su periodo. NADA más de la global
  // (ni uuid, ni serie-folio, ni importes, ni el total del ticket guardado en la fila).
  global: {
    select: { cfdi: { select: { estado: true, globalPeriodicidad: true, globalDesde: true } } },
  },
  sucursal: {
    select: {
      nombre: true,
      zonaHoraria: true,
      activo: true,
      empresa: { select: { activo: true } },
    },
  },
} as const satisfies Prisma.CodigoFacturacionSelect;

export type LecturaCodigoPublico = Prisma.CodigoFacturacionGetPayload<{
  select: typeof SELECCION_CODIGO_PUBLICO;
}>;

/**
 * Lo que el portal de autofactura (F2-103) lee de un código: lo de la consulta pública más el
 * desglose (subtotal, impuestos) y los ids que necesita la emisión (F2-104: el candado por código
 * y el cheque). Los ids nunca salen al público; el servicio arma la respuesta con lista blanca.
 */
const SELECCION_CODIGO_PORTAL = {
  id: true,
  codigo: true,
  estado: true,
  expiraAt: true,
  chequeId: true,
  sucursalId: true,
  cheque: {
    select: {
      abiertoAt: true,
      cerradoAt: true,
      subtotal: true,
      impuestos: true,
      total: true,
      cancelado: true,
    },
  },
  cfdi: { select: { estado: true } },
  // F2-108: si el ticket entró a una factura global, su estado y su periodo. NADA más de la global
  // (ni uuid, ni serie-folio, ni importes, ni el total del ticket guardado en la fila).
  global: {
    select: { cfdi: { select: { estado: true, globalPeriodicidad: true, globalDesde: true } } },
  },
  sucursal: {
    select: {
      nombre: true,
      zonaHoraria: true,
      activo: true,
      empresa: { select: { activo: true } },
    },
  },
} as const satisfies Prisma.CodigoFacturacionSelect;

export type LecturaCodigoPortal = Prisma.CodigoFacturacionGetPayload<{
  select: typeof SELECCION_CODIGO_PORTAL;
}>;

/**
 * Un portal que se puede mostrar: el portal activo, y su sucursal y su empresa activas. El mismo
 * filtro para la marca y para el logo: cualquiera de los tres dado de baja = no existe.
 */
function wherePortalVisible(slug: string): Prisma.PortalFacturacionWhereInput {
  return { slug, activo: true, sucursal: { activo: true, empresa: { activo: true } } };
}

/** Lo que el portal público sabe de sí mismo (F2-103). Sin el logo: ése va por su ruta. */
export interface LecturaPortalPublico {
  slug: string;
  color: string;
  tieneLogo: boolean;
  sucursal: string;
  /**
   * La empresa del portal, OPACA para el servicio: sólo sirve para pasarla a
   * `codigoFacturacionDelPortal`, que la pone en el WHERE. No hay otra consulta que la acepte.
   */
  empresaId: string;
}

function exigirTexto(nombre: string, valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new Error(`Consulta del portal de autofactura: ${nombre} vacío o ausente.`);
  }
  return valor;
}

/**
 * EL helper obligatorio de scope multiempresa. Todo servicio de datos de
 * negocio lee a través de `para(scope)`; importar `PrismaService` directamente
 * fuera de la allowlist de `eslint.config.mjs` rompe el lint.
 *
 * El cliente crudo se guarda en un campo privado de JS (`#prisma`), no en una
 * propiedad: nadie puede sacarlo de esta clase para saltarse el filtro.
 */
@Injectable()
export class ScopedPrismaService {
  readonly #prisma: PrismaService;

  constructor(prisma: PrismaService) {
    this.#prisma = prisma;
  }

  para(scope: EmpresaScope): DatosScoped {
    const cliente = extenderConScope(this.#prisma, scope);
    // Cada delegado se arma sólo con las operaciones permitidas: `create`,
    // `update`, etc. no existen ni en el tipo ni en runtime. La extensión de
    // arriba sigue rechazándolas por si algo llegara a colarse.
    const delegados = Object.values(Prisma.ModelName).map((modelo) => {
      const clave = (modelo.charAt(0).toLowerCase() + modelo.slice(1)) as Delegado;
      const delegado = cliente[clave] as unknown as Record<string, (args?: unknown) => unknown>;
      const operaciones = OPERACIONES_PERMITIDAS.map(
        (op) => [op, (args?: unknown) => delegado[op](args)] as const,
      );
      return [clave, Object.freeze(Object.fromEntries(operaciones))] as const;
    });
    return Object.freeze(Object.fromEntries(delegados)) as unknown as DatosScoped;
  }

  /**
   * Las escrituras de la ingesta (F1-031), clavadas a la SUCURSAL del agente,
   * no sólo a su empresa: cada operación de `EscrituraSucursal` pone
   * `sucursalId` y `empresaId` ella misma, desde la API key. Es el único lugar
   * donde existe una transacción; `para(scope)` sigue sin exponer `$transaction`.
   */
  deSucursal(agente: AgenteAutenticado): EscrituraSucursal {
    return new EscrituraSucursal((fn) => this.#prisma.$transaction((tx) => fn(tx)), agente);
  }

  /**
   * Las altas de la administración (F1-060): empresa, sucursal y usuario, cada
   * una con su propio chequeo de alcance (ver `escritura-admin.ts`). Las
   * ediciones siguen por `para(scope).X.updateMany`.
   */
  admin(scope: EmpresaScope): EscrituraAdmin {
    return new EscrituraAdmin(this.#prisma, scope);
  }

  /**
   * Las escrituras del centro de alertas (F2-224): abrir, cerrar y guardar reglas, todo
   * bajo el candado de la empresa y clavado a ella (ver `escritura-alertas.ts`). La
   * empresa se verifica con este `scope`: fuera de alcance, 404.
   */
  alertas(scope: EmpresaScope): EscrituraAlertas {
    return new EscrituraAlertas(this.#prisma, scope);
  }

  /**
   * Las escrituras de los reportes programados (F2-141): guardar la suscripción propia y
   * reclamar/cerrar cada envío (ver `escritura-reportes.ts`). La empresa se verifica con
   * este `scope`: fuera de alcance, 404.
   */
  reportes(scope: EmpresaScope): EscrituraReportes {
    return new EscrituraReportes(this.#prisma, scope);
  }

  /**
   * Las escrituras de las notificaciones push (F2-146): el navegador y las preferencias
   * propias, el descarte de navegadores muertos y el reclamo del resumen diario (ver
   * `escritura-push.ts`).
   */
  push(scope: EmpresaScope): EscrituraPush {
    return new EscrituraPush(this.#prisma, scope);
  }

  /**
   * Las escrituras de la ingesta de catálogos (F2-230), clavadas a la SUCURSAL del agente
   * como `deSucursal()`: página y cierre bajo el candado de (sucursal, catálogo). Ver
   * `escritura-catalogos.ts`.
   */
  catalogosDeSucursal(agente: AgenteAutenticado): IngestaCatalogos {
    return new IngestaCatalogos(this.#prisma, agente);
  }

  /**
   * Las escrituras del panel sobre catálogos (F2-230): metadata propia de un producto y la
   * solicitud de sincronización. Empresa, sucursal y producto se verifican con este `scope`:
   * fuera de alcance, 404.
   */
  catalogos(scope: EmpresaScope): EscrituraCatalogos {
    return new EscrituraCatalogos(this.#prisma, scope);
  }

  /**
   * Existencias (F2-121) de la sucursal del agente: la foto de un almacén, bajo su candado.
   * El tenant sale de la API key; nada de lo que llega puede moverlo.
   */
  existenciasDeSucursal(agente: AgenteAutenticado): IngestaExistencias {
    return new IngestaExistencias(this.#prisma, agente);
  }

  /** Lo que el panel escribe sobre las existencias (F2-121): los límites, con scope. */
  existencias(scope: EmpresaScope): EscrituraExistencias {
    return new EscrituraExistencias(this.#prisma, scope);
  }

  /**
   * Pólizas y movimientos de inventario (F2-122) de la sucursal del agente: un lote bajo el
   * candado de la sucursal. El panel no escribe pólizas: sólo las lee con `para(scope)`.
   */
  movimientosDeSucursal(agente: AgenteAutenticado): IngestaMovimientos {
    return new IngestaMovimientos(this.#prisma, agente);
  }

  /**
   * Recetas (F2-125) de la sucursal del agente: un lote bajo el candado de recetas de la
   * sucursal. El panel no escribe recetas: sólo las lee con `para(scope)`.
   */
  recetasDeSucursal(agente: AgenteAutenticado): IngestaRecetas {
    return new IngestaRecetas(this.#prisma, agente);
  }

  /**
   * Compras (F2-126) de la sucursal del agente: un lote bajo el candado de compras de la
   * sucursal. El panel no escribe compras: sólo las lee con `para(scope)`.
   */
  comprasDeSucursal(agente: AgenteAutenticado): IngestaCompras {
    return new IngestaCompras(this.#prisma, agente);
  }

  /**
   * Categorías de gasto y gastos (F2-126), con el scope del usuario. Es dato NUESTRO: nunca se
   * escribe a SoftRestaurant.
   */
  gastos(scope: EmpresaScope): EscrituraGastos {
    return new EscrituraGastos(this.#prisma, scope);
  }

  /**
   * Perfil fiscal, metadata del CSD y receptores frecuentes (F2-100), con el scope del usuario. Es
   * dato NUESTRO: nunca se escribe a SoftRestaurant. Del CSD sólo pasa metadata.
   */
  facturacion(scope: EmpresaScope): EscrituraFacturacion {
    return new EscrituraFacturacion(this.#prisma, scope);
  }

  /**
   * El control de folios del PAC (F2-110): lecturas de PLATAFORMA. Con cualquier scope sólo
   * contesta si hay folios (un booleano); las cifras exigen scope global.
   */
  folios(scope: EmpresaScope): LecturaFoliosPlataforma {
    return new LecturaFoliosPlataforma(this.#prisma, scope);
  }

  /** Las escrituras del control de folios (F2-110). Lanza con un scope que no sea global. */
  escrituraFolios(scope: EmpresaScope): EscrituraFolios {
    return new EscrituraFolios(this.#prisma, scope);
  }

  /**
   * Conteos físicos (F2-123): crear, capturar, cerrar y cancelar, con el scope del usuario y bajo
   * el candado de cada conteo. Es dato NUESTRO: nunca se escribe a SoftRestaurant.
   */
  conteos(scope: EmpresaScope): EscrituraConteos {
    return new EscrituraConteos(this.#prisma, scope);
  }

  /**
   * Traspasos del panel (F2-124): enviar, recibir, cancelar y conciliar contra SR, con el scope
   * recibido y bajo el candado de traspasos de la empresa. Dato NUESTRO: nunca se escribe a SR.
   */
  traspasos(scope: EmpresaScope): EscrituraTraspasos {
    return new EscrituraTraspasos(this.#prisma, scope);
  }

  /**
   * La consulta PÚBLICA de un código de facturación (F2-101): sin usuario ni tenant, porque el
   * código ES la credencial (único global, 32^9 combinaciones, rate limit por IP). Por eso no
   * pasa por `para(scope)`, y por eso sólo devuelve la lista blanca `SELECCION_CODIGO_PUBLICO`:
   * quien la use no puede pedir un `include` que filtre el folio o las partidas.
   */
  codigoFacturacionPublico(codigo: string): Promise<LecturaCodigoPublico | null> {
    if (typeof codigo !== 'string' || codigo.length === 0) {
      throw new Error('Consulta de código de facturación: código vacío o ausente.');
    }
    return this.#prisma.codigoFacturacion.findFirst({
      where: { codigo },
      select: SELECCION_CODIGO_PUBLICO,
    });
  }

  /**
   * El portal público de una sucursal por su slug (F2-103), sin usuario ni tenant: el slug es una
   * URL pública. Null si no existe o si el portal, su sucursal o su empresa están dados de baja.
   */
  async portalPublico(slug: string): Promise<LecturaPortalPublico | null> {
    const fila = await this.#prisma.portalFacturacion.findFirst({
      where: wherePortalVisible(exigirTexto('slug', slug)),
      select: {
        slug: true,
        color: true,
        logoTipo: true,
        empresaId: true,
        sucursal: { select: { nombre: true } },
      },
    });
    if (!fila) return null;
    return {
      slug: fila.slug,
      color: fila.color,
      tieneLogo: fila.logoTipo !== null,
      sucursal: fila.sucursal.nombre,
      empresaId: fila.empresaId,
    };
  }

  /** El logo del portal (F2-103), con el MISMO filtro de visibilidad que `portalPublico`. */
  async logoPortal(slug: string): Promise<{ logo: Buffer; tipo: string } | null> {
    const fila = await this.#prisma.portalFacturacion.findFirst({
      where: wherePortalVisible(exigirTexto('slug', slug)),
      select: { logo: true, logoTipo: true },
    });
    if (!fila || fila.logo === null || fila.logoTipo === null) return null;
    return { logo: Buffer.from(fila.logo), tipo: fila.logoTipo };
  }

  /**
   * Un código de facturación visto DESDE EL PORTAL de una empresa (F2-103): el `empresaId` va en
   * el WHERE, así un código de otra empresa es "no existe" sin que el servicio tenga que acordarse
   * de compararlo. El `empresaId` sale de `portalPublico`. Lista blanca `SELECCION_CODIGO_PORTAL`.
   *
   * DECISION PROVISIONAL (nocturno): el portal de una sucursal acepta los códigos de CUALQUIER
   * sucursal de su empresa (un emisor por empresa, F2-100), nunca los de otra empresa. La opción
   * más estricta (sólo los de su sucursal) es decisión abierta (docs/esquema-sr.md §2).
   */
  codigoFacturacionDelPortal(
    codigo: string,
    empresaId: string,
  ): Promise<LecturaCodigoPortal | null> {
    return this.#prisma.codigoFacturacion.findFirst({
      where: {
        codigo: exigirTexto('codigo', codigo),
        empresaId: exigirTexto('empresaId', empresaId),
      },
      select: SELECCION_CODIGO_PORTAL,
    });
  }

  /**
   * SQL crudo de los agregados de ventas (F1-032), con scope. El helper arma
   * las CTEs ya filtradas por el tenant del usuario, la empresa y sucursal
   * pedidas y el rango en la zona de cada sucursal; el caller sólo escribe el
   * cuerpo que lee de ellas (ver `consulta-ventas.ts`). Cada consulta corre con
   * `statement_timeout` local, en una transacción de sólo esas dos sentencias.
   */
  ventas(scope: EmpresaScope, filtro: FiltroVentas): ConsultaVentas {
    return new ConsultaVentas(
      async (sql, timeoutMs) => {
        const [, filas] = await this.#prisma.$transaction([
          this.#prisma
            .$queryRaw`SELECT set_config('statement_timeout', ${String(timeoutMs)}, true)`,
          this.#prisma.$queryRaw<unknown[]>(sql),
        ]);
        return filas;
      },
      scope,
      filtro,
    );
  }
}
