import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import type { EmpresaScope } from './empresa-scope';
import { LLAVE_EMPRESA, whereScoped, type WhereGenerico } from './scope.helper';

/**
 * Las únicas operaciones que el cliente con scope deja pasar. Todas aceptan
 * `where`, y ahí es donde se inyecta el filtro de empresa. La única escritura
 * es `updateMany` (F1-012, rotar la API key de una sucursal): lleva el mismo
 * filtro en el WHERE y pasa por `validarEscritura`. create/update/upsert/delete
 * y las búsquedas por llave única (findUnique, que no admite un AND extra) se
 * rechazan: la tarea que las necesite (F1-060, la ingesta) las agrega aquí con
 * su propio filtro y sus tests, no por un atajo.
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

/**
 * Columnas que una escritura con scope NUNCA puede tocar, además de la llave de
 * tenant del modelo (`LLAVE_EMPRESA`): la identidad de la fila y su pertenencia.
 * Una escritura con scope no mueve una fila a otra empresa ni a otra sucursal.
 *
 * Es una lista de PROHIBIDAS, no de permitidas: si un modelo futuro trae otra
 * columna de pertenencia, se agrega aquí con su test. F1-030 agregó `chequeId`
 * / `cheque`: una partida o un pago no se mueven a otro cheque.
 */
const COLUMNAS_INTOCABLES: readonly string[] = [
  'id',
  'empresaId',
  'sucursalId',
  'chequeId',
  'empresa',
  'sucursal',
  'cheque',
];

/**
 * Valida una escritura antes de mandarla: `where` no vacío (para admin_global el
 * filtro de empresa es `{}` y un where vacío actualizaría la tabla entera) y un
 * `data` que no toque identidad ni pertenencia.
 */
function validarEscritura(
  modelo: Prisma.ModelName,
  args: { where?: WhereGenerico; data?: WhereGenerico },
): void {
  if (!args.where || Object.keys(args.where).length === 0) {
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
}
