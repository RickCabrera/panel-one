import { Injectable } from '@nestjs/common';
import { FormaPago, Prisma } from '@prisma/client';

import { validarFiltro } from '../scope/consulta-ventas';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService, type DatosScoped } from '../scope/scoped-prisma.service';
import { dec, desglosarFormas, limitesLocales, pesos, promedio } from './cortes';

/**
 * Cortes de caja (turnos de SR) para el panel (MVP de cortes).
 *
 * Reglas:
 * - El turno (apertura, cierre, fondo, declarados) es el que mandó el agente desde
 *   `dbo.turnos` (docs/esquema-sr.md §2, "Turnos"). Lo VENDIDO no se guarda: se calcula al leer
 *   con los cheques de la MISMA sucursal cuyo `turno_sr` es el del turno. Ese `idturno` es el del
 *   COBRO (validado en F1-090), que es como arma SR su Corte X.
 * - Venta = Σ `cheques.total` de las cuentas NO canceladas, tal cual las reporta SR (sin
 *   propina). Los cancelados no suman: se cuentan aparte.
 * - Turno abierto (`cierre_at` nulo) = acumulado en curso: lo cobrado hasta ahora en ese turno.
 * - Todo se lee con el cliente con scope (`datos.para(scope)`): el filtro de empresa va en el
 *   WHERE de cada consulta. Un turno de otra empresa = 404, igual que uno que no existe.
 * - Dinero en Decimal; string de 2 decimales en la salida; promedios null sin divisor.
 */

/** Tope de filas de la lista: un rango de un año con varios turnos al día cabe de sobra. */
export const MAX_CORTES = 500;

/** Productos del detalle del corte (top por importe). */
export const TOP_PRODUCTOS_CORTE = 10;

export interface ResumenCorte {
  id: string;
  sucursalId: string;
  sucursal: string;
  zonaHoraria: string;
  /** `idturno` de SR. */
  turnoSr: string;
  aperturaAt: string;
  /** Null = turno abierto. */
  cierreAt: string | null;
  abierto: boolean;
  estacion: string | null;
  fondo: string;
  /** Σ total de las cuentas cobradas en el turno (no canceladas). */
  venta: string;
  cuentas: number;
  ticketPromedio: string | null;
}

export interface ListaCortes {
  cortes: ResumenCorte[];
  /** Hubo más de `MAX_CORTES`: se muestran los más recientes. */
  truncado: boolean;
}

export interface RenglonCuadre {
  concepto: 'efectivo' | 'tarjeta' | 'vales' | 'credito' | 'total';
  declarado: string;
  /** Lo cobrado en el turno por esa forma; null si SR declara un concepto sin forma equivalente. */
  cobrado: string | null;
  /** declarado − cobrado; null sin cobrado comparable o con el turno abierto. */
  diferencia: string | null;
}

export interface DetalleCorte extends ResumenCorte {
  comensales: { total: number; cuentasConDato: number };
  propina: string;
  descuentos: { monto: string; cuentas: number };
  cancelados: { cuentas: number; monto: string };
  formasPago: {
    formas: Array<{ forma: FormaPago; monto: string }>;
    sinCatalogo: Array<{ formaRaw: string; monto: string }>;
  };
  /** Σ pagos de las cuentas no canceladas del turno (sin propina ni cambio, esquema-sr §4). */
  cobrado: string;
  cuadre: RenglonCuadre[];
  topProductos: Array<{ producto: string; importe: string; cantidad: string }>;
}

type TurnoLeido = {
  id: string;
  sucursalId: string;
  turnoSr: string;
  aperturaAt: Date;
  cierreAt: Date | null;
  estacion: string | null;
  fondo: Prisma.Decimal;
  declaradoEfectivo: Prisma.Decimal;
  declaradoTarjeta: Prisma.Decimal;
  declaradoVales: Prisma.Decimal;
  declaradoCredito: Prisma.Decimal;
};

const SELECCION_TURNO = {
  id: true,
  sucursalId: true,
  turnoSr: true,
  aperturaAt: true,
  cierreAt: true,
  estacion: true,
  fondo: true,
  declaradoEfectivo: true,
  declaradoTarjeta: true,
  declaradoVales: true,
  declaradoCredito: true,
} as const;

interface SucursalLeida {
  id: string;
  nombre: string;
  zonaHoraria: string;
}

function resumen(
  t: TurnoLeido,
  s: SucursalLeida,
  venta: Prisma.Decimal,
  cuentas: number,
): ResumenCorte {
  return {
    id: t.id,
    sucursalId: t.sucursalId,
    sucursal: s.nombre,
    zonaHoraria: s.zonaHoraria,
    turnoSr: t.turnoSr,
    aperturaAt: t.aperturaAt.toISOString(),
    cierreAt: t.cierreAt?.toISOString() ?? null,
    abierto: t.cierreAt === null,
    estacion: t.estacion,
    fondo: pesos(t.fondo),
    venta: pesos(venta),
    cuentas,
    ticketPromedio: promedio(venta, cuentas),
  };
}

@Injectable()
export class CortesService {
  constructor(private readonly datos: ScopedPrismaService) {}

  /**
   * Los turnos de la empresa (o de una sucursal) que estuvieron ABIERTOS en algún momento de
   * los días locales `desde..hasta` de SU sucursal: apertura antes del fin del rango y cierre
   * (si lo hay) desde su inicio. Un turno abierto que empezó antes del rango también sale. Orden:
   * apertura más reciente primero.
   */
  async listar(
    scope: EmpresaScope,
    filtro: { empresaId: string; sucursalId?: string; desde: string; hasta: string },
  ): Promise<ListaCortes> {
    validarFiltro(filtro);
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, filtro.empresaId, filtro.sucursalId);
    const sucursales = await this.sucursales(datos, filtro.empresaId, filtro.sucursalId);
    if (sucursales.length === 0) return { cortes: [], truncado: false };

    const turnos: TurnoLeido[] = await datos.turno.findMany({
      where: {
        empresaId: filtro.empresaId,
        OR: sucursales.map((s) => {
          const { inicio, fin } = limitesLocales(filtro.desde, filtro.hasta, s.zonaHoraria);
          return {
            sucursalId: s.id,
            aperturaAt: { lt: fin },
            OR: [{ cierreAt: null }, { cierreAt: { gte: inicio } }],
          };
        }),
      },
      select: SELECCION_TURNO,
      orderBy: [{ aperturaAt: 'desc' }, { id: 'asc' }],
      take: MAX_CORTES + 1,
    });
    const truncado = turnos.length > MAX_CORTES;
    const vistos = truncado ? turnos.slice(0, MAX_CORTES) : turnos;
    const ventas = await this.ventasPorTurno(datos, filtro.empresaId, vistos);
    const porId = new Map(sucursales.map((s) => [s.id, s]));
    return {
      cortes: vistos.map((t) => {
        const v = ventas.get(llave(t.sucursalId, t.turnoSr));
        return resumen(t, porId.get(t.sucursalId)!, dec(v?.venta), v?.cuentas ?? 0);
      }),
      truncado,
    };
  }

  /** Los turnos abiertos ahora (cierre nulo) de la empresa o de una sucursal: el acumulado en curso. */
  async enCurso(
    scope: EmpresaScope,
    empresaId: string,
    sucursalId?: string,
  ): Promise<ResumenCorte[]> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId, sucursalId);
    const sucursales = await this.sucursales(datos, empresaId, sucursalId);
    if (sucursales.length === 0) return [];
    const turnos: TurnoLeido[] = await datos.turno.findMany({
      where: { empresaId, sucursalId: { in: sucursales.map((s) => s.id) }, cierreAt: null },
      select: SELECCION_TURNO,
      orderBy: [{ aperturaAt: 'desc' }, { id: 'asc' }],
      take: MAX_CORTES,
    });
    const ventas = await this.ventasPorTurno(datos, empresaId, turnos);
    const porId = new Map(sucursales.map((s) => [s.id, s]));
    return turnos.map((t) => {
      const v = ventas.get(llave(t.sucursalId, t.turnoSr));
      return resumen(t, porId.get(t.sucursalId)!, dec(v?.venta), v?.cuentas ?? 0);
    });
  }

  /** El detalle de UN corte. De otra empresa o inexistente = 404 (nunca 403). */
  async detalle(scope: EmpresaScope, id: string): Promise<DetalleCorte> {
    const datos = this.datos.para(scope);
    const t: TurnoLeido & { empresaId: string } = encontradoOr404(
      await datos.turno.findFirst({
        where: { id },
        select: { ...SELECCION_TURNO, empresaId: true },
      }),
    );
    const s = encontradoOr404(
      await datos.sucursal.findFirst({
        where: { id: t.sucursalId, empresaId: t.empresaId },
        select: { id: true, nombre: true, zonaHoraria: true },
      }),
    );
    // Las cuentas del turno: MISMA sucursal y empresa que el turno, y su `turno_sr`.
    const delTurno = { empresaId: t.empresaId, sucursalId: t.sucursalId, turnoSr: t.turnoSr };
    const cobradas = { ...delTurno, cancelado: false };

    const [ventas, conDescuento, cancelados, pagos, partidas] = await Promise.all([
      datos.cheque.aggregate({
        where: cobradas,
        _sum: { total: true, propina: true, descuentos: true, comensales: true },
        _count: { _all: true, comensales: true },
      }),
      datos.cheque.count({ where: { ...cobradas, descuentos: { not: 0 } } }),
      datos.cheque.aggregate({
        where: { ...delTurno, cancelado: true },
        _sum: { total: true },
        _count: { _all: true },
      }),
      datos.chequePago.groupBy({
        by: ['formaRaw'],
        where: { empresaId: t.empresaId, cheque: cobradas },
        _sum: { monto: true },
      }),
      datos.chequePartida.groupBy({
        by: ['producto'],
        where: { empresaId: t.empresaId, cheque: cobradas },
        _sum: { total: true, cantidad: true },
        orderBy: [{ _sum: { total: 'desc' } }, { producto: 'asc' }],
        take: TOP_PRODUCTOS_CORTE,
      }),
    ]);

    const catalogo = await datos.formaPagoCatalogo.findMany({
      where: { empresaId: t.empresaId, formaRaw: { in: pagos.map((p) => p.formaRaw) } },
      select: { formaRaw: true, forma: true },
    });
    const formas = desglosarFormas(
      pagos.map((p) => ({ formaRaw: p.formaRaw, monto: dec(p._sum.monto) })),
      new Map(catalogo.map((c) => [c.formaRaw, c.forma])),
    );

    const venta = dec(ventas._sum.total);
    const cuentas = ventas._count._all;
    const abierto = t.cierreAt === null;
    const montoForma = (f: FormaPago) => formas.formas.find((x) => x.forma === f)!.monto;
    const declaradoTotal = t.declaradoEfectivo
      .plus(t.declaradoTarjeta)
      .plus(t.declaradoVales)
      .plus(t.declaradoCredito);
    const renglon = (
      concepto: RenglonCuadre['concepto'],
      declarado: Prisma.Decimal,
      cobrado: string | null,
    ): RenglonCuadre => ({
      concepto,
      declarado: pesos(declarado),
      cobrado,
      // DECISION PROVISIONAL (nocturno): la diferencia es declarado − cobrado (pagos, sin propina
      // ni fondo). No se ha visto en SR si el efectivo que declara el cajero incluye el fondo o
      // las propinas (F1-090 declaró todo en 0.00): con el turno abierto no se calcula.
      diferencia:
        abierto || cobrado === null
          ? null
          : pesos(declarado.minus(new Prisma.Decimal(cobrado))),
    });

    return {
      ...resumen(t, s, venta, cuentas),
      comensales: {
        total: ventas._sum.comensales ?? 0,
        cuentasConDato: ventas._count.comensales,
      },
      propina: pesos(dec(ventas._sum.propina)),
      descuentos: { monto: pesos(dec(ventas._sum.descuentos)), cuentas: conDescuento },
      cancelados: {
        cuentas: cancelados._count._all,
        // DECISION PROVISIONAL (nocturno): el monto de un cancelado es su `total` tal como llegó,
        // igual que en Análisis (docs/esquema-sr.md §2).
        monto: pesos(dec(cancelados._sum.total)),
      },
      formasPago: { formas: formas.formas, sinCatalogo: formas.sinCatalogo },
      cobrado: pesos(formas.total),
      cuadre: [
        renglon('efectivo', t.declaradoEfectivo, montoForma(FormaPago.efectivo)),
        renglon('tarjeta', t.declaradoTarjeta, montoForma(FormaPago.tarjeta)),
        renglon('vales', t.declaradoVales, null),
        renglon('credito', t.declaradoCredito, null),
        renglon('total', declaradoTotal, pesos(formas.total)),
      ],
      topProductos: partidas.map((p) => ({
        producto: p.producto,
        importe: pesos(dec(p._sum.total)),
        cantidad: dec(p._sum.cantidad).toFixed(3),
      })),
    };
  }

  private sucursales(
    datos: DatosScoped,
    empresaId: string,
    sucursalId?: string,
  ): Promise<SucursalLeida[]> {
    return datos.sucursal.findMany({
      where: { empresaId, ...(sucursalId === undefined ? {} : { id: sucursalId }) },
      select: { id: true, nombre: true, zonaHoraria: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
  }

  /** Venta y cuentas cobradas de cada turno de la lista, en UNA consulta agrupada. */
  private async ventasPorTurno(
    datos: DatosScoped,
    empresaId: string,
    turnos: readonly TurnoLeido[],
  ): Promise<Map<string, { venta: Prisma.Decimal; cuentas: number }>> {
    const resultado = new Map<string, { venta: Prisma.Decimal; cuentas: number }>();
    if (turnos.length === 0) return resultado;
    const porSucursal = new Map<string, string[]>();
    for (const t of turnos) {
      porSucursal.set(t.sucursalId, [...(porSucursal.get(t.sucursalId) ?? []), t.turnoSr]);
    }
    const filas = await datos.cheque.groupBy({
      by: ['sucursalId', 'turnoSr'],
      where: {
        empresaId,
        cancelado: false,
        OR: [...porSucursal].map(([sucursalId, turnosSr]) => ({
          sucursalId,
          turnoSr: { in: turnosSr },
        })),
      },
      _sum: { total: true },
      _count: { _all: true },
    });
    for (const f of filas) {
      if (f.turnoSr === null) continue;
      resultado.set(llave(f.sucursalId, f.turnoSr), {
        venta: dec(f._sum.total),
        cuentas: f._count._all,
      });
    }
    return resultado;
  }
}

function llave(sucursalId: string, turnoSr: string): string {
  return `${sucursalId}|${turnoSr}`;
}
