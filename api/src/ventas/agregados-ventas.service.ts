import { Injectable } from '@nestjs/common';
import { FormaPago, Prisma } from '@prisma/client';

import type { EmpresaScope } from '../scope/empresa-scope';
import { validarFiltro, type ConsultaVentas, type FiltroVentas } from '../scope/consulta-ventas';
import { verificarAlcance } from '../scope/alcance';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';

/**
 * Agregados de ventas (F1-032) para el panel. Los endpoints son de F1-033.
 *
 * Reglas que valen para todos:
 * - Venta = suma de `cheques.total` TAL COMO LO REPORTA SR. Nunca se recalcula
 *   sumando partidas (docs/esquema-sr.md §3).
 * - Los cancelados no cuentan en ninguna venta; sólo se cuentan aparte.
 * - `desde`/`hasta` son días LOCALES de cada sucursal, inclusivos.
 * - Dinero: `Prisma.Decimal` en código y string con 2 decimales en la salida.
 *   Cantidades con 3. Ninguna división se hace en SQL: se hace aquí con
 *   Decimal, redondeando mitad-lejos-de-cero.
 * - Empresa o sucursal fuera del scope = 404, igual que inexistente.
 */

export interface Resumen {
  venta: string;
  cuentas: number;
  /** Null sin cuentas: un promedio sin divisor es null, nunca "0.00" (F1-033). */
  ticketPromedio: string | null;
  subtotal: string;
  impuestos: string;
  propina: string;
  descuentos: { monto: string; cuentas: number };
  /**
   * DECISION PROVISIONAL (nocturno): siempre null. El modelo no distingue una
   * cortesía (docs/esquema-sr.md §2, decisión abierta).
   */
  cortesias: null;
  comensales: { total: number; cuentasConDato: number; promedioPorComensal: string | null };
  cancelados: { cuentas: number };
}

export interface VentaHora {
  /** Hora local de la sucursal en que se cerró la cuenta, 0..23. */
  hora: number;
  venta: string;
  cuentas: number;
}

export interface FormasPago {
  /** Las cuatro formas del ENUM, siempre, en este orden. Incluye `otro`. */
  formas: Array<{ forma: FormaPago; monto: string }>;
  /** Textos de SR sin entrada en el catálogo (ya sumados dentro de `otro`). */
  sinCatalogo: Array<{ formaRaw: string; monto: string }>;
}

export interface ProductoTop {
  producto: string;
  /** Suma de `partidas.total`: ANTES del descuento del cheque; no cuadra con la venta. */
  importe: string;
  cantidad: string;
}

export interface VentaSucursal {
  sucursalId: string;
  nombre: string;
  venta: string;
  cuentas: number;
  /** Null si la sucursal no tuvo cuentas en el rango. */
  ticketPromedio: string | null;
  comensales: number;
}

export type OrdenTop = 'importe' | 'cantidad';
export const LIMITE_TOP_DEFAULT = 10;
export const LIMITE_TOP_MAX = 50;

export const FORMAS: readonly FormaPago[] = [
  FormaPago.efectivo,
  FormaPago.tarjeta,
  FormaPago.transferencia,
  FormaPago.otro,
];

const CERO = new Prisma.Decimal(0);

export function pesos(d: Prisma.Decimal): string {
  return d.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
}

/** Un NUMERIC que llega de $queryRaw (Decimal) o de un COALESCE a 0. */
function dec(valor: unknown): Prisma.Decimal {
  if (valor === null || valor === undefined) {
    return CERO;
  }
  return new Prisma.Decimal(valor as Prisma.Decimal.Value);
}

/** `a / b` a 2 decimales, mitad lejos de cero; null si `b` es cero. */
function dividir(a: Prisma.Decimal, b: Prisma.Decimal.Value): Prisma.Decimal | null {
  const divisor = new Prisma.Decimal(b);
  if (divisor.isZero()) {
    return null;
  }
  return a.div(divisor).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
}

/**
 * Convención de todos los promedios (F1-033): sin divisor, `null`. Un "0.00"
 * diría que el ticket promedio fue de cero pesos, y no hubo tickets.
 */
function promedio(venta: Prisma.Decimal, cuentas: number): string | null {
  const p = dividir(venta, cuentas);
  return p === null ? null : pesos(p);
}

@Injectable()
export class AgregadosVentasService {
  constructor(private readonly datos: ScopedPrismaService) {}

  /**
   * Valida el filtro (400), resuelve la empresa y la sucursal DENTRO del scope
   * (404 si no se ven) y devuelve la consulta con las CTEs de scope. Las CTEs
   * vuelven a filtrar por tenant: si esta verificación faltara, el SQL
   * devolvería vacío, no datos ajenos.
   */
  async consulta(scope: EmpresaScope, filtro: FiltroVentas): Promise<ConsultaVentas> {
    validarFiltro(filtro);
    await verificarAlcance(this.datos.para(scope), filtro.empresaId, filtro.sucursalId);
    return this.datos.ventas(scope, filtro);
  }

  async resumen(scope: EmpresaScope, filtro: FiltroVentas): Promise<Resumen> {
    const q = await this.consulta(scope, filtro);
    const [f] = await q.consultar<{
      cuentas: number;
      venta: unknown;
      subtotal: unknown;
      impuestos: unknown;
      propina: unknown;
      descuentos: unknown;
      cuentas_con_descuento: number;
      comensales: number;
      cuentas_con_comensales: number;
      venta_con_comensales: unknown;
      cancelados: number;
    }>(Prisma.sql`SELECT
        count(*)::int AS cuentas,
        COALESCE(sum(total), 0) AS venta,
        COALESCE(sum(subtotal), 0) AS subtotal,
        COALESCE(sum(impuestos), 0) AS impuestos,
        COALESCE(sum(propina), 0) AS propina,
        COALESCE(sum(descuentos), 0) AS descuentos,
        (count(*) FILTER (WHERE descuentos <> 0))::int AS cuentas_con_descuento,
        COALESCE(sum(comensales), 0)::int AS comensales,
        count(comensales)::int AS cuentas_con_comensales,
        COALESCE(sum(total) FILTER (WHERE comensales > 0), 0) AS venta_con_comensales,
        (SELECT count(*) FROM cancelados)::int AS cancelados
      FROM ventas`);
    const venta = dec(f.venta);
    const porComensal = dividir(dec(f.venta_con_comensales), f.comensales);
    return {
      venta: pesos(venta),
      cuentas: f.cuentas,
      ticketPromedio: promedio(venta, f.cuentas),
      subtotal: pesos(dec(f.subtotal)),
      impuestos: pesos(dec(f.impuestos)),
      propina: pesos(dec(f.propina)),
      descuentos: { monto: pesos(dec(f.descuentos)), cuentas: f.cuentas_con_descuento },
      cortesias: null,
      comensales: {
        total: f.comensales,
        cuentasConDato: f.cuentas_con_comensales,
        promedioPorComensal: porComensal === null ? null : pesos(porComensal),
      },
      cancelados: { cuentas: f.cancelados },
    };
  }

  /** Las 24 horas locales, con cero donde no hubo cierres. */
  async porHora(scope: EmpresaScope, filtro: FiltroVentas): Promise<VentaHora[]> {
    const q = await this.consulta(scope, filtro);
    const filas = await q.consultar<{ hora: number; venta: unknown; cuentas: number }>(
      Prisma.sql`SELECT hora_local AS hora, COALESCE(sum(total), 0) AS venta, count(*)::int AS cuentas
        FROM ventas GROUP BY hora_local`,
    );
    const porHora = new Map(filas.map((f) => [f.hora, f]));
    return Array.from({ length: 24 }, (_, hora) => {
      const f = porHora.get(hora);
      return { hora, venta: pesos(dec(f?.venta)), cuentas: f?.cuentas ?? 0 };
    });
  }

  /**
   * Desglose por forma de pago. El ENUM se deriva AL LEER con el catálogo de
   * la empresa (match exacto de `forma_raw`); lo que no está en el catálogo es
   * `otro` y además se lista en `sinCatalogo`. No se usa `cheque_pagos.forma`.
   */
  async formasPago(scope: EmpresaScope, filtro: FiltroVentas): Promise<FormasPago> {
    const q = await this.consulta(scope, filtro);
    const filas = await q.consultar<{
      forma: string | null;
      forma_raw: string;
      monto: unknown;
    }>(Prisma.sql`SELECT cf.forma, p.forma_raw, COALESCE(sum(p.monto), 0) AS monto
      FROM pagos_ventas p
      LEFT JOIN catalogo_formas cf ON cf.empresa_id = p.empresa_id AND cf.forma_raw = p.forma_raw
      GROUP BY cf.forma, p.forma_raw`);
    const totales = new Map<FormaPago, Prisma.Decimal>(FORMAS.map((f) => [f, CERO]));
    const sinCatalogo: Array<{ formaRaw: string; monto: Prisma.Decimal }> = [];
    for (const f of filas) {
      const monto = dec(f.monto);
      const forma = (f.forma ?? FormaPago.otro) as FormaPago;
      if (!totales.has(forma)) {
        throw new Error(`Forma de pago desconocida en el catálogo: ${forma}`);
      }
      totales.set(forma, totales.get(forma)!.plus(monto));
      if (f.forma === null) {
        sinCatalogo.push({ formaRaw: f.forma_raw, monto });
      }
    }
    sinCatalogo.sort((a, b) => b.monto.comparedTo(a.monto) || (a.formaRaw < b.formaRaw ? -1 : 1));
    return {
      formas: FORMAS.map((forma) => ({ forma, monto: pesos(totales.get(forma)!) })),
      sinCatalogo: sinCatalogo.map((s) => ({ formaRaw: s.formaRaw, monto: pesos(s.monto) })),
    };
  }

  /**
   * Top productos por importe o por cantidad, agrupados por NOMBRE de producto
   * (no hay id de producto de SR, docs/esquema-sr.md §6). Empate: por nombre en
   * orden de code points (collation `ucs_basic`), para que no dependa del locale de la base.
   */
  async topProductos(
    scope: EmpresaScope,
    filtro: FiltroVentas,
    opciones: { por?: OrdenTop; limite?: number } = {},
  ): Promise<ProductoTop[]> {
    const por = opciones.por ?? 'importe';
    const limite = opciones.limite ?? LIMITE_TOP_DEFAULT;
    if (por !== 'importe' && por !== 'cantidad') {
      throw new Error(`Orden de top productos inválido: ${String(por)}`);
    }
    if (!Number.isInteger(limite) || limite < 1 || limite > LIMITE_TOP_MAX) {
      throw new Error(`El límite de top productos va de 1 a ${LIMITE_TOP_MAX}.`);
    }
    const q = await this.consulta(scope, filtro);
    const orden = Prisma.raw(por === 'importe' ? 'importe' : 'cantidad');
    const filas = await q.consultar<{ producto: string; importe: unknown; cantidad: unknown }>(
      Prisma.sql`SELECT producto, COALESCE(sum(total), 0) AS importe, COALESCE(sum(cantidad), 0) AS cantidad
        FROM partidas_ventas
        GROUP BY producto
        ORDER BY ${orden} DESC, producto COLLATE ucs_basic ASC
        LIMIT ${limite}`,
    );
    return filas.map((f) => ({
      producto: f.producto,
      importe: pesos(dec(f.importe)),
      cantidad: dec(f.cantidad).toFixed(3),
    }));
  }

  /** Una fila por sucursal en alcance, incluidas las que no vendieron. */
  async comparativoSucursales(scope: EmpresaScope, filtro: FiltroVentas): Promise<VentaSucursal[]> {
    const q = await this.consulta(scope, filtro);
    const filas = await q.consultar<{
      sucursal_id: string;
      nombre: string;
      venta: unknown;
      cuentas: number;
      comensales: number;
    }>(Prisma.sql`SELECT s.id AS sucursal_id, s.nombre,
        COALESCE(sum(v.total), 0) AS venta,
        count(v.id)::int AS cuentas,
        COALESCE(sum(v.comensales), 0)::int AS comensales
      FROM sucursales_alcance s
      LEFT JOIN ventas v ON v.sucursal_id = s.id AND v.empresa_id = s.empresa_id
      GROUP BY s.id, s.nombre
      ORDER BY s.nombre COLLATE ucs_basic ASC, s.id ASC`);
    return filas.map((f) => {
      const venta = dec(f.venta);
      return {
        sucursalId: f.sucursal_id,
        nombre: f.nombre,
        venta: pesos(venta),
        cuentas: f.cuentas,
        ticketPromedio: promedio(venta, f.cuentas),
        comensales: f.comensales,
      };
    });
  }
}
