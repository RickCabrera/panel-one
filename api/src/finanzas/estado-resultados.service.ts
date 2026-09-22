import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { limitesDelRango } from '../inventario/kardex';
import { validarRango } from '../inventario/movimientos.service';
import { RecetasService } from '../inventario/recetas.service';
import type { EmpresaScope } from '../scope/empresa-scope';
import { fechaDeDia } from '../scope/escritura-gastos';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { AgregadosVentasService } from '../ventas/agregados-ventas.service';
import type {
  EstadoResultadosBaseDto,
  EstadoResultadosDto,
  RangoQueryDto,
} from './dto/finanzas.dto';
import {
  resultadoSucursal,
  resultadoTotal,
  type CifrasSucursal,
  type Resultado,
} from './estado-resultados';
import { GastosService } from './gastos.service';

type D = Prisma.Decimal;
const CERO = new Prisma.Decimal(0);
const dec = (v: unknown): D => new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value);
const txt = (v: D | null, dp: number) =>
  v === null ? null : v.toFixed(dp, Prisma.Decimal.ROUND_HALF_UP);

function aDto(r: Resultado): EstadoResultadosBaseDto {
  return {
    cuentas: r.cuentas,
    venta: r.venta.toFixed(2),
    ventaNeta: r.ventaNeta.toFixed(2),
    costo: {
      importe: txt(r.costo.importe, 2),
      completo: r.costo.completo,
      insumosSinCosto: r.costo.insumosSinCosto,
      productosSinCosto: r.costo.productosSinCosto,
      ventaSinCosto: r.costo.ventaSinCosto.toFixed(2),
    },
    gastos: r.gastos.toFixed(2),
    compras: r.compras.toFixed(2),
    utilidadBruta: txt(r.utilidadBruta, 2),
    utilidadOperacion: txt(r.utilidadOperacion, 2),
    margenBruto: txt(r.margenBruto, 1),
    margenOperacion: txt(r.margenOperacion, 1),
    utilidadSobrestimada: r.utilidadSobrestimada,
    sinVentas: r.sinVentas,
  };
}

/**
 * Estado de resultados simple (F2-126), por sucursal y total de la empresa: venta neta − costo de
 * lo vendido − gastos. Las ventas salen de las CTEs del helper de agregados (nada de FROM escrito
 * aquí), el costo del consumo teórico de F2-125 (se reusa `RecetasService.consumoTeorico`, no se
 * recalcula), los gastos del panel y las compras (informativas) del espejo de SR. Todo con el scope
 * del usuario; fuera de alcance = 404. Las reglas de qué se afirma y qué no viven en
 * `estado-resultados.ts`.
 */
@Injectable()
export class EstadoResultadosService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly agregados: AgregadosVentasService,
    private readonly recetas: RecetasService,
    private readonly gastosService: GastosService,
  ) {}

  async estado(scope: EmpresaScope, q: RangoQueryDto): Promise<EstadoResultadosDto> {
    validarRango(q.desde, q.hasta);
    // El helper de agregados verifica la empresa y la sucursal con el scope (404) ANTES de leer.
    const ventas = await this.agregados.consulta(scope, {
      empresaId: q.empresaId,
      sucursalId: q.sucursalId,
      desde: q.desde,
      hasta: q.hasta,
    });
    const datos = this.datos.para(scope);
    const deLasSucursales = {
      empresaId: q.empresaId,
      ...(q.sucursalId ? { sucursalId: q.sucursalId } : {}),
    };
    const sucursales = await datos.sucursal.findMany({
      where: { empresaId: q.empresaId, ...(q.sucursalId ? { id: q.sucursalId } : {}) },
      select: { id: true, nombre: true, zonaHoraria: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
    const enRango = sucursales.map((s) => {
      const { inicio, fin } = limitesDelRango(q.desde, q.hasta, s.zonaHoraria);
      return { sucursalId: s.id, fecha: { gte: inicio, lt: fin } };
    });
    const gastosWhere = {
      ...deLasSucursales,
      anuladoAt: null,
      dia: { gte: fechaDeDia(q.desde), lte: fechaDeDia(q.hasta) },
    };

    const [porVenta, consumo, gastos, compras, gastosPorCategoria] = await Promise.all([
      ventas.consultar<{ sucursal_id: string; cuentas: number; venta: unknown; subtotal: unknown }>(
        Prisma.sql`SELECT sucursal_id, count(*)::int AS cuentas,
            COALESCE(sum(total), 0) AS venta, COALESCE(sum(subtotal), 0) AS subtotal
          FROM ventas GROUP BY sucursal_id`,
      ),
      this.recetas.consumoTeorico(scope, q),
      datos.gasto.groupBy({ by: ['sucursalId'], where: gastosWhere, _sum: { monto: true } }),
      sucursales.length === 0
        ? Promise.resolve([])
        : datos.compra.groupBy({
            by: ['sucursalId'],
            where: { ...deLasSucursales, cancelada: false, OR: enRango },
            _sum: { total: true },
          }),
      this.gastosService.porCategoria(datos, gastosWhere),
    ]);

    const venta = new Map(porVenta.map((v) => [v.sucursal_id, v]));
    const estado = new Map(consumo.sucursales.map((s) => [s.sucursalId, s]));
    const gasto = new Map(gastos.map((g) => [g.sucursalId, dec(g._sum.monto)]));
    const compra = new Map(compras.map((c) => [c.sucursalId, dec(c._sum.total)]));

    const resultados = sucursales.map((s) => {
      const v = venta.get(s.id);
      const e = estado.get(s.id);
      const aparte = consumo.aparte.filter((a) => a.sucursalId === s.id);
      const cifras: CifrasSucursal = {
        sucursalId: s.id,
        sucursal: s.nombre,
        cuentas: v?.cuentas ?? 0,
        venta: dec(v?.venta),
        ventaNeta: dec(v?.subtotal),
        calculada: e?.calculada ?? false,
        motivo: e?.catalogoProductos === false ? 'sin_catalogo_productos' : 'sin_recetas',
        importesTeoricos: consumo.filas
          .filter((f) => f.sucursalId === s.id && dec(f.teorico).greaterThan(0))
          .map((f) => (f.importeTeorico === null ? null : dec(f.importeTeorico))),
        productosSinCosto: aparte.length,
        ventaSinCosto: aparte.reduce<D>((acc, a) => acc.plus(dec(a.importe)), CERO),
        gastos: gasto.get(s.id) ?? CERO,
        compras: compra.get(s.id) ?? CERO,
      };
      return resultadoSucursal(cifras);
    });
    const total = resultadoTotal(resultados);

    return {
      sucursales: resultados.map((r) => ({
        sucursalId: r.sucursalId,
        sucursal: r.sucursal,
        motivo: r.motivo,
        ...aDto(r),
      })),
      total: { sucursalesSinCalculo: total.sucursalesSinCalculo, ...aDto(total) },
      gastosPorCategoria,
    };
  }
}
