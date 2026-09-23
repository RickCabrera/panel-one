import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { limitesDelRango } from '../inventario/kardex';
import { validarRango } from '../inventario/movimientos.service';
import { llaveInsumo } from '../inventario/recetas';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import type {
  AlcanceQueryDto,
  CompraDetalleDto,
  ComprasDto,
  ComprasQueryDto,
  ProveedorComprasDto,
} from './dto/finanzas.dto';

/** Tope de compras de la lista (los totales y el resumen por proveedor no se recortan). */
export const MAX_COMPRAS_LISTA = 2000;

type D = Prisma.Decimal;
const CERO = new Prisma.Decimal(0);
const pesos = (v: D) => v.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);

/**
 * Compras LEÍDAS de SoftRestaurant (F2-126), para la vista "Compras". Todo por el helper de scope:
 * la empresa (y la sucursal) se verifica con el scope del usuario y va en el WHERE de cada
 * consulta; fuera de alcance = 404, nunca 403. El rango se corta por `fecha` en la zona de CADA
 * sucursal. Una compra cancelada se lista marcada y no suma. Proveedor, almacén e insumo se
 * resuelven a nombre contra los espejos de la MISMA sucursal (sin catálogo = nulo, no se oculta).
 */
@Injectable()
export class ComprasService {
  constructor(private readonly datos: ScopedPrismaService) {}

  async listar(scope: EmpresaScope, q: ComprasQueryDto): Promise<ComprasDto> {
    validarRango(q.desde, q.hasta);
    if (q.proveedorOrigenSrId !== undefined && q.sucursalId === undefined) {
      throw new BadRequestException(['proveedorOrigenSrId exige sucursalId']);
    }
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, q.empresaId, q.sucursalId);
    const deLasSucursales = {
      empresaId: q.empresaId,
      ...(q.sucursalId ? { sucursalId: q.sucursalId } : {}),
    };
    const [sucursales, recibidas] = await Promise.all([
      datos.sucursal.findMany({
        where: { empresaId: q.empresaId, ...(q.sucursalId ? { id: q.sucursalId } : {}) },
        select: { id: true, nombre: true, zonaHoraria: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      datos.compra.groupBy({
        by: ['sucursalId'],
        where: deLasSucursales,
        _count: { _all: true },
      }),
    ]);
    const recibidasDe = new Map(recibidas.map((r) => [r.sucursalId, r._count._all]));
    const enRango = sucursales.map((s) => {
      const { inicio, fin } = limitesDelRango(q.desde, q.hasta, s.zonaHoraria);
      return { sucursalId: s.id, fecha: { gte: inicio, lt: fin } };
    });
    const where = {
      ...deLasSucursales,
      OR: enRango,
      ...(q.proveedorOrigenSrId ? { proveedorOrigenSrId: q.proveedorOrigenSrId } : {}),
    };
    const [compras, cuantas, porProveedor, proveedores, almacenes] = await Promise.all([
      datos.compra.findMany({
        where,
        select: {
          id: true,
          sucursalId: true,
          folio: true,
          fecha: true,
          proveedorOrigenSrId: true,
          almacenOrigenSrId: true,
          total: true,
          partidas: true,
          cancelada: true,
        },
        orderBy: [{ fecha: 'desc' }, { folio: 'desc' }, { id: 'asc' }],
        take: MAX_COMPRAS_LISTA,
      }),
      datos.compra.count({ where }),
      datos.compra.groupBy({
        by: ['sucursalId', 'proveedorOrigenSrId'],
        where: { ...where, cancelada: false },
        _count: { _all: true },
        _sum: { total: true },
      }),
      datos.proveedorCatalogo.findMany({
        where: deLasSucursales,
        select: { sucursalId: true, origenSrId: true, nombre: true },
      }),
      datos.almacenCatalogo.findMany({
        where: deLasSucursales,
        select: { sucursalId: true, origenSrId: true, nombre: true },
      }),
    ]);
    const nombre = (filas: Array<{ sucursalId: string; origenSrId: string; nombre: string }>) =>
      new Map(filas.map((f) => [llaveInsumo(f.sucursalId, f.origenSrId), f.nombre]));
    const proveedor = nombre(proveedores);
    const almacen = nombre(almacenes);
    const de = (m: Map<string, string>, sucursalId: string, origen: string | null) =>
      origen === null ? null : (m.get(llaveInsumo(sucursalId, origen)) ?? null);

    const resumen: ProveedorComprasDto[] = porProveedor
      .map((g) => ({
        sucursalId: g.sucursalId,
        proveedorOrigenSrId: g.proveedorOrigenSrId,
        proveedor: de(proveedor, g.sucursalId, g.proveedorOrigenSrId),
        compras: g._count._all,
        totalD: g._sum.total ?? CERO,
      }))
      .sort(
        (a, b) =>
          b.totalD.comparedTo(a.totalD) ||
          (a.proveedor ?? '￿').localeCompare(b.proveedor ?? '￿', 'es-MX') ||
          (a.sucursalId < b.sucursalId ? -1 : a.sucursalId > b.sucursalId ? 1 : 0),
      )
      .map(({ totalD, ...r }) => ({ ...r, total: pesos(totalD) }));
    const total = porProveedor.reduce<D>((acc, g) => acc.plus(g._sum.total ?? CERO), CERO);

    return {
      sucursales: sucursales.map((s) => ({
        sucursalId: s.id,
        sucursal: s.nombre,
        comprasRecibidas: recibidasDe.get(s.id) ?? 0,
      })),
      porProveedor: resumen,
      compras: compras.map((c) => ({
        id: c.id,
        sucursalId: c.sucursalId,
        folio: c.folio,
        fecha: c.fecha.toISOString(),
        proveedorOrigenSrId: c.proveedorOrigenSrId,
        proveedor: de(proveedor, c.sucursalId, c.proveedorOrigenSrId),
        almacenOrigenSrId: c.almacenOrigenSrId,
        almacen: de(almacen, c.sucursalId, c.almacenOrigenSrId),
        total: pesos(c.total),
        partidas: c.partidas,
        cancelada: c.cancelada,
      })),
      totalCompras: cuantas,
      truncado: cuantas > compras.length,
      total: pesos(total),
    };
  }

  async detalle(scope: EmpresaScope, id: string, q: AlcanceQueryDto): Promise<CompraDetalleDto> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, q.empresaId);
    const c = encontradoOr404(
      await datos.compra.findFirst({
        where: { id, empresaId: q.empresaId },
        select: {
          id: true,
          sucursalId: true,
          folio: true,
          fecha: true,
          proveedorOrigenSrId: true,
          almacenOrigenSrId: true,
          total: true,
          partidas: true,
          cancelada: true,
          sucursal: { select: { nombre: true } },
          detalle: {
            select: {
              renglon: true,
              insumoOrigenSrId: true,
              cantidad: true,
              costoUnitario: true,
              importe: true,
            },
            orderBy: { renglon: 'asc' },
          },
        },
      }),
    );
    const deLaSucursal = { empresaId: q.empresaId, sucursalId: c.sucursalId };
    const insumos = [...new Set(c.detalle.map((p) => p.insumoOrigenSrId))];
    const [prov, alm, ins] = await Promise.all([
      c.proveedorOrigenSrId
        ? datos.proveedorCatalogo.findFirst({
            where: { ...deLaSucursal, origenSrId: c.proveedorOrigenSrId },
            select: { nombre: true },
          })
        : null,
      c.almacenOrigenSrId
        ? datos.almacenCatalogo.findFirst({
            where: { ...deLaSucursal, origenSrId: c.almacenOrigenSrId },
            select: { nombre: true },
          })
        : null,
      datos.insumo.findMany({
        where: { ...deLaSucursal, origenSrId: { in: insumos } },
        select: { origenSrId: true, nombre: true, unidadOrigenSrId: true },
      }),
    ]);
    const unidades = await datos.unidadCatalogo.findMany({
      where: {
        ...deLaSucursal,
        origenSrId: {
          in: ins.map((i) => i.unidadOrigenSrId).filter((u): u is string => u !== null),
        },
      },
      select: { origenSrId: true, nombre: true },
    });
    const unidad = new Map(unidades.map((u) => [u.origenSrId, u.nombre]));
    const insumo = new Map(
      ins.map((i) => [
        i.origenSrId,
        {
          nombre: i.nombre,
          unidad: i.unidadOrigenSrId ? (unidad.get(i.unidadOrigenSrId) ?? null) : null,
        },
      ]),
    );
    return {
      id: c.id,
      sucursalId: c.sucursalId,
      sucursal: c.sucursal.nombre,
      folio: c.folio,
      fecha: c.fecha.toISOString(),
      proveedorOrigenSrId: c.proveedorOrigenSrId,
      proveedor: prov?.nombre ?? null,
      almacenOrigenSrId: c.almacenOrigenSrId,
      almacen: alm?.nombre ?? null,
      total: pesos(c.total),
      partidas: c.partidas,
      cancelada: c.cancelada,
      detalle: c.detalle.map((p) => ({
        renglon: p.renglon,
        insumoOrigenSrId: p.insumoOrigenSrId,
        insumo: insumo.get(p.insumoOrigenSrId)?.nombre ?? null,
        unidad: insumo.get(p.insumoOrigenSrId)?.unidad ?? null,
        cantidad: p.cantidad.toFixed(3),
        costoUnitario: pesos(p.costoUnitario),
        importe: pesos(p.importe),
      })),
    };
  }
}
