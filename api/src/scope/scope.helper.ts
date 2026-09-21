import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { EmpresaScope } from './empresa-scope';

/**
 * La columna que dice de qué empresa es cada fila, por modelo. `satisfies
 * Record<Prisma.ModelName, ...>` obliga a registrar aquí TODO modelo nuevo: si
 * F1-030 agrega `Cheque` y no lo anota, `npm run typecheck` falla.
 */
export const LLAVE_EMPRESA = {
  Empresa: 'id',
  Sucursal: 'empresaId',
  Usuario: 'empresaId',
  AgenteEstado: 'empresaId',
  Cheque: 'empresaId',
  ChequePartida: 'empresaId',
  ChequePago: 'empresaId',
  MesaSnapshot: 'empresaId',
} as const satisfies Record<Prisma.ModelName, 'id' | 'empresaId'>;

export type WhereGenerico = Record<string, unknown>;

/** El filtro de tenant de un modelo: `{}` para admin_global, la empresa para los demás. */
export function whereEmpresa(scope: EmpresaScope, modelo: Prisma.ModelName): WhereGenerico {
  if (scope.tipo === 'global') {
    return {};
  }
  return { [LLAVE_EMPRESA[modelo]]: scope.empresaId };
}

/**
 * El `where` del caller AND el filtro de tenant. El filtro va en el WHERE de la
 * consulta, no en una revisión posterior de lo que se leyó: así vale igual para
 * una fila que para una lista, un count o un agregado.
 */
export function whereScoped(
  scope: EmpresaScope,
  modelo: Prisma.ModelName,
  where?: WhereGenerico,
): WhereGenerico {
  const filtro = whereEmpresa(scope, modelo);
  if (Object.keys(filtro).length === 0) {
    return where ?? {};
  }
  return where ? { AND: [where, filtro] } : filtro;
}

/**
 * Una fila buscada CON scope que no apareció es 404. Nunca 403: "no existe" y
 * "es de otra empresa" responden exactamente lo mismo, para no confirmar que el
 * recurso existe.
 */
export function encontradoOr404<T>(fila: T | null | undefined): T {
  if (fila === null || fila === undefined) {
    throw new NotFoundException('Recurso no encontrado');
  }
  return fila;
}
