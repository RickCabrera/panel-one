import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { Reloj } from '../comun/reloj';
import type { EmpresaScope } from '../scope/empresa-scope';
import type { FiltroVentas } from '../scope/consulta-ventas';
import { AgregadosVentasService } from '../ventas/agregados-ventas.service';
import {
  completar,
  dec,
  HORAS,
  mesesDelRango,
  normalizarBusqueda,
  pesos,
  tasaDe,
  type Acumulado,
} from './tablero';

/**
 * El tablero de facturación (F2-106). Todo se lee por el helper de scope (`AgregadosVentasService
 * .consulta` → `ScopedPrismaService.ventas()`): las CTEs `cfdis_periodo` y `codigos_ventas` ya traen
 * el tenant, la empresa y sucursal pedidas y el rango en la zona de cada sucursal, con timeout.
 *
 * La VENTA no se recalcula aquí: es la respuesta de `AgregadosVentasService.resumen` y
 * `.comparativoSucursales`, las mismas que `/ventas/resumen` y `/ventas/comparativo-sucursales`.
 * Así el tablero cuadra con Fase 1 por construcción.
 */

export interface CifrasCfdi {
  monto: string;
  cfdis: number;
}

export interface SucursalTablero {
  sucursalId: string;
  nombre: string;
  venta: string;
  cuentas: number;
  facturado: string;
  cfdis: number;
  cancelados: CifrasCfdi;
  tasa: string | null;
}

export interface TableroFacturacion {
  ventas: { venta: string; cuentas: number };
  facturado: CifrasCfdi;
  cancelados: CifrasCfdi;
  tasa: string | null;
  porFacturar: { cuentas: number; monto: string };
  porSucursal: SucursalTablero[];
  porMes: Array<{ mes: string } & Acumulado>;
  porHora: Array<{ hora: number } & Acumulado>;
}

export type EstadoCfdiEmitido = 'vigente' | 'cancelado';

export interface CfdiFila {
  id: string;
  uuid: string;
  serieFolio: string;
  sucursalId: string;
  sucursal: string;
  receptorRfc: string;
  receptorNombre: string;
  total: string;
  estado: EstadoCfdiEmitido;
  emitidoAt: string;
  folioTicket: string | null;
  xml: boolean;
  pdf: boolean;
}

export interface PaginaCfdis {
  total: number;
  pagina: number;
  porPagina: number;
  cfdis: CfdiFila[];
}

export interface OpcionesCfdis {
  q?: string;
  estado?: EstadoCfdiEmitido;
  pagina: number;
  porPagina: number;
}

export interface CuentaPorFacturar {
  chequeId: string;
  folio: string;
  sucursalId: string;
  sucursal: string;
  cerradoAt: string;
  total: string;
  codigo: string;
  expiraAt: string;
}

export interface PaginaPorFacturar {
  total: number;
  monto: string;
  pagina: number;
  porPagina: number;
  cuentas: CuentaPorFacturar[];
}

/**
 * Un código por facturar = el que `facturacion/codigo.ts#estadoPublico` diría `pendiente`: estado
 * guardado `pendiente`, sin CFDI `vigente` ni reserva `timbrando` (`con_cfdi`), sin vencer a `ahora`
 * (exclusivo) y de un cheque no cancelado (`codigos_ventas` sólo trae cuentas de `ventas`). Un e2e
 * compara rama por rama contra `estadoPublico`.
 */
const POR_FACTURAR = (ahora: Date) =>
  Prisma.sql`k.estado = 'pendiente' AND NOT k.con_cfdi AND k.expira_at > ${ahora}::timestamptz`;

@Injectable()
export class TableroFacturacionService {
  constructor(
    private readonly agregados: AgregadosVentasService,
    private readonly reloj: Reloj,
  ) {}

  async tablero(scope: EmpresaScope, filtro: FiltroVentas): Promise<TableroFacturacion> {
    // `consulta` valida el filtro (400) y el alcance (404) ANTES de leer nada.
    const q = await this.agregados.consulta(scope, filtro);
    const ahora = new Date(this.reloj.ahora());
    const [resumen, ventasSucursal, cfdiSucursal, porMes, porHora, [pendientes]] =
      await Promise.all([
        this.agregados.resumen(scope, filtro),
        this.agregados.comparativoSucursales(scope, filtro),
        q.consultar<{
          sucursal_id: string;
          facturado: unknown;
          num_vigentes: number;
          cancelado: unknown;
          num_cancelados: number;
        }>(Prisma.sql`SELECT s.id AS sucursal_id,
            COALESCE(sum(f.total) FILTER (WHERE f.estado = 'vigente'), 0) AS facturado,
            (count(f.id) FILTER (WHERE f.estado = 'vigente'))::int AS num_vigentes,
            COALESCE(sum(f.total) FILTER (WHERE f.estado = 'cancelado'), 0) AS cancelado,
            (count(f.id) FILTER (WHERE f.estado = 'cancelado'))::int AS num_cancelados
          FROM sucursales_alcance s
          LEFT JOIN cfdis_periodo f ON f.sucursal_id = s.id AND f.empresa_id = s.empresa_id
          GROUP BY s.id`),
        q.consultar<{ clave: string; facturado: unknown; num_cfdi: number }>(
          Prisma.sql`SELECT mes_local AS clave, sum(total) AS facturado, count(*)::int AS num_cfdi
            FROM cfdis_periodo WHERE estado = 'vigente' GROUP BY mes_local`,
        ),
        q.consultar<{ clave: number; facturado: unknown; num_cfdi: number }>(
          Prisma.sql`SELECT hora_local AS clave, sum(total) AS facturado, count(*)::int AS num_cfdi
            FROM cfdis_periodo WHERE estado = 'vigente' GROUP BY hora_local`,
        ),
        q.consultar<{ cuentas: number; monto: unknown }>(
          Prisma.sql`SELECT count(*)::int AS cuentas, COALESCE(sum(k.total), 0) AS monto
            FROM codigos_ventas k WHERE ${POR_FACTURAR(ahora)}`,
        ),
      ]);

    // Los totales salen de la MISMA consulta que agrupa `cfdis_periodo`, y las dos listas de
    // sucursales (ventas y CFDI, ambas de `sucursales_alcance`) tienen que ser la misma: si no,
    // truena en vez de repartir cifras en filas equivocadas.
    const cfdiDe = new Map(cfdiSucursal.map((f) => [f.sucursal_id, f]));
    const deVentas = new Set(ventasSucursal.map((v) => v.sucursalId));
    if (cfdiDe.size !== deVentas.size || [...cfdiDe.keys()].some((id) => !deVentas.has(id))) {
      throw new Error('Tablero de facturación: las sucursales de ventas y de CFDI no coinciden.');
    }
    let facturado = new Prisma.Decimal(0);
    let cancelado = new Prisma.Decimal(0);
    let vigentes = 0;
    let cancelados = 0;
    for (const f of cfdiSucursal) {
      facturado = facturado.plus(dec(f.facturado));
      cancelado = cancelado.plus(dec(f.cancelado));
      vigentes += f.num_vigentes;
      cancelados += f.num_cancelados;
    }
    const porSucursal = ventasSucursal.map((v): SucursalTablero => {
      const f = cfdiDe.get(v.sucursalId);
      const suFacturado = dec(f?.facturado);
      const suCancelado = dec(f?.cancelado);
      return {
        sucursalId: v.sucursalId,
        nombre: v.nombre,
        venta: v.venta,
        cuentas: v.cuentas,
        facturado: pesos(suFacturado),
        cfdis: f?.num_vigentes ?? 0,
        cancelados: { monto: pesos(suCancelado), cfdis: f?.num_cancelados ?? 0 },
        tasa: tasaDe(suFacturado, dec(v.venta)),
      };
    });

    return {
      ventas: { venta: resumen.venta, cuentas: resumen.cuentas },
      facturado: { monto: pesos(facturado), cfdis: vigentes },
      cancelados: { monto: pesos(cancelado), cfdis: cancelados },
      tasa: tasaDe(facturado, dec(resumen.venta)),
      porFacturar: { cuentas: pendientes.cuentas, monto: pesos(dec(pendientes.monto)) },
      porSucursal,
      porMes: completar(mesesDelRango(filtro.desde, filtro.hasta), porMes).map(
        ({ clave, ...r }) => ({ mes: clave, ...r }),
      ),
      porHora: completar(HORAS, porHora).map(({ clave, ...r }) => ({ hora: clave, ...r })),
    };
  }

  /** La tabla de CFDI emitidos del periodo, con búsqueda y paginada. Sólo admins (receptores). */
  async cfdis(scope: EmpresaScope, filtro: FiltroVentas, op: OpcionesCfdis): Promise<PaginaCfdis> {
    const q = await this.agregados.consulta(scope, filtro);
    const t = normalizarBusqueda(op.q);
    // Búsqueda LITERAL (`strpos`, sin comodines): RFC, UUID, serie-folio (`A-12`, `A12` o `12`) y
    // folio del ticket. El texto viaja como parámetro.
    const busqueda =
      t === null
        ? Prisma.sql`true`
        : Prisma.sql`(strpos(upper(COALESCE(receptor_rfc, '')), ${t}) > 0
            OR strpos(upper(COALESCE(uuid, '')), ${t}) > 0
            OR strpos(upper(serie) || '-' || folio::text, ${t}) > 0
            OR strpos(upper(serie) || folio::text, ${t}) > 0
            OR strpos(upper(COALESCE(folio_ticket, '')), ${t}) > 0)`;
    const estado = op.estado === undefined ? Prisma.sql`true` : Prisma.sql`estado = ${op.estado}`;
    const donde = Prisma.sql`WHERE ${busqueda} AND ${estado}`;
    const [[{ total }], filas] = await Promise.all([
      q.consultar<{ total: number }>(
        Prisma.sql`SELECT count(*)::int AS total FROM cfdis_periodo ${donde}`,
      ),
      q.consultar<{
        id: string;
        uuid: string;
        serie: string;
        folio: number;
        sucursal_id: string;
        sucursal_nombre: string;
        receptor_rfc: string | null;
        receptor_nombre: string | null;
        total: unknown;
        estado: EstadoCfdiEmitido;
        emitido_at: Date;
        folio_ticket: string | null;
        con_xml: boolean;
        con_pdf: boolean;
      }>(Prisma.sql`SELECT id, uuid, serie, folio, sucursal_id, sucursal_nombre, receptor_rfc,
          receptor_nombre, total, estado, emitido_at, folio_ticket, con_xml, con_pdf
        FROM cfdis_periodo ${donde}
        ORDER BY emitido_at DESC, id DESC
        LIMIT ${op.porPagina} OFFSET ${(op.pagina - 1) * op.porPagina}`),
    ]);
    return {
      total,
      pagina: op.pagina,
      porPagina: op.porPagina,
      cfdis: filas.map((f) => ({
        id: f.id,
        uuid: f.uuid,
        serieFolio: `${f.serie}-${f.folio}`,
        sucursalId: f.sucursal_id,
        sucursal: f.sucursal_nombre,
        receptorRfc: f.receptor_rfc ?? '',
        receptorNombre: f.receptor_nombre ?? '',
        total: pesos(dec(f.total)),
        estado: f.estado,
        emitidoAt: f.emitido_at.toISOString(),
        folioTicket: f.folio_ticket,
        xml: f.con_xml,
        pdf: f.con_pdf,
      })),
    };
  }

  /** Las cuentas del periodo con código todavía facturable. Sólo admins (el código factura). */
  async porFacturar(
    scope: EmpresaScope,
    filtro: FiltroVentas,
    op: { pagina: number; porPagina: number },
  ): Promise<PaginaPorFacturar> {
    const q = await this.agregados.consulta(scope, filtro);
    const ahora = new Date(this.reloj.ahora());
    const [[resumen], filas] = await Promise.all([
      q.consultar<{ total: number; monto: unknown }>(
        Prisma.sql`SELECT count(*)::int AS total, COALESCE(sum(k.total), 0) AS monto
          FROM codigos_ventas k WHERE ${POR_FACTURAR(ahora)}`,
      ),
      q.consultar<{
        cheque_id: string;
        folio: string;
        sucursal_id: string;
        sucursal: string;
        cerrado_at: Date;
        total: unknown;
        codigo: string;
        expira_at: Date;
      }>(Prisma.sql`SELECT k.cheque_id, k.folio, k.sucursal_id, s.nombre AS sucursal,
          k.cerrado_at, k.total, k.codigo, k.expira_at
        FROM codigos_ventas k
        JOIN sucursales_alcance s ON s.id = k.sucursal_id AND s.empresa_id = k.empresa_id
        WHERE ${POR_FACTURAR(ahora)}
        ORDER BY k.cerrado_at DESC, k.cheque_id DESC
        LIMIT ${op.porPagina} OFFSET ${(op.pagina - 1) * op.porPagina}`),
    ]);
    return {
      total: resumen.total,
      monto: pesos(dec(resumen.monto)),
      pagina: op.pagina,
      porPagina: op.porPagina,
      cuentas: filas.map((f) => ({
        chequeId: f.cheque_id,
        folio: f.folio,
        sucursalId: f.sucursal_id,
        sucursal: f.sucursal,
        cerradoAt: f.cerrado_at.toISOString(),
        total: pesos(dec(f.total)),
        codigo: f.codigo,
        expiraAt: f.expira_at.toISOString(),
      })),
    };
  }
}
