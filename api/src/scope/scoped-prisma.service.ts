import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { EmpresaScope } from './empresa-scope';
import type { AgenteAutenticado } from '../auth/request-autenticado';
import { ConsultaVentas, type FiltroVentas } from './consulta-ventas';
import { EscrituraAdmin } from './escritura-admin';
import { EscrituraAlertas } from './escritura-alertas';
import { EscrituraCatalogos, IngestaCatalogos } from './escritura-catalogos';
import { EscrituraReportes } from './escritura-reportes';
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
