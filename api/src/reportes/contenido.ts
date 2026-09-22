import { Prisma, type TipoAlerta } from '@prisma/client';

import type {
  ProductoTop,
  Resumen,
  VentaDia,
  VentaSucursal,
} from '../ventas/agregados-ventas.service';
import { pesos } from '../ventas/agregados-ventas.service';
import type { PeriodoReporte } from './calendario';

/**
 * Lo que dice cada correo (F2-141), ANTES de volverlo HTML. Las cifras son exactamente las
 * que devuelven los servicios del panel (`AgregadosVentasService`) para el mismo filtro:
 * aquí no se recalcula ninguna venta, sólo se comparan dos periodos con Decimal.
 */

export interface ConteoAlertas {
  tipo: TipoAlerta;
  cuentas: number;
}

export interface AlertasReporte {
  /** Abiertas en el momento de armar el correo. */
  abiertas: ConteoAlertas[];
  /** Abiertas (y quizá ya cerradas) en las 24 h anteriores al armado. */
  ultimas24h: ConteoAlertas[];
}

export interface EmpresaReporte {
  id: string;
  nombre: string;
  /** La zona que decide la hora de envío y qué día es "ayer" (ver `zonaDeEmpresa`). */
  zona: string;
}

export interface ContenidoDiario {
  tipo: 'diario';
  empresa: EmpresaReporte;
  periodo: PeriodoReporte;
  resumen: Resumen;
  sucursales: VentaSucursal[];
  top: ProductoTop[];
  alertas: AlertasReporte;
}

export interface FilaSemanal {
  sucursalId: string;
  nombre: string;
  actual: VentaSucursal;
  /** Null si la sucursal no estaba en el alcance la semana anterior (no debería pasar). */
  anterior: VentaSucursal | null;
  /**
   * `actual − anterior` de la venta. Null ("—") si alguna de las dos semanas no tiene
   * cuentas: sin lectura no hay comparación, y un −100 % sería mentir sobre una sucursal
   * desconectada.
   */
  diferencia: string | null;
  /** Variación en %, 2 decimales. Null en los mismos casos que `diferencia`. */
  variacionPct: string | null;
}

export interface DiaSemanal {
  dia: string;
  venta: string;
  cuentas: number;
  diaAnterior: string;
  ventaAnterior: string;
  cuentasAnterior: number;
}

export interface ContenidoSemanal {
  tipo: 'semanal';
  empresa: EmpresaReporte;
  periodo: PeriodoReporte;
  anterior: { desde: string; hasta: string };
  resumen: Resumen;
  resumenAnterior: Resumen;
  diferencia: string | null;
  variacionPct: string | null;
  sucursales: FilaSemanal[];
  dias: DiaSemanal[];
}

export type ContenidoReporte = ContenidoDiario | ContenidoSemanal;

/** Diferencia y variación % entre dos ventas; null si algún lado no tiene cuentas. */
export function comparar(
  actual: { venta: string; cuentas: number },
  anterior: { venta: string; cuentas: number } | null,
): { diferencia: string | null; variacionPct: string | null } {
  if (anterior === null || actual.cuentas === 0 || anterior.cuentas === 0) {
    return { diferencia: null, variacionPct: null };
  }
  const a = new Prisma.Decimal(actual.venta);
  const b = new Prisma.Decimal(anterior.venta);
  const diferencia = a.minus(b);
  const variacionPct = b.isZero()
    ? null
    : diferencia.div(b).times(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toFixed(2);
  return { diferencia: pesos(diferencia), variacionPct };
}

/** Empareja la semana actual con la anterior, sucursal por sucursal (por id). */
export function filasSemanales(
  actual: readonly VentaSucursal[],
  anterior: readonly VentaSucursal[],
): FilaSemanal[] {
  const previas = new Map(anterior.map((s) => [s.sucursalId, s]));
  return actual.map((s) => {
    const p = previas.get(s.sucursalId) ?? null;
    return {
      sucursalId: s.sucursalId,
      nombre: s.nombre,
      actual: s,
      anterior: p,
      ...comparar(s, p),
    };
  });
}

/** Empareja día a día (lunes con lunes) las dos semanas. */
export function diasSemanales(
  actual: readonly VentaDia[],
  anterior: readonly VentaDia[],
): DiaSemanal[] {
  if (actual.length !== anterior.length) {
    throw new Error('Las dos semanas del reporte no tienen los mismos días.');
  }
  return actual.map((d, i) => ({
    dia: d.dia,
    venta: d.venta,
    cuentas: d.cuentas,
    diaAnterior: anterior[i].dia,
    ventaAnterior: anterior[i].venta,
    cuentasAnterior: anterior[i].cuentas,
  }));
}
