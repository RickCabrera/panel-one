import { Injectable } from '@nestjs/common';
import { Prisma, type TipoPolizaInventario } from '@prisma/client';

import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService, type DatosScoped } from '../scope/scoped-prisma.service';
import { AgregadosVentasService } from '../ventas/agregados-ventas.service';
import type {
  ConsumoTeoricoDto,
  ConsumoTeoricoQueryDto,
  ProductoRecetaDto,
  RecetasDto,
  RecetasQueryDto,
  SucursalRecetasDto,
} from './dto/recetas.dto';
import { limitesDelRango } from './kardex';
import { validarRango } from './movimientos.service';
import {
  costoReceta,
  costosDeExistencias,
  cruzarVendidos,
  llaveInsumo,
  porcentajeDelPrecio,
  variaciones,
  type SalidasInsumo,
} from './recetas';
import { valorDe } from '../ingesta/existencias';

/** Tope de filas de la lista de recetas (y de lo que se lee para armarla). */
export const MAX_FILAS_RECETAS = 5000;

type D = Prisma.Decimal;
const CERO = new Prisma.Decimal(0);
const dec = (v: unknown): D => new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value);
const txt = (v: D | null, dp: number) => (v === null ? null : v.toFixed(dp));

/** Los tipos de póliza que cuentan como salida real (ver `variaciones`). */
const TIPOS_REAL = [
  'consumo',
  'merma',
  'ajuste',
] as const satisfies readonly TipoPolizaInventario[];

/** El estado de la sucursal sin la zona (la zona sólo sirve para cortar el rango). */
const sinZona = (s: SucursalRecetasDto): SucursalRecetasDto => ({
  sucursalId: s.sucursalId,
  sucursal: s.sucursal,
  recetasRecibidas: s.recetasRecibidas,
  catalogoProductos: s.catalogoProductos,
});

interface Filtro {
  empresaId: string;
  sucursalId?: string;
}

/**
 * Recetas y consumo teórico (F2-125): las recetas que el agente mandó por `POST /ingesta/recetas`,
 * cruzadas con el espejo de productos e insumos, y el teórico (ventas × receta) contra el real
 * (pólizas de F2-122). Todo por el helper de scope: la empresa (y la sucursal) se verifica con el
 * scope del usuario y va en el WHERE de cada consulta; lo vendido sale de las CTEs del helper de
 * agregados (`ventas()`), nunca de un FROM escrito aquí. Fuera de alcance = 404, nunca 403. Nada
 * de esto se escribe a SoftRestaurant.
 *
 * DECISION PROVISIONAL (nocturno): el teórico no se materializa por día; se calcula al vuelo para
 * el rango pedido (un día = un rango de un día). F2-126/F2-127 reusan `consumoTeorico`.
 */
@Injectable()
export class RecetasService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly agregados: AgregadosVentasService,
  ) {}

  /** Sucursales del filtro con su estado: catálogo de productos y recetas recibidas. */
  private async estadoSucursales(datos: DatosScoped, f: Filtro) {
    const deLasSucursales = {
      empresaId: f.empresaId,
      ...(f.sucursalId ? { sucursalId: f.sucursalId } : {}),
    };
    const [sucursales, sincronizadas, recetas] = await Promise.all([
      datos.sucursal.findMany({
        where: { empresaId: f.empresaId, ...(f.sucursalId ? { id: f.sucursalId } : {}) },
        select: { id: true, nombre: true, zonaHoraria: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      datos.sincronizacionCatalogo.findMany({
        where: { ...deLasSucursales, catalogo: 'productos' },
        select: { sucursalId: true },
      }),
      datos.receta.groupBy({
        by: ['sucursalId'],
        where: deLasSucursales,
        _count: { _all: true },
      }),
    ]);
    const conCatalogo = new Set(sincronizadas.map((s) => s.sucursalId));
    const recetasDe = new Map(recetas.map((r) => [r.sucursalId, r._count._all]));
    const estado: Array<SucursalRecetasDto & { zonaHoraria: string }> = sucursales.map((s) => ({
      sucursalId: s.id,
      sucursal: s.nombre,
      zonaHoraria: s.zonaHoraria,
      recetasRecibidas: recetasDe.get(s.id) ?? 0,
      catalogoProductos: conCatalogo.has(s.id),
    }));
    return { deLasSucursales, estado };
  }

  /** Nombres y unidades de los insumos, y el costo de la última foto de existencias. */
  private async insumos(datos: DatosScoped, where: Record<string, unknown>) {
    const [insumos, unidades, existencias] = await Promise.all([
      datos.insumo.findMany({
        where,
        select: { sucursalId: true, origenSrId: true, nombre: true, unidadOrigenSrId: true },
      }),
      datos.unidadCatalogo.findMany({
        where,
        select: { sucursalId: true, origenSrId: true, nombre: true },
      }),
      datos.existencia.findMany({
        where,
        select: { sucursalId: true, insumoOrigenSrId: true, cantidad: true, valor: true },
      }),
    ]);
    const unidad = new Map(
      unidades.map((u) => [llaveInsumo(u.sucursalId, u.origenSrId), u.nombre]),
    );
    const info = new Map(
      insumos.map((i) => [
        llaveInsumo(i.sucursalId, i.origenSrId),
        {
          nombre: i.nombre,
          unidad: i.unidadOrigenSrId
            ? (unidad.get(llaveInsumo(i.sucursalId, i.unidadOrigenSrId)) ?? null)
            : null,
        },
      ]),
    );
    return { info, costos: costosDeExistencias(existencias) };
  }

  async recetas(scope: EmpresaScope, q: RecetasQueryDto): Promise<RecetasDto> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, q.empresaId, q.sucursalId);
    const { deLasSucursales, estado } = await this.estadoSucursales(datos, q);
    const [productos, recetas, { info, costos }] = await Promise.all([
      datos.producto.findMany({
        where: deLasSucursales,
        select: {
          sucursalId: true,
          origenSrId: true,
          clave: true,
          nombre: true,
          precio: true,
          activo: true,
          activoPos: true,
        },
        orderBy: [{ sucursalId: 'asc' }, { origenSrId: 'asc' }],
        take: MAX_FILAS_RECETAS + 1,
      }),
      datos.receta.findMany({
        where: deLasSucursales,
        select: {
          sucursalId: true,
          productoOrigenSrId: true,
          detalle: {
            select: { insumoOrigenSrId: true, cantidad: true },
            orderBy: { renglon: 'asc' },
          },
        },
        orderBy: [{ sucursalId: 'asc' }, { productoOrigenSrId: 'asc' }],
        take: MAX_FILAS_RECETAS + 1,
      }),
      this.insumos(datos, deLasSucursales),
    ]);
    const recetaDe = new Map(
      recetas.map((r) => [llaveInsumo(r.sucursalId, r.productoOrigenSrId), r.detalle]),
    );
    const enEspejo = new Set(productos.map((p) => llaveInsumo(p.sucursalId, p.origenSrId)));

    const fila = (
      p: {
        sucursalId: string;
        origenSrId: string;
        clave: string | null;
        nombre: string | null;
        precio: D | null;
        vigente: boolean;
        enCatalogo: boolean;
      },
      detalle: ReadonlyArray<{ insumoOrigenSrId: string; cantidad: D }>,
    ): ProductoRecetaDto => {
      const importes: Array<D | null> = [];
      const renglones = detalle.map((r) => {
        const i = info.get(llaveInsumo(p.sucursalId, r.insumoOrigenSrId));
        const costo = costos.get(llaveInsumo(p.sucursalId, r.insumoOrigenSrId)) ?? null;
        const importe = costo ? valorDe(r.cantidad, costo) : null;
        importes.push(importe);
        return {
          insumoOrigenSrId: r.insumoOrigenSrId,
          insumo: i?.nombre ?? null,
          unidad: i?.unidad ?? null,
          cantidad: r.cantidad.toFixed(4),
          costo: txt(costo, 2),
          importe: txt(importe, 2),
        };
      });
      const conReceta = renglones.length > 0;
      const { costo, incompleto } = costoReceta(importes.map((importe) => ({ importe })));
      return {
        sucursalId: p.sucursalId,
        productoOrigenSrId: p.origenSrId,
        clave: p.clave,
        nombre: p.nombre,
        vigente: p.vigente,
        enCatalogo: p.enCatalogo,
        precio: txt(p.precio, 2),
        conReceta,
        renglones,
        costo: conReceta ? costo.toFixed(2) : null,
        costoIncompleto: conReceta && incompleto,
        porcentajePrecio: conReceta
          ? txt(porcentajeDelPrecio(costo, incompleto, p.precio), 1)
          : null,
      };
    };

    const filas: ProductoRecetaDto[] = [
      ...productos.map((p) =>
        fila(
          {
            ...p,
            vigente: p.activo && p.activoPos !== false,
            enCatalogo: true,
          },
          recetaDe.get(llaveInsumo(p.sucursalId, p.origenSrId)) ?? [],
        ),
      ),
      ...recetas
        .filter((r) => !enEspejo.has(llaveInsumo(r.sucursalId, r.productoOrigenSrId)))
        .map((r) =>
          fila(
            {
              sucursalId: r.sucursalId,
              origenSrId: r.productoOrigenSrId,
              clave: null,
              nombre: null,
              precio: null,
              vigente: false,
              enCatalogo: false,
            },
            r.detalle,
          ),
        ),
    ];
    const orden = new Map(estado.map((s, i) => [s.sucursalId, i]));
    filas.sort(
      (a, b) =>
        (orden.get(a.sucursalId) ?? 0) - (orden.get(b.sucursalId) ?? 0) ||
        Number(b.conReceta) - Number(a.conReceta) ||
        (a.nombre === null ? 1 : 0) - (b.nombre === null ? 1 : 0) ||
        (a.nombre ?? '').localeCompare(b.nombre ?? '', 'es-MX') ||
        (a.productoOrigenSrId < b.productoOrigenSrId ? -1 : 1),
    );
    const truncado =
      productos.length > MAX_FILAS_RECETAS ||
      recetas.length > MAX_FILAS_RECETAS ||
      filas.length > MAX_FILAS_RECETAS;
    return {
      sucursales: estado.map(sinZona),
      productos: filas.slice(0, MAX_FILAS_RECETAS),
      total: filas.length,
      truncado,
    };
  }

  async consumoTeorico(scope: EmpresaScope, q: ConsumoTeoricoQueryDto): Promise<ConsumoTeoricoDto> {
    validarRango(q.desde, q.hasta);
    // El helper de agregados verifica la empresa y la sucursal con el scope (404) ANTES de leer.
    const ventas = await this.agregados.consulta(scope, {
      empresaId: q.empresaId,
      sucursalId: q.sucursalId,
      desde: q.desde,
      hasta: q.hasta,
    });
    const datos = this.datos.para(scope);
    const { deLasSucursales, estado } = await this.estadoSucursales(datos, q);
    const polizas = await datos.polizaInventario.groupBy({
      by: ['sucursalId'],
      where: deLasSucursales,
      _count: { _all: true },
    });
    const polizasDe = new Map(polizas.map((p) => [p.sucursalId, p._count._all]));
    const calculables = new Set(
      estado.filter((s) => s.catalogoProductos && s.recetasRecibidas > 0).map((s) => s.sucursalId),
    );
    const conMovimientos = new Set(
      estado.filter((s) => (polizasDe.get(s.sucursalId) ?? 0) > 0).map((s) => s.sucursalId),
    );

    const sucursalesDto = estado.map((s) => ({
      ...sinZona(s),
      polizasRecibidas: polizasDe.get(s.sucursalId) ?? 0,
      calculada: calculables.has(s.sucursalId),
      productosExplotados: 0,
    }));
    if (calculables.size === 0) {
      return { sucursales: sucursalesDto, filas: [], aparte: [] };
    }

    const deCalculables = { empresaId: q.empresaId, sucursalId: { in: [...calculables] } };
    const enRango = estado
      .filter((s) => calculables.has(s.sucursalId))
      .map((s) => {
        const { inicio, fin } = limitesDelRango(q.desde, q.hasta, s.zonaHoraria);
        return { sucursalId: s.sucursalId, fecha: { gte: inicio, lt: fin } };
      });
    const salidasDe = (extra: Record<string, unknown>) =>
      datos.movimientoInventario.groupBy({
        by: ['sucursalId', 'insumoOrigenSrId'],
        where: { ...deCalculables, OR: enRango, ...extra },
        _sum: { cantidad: true, importe: true },
      });

    const [vendidos, productos, recetas, porTipo, salidasNegativas, { info, costos }] =
      await Promise.all([
        ventas.consultar<{
          sucursal_id: string;
          producto: string;
          partidas: number;
          cantidad: unknown;
          importe: unknown;
        }>(Prisma.sql`SELECT sucursal_id, producto, count(*)::int AS partidas,
            COALESCE(sum(cantidad), 0) AS cantidad, COALESCE(sum(total), 0) AS importe
          FROM partidas_ventas
          GROUP BY sucursal_id, producto`),
        datos.producto.findMany({
          where: deCalculables,
          select: { sucursalId: true, origenSrId: true, nombre: true },
        }),
        datos.receta.findMany({
          where: deCalculables,
          select: {
            sucursalId: true,
            productoOrigenSrId: true,
            detalle: { select: { insumoOrigenSrId: true, cantidad: true } },
          },
        }),
        Promise.all(TIPOS_REAL.map((tipo) => salidasDe({ poliza: { tipo, cancelada: false } }))),
        // El costo del periodo: Σ importe / Σ cantidad de las SALIDAS (cantidad < 0) de esos tipos.
        salidasDe({
          cantidad: { lt: 0 },
          poliza: { tipo: { in: [...TIPOS_REAL] }, cancelada: false },
        }),
        this.insumos(datos, deCalculables),
      ]);

    const cruce = cruzarVendidos(
      vendidos.map((v) => ({
        sucursalId: v.sucursal_id,
        producto: v.producto,
        partidas: v.partidas,
        cantidad: dec(v.cantidad),
        importe: dec(v.importe),
      })),
      productos,
      recetas.map((r) => ({
        sucursalId: r.sucursalId,
        productoOrigenSrId: r.productoOrigenSrId,
        renglones: r.detalle,
      })),
      calculables,
    );

    const salidas = new Map<string, Map<string, SalidasInsumo>>();
    const de = (sucursalId: string, insumo: string): SalidasInsumo => {
      const m = salidas.get(sucursalId) ?? new Map<string, SalidasInsumo>();
      salidas.set(sucursalId, m);
      const s = m.get(insumo) ?? {
        consumo: CERO,
        merma: CERO,
        ajuste: CERO,
        importeAbs: CERO,
        cantidadAbs: CERO,
      };
      m.set(insumo, s);
      return s;
    };
    TIPOS_REAL.forEach((tipo, i) => {
      for (const g of porTipo[i]) {
        de(g.sucursalId, g.insumoOrigenSrId)[tipo] = dec(g._sum.cantidad);
      }
    });
    for (const g of salidasNegativas) {
      const s = de(g.sucursalId, g.insumoOrigenSrId);
      s.importeAbs = dec(g._sum.importe).abs();
      s.cantidadAbs = dec(g._sum.cantidad).abs();
    }

    const filas = variaciones({
      calculables,
      teorico: cruce.teorico,
      salidas,
      conMovimientos,
      costoExistencias: costos,
    });
    const nombreSucursal = new Map(estado.map((s) => [s.sucursalId, s.sucursal]));
    return {
      sucursales: sucursalesDto.map((s) => ({
        ...s,
        productosExplotados: cruce.explotados.get(s.sucursalId) ?? 0,
      })),
      filas: filas.map((f) => {
        const i = info.get(llaveInsumo(f.sucursalId, f.insumoOrigenSrId));
        return {
          sucursalId: f.sucursalId,
          insumoOrigenSrId: f.insumoOrigenSrId,
          insumo: i?.nombre ?? null,
          unidad: i?.unidad ?? null,
          teorico: f.teorico.toFixed(3),
          real: txt(f.real, 3),
          consumo: txt(f.consumo, 3),
          merma: txt(f.merma, 3),
          ajuste: txt(f.ajuste, 3),
          variacion: txt(f.variacion, 3),
          porcentaje: txt(f.porcentaje, 1),
          sinTeorico: f.sinTeorico,
          costo: txt(f.costo, 2),
          importeTeorico: txt(f.importeTeorico, 2),
          importeVariacion: txt(f.importeVariacion, 2),
        };
      }),
      aparte: cruce.aparte.map((a) => ({
        sucursalId: a.sucursalId,
        sucursal: nombreSucursal.get(a.sucursalId) ?? '',
        producto: a.producto,
        motivo: a.motivo,
        productoOrigenSrId: a.productoOrigenSrId,
        partidas: a.partidas,
        cantidad: a.cantidad.toFixed(3),
        importe: a.importe.toFixed(2),
      })),
    };
  }
}
