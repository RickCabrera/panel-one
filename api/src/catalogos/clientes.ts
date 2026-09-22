import { Prisma } from '@prisma/client';

import { pesos } from '../ventas/agregados-ventas.service';

/**
 * La parte PURA de la vista Clientes (F2-232): ligar las cuentas del periodo con el espejo de
 * clientes y armar la lista. Sin base de datos: la lectura (con el helper de scope) vive en
 * `catalogos.service.ts`.
 *
 * Reglas:
 * - El cheque trae el id del cliente en el POS (`cliente_origen_sr_id`) y se liga con el espejo
 *   por (sucursal, `origen_sr_id`) EXACTO. Nunca por la clave visible ni por el nombre.
 * - Visitas = cuentas NO canceladas cerradas en el periodo con ese cliente (las mismas que
 *   devuelve Tickets con `clienteId` y `canceladas=excluir`). Las canceladas van aparte, con
 *   conteo e importe, y no suman a la venta.
 * - Ticket promedio = venta / visitas, a 2 decimales mitad lejos de cero (la regla de Análisis
 *   y Meseros).
 * - No se inventa ficha: un id que llega en las cuentas y no está en el espejo sale como tal
 *   (`sin-ficha`), y uno de una sucursal sin catálogo sincronizado sale `sin-sincronizar`.
 * - Un cliente del espejo dado de baja (`activo=false`) sólo aparece si tuvo visitas o
 *   canceladas en el periodo.
 * - Sin datos de contacto salvo que se pidan (`contacto`): el nombre sí va, es lo que se busca.
 */

/** Tope de filas del espejo de clientes que se leen para la lista. Más = `catalogoTruncado`. */
export const MAX_CATALOGO_CLIENTES = 5000;
/** Filas por página de la lista; `porPagina` puede pedir hasta `MAX_POR_PAGINA_CLIENTES`. */
export const POR_PAGINA_CLIENTES = 50;
export const MAX_POR_PAGINA_CLIENTES = 500;

const CERO = new Prisma.Decimal(0);

/**
 * Cómo quedó una fila:
 * - `ficha`: el cliente está en el espejo de su sucursal.
 * - `sin-ficha`: las cuentas traen ese id y el espejo de su sucursal (sincronizado) no lo tiene.
 * - `sin-sincronizar`: las cuentas traen ese id y su sucursal nunca mandó una sincronización
 *   completa de clientes; no se puede afirmar que no está.
 */
export type CruceCliente = 'ficha' | 'sin-ficha' | 'sin-sincronizar';

/**
 * Estado del catálogo de clientes de una sucursal:
 * - `sin-sincronizar`: nunca llegó una sincronización completa.
 * - `vacio`: la última completa llegó sin clientes activos.
 * - `con-clientes`.
 */
export type EstadoCatalogoClientes = 'sin-sincronizar' | 'vacio' | 'con-clientes';

/** Las cifras del periodo de un id de cliente en una sucursal (de `ventas` y `cancelados`). */
export interface CifrasClienteLeidas {
  sucursalId: string;
  origenSrId: string;
  visitas: number;
  venta: Prisma.Decimal;
  ultimaVisita: Date | null;
  canceladas: number;
  montoCancelado: Prisma.Decimal;
}

export interface ClienteLeido {
  id: string;
  sucursalId: string;
  origenSrId: string;
  clave: string | null;
  nombre: string;
  activo: boolean;
  activoPos: boolean | null;
  vistoAt: Date;
  telefono?: string | null;
  correo?: string | null;
  rfc?: string | null;
}

export interface SucursalClientesLeida {
  id: string;
  nombre: string;
  /** Tiene una sincronización completa del catálogo de clientes. */
  sincronizado: boolean;
  /** Clientes con `activo=true` en el espejo (sin tope). */
  clientesActivos: number;
  /** Cuentas NO canceladas del periodo, con y sin cliente. */
  cuentas: number;
  cuentasConCliente: number;
}

export interface CifrasCliente {
  visitas: number;
  venta: string;
  ticketPromedio: string | null;
  /** Cierre de la última visita del periodo (ISO UTC); null = sin visitas. */
  ultimaVisita: string | null;
  canceladas: { cuentas: number; monto: string };
}

export interface FilaCliente extends CifrasCliente {
  /** Id del espejo; null en `sin-ficha` / `sin-sincronizar` (no hay ficha que abrir). */
  id: string | null;
  sucursalId: string;
  sucursal: string;
  cruce: CruceCliente;
  origenSrId: string;
  clave: string | null;
  nombre: string | null;
  activo: boolean | null;
  activoPos: boolean | null;
  /** Sólo con `contacto=true`; si no, las tres llaves no vienen. */
  telefono?: string | null;
  correo?: string | null;
  rfc?: string | null;
}

export interface SucursalClientes {
  sucursalId: string;
  sucursal: string;
  catalogo: EstadoCatalogoClientes;
  clientesActivos: number;
  cuentas: number;
  cuentasConCliente: number;
}

export interface ResumenClientes {
  /** Algún espejo con clientes o alguna cuenta del periodo con cliente. */
  usaClientes: boolean;
  catalogoTruncado: boolean;
  cuentas: number;
  cuentasConCliente: number;
  /** Venta de las cuentas con cliente (Σ `venta` de todas las filas, también las no paginadas). */
  ventaConCliente: string;
  sucursales: SucursalClientes[];
  filas: FilaCliente[];
  /** Filas que pasan el filtro `q`, antes de paginar. */
  total: number;
  pagina: number;
  porPagina: number;
}

export interface EntradaResumen {
  cifras: readonly CifrasClienteLeidas[];
  /** La lista del espejo (hasta `MAX_CATALOGO_CLIENTES`) ∪ los registros de los ids de las cuentas. */
  clientes: readonly ClienteLeido[];
  catalogoTruncado: boolean;
  sucursales: readonly SucursalClientesLeida[];
  q?: string;
  pagina: number;
  porPagina: number;
  contacto: boolean;
}

const llave = (sucursalId: string, origenSrId: string) => `${sucursalId}|${origenSrId}`;

export function cifrasDe(c: CifrasClienteLeidas | undefined): CifrasCliente {
  const venta = c?.venta ?? CERO;
  const visitas = c?.visitas ?? 0;
  return {
    visitas,
    venta: pesos(venta),
    ticketPromedio: visitas === 0 ? null : pesos(venta.div(visitas)),
    ultimaVisita: c?.ultimaVisita?.toISOString() ?? null,
    canceladas: { cuentas: c?.canceladas ?? 0, monto: pesos(c?.montoCancelado ?? CERO) },
  };
}

export function estadoCatalogo(s: SucursalClientesLeida): EstadoCatalogoClientes {
  if (!s.sincronizado) return 'sin-sincronizar';
  return s.clientesActivos === 0 ? 'vacio' : 'con-clientes';
}

/** `q` contra nombre, clave e id del POS: sin distinguir mayúsculas, literal. */
function coincide(f: FilaCliente, q: string | undefined): boolean {
  if (!q) return true;
  const buscado = q.toLocaleLowerCase('es-MX');
  return [f.nombre, f.clave, f.origenSrId].some(
    (v) => v !== null && v.toLocaleLowerCase('es-MX').includes(buscado),
  );
}

/** Byte a byte, como `ucs_basic`: el mismo orden en cualquier máquina. */
function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Visitas desc, venta desc, nombre asc (los sin nombre al final), id del POS, sucursal. */
function orden(a: FilaCliente, b: FilaCliente): number {
  return (
    b.visitas - a.visitas ||
    new Prisma.Decimal(b.venta).comparedTo(a.venta) ||
    (a.nombre === null ? 1 : 0) - (b.nombre === null ? 1 : 0) ||
    comparar(a.nombre ?? '', b.nombre ?? '') ||
    comparar(a.origenSrId, b.origenSrId) ||
    comparar(a.sucursalId, b.sucursalId)
  );
}

export function resumenClientes(e: EntradaResumen): ResumenClientes {
  const nombreSucursal = new Map(e.sucursales.map((s) => [s.id, s.nombre]));
  const sincronizada = new Map(e.sucursales.map((s) => [s.id, s.sincronizado]));
  const cifras = new Map(e.cifras.map((c) => [llave(c.sucursalId, c.origenSrId), c]));
  // `clientes` junta dos lecturas que se pueden encimar: una fila por id.
  const porId = new Map(e.clientes.map((c) => [c.id, c]));
  const enEspejo = new Set<string>();
  const filas: FilaCliente[] = [];

  for (const c of porId.values()) {
    const k = llave(c.sucursalId, c.origenSrId);
    enEspejo.add(k);
    const suyas = cifras.get(k);
    if (!c.activo && !suyas) continue;
    filas.push({
      id: c.id,
      sucursalId: c.sucursalId,
      sucursal: nombreSucursal.get(c.sucursalId) ?? '',
      cruce: 'ficha',
      origenSrId: c.origenSrId,
      clave: c.clave,
      nombre: c.nombre,
      activo: c.activo,
      activoPos: c.activoPos,
      ...(e.contacto
        ? { telefono: c.telefono ?? null, correo: c.correo ?? null, rfc: c.rfc ?? null }
        : {}),
      ...cifrasDe(suyas),
    });
  }
  for (const c of e.cifras) {
    if (enEspejo.has(llave(c.sucursalId, c.origenSrId))) continue;
    filas.push({
      id: null,
      sucursalId: c.sucursalId,
      sucursal: nombreSucursal.get(c.sucursalId) ?? '',
      cruce: sincronizada.get(c.sucursalId) ? 'sin-ficha' : 'sin-sincronizar',
      origenSrId: c.origenSrId,
      clave: null,
      nombre: null,
      activo: null,
      activoPos: null,
      ...(e.contacto ? { telefono: null, correo: null, rfc: null } : {}),
      ...cifrasDe(c),
    });
  }

  const visibles = filas.filter((f) => coincide(f, e.q)).sort(orden);
  const inicio = (e.pagina - 1) * e.porPagina;
  const sucursales = e.sucursales.map((s) => ({
    sucursalId: s.id,
    sucursal: s.nombre,
    catalogo: estadoCatalogo(s),
    clientesActivos: s.clientesActivos,
    cuentas: s.cuentas,
    cuentasConCliente: s.cuentasConCliente,
  }));
  const cuentasConCliente = e.sucursales.reduce((n, s) => n + s.cuentasConCliente, 0);
  return {
    usaClientes: e.sucursales.some((s) => s.clientesActivos > 0) || cuentasConCliente > 0,
    catalogoTruncado: e.catalogoTruncado,
    cuentas: e.sucursales.reduce((n, s) => n + s.cuentas, 0),
    cuentasConCliente,
    ventaConCliente: pesos(e.cifras.reduce((s, c) => s.plus(c.venta), CERO)),
    sucursales,
    filas: visibles.slice(inicio, inicio + e.porPagina),
    total: visibles.length,
    pagina: e.pagina,
    porPagina: e.porPagina,
  };
}
