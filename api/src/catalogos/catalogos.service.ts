import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type CatalogoSr } from '@prisma/client';

import { Reloj } from '../comun/reloj';
import { Auditoria, type Actor } from '../comun/auditoria';
import { CATALOGOS, solicitudPendiente } from '../ingesta/catalogos';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import type { ConsultaVentas } from '../scope/consulta-ventas';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService, type DatosScoped } from '../scope/scoped-prisma.service';
import { AgregadosVentasService } from '../ventas/agregados-ventas.service';
import { AnalisisService } from '../ventas/analisis.service';
import {
  agruparMenu,
  MAX_FILAS_MENU,
  MAX_SIN_CATALOGO,
  normalizarNombre,
  vendidosSinCatalogo,
} from './menu';
import {
  cifrasDe,
  MAX_CATALOGO_CLIENTES,
  resumenClientes,
  type CifrasCliente,
  type CifrasClienteLeidas,
  type ResumenClientes,
} from './clientes';
import { MAX_CATALOGO_MESEROS, rendimientoMeseros, type RendimientoMeseros } from './meseros';
import type {
  AsignarCanalAreaDto,
  DetalleProductoDto,
  FilaMapeoAreaDto,
  SucursalMapeoDto,
  MenuDto,
  VendidosSinCatalogoDto,
  EstadoFiltro,
  FilaCatalogoDto,
  FilaClienteDto,
  FilaInsumoDto,
  FilaProductoDto,
  GuardarMetadataDto,
  SincronizacionSucursalDto,
} from './dto/catalogos.dto';

export const POR_PAGINA = 50;
/** Áreas del espejo que lee el mapeo (F2-233). Un restaurante tiene decenas, no miles. */
export const MAX_AREAS_MAPEO = 2000;

export interface MapeoAreas {
  sucursales: SucursalMapeoDto[];
  areas: FilaMapeoAreaDto[];
  truncado: boolean;
}

const SELECT_MAPEO = {
  id: true,
  sucursalId: true,
  origenSrId: true,
  clave: true,
  nombre: true,
  activo: true,
  activoPos: true,
  sucursal: { select: { nombre: true } },
  canal: { select: { canal: true, updatedAt: true } },
} as const;

function filaMapeo(a: {
  id: string;
  sucursalId: string;
  origenSrId: string;
  clave: string | null;
  nombre: string;
  activo: boolean;
  activoPos: boolean | null;
  sucursal: { nombre: string };
  canal: { canal: FilaMapeoAreaDto['canal']; updatedAt: Date } | null;
}): FilaMapeoAreaDto {
  return {
    id: a.id,
    sucursalId: a.sucursalId,
    sucursal: a.sucursal.nombre,
    origenSrId: a.origenSrId,
    clave: a.clave,
    nombre: a.nombre,
    activo: a.activo,
    activoPos: a.activoPos,
    canal: a.canal?.canal ?? null,
    canalActualizadoAt: a.canal?.updatedAt.toISOString() ?? null,
  };
}
/** Productos que muestra la ficha de un cliente (F2-232). */
export const MAX_PRODUCTOS_FICHA = 10;
/** Pares (sucursal, id) por consulta al buscar los clientes de las cuentas (F2-232). */
const LOTE_CLIENTES = 500;

export interface FichaCliente {
  cliente: {
    id: string;
    sucursalId: string;
    sucursal: string;
    origenSrId: string;
    clave: string | null;
    nombre: string;
    telefono: string | null;
    correo: string | null;
    rfc: string | null;
    activo: boolean;
    activoPos: boolean | null;
    vistoAt: string;
  };
  periodo: CifrasCliente;
  productos: Array<{ producto: string; cantidad: string; importe: string; cuentas: number }>;
}

export interface FiltroCatalogo {
  empresaId: string;
  sucursalId?: string;
  estado?: EstadoFiltro;
  q?: string;
  pagina?: number;
}

export interface Pagina<T> {
  filas: T[];
  total: number;
  pagina: number;
  porPagina: number;
}

/** Columnas comunes que se leen de las tablas espejo. */
const SELECT_COMUN = {
  id: true,
  sucursalId: true,
  origenSrId: true,
  clave: true,
  nombre: true,
  activo: true,
  activoPos: true,
  vistoAt: true,
  updatedAt: true,
  sucursal: { select: { nombre: true } },
} as const;

interface FilaComun {
  id: string;
  sucursalId: string;
  origenSrId: string;
  clave: string | null;
  nombre: string;
  activo: boolean;
  activoPos: boolean | null;
  vistoAt: Date;
  updatedAt: Date;
  sucursal: { nombre: string };
}

/** La forma común de los delegados espejo CON scope que usa la lectura. */
interface DelegadoLectura {
  findMany(args: object): Promise<Array<FilaComun & Record<string, unknown>>>;
  count(args: object): Promise<number>;
}

function delegado(datos: DatosScoped, catalogo: CatalogoSr): DelegadoLectura {
  const d: Record<CatalogoSr, unknown> = {
    grupos: datos.grupoProducto,
    productos: datos.producto,
    meseros: datos.meseroCatalogo,
    clientes: datos.clienteCatalogo,
    areas: datos.areaCatalogo,
    canales: datos.canalVentaCatalogo,
    unidades: datos.unidadCatalogo,
    grupos_insumo: datos.grupoInsumo,
    insumos: datos.insumo,
    almacenes: datos.almacenCatalogo,
    proveedores: datos.proveedorCatalogo,
  };
  return d[catalogo] as DelegadoLectura;
}

function extraSelect(catalogo: CatalogoSr): Record<string, unknown> {
  switch (catalogo) {
    case 'productos':
      return {
        grupoOrigenSrId: true,
        precio: true,
        metadata: { select: { productoId: true } },
      };
    case 'clientes':
      return { telefono: true, correo: true, rfc: true };
    case 'insumos':
      return { grupoOrigenSrId: true, unidadOrigenSrId: true };
    default:
      return {};
  }
}

function vistaComun(f: FilaComun): FilaCatalogoDto {
  return {
    id: f.id,
    sucursalId: f.sucursalId,
    sucursal: f.sucursal.nombre,
    origenSrId: f.origenSrId,
    clave: f.clave,
    nombre: f.nombre,
    activo: f.activo,
    activoPos: f.activoPos,
    vistoAt: f.vistoAt.toISOString(),
    updatedAt: f.updatedAt.toISOString(),
  };
}

/**
 * Lectura de los catálogos espejo (F2-230) y lo que el panel escribe sobre ellos. Todo por
 * el helper de scope: la empresa (y la sucursal, si viene) se verifica con el scope del
 * usuario y va en el WHERE de cada consulta. Fuera de alcance = 404, nunca 403.
 */
@Injectable()
export class CatalogosService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
    private readonly agregados: AgregadosVentasService,
    private readonly analisis: AnalisisService,
  ) {}

  async listar(
    scope: EmpresaScope,
    catalogo: CatalogoSr,
    f: FiltroCatalogo,
  ): Promise<Pagina<FilaCatalogoDto | FilaProductoDto | FilaClienteDto | FilaInsumoDto>> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, f.empresaId, f.sucursalId);
    const pagina = f.pagina ?? 1;
    const where: Record<string, unknown> = {
      empresaId: f.empresaId,
      ...(f.sucursalId ? { sucursalId: f.sucursalId } : {}),
      ...(f.estado === 'activos'
        ? { activo: true }
        : f.estado === 'inactivos'
          ? { activo: false }
          : {}),
      ...(f.q
        ? {
            OR: [
              { nombre: { contains: f.q, mode: 'insensitive' } },
              { clave: { contains: f.q, mode: 'insensitive' } },
              { origenSrId: { contains: f.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const d = delegado(datos, catalogo);
    const [total, filas] = await Promise.all([
      d.count({ where }),
      d.findMany({
        where,
        select: { ...SELECT_COMUN, ...extraSelect(catalogo) },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
      }),
    ]);
    const vistas =
      catalogo === 'productos'
        ? await this.conGrupo(datos, f.empresaId, filas)
        : catalogo === 'insumos'
          ? await this.conGrupoYUnidad(datos, f.empresaId, filas)
          : catalogo === 'clientes'
            ? filas.map((r) => ({
                ...vistaComun(r),
                telefono: r.telefono as string | null,
                correo: r.correo as string | null,
                rfc: r.rfc as string | null,
              }))
            : filas.map(vistaComun);
    return { filas: vistas, total, pagina, porPagina: POR_PAGINA };
  }

  async producto(scope: EmpresaScope, empresaId: string, id: string): Promise<DetalleProductoDto> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId);
    const fila = encontradoOr404(
      (await datos.producto.findFirst({
        where: { id, empresaId },
        select: {
          ...SELECT_COMUN,
          grupoOrigenSrId: true,
          precio: true,
          metadata: {
            select: {
              productoId: true,
              descripcion: true,
              fotoUrl: true,
              etiquetas: true,
              minimo: true,
              maximo: true,
              updatedAt: true,
            },
          },
        },
      })) as (FilaComun & Record<string, unknown>) | null,
    );
    const [vista] = await this.conGrupo(datos, empresaId, [fila]);
    const m = fila.metadata as {
      descripcion: string | null;
      fotoUrl: string | null;
      etiquetas: string[];
      minimo: Prisma.Decimal | null;
      maximo: Prisma.Decimal | null;
      updatedAt: Date;
    } | null;
    return {
      ...vista,
      metadata: m
        ? {
            descripcion: m.descripcion,
            fotoUrl: m.fotoUrl,
            etiquetas: m.etiquetas,
            minimo: m.minimo?.toFixed(3) ?? null,
            maximo: m.maximo?.toFixed(3) ?? null,
            updatedAt: m.updatedAt.toISOString(),
          }
        : null,
    };
  }

  async guardarMetadata(
    actor: Actor,
    scope: EmpresaScope,
    id: string,
    dto: GuardarMetadataDto,
  ): Promise<DetalleProductoDto> {
    const minimo = dto.minimo ? new Prisma.Decimal(dto.minimo) : null;
    const maximo = dto.maximo ? new Prisma.Decimal(dto.maximo) : null;
    if (minimo && maximo && minimo.greaterThan(maximo)) {
      throw new BadRequestException('minimo no puede ser mayor que maximo.');
    }
    // 404 con el scope del USUARIO antes de escribir (la escritura lo vuelve a verificar).
    await verificarAlcance(this.datos.para(scope), dto.empresaId);
    await this.datos.catalogos(scope).guardarMetadata(
      dto.empresaId,
      id,
      {
        descripcion: dto.descripcion ?? null,
        fotoUrl: dto.fotoUrl ?? null,
        etiquetas: dto.etiquetas,
        minimo,
        maximo,
      },
      actor.id,
      new Date(this.reloj.ahora()),
    );
    this.auditoria.registrar(actor, {
      accion: 'producto_metadata.editar',
      recurso: 'producto',
      recursoId: id,
      empresaId: dto.empresaId,
      campos: ['descripcion', 'fotoUrl', 'etiquetas', 'minimo', 'maximo'],
    });
    return this.producto(scope, dto.empresaId, id);
  }

  /**
   * Las áreas del espejo con su canal de negocio (F2-233), en cualquier estado: un área dada de
   * baja sigue teniendo ventas en periodos pasados y su canal se puede corregir.
   */
  async mapeoAreas(
    scope: EmpresaScope,
    empresaId: string,
    sucursalId?: string,
  ): Promise<MapeoAreas> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId, sucursalId);
    const deLaSucursal = sucursalId ? { sucursalId } : {};
    const [sucursales, estados, areas] = await Promise.all([
      datos.sucursal.findMany({
        where: { empresaId, ...(sucursalId ? { id: sucursalId } : {}) },
        select: { id: true, nombre: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      datos.sincronizacionCatalogo.findMany({
        where: { empresaId, catalogo: 'areas', ...deLaSucursal },
        select: { sucursalId: true, ultimaCompletaAt: true },
      }),
      datos.areaCatalogo.findMany({
        where: { empresaId, ...deLaSucursal },
        select: SELECT_MAPEO,
        orderBy: [{ sucursalId: 'asc' }, { nombre: 'asc' }, { id: 'asc' }],
        take: MAX_AREAS_MAPEO + 1,
      }),
    ]);
    return {
      sucursales: sucursales.map((s) => ({
        sucursalId: s.id,
        sucursal: s.nombre,
        ultimaCompletaAt:
          estados.find((e) => e.sucursalId === s.id)?.ultimaCompletaAt.toISOString() ?? null,
      })),
      areas: areas.slice(0, MAX_AREAS_MAPEO).map(filaMapeo),
      truncado: areas.length > MAX_AREAS_MAPEO,
    };
  }

  async asignarCanalArea(
    actor: Actor,
    scope: EmpresaScope,
    id: string,
    dto: AsignarCanalAreaDto,
  ): Promise<FilaMapeoAreaDto> {
    // 404 con el scope del USUARIO antes de escribir (la escritura lo vuelve a verificar).
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, dto.empresaId);
    await this.datos
      .catalogos(scope)
      .asignarCanalArea(dto.empresaId, id, dto.canal, actor.id, new Date(this.reloj.ahora()));
    this.auditoria.registrar(actor, {
      accion: 'area_canal.asignar',
      recurso: 'area',
      recursoId: id,
      empresaId: dto.empresaId,
      campos: ['canal'],
    });
    const fila = encontradoOr404(
      await datos.areaCatalogo.findFirst({
        where: { id, empresaId: dto.empresaId },
        select: SELECT_MAPEO,
      }),
    );
    return filaMapeo(fila);
  }

  async sincronizacion(
    scope: EmpresaScope,
    empresaId: string,
  ): Promise<SincronizacionSucursalDto[]> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId);
    const [sucursales, estados, solicitudes] = await Promise.all([
      datos.sucursal.findMany({
        where: { empresaId },
        select: { id: true, nombre: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      datos.sincronizacionCatalogo.findMany({ where: { empresaId } }),
      datos.solicitudSincronizacion.findMany({ where: { empresaId } }),
    ]);
    return sucursales.map((s) => {
      const propios = estados.filter((e) => e.sucursalId === s.id);
      const solicitadaAt = solicitudes.find((x) => x.sucursalId === s.id)?.solicitadaAt ?? null;
      return {
        sucursalId: s.id,
        sucursal: s.nombre,
        catalogos: CATALOGOS.map((catalogo) => {
          const e = propios.find((x) => x.catalogo === catalogo);
          return {
            catalogo,
            ultimaCompletaAt: e?.ultimaCompletaAt.toISOString() ?? null,
            recibidaAt: e?.recibidaAt.toISOString() ?? null,
            total: e?.total ?? null,
            rechazados: e?.rechazados ?? null,
            desactivados: e?.desactivados ?? null,
          };
        }),
        solicitud: {
          solicitadaAt: solicitadaAt?.toISOString() ?? null,
          pendiente: solicitudPendiente(solicitadaAt, propios),
        },
      };
    });
  }

  async forzar(
    actor: Actor,
    scope: EmpresaScope,
    empresaId: string,
    sucursalId: string,
  ): Promise<SincronizacionSucursalDto> {
    await verificarAlcance(this.datos.para(scope), empresaId, sucursalId);
    await this.datos
      .catalogos(scope)
      .solicitarSincronizacion(empresaId, sucursalId, actor.id, new Date(this.reloj.ahora()));
    this.auditoria.registrar(actor, {
      accion: 'sucursal.forzar_sincronizacion',
      recurso: 'sucursal',
      recursoId: sucursalId,
      empresaId,
    });
    const todas = await this.sincronizacion(scope, empresaId);
    return encontradoOr404(todas.find((s) => s.sucursalId === sucursalId));
  }

  /**
   * El orquestador de menú (F2-145): los productos ACTIVOS del espejo (los que vio la última
   * sincronización completa) cruzados entre sucursales, por categoría, con la discrepancia de
   * precio señalada. Sólo lectura: el precio lo manda el POS.
   *
   * DECISION PROVISIONAL (nocturno): la metadata propia sigue POR SUCURSAL, como la dejó F2-230
   * (cuelga del producto espejo de cada sucursal); por eso cada precio lleva su `productoId`.
   * Si foto, descripción y etiquetas deben ser por empresa es decisión abierta de Ricardo
   * (esquema-sr.md §6).
   */
  async menu(scope: EmpresaScope, empresaId: string, sucursalId?: string): Promise<MenuDto> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId, sucursalId);
    const deLaSucursal = sucursalId ? { sucursalId } : {};
    const [sucursales, sincronizaciones, grupos, filas] = await Promise.all([
      datos.sucursal.findMany({
        where: { empresaId, ...(sucursalId ? { id: sucursalId } : {}) },
        select: { id: true, nombre: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      datos.sincronizacionCatalogo.findMany({
        where: { empresaId, catalogo: 'productos', ...deLaSucursal },
        select: { sucursalId: true, ultimaCompletaAt: true },
      }),
      datos.grupoProducto.findMany({
        where: { empresaId, ...deLaSucursal },
        select: { sucursalId: true, origenSrId: true, nombre: true },
      }),
      datos.producto.findMany({
        where: { empresaId, activo: true, ...deLaSucursal },
        select: {
          id: true,
          sucursalId: true,
          origenSrId: true,
          clave: true,
          nombre: true,
          grupoOrigenSrId: true,
          precio: true,
          activoPos: true,
          metadata: { select: { productoId: true } },
        },
        orderBy: [{ sucursalId: 'asc' }, { origenSrId: 'asc' }],
        take: MAX_FILAS_MENU + 1,
      }),
    ]);
    const truncado = filas.length > MAX_FILAS_MENU;
    const usadas = filas.slice(0, MAX_FILAS_MENU);
    const grupo = new Map(grupos.map((g) => [`${g.sucursalId}|${g.origenSrId}`, g.nombre]));
    const agrupado = agruparMenu(
      usadas.map((f) => ({
        productoId: f.id,
        sucursalId: f.sucursalId,
        origenSrId: f.origenSrId,
        clave: f.clave,
        nombre: f.nombre,
        grupo: f.grupoOrigenSrId
          ? (grupo.get(`${f.sucursalId}|${f.grupoOrigenSrId}`) ?? null)
          : null,
        precio: f.precio,
        activoPos: f.activoPos,
        tieneMetadata: f.metadata !== null,
      })),
      sucursales.map((s) => s.id),
    );
    return {
      sucursales: sucursales.map((s) => ({
        sucursalId: s.id,
        sucursal: s.nombre,
        sincronizadoAt:
          sincronizaciones.find((x) => x.sucursalId === s.id)?.ultimaCompletaAt.toISOString() ??
          null,
        productos: usadas.filter((f) => f.sucursalId === s.id).length,
      })),
      ...agrupado,
      truncado,
    };
  }

  /**
   * Lo vendido en el periodo (cuentas cerradas no canceladas, corte en la zona de CADA
   * sucursal) cuyo nombre no está en el catálogo de SU sucursal (F2-145). Las ventas salen del
   * helper de scope de agregados; los nombres del catálogo, del espejo con el mismo scope. Se
   * cruzan en código (el helper no deja leer tablas reales en su cuerpo).
   *
   * Sólo se cruzan las sucursales con una sincronización COMPLETA de productos: las demás van en
   * `sucursalesSinCatalogo` y no listan nada (contra un catálogo parcial todo saldría aquí).
   */
  async vendidosSinCatalogo(
    scope: EmpresaScope,
    filtro: { empresaId: string; sucursalId?: string; desde: string; hasta: string },
  ): Promise<VendidosSinCatalogoDto> {
    const q = await this.agregados.consulta(scope, filtro);
    const datos = this.datos.para(scope);
    const deLaSucursal = filtro.sucursalId ? { sucursalId: filtro.sucursalId } : {};
    const [vendidos, sucursales, sincronizadas] = await Promise.all([
      q.consultar<{
        sucursal_id: string;
        producto: string;
        partidas: number;
        cantidad: unknown;
        importe: unknown;
      }>(Prisma.sql`SELECT sucursal_id, producto, count(*)::int AS partidas,
          COALESCE(sum(cantidad), 0) AS cantidad, COALESCE(sum(total), 0) AS importe
        FROM partidas_ventas
        GROUP BY sucursal_id, producto`),
      datos.sucursal.findMany({
        where: {
          empresaId: filtro.empresaId,
          ...(filtro.sucursalId ? { id: filtro.sucursalId } : {}),
        },
        select: { id: true, nombre: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      datos.sincronizacionCatalogo.findMany({
        where: { empresaId: filtro.empresaId, catalogo: 'productos', ...deLaSucursal },
        select: { sucursalId: true },
      }),
    ]);
    const conCatalogo = new Set(sincronizadas.map((s) => s.sucursalId));
    // Todos los estados: un producto dado de baja que se vendió antes sí estaba en el catálogo.
    const nombres =
      conCatalogo.size === 0
        ? []
        : await datos.producto.findMany({
            where: { empresaId: filtro.empresaId, sucursalId: { in: [...conCatalogo] } },
            select: { sucursalId: true, nombre: true },
          });
    const catalogo = new Map<string, Set<string>>();
    for (const n of nombres) {
      const set = catalogo.get(n.sucursalId) ?? new Set<string>();
      set.add(normalizarNombre(n.nombre));
      catalogo.set(n.sucursalId, set);
    }
    const filas = vendidosSinCatalogo(
      vendidos.map((v) => ({
        sucursalId: v.sucursal_id,
        producto: v.producto,
        partidas: v.partidas,
        cantidad: new Prisma.Decimal(v.cantidad as Prisma.Decimal.Value),
        importe: new Prisma.Decimal(v.importe as Prisma.Decimal.Value),
      })),
      catalogo,
      conCatalogo,
    );
    const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));
    return {
      filas: filas.slice(0, MAX_SIN_CATALOGO).map((f) => ({
        sucursalId: f.sucursalId,
        sucursal: nombreSucursal.get(f.sucursalId) ?? '',
        producto: f.producto,
        variantes: f.variantes,
        partidas: f.partidas,
        cantidad: f.cantidad.toFixed(3),
        importe: f.importe.toFixed(2, Prisma.Decimal.ROUND_HALF_UP),
      })),
      total: filas.length,
      truncado: filas.length > MAX_SIN_CATALOGO,
      sucursalesSinCatalogo: sucursales
        .filter((s) => !conCatalogo.has(s.id))
        .map((s) => ({ sucursalId: s.id, sucursal: s.nombre })),
    };
  }

  /**
   * Meseros (F2-231): el rendimiento del periodo por mesero, ligado con el espejo de meseros.
   * Las cifras son las de Análisis (`porMeseroConSegundos`, por el helper de agregados: empresa
   * o sucursal fuera del scope = 404 ANTES de leer nada más); el espejo, las sucursales y su
   * sincronización se leen por `datos.para(scope)` con la empresa (y la sucursal) del filtro.
   */
  async rendimientoMeseros(
    scope: EmpresaScope,
    filtro: { empresaId: string; sucursalId?: string; desde: string; hasta: string },
  ): Promise<RendimientoMeseros> {
    const ventas = await this.analisis.porMeseroConSegundos(scope, filtro);
    const datos = this.datos.para(scope);
    const deLaSucursal = filtro.sucursalId ? { sucursalId: filtro.sucursalId } : {};
    const [sucursales, sincronizadas, catalogo] = await Promise.all([
      datos.sucursal.findMany({
        where: {
          empresaId: filtro.empresaId,
          ...(filtro.sucursalId ? { id: filtro.sucursalId } : {}),
        },
        select: { id: true, nombre: true },
      }),
      datos.sincronizacionCatalogo.findMany({
        where: {
          empresaId: filtro.empresaId,
          catalogo: 'meseros',
          ...deLaSucursal,
        },
        select: { sucursalId: true },
      }),
      // Todos los estados: un mesero dado de baja sigue siendo quien atendió en su periodo.
      datos.meseroCatalogo.findMany({
        where: { empresaId: filtro.empresaId, ...deLaSucursal },
        select: {
          id: true,
          sucursalId: true,
          clave: true,
          nombre: true,
          activo: true,
          activoPos: true,
          vistoAt: true,
        },
        orderBy: [{ sucursalId: 'asc' }, { nombre: 'asc' }, { id: 'asc' }],
        take: MAX_CATALOGO_MESEROS + 1,
      }),
    ]);
    const sincronizado = new Set(sincronizadas.map((s) => s.sucursalId));
    return rendimientoMeseros({
      ventas,
      catalogo: catalogo.slice(0, MAX_CATALOGO_MESEROS),
      catalogoTruncado: catalogo.length > MAX_CATALOGO_MESEROS,
      sucursales: sucursales.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        sincronizado: sincronizado.has(s.id),
      })),
    });
  }

  /**
   * Clientes (F2-232): la lista del periodo, ligada con el espejo. Las cifras salen de las CTEs
   * `ventas` y `cancelados` del helper de scope (empresa o sucursal fuera del scope = 404 ANTES
   * de leer nada más); el espejo, las sucursales y su sincronización, de `datos.para(scope)` con
   * la empresa (y la sucursal) del filtro. `q` se aplica EN CÓDIGO: el texto buscado (que puede
   * ser un nombre) no viaja a ninguna consulta ni a ningún log.
   */
  async resumenClientes(
    scope: EmpresaScope,
    filtro: { empresaId: string; sucursalId?: string; desde: string; hasta: string },
    opciones: { q?: string; pagina: number; porPagina: number; contacto: boolean },
  ): Promise<ResumenClientes> {
    const q = await this.agregados.consulta(scope, filtro);
    const [cifras, cuentas] = await Promise.all([
      this.cifrasClientes(q),
      q.consultar<{ sucursal_id: string; cuentas: number; con_cliente: number }>(
        Prisma.sql`SELECT sucursal_id, count(*)::int AS cuentas,
          count(cliente_origen_sr_id)::int AS con_cliente
        FROM ventas GROUP BY sucursal_id`,
      ),
    ]);
    const datos = this.datos.para(scope);
    const deLaSucursal = filtro.sucursalId ? { sucursalId: filtro.sucursalId } : {};
    const seleccion = {
      id: true,
      sucursalId: true,
      origenSrId: true,
      clave: true,
      nombre: true,
      activo: true,
      activoPos: true,
      vistoAt: true,
      telefono: opciones.contacto,
      correo: opciones.contacto,
      rfc: opciones.contacto,
    };
    const [sucursales, sincronizadas, activos, lista, ligados] = await Promise.all([
      datos.sucursal.findMany({
        where: {
          empresaId: filtro.empresaId,
          ...(filtro.sucursalId ? { id: filtro.sucursalId } : {}),
        },
        select: { id: true, nombre: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      datos.sincronizacionCatalogo.findMany({
        where: { empresaId: filtro.empresaId, catalogo: 'clientes', ...deLaSucursal },
        select: { sucursalId: true },
      }),
      datos.clienteCatalogo.groupBy({
        by: ['sucursalId'],
        where: { empresaId: filtro.empresaId, activo: true, ...deLaSucursal },
        _count: { _all: true },
      }),
      // La lista (los vigentes; los dados de baja sólo entran por `ligados`), con tope.
      datos.clienteCatalogo.findMany({
        where: { empresaId: filtro.empresaId, activo: true, ...deLaSucursal },
        select: seleccion,
        orderBy: [{ sucursalId: 'asc' }, { nombre: 'asc' }, { id: 'asc' }],
        take: MAX_CATALOGO_CLIENTES + 1,
      }),
      // Los registros de los ids que traen las cuentas, SIN el tope de la lista: así un id sólo
      // sale "sin ficha" si de verdad no está en el espejo.
      this.clientesDe(datos, filtro.empresaId, cifras, seleccion),
    ]);
    const sincronizado = new Set(sincronizadas.map((s) => s.sucursalId));
    const activosDe = new Map(activos.map((a) => [a.sucursalId, a._count._all]));
    const cuentasDe = new Map(cuentas.map((c) => [c.sucursal_id, c]));
    return resumenClientes({
      cifras,
      clientes: [...lista.slice(0, MAX_CATALOGO_CLIENTES), ...ligados],
      catalogoTruncado: lista.length > MAX_CATALOGO_CLIENTES,
      sucursales: sucursales.map((s) => ({
        id: s.id,
        nombre: s.nombre,
        sincronizado: sincronizado.has(s.id),
        clientesActivos: activosDe.get(s.id) ?? 0,
        cuentas: cuentasDe.get(s.id)?.cuentas ?? 0,
        cuentasConCliente: cuentasDe.get(s.id)?.con_cliente ?? 0,
      })),
      q: opciones.q,
      pagina: opciones.pagina,
      porPagina: opciones.porPagina,
      contacto: opciones.contacto,
    });
  }

  /**
   * La ficha de UN cliente (F2-232): su registro del espejo con sus datos de contacto, sus
   * cifras del periodo en SU sucursal y lo que más pide. Id ajeno o inexistente = el mismo 404.
   */
  async fichaCliente(
    scope: EmpresaScope,
    id: string,
    filtro: { empresaId: string; desde: string; hasta: string },
  ): Promise<FichaCliente> {
    // Valida el filtro (400) y la empresa (404) antes de buscar al cliente.
    await this.agregados.consulta(scope, filtro);
    const datos = this.datos.para(scope);
    const c = encontradoOr404(
      await datos.clienteCatalogo.findFirst({
        where: { id, empresaId: filtro.empresaId },
        select: {
          id: true,
          sucursalId: true,
          origenSrId: true,
          clave: true,
          nombre: true,
          telefono: true,
          correo: true,
          rfc: true,
          activo: true,
          activoPos: true,
          vistoAt: true,
          sucursal: { select: { nombre: true } },
        },
      }),
    );
    const q = await this.agregados.consulta(scope, { ...filtro, sucursalId: c.sucursalId });
    const origen = c.origenSrId;
    const [cifras, productos] = await Promise.all([
      this.cifrasClientes(q, origen),
      q.consultar<{ producto: string; cantidad: unknown; importe: unknown; cuentas: number }>(
        Prisma.sql`SELECT p.producto, sum(p.cantidad) AS cantidad, sum(p.total) AS importe,
          count(DISTINCT p.cheque_id)::int AS cuentas
        FROM partidas_ventas p
        JOIN ventas v ON v.id = p.cheque_id AND v.empresa_id = p.empresa_id
        WHERE v.cliente_origen_sr_id = ${origen}
        GROUP BY p.producto
        ORDER BY sum(p.cantidad) DESC, sum(p.total) DESC, p.producto COLLATE ucs_basic
        LIMIT ${MAX_PRODUCTOS_FICHA}`,
      ),
    ]);
    const dec = (v: unknown) => new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value);
    return {
      cliente: {
        id: c.id,
        sucursalId: c.sucursalId,
        sucursal: c.sucursal.nombre,
        origenSrId: c.origenSrId,
        clave: c.clave,
        nombre: c.nombre,
        telefono: c.telefono,
        correo: c.correo,
        rfc: c.rfc,
        activo: c.activo,
        activoPos: c.activoPos,
        vistoAt: c.vistoAt.toISOString(),
      },
      periodo: cifrasDe(cifras[0]),
      productos: productos.map((p) => ({
        producto: p.producto,
        cantidad: dec(p.cantidad).toFixed(3),
        importe: dec(p.importe).toFixed(2, Prisma.Decimal.ROUND_HALF_UP),
        cuentas: p.cuentas,
      })),
    };
  }

  /**
   * Visitas, venta y canceladas del periodo por (sucursal, id del cliente en el POS), de las
   * CTEs con scope. Con `origen`, sólo las de ese id (la ficha ya fijó la sucursal).
   */
  private async cifrasClientes(q: ConsultaVentas, origen?: string): Promise<CifrasClienteLeidas[]> {
    const deQuien =
      origen === undefined
        ? Prisma.sql`cliente_origen_sr_id IS NOT NULL`
        : Prisma.sql`cliente_origen_sr_id = ${origen}`;
    const filas = await q.consultar<{
      sucursal_id: string;
      origen: string;
      visitas: number;
      venta: unknown;
      ultima: Date | null;
      canceladas: number;
      monto_cancelado: unknown;
    }>(Prisma.sql`SELECT sucursal_id, origen,
        sum(visitas)::int AS visitas, sum(venta) AS venta, max(ultima) AS ultima,
        sum(canceladas)::int AS canceladas, sum(monto_cancelado) AS monto_cancelado
      FROM (
        SELECT sucursal_id, cliente_origen_sr_id AS origen, count(*) AS visitas,
          sum(total) AS venta, max(cerrado_at) AS ultima,
          0 AS canceladas, 0::numeric AS monto_cancelado
        FROM ventas WHERE ${deQuien} GROUP BY sucursal_id, cliente_origen_sr_id
        UNION ALL
        SELECT sucursal_id, cliente_origen_sr_id, 0, 0::numeric, NULL::timestamptz,
          count(*), sum(total)
        FROM cancelados WHERE ${deQuien} GROUP BY sucursal_id, cliente_origen_sr_id
      ) x
      GROUP BY sucursal_id, origen`);
    const dec = (v: unknown) => new Prisma.Decimal((v ?? 0) as Prisma.Decimal.Value);
    return filas.map((f) => ({
      sucursalId: f.sucursal_id,
      origenSrId: f.origen,
      visitas: f.visitas,
      venta: dec(f.venta),
      ultimaVisita: f.ultima,
      canceladas: f.canceladas,
      montoCancelado: dec(f.monto_cancelado),
    }));
  }

  /** Los registros del espejo de los ids de `cifras`, por lotes, con scope y como parámetros. */
  private async clientesDe<S extends Prisma.ClienteCatalogoSelect>(
    datos: DatosScoped,
    empresaId: string,
    cifras: readonly CifrasClienteLeidas[],
    select: S,
  ) {
    const lotes: Array<Array<{ sucursalId: string; origenSrId: string }>> = [];
    for (let i = 0; i < cifras.length; i += LOTE_CLIENTES) {
      lotes.push(
        cifras
          .slice(i, i + LOTE_CLIENTES)
          .map((c) => ({ sucursalId: c.sucursalId, origenSrId: c.origenSrId })),
      );
    }
    const leidos = await Promise.all(
      lotes.map((pares) =>
        datos.clienteCatalogo.findMany({ where: { empresaId, OR: pares }, select }),
      ),
    );
    return leidos.flat();
  }

  /**
   * Resuelve el grupo de insumo y la unidad de cada insumo en SU sucursal (F2-120; sin FK: por
   * texto, como el grupo del producto). Con el scope y la empresa en el WHERE: un grupo o una
   * unidad con el mismo `origenSrId` en otra sucursal (o empresa) no cuenta.
   */
  private async conGrupoYUnidad(
    datos: DatosScoped,
    empresaId: string,
    filas: ReadonlyArray<FilaComun & Record<string, unknown>>,
  ): Promise<FilaInsumoDto[]> {
    const pedidos = (col: 'grupoOrigenSrId' | 'unidadOrigenSrId') =>
      filas.flatMap((f) =>
        typeof f[col] === 'string' ? [{ sucursalId: f.sucursalId, origenSrId: f[col] }] : [],
      );
    const select = { sucursalId: true, origenSrId: true, nombre: true } as const;
    const pg = pedidos('grupoOrigenSrId');
    const pu = pedidos('unidadOrigenSrId');
    const [grupos, unidades] = await Promise.all([
      pg.length === 0 ? [] : datos.grupoInsumo.findMany({ where: { empresaId, OR: pg }, select }),
      pu.length === 0
        ? []
        : datos.unidadCatalogo.findMany({ where: { empresaId, OR: pu }, select }),
    ]);
    const llave = (sucursalId: string, origen: string) => `${sucursalId}|${origen}`;
    const nombreGrupo = new Map(grupos.map((g) => [llave(g.sucursalId, g.origenSrId), g.nombre]));
    const nombreUnidad = new Map(
      unidades.map((u) => [llave(u.sucursalId, u.origenSrId), u.nombre]),
    );
    return filas.map((f) => {
      const grupoOrigenSrId = (f.grupoOrigenSrId as string | null) ?? null;
      const unidadOrigenSrId = (f.unidadOrigenSrId as string | null) ?? null;
      return {
        ...vistaComun(f),
        grupoOrigenSrId,
        grupo: grupoOrigenSrId
          ? (nombreGrupo.get(llave(f.sucursalId, grupoOrigenSrId)) ?? null)
          : null,
        unidadOrigenSrId,
        unidad: unidadOrigenSrId
          ? (nombreUnidad.get(llave(f.sucursalId, unidadOrigenSrId)) ?? null)
          : null,
      };
    });
  }

  /** Resuelve el nombre del grupo de cada producto en SU sucursal (sin FK: por texto). */
  private async conGrupo(
    datos: DatosScoped,
    empresaId: string,
    filas: ReadonlyArray<FilaComun & Record<string, unknown>>,
  ): Promise<FilaProductoDto[]> {
    const pedidos = filas.flatMap((f) =>
      typeof f.grupoOrigenSrId === 'string'
        ? [{ sucursalId: f.sucursalId, origenSrId: f.grupoOrigenSrId }]
        : [],
    );
    const grupos =
      pedidos.length === 0
        ? []
        : await datos.grupoProducto.findMany({
            where: { empresaId, OR: pedidos },
            select: { sucursalId: true, origenSrId: true, nombre: true },
          });
    const nombre = new Map(grupos.map((g) => [`${g.sucursalId}|${g.origenSrId}`, g.nombre]));
    return filas.map((f) => {
      const grupoOrigenSrId = (f.grupoOrigenSrId as string | null) ?? null;
      return {
        ...vistaComun(f),
        grupoOrigenSrId,
        grupo: grupoOrigenSrId ? (nombre.get(`${f.sucursalId}|${grupoOrigenSrId}`) ?? null) : null,
        precio: (f.precio as Prisma.Decimal | null | undefined)?.toFixed(2) ?? null,
        tieneMetadata: f.metadata !== null && f.metadata !== undefined,
      };
    });
  }
}
