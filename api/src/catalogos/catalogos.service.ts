import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type CatalogoSr } from '@prisma/client';

import { Reloj } from '../comun/reloj';
import { Auditoria, type Actor } from '../comun/auditoria';
import { CATALOGOS, solicitudPendiente } from '../ingesta/catalogos';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService, type DatosScoped } from '../scope/scoped-prisma.service';
import { AgregadosVentasService } from '../ventas/agregados-ventas.service';
import {
  agruparMenu,
  MAX_FILAS_MENU,
  MAX_SIN_CATALOGO,
  normalizarNombre,
  vendidosSinCatalogo,
} from './menu';
import type {
  DetalleProductoDto,
  MenuDto,
  VendidosSinCatalogoDto,
  EstadoFiltro,
  FilaCatalogoDto,
  FilaClienteDto,
  FilaProductoDto,
  GuardarMetadataDto,
  SincronizacionSucursalDto,
} from './dto/catalogos.dto';

export const POR_PAGINA = 50;

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

/** Columnas comunes que se leen de las seis tablas espejo. */
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

/** La forma común de los seis delegados CON scope que usa la lectura. */
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
  ) {}

  async listar(
    scope: EmpresaScope,
    catalogo: CatalogoSr,
    f: FiltroCatalogo,
  ): Promise<Pagina<FilaCatalogoDto | FilaProductoDto | FilaClienteDto>> {
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
