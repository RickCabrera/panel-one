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
  AgenteContacto: 'empresaId',
  Cheque: 'empresaId',
  ChequePartida: 'empresaId',
  ChequePago: 'empresaId',
  MesaSnapshot: 'empresaId',
  FormaPagoCatalogo: 'empresaId',
  // F1-093. Nunca se lee con scope: sólo AuthService, por `sid` y usuario.
  SesionUsuario: 'empresaId',
  // F2-202. Bandeja del correo falso: hoy sólo la escribe `CorreoFalso` (INSERT) y
  // no la lee nadie; quien la lea lo hará con scope por esta columna.
  CorreoEnviado: 'empresaId',
  // F2-224. Las escribe SÓLO `EscrituraAlertas` (bajo candado por empresa).
  Alerta: 'empresaId',
  ReglaAlerta: 'empresaId',
  AlertaEvaluacion: 'empresaId',
  // F2-141. Las escribe SÓLO `EscrituraReportes`, salvo la baja pública, que apaga por
  // `updateMany` con el id de un token firmado ya verificado.
  SuscripcionReporte: 'empresaId',
  EnvioReporte: 'empresaId',
  // F2-230. Catálogos espejo: los escribe SÓLO `IngestaCatalogos` (clavada a la sucursal
  // del agente); la metadata y la solicitud, `EscrituraCatalogos` (con scope).
  GrupoProducto: 'empresaId',
  Producto: 'empresaId',
  MeseroCatalogo: 'empresaId',
  ClienteCatalogo: 'empresaId',
  AreaCatalogo: 'empresaId',
  CanalVentaCatalogo: 'empresaId',
  ProductoMetadata: 'empresaId',
  // F2-233. El mapeo área → canal: lo escribe SÓLO `EscrituraCatalogos` (con scope).
  AreaCanal: 'empresaId',
  SincronizacionCatalogo: 'empresaId',
  SolicitudSincronizacion: 'empresaId',
  // F2-120. Catálogos de inventario: como los espejos de F2-230, los escribe SÓLO
  // `IngestaCatalogos` (clavada a la sucursal del agente).
  UnidadCatalogo: 'empresaId',
  GrupoInsumo: 'empresaId',
  Insumo: 'empresaId',
  AlmacenCatalogo: 'empresaId',
  ProveedorCatalogo: 'empresaId',
  // F2-121. Existencias y su lectura: las escribe SÓLO `IngestaExistencias` (clavada a la
  // sucursal del agente); los límites, SÓLO `EscrituraExistencias` (con scope).
  Existencia: 'empresaId',
  LecturaExistencias: 'empresaId',
  LimiteExistencia: 'empresaId',
  // F2-122. Pólizas y sus partidas: las escribe SÓLO `IngestaMovimientos` (clavada a la
  // sucursal del agente). El panel sólo las lee.
  PolizaInventario: 'empresaId',
  MovimientoInventario: 'empresaId',
} as const satisfies Record<Prisma.ModelName, 'id' | 'empresaId'>;

export type WhereGenerico = Record<string, unknown>;

/**
 * Columnas que una escritura con scope NUNCA puede tocar, además de la llave de
 * tenant del modelo (`LLAVE_EMPRESA`): la identidad de la fila y su pertenencia.
 * Una escritura con scope no mueve una fila a otra empresa ni a otra sucursal.
 *
 * Es una lista de PROHIBIDAS, no de permitidas: si un modelo futuro trae otra
 * columna de pertenencia, se agrega aquí con su test. F1-030 agregó `chequeId`
 * / `cheque`: una partida o un pago no se mueven a otro cheque. La usan
 * `updateMany` con scope (F1-012) y las escrituras de sucursal de la ingesta
 * (F1-031, `escritura-sucursal.ts`).
 */
export const COLUMNAS_INTOCABLES: readonly string[] = [
  'id',
  'empresaId',
  'sucursalId',
  'chequeId',
  // F2-122: una partida no se mueve a otra póliza.
  'polizaId',
  'empresa',
  'sucursal',
  'cheque',
  'poliza',
];

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
