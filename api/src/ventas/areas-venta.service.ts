import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { FiltroVentas } from '../scope/consulta-ventas';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { AgregadosVentasService } from './agregados-ventas.service';
import { armarPorArea, type VentaAreaLeida, type VentaPorArea } from './por-area';

function dec(valor: unknown): Prisma.Decimal {
  if (valor === null || valor === undefined) {
    return new Prisma.Decimal(0);
  }
  return new Prisma.Decimal(valor as Prisma.Decimal.Value);
}

/**
 * Venta por área y canal (F2-233). La venta y las cuentas salen de UNA sentencia sobre la CTE
 * `ventas` del helper de scope (la Σ de las áreas y el total son del mismo snapshot); el espejo
 * de áreas, su mapeo y el estado de sincronización se leen con `ScopedPrismaService` (empresa y
 * sucursal en el WHERE). Fuera de alcance = 404 (lo resuelve `AgregadosVentasService.consulta`).
 *
 * Sin cache: el mapeo área → canal se aplica al leer, y cambiarlo tiene que verse al instante en
 * cualquier periodo, sin re-ingerir nada.
 */
@Injectable()
export class AreasVentaService {
  constructor(
    private readonly agregados: AgregadosVentasService,
    private readonly datos: ScopedPrismaService,
  ) {}

  async porArea(scope: EmpresaScope, filtro: FiltroVentas): Promise<VentaPorArea> {
    const q = await this.agregados.consulta(scope, filtro);
    const filas = await q.consultar<{
      sucursal_id: string;
      sucursal: string;
      area_origen_sr_id: string | null;
      venta: unknown;
      cuentas: number;
    }>(Prisma.sql`SELECT v.sucursal_id, s.nombre AS sucursal, v.area_origen_sr_id,
        COALESCE(sum(v.total), 0) AS venta, count(*)::int AS cuentas
      FROM ventas v
      JOIN sucursales_alcance s ON s.id = v.sucursal_id
      GROUP BY v.sucursal_id, s.nombre, v.area_origen_sr_id`);
    const leidas: VentaAreaLeida[] = filas.map((f) => ({
      sucursalId: f.sucursal_id,
      sucursal: f.sucursal,
      areaOrigenSrId: f.area_origen_sr_id,
      venta: dec(f.venta),
      cuentas: f.cuentas,
    }));

    const datos = this.datos.para(scope);
    const { empresaId, sucursalId } = filtro;
    const deLaSucursal = sucursalId ? { sucursalId } : {};
    // Sólo las áreas que aparecen en las cuentas: acotado por lo vendido, sin tope.
    const origenes = [
      ...new Set(leidas.flatMap((f) => (f.areaOrigenSrId === null ? [] : [f.areaOrigenSrId]))),
    ];
    const [sucursales, sincronizaciones, areas] = await Promise.all([
      datos.sucursal.findMany({
        where: { empresaId, ...(sucursalId ? { id: sucursalId } : {}) },
        select: { id: true, nombre: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      datos.sincronizacionCatalogo.findMany({
        where: { empresaId, catalogo: 'areas', ...deLaSucursal },
        select: { sucursalId: true },
      }),
      origenes.length === 0
        ? Promise.resolve([])
        : datos.areaCatalogo.findMany({
            where: { empresaId, ...deLaSucursal, origenSrId: { in: origenes } },
            select: {
              id: true,
              sucursalId: true,
              origenSrId: true,
              clave: true,
              nombre: true,
              activo: true,
              canal: { select: { canal: true } },
            },
          }),
    ]);
    return armarPorArea(
      leidas,
      areas.map((a) => ({
        id: a.id,
        sucursalId: a.sucursalId,
        origenSrId: a.origenSrId,
        clave: a.clave,
        nombre: a.nombre,
        activo: a.activo,
        canal: a.canal?.canal ?? null,
      })),
      sucursales,
      new Set(sincronizaciones.map((s) => s.sucursalId)),
    );
  }
}
