import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, type EstadoConteo } from '@prisma/client';

import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { encontradoOr404 } from '../scope/scope.helper';
import { diferenciaDe, totalesDe } from './conteos';
import type {
  CapturaRespuestaDto,
  CapturarConteoDto,
  ConteoDetalleDto,
  ConteoResumenDto,
  ConteosDto,
  ConteosQueryDto,
  CrearConteoDto,
  PartidaConteoDto,
} from './dto/conteos.dto';
import { atrasada, LECTURA_ATRASADA_MS } from './existencias';

/** Cuántos conteos devuelve la lista (los más recientes). */
export const MAX_CONTEOS_LISTA = 200;

const deSucursal = (sucursalId: string, origen: string) => JSON.stringify([sucursalId, origen]);
const cant = (v: Prisma.Decimal | null) => v?.toFixed(3) ?? null;
const pesos = (v: Prisma.Decimal | null) => v?.toFixed(2) ?? null;

interface CabeceraConteo {
  id: string;
  folio: number;
  sucursalId: string;
  almacenOrigenSrId: string;
  grupoOrigenSrId: string | null;
  nota: string | null;
  estado: EstadoConteo;
  teoricoCapturadoAt: Date;
  createdAt: Date;
  cerradoAt: Date | null;
  canceladoAt: Date | null;
}

const SELECT_CABECERA = {
  id: true,
  folio: true,
  sucursalId: true,
  almacenOrigenSrId: true,
  grupoOrigenSrId: true,
  nota: true,
  estado: true,
  teoricoCapturadoAt: true,
  createdAt: true,
  cerradoAt: true,
  canceladoAt: true,
} as const;

/**
 * Conteos físicos (F2-123). Todo por el helper de scope: la empresa (y la sucursal, si viene) se
 * verifica con el scope del usuario y va en el WHERE de cada consulta; las escrituras van por
 * `datos.conteos(scope)`. Fuera de alcance = 404, nunca 403. Nada de esto se escribe a
 * SoftRestaurant: el reporte de diferencias es para que el encargado ajuste en SR.
 */
@Injectable()
export class ConteosService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
  ) {}

  async listar(scope: EmpresaScope, q: ConteosQueryDto): Promise<ConteosDto> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, q.empresaId, q.sucursalId);
    const ahora = this.reloj.ahora();
    const deLasSucursales = {
      empresaId: q.empresaId,
      ...(q.sucursalId ? { sucursalId: q.sucursalId } : {}),
    };
    const delFiltro = { ...deLasSucursales, ...(q.estado ? { estado: q.estado } : {}) };
    const [sucursales, total, conteos, almacenes, lecturas, grupos] = await Promise.all([
      datos.sucursal.findMany({
        where: { empresaId: q.empresaId, ...(q.sucursalId ? { id: q.sucursalId } : {}) },
        select: { id: true, nombre: true, zonaHoraria: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      datos.conteoFisico.count({ where: delFiltro }),
      datos.conteoFisico.findMany({
        where: delFiltro,
        select: SELECT_CABECERA,
        orderBy: [{ createdAt: 'desc' }, { folio: 'desc' }],
        take: MAX_CONTEOS_LISTA,
      }),
      datos.almacenCatalogo.findMany({
        where: deLasSucursales,
        select: { sucursalId: true, origenSrId: true, nombre: true, activo: true },
      }),
      datos.lecturaExistencias.findMany({
        where: deLasSucursales,
        select: { sucursalId: true, almacenOrigenSrId: true, capturadoAt: true, recibidaAt: true },
      }),
      datos.grupoInsumo.findMany({
        where: { ...deLasSucursales, activo: true },
        select: { sucursalId: true, origenSrId: true, nombre: true },
        orderBy: [{ nombre: 'asc' }, { origenSrId: 'asc' }],
      }),
    ]);
    const ids = conteos.map((c) => c.id);
    const [articulos, contados] =
      ids.length === 0
        ? [[], []]
        : await Promise.all([
            datos.partidaConteo.groupBy({
              by: ['conteoId'],
              where: { empresaId: q.empresaId, conteoId: { in: ids } },
              _count: { _all: true },
            }),
            datos.partidaConteo.groupBy({
              by: ['conteoId'],
              where: { empresaId: q.empresaId, conteoId: { in: ids }, contado: { not: null } },
              _count: { _all: true },
            }),
          ]);
    const articulosDe = new Map(articulos.map((a) => [a.conteoId, a._count._all]));
    const contadosDe = new Map(contados.map((a) => [a.conteoId, a._count._all]));

    const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));
    const nombreAlmacen = new Map(
      almacenes.map((a) => [deSucursal(a.sucursalId, a.origenSrId), a.nombre]),
    );
    const nombreGrupo = new Map(
      grupos.map((g) => [deSucursal(g.sucursalId, g.origenSrId), g.nombre]),
    );
    const faltantes = conteos.filter(
      (c) => c.grupoOrigenSrId && !nombreGrupo.has(deSucursal(c.sucursalId, c.grupoOrigenSrId)),
    );
    // Un conteo por un grupo que ya no está activo sigue mostrando su nombre.
    if (faltantes.length > 0) {
      const extra = await datos.grupoInsumo.findMany({
        where: {
          ...deLasSucursales,
          origenSrId: { in: [...new Set(faltantes.map((c) => c.grupoOrigenSrId!))] },
        },
        select: { sucursalId: true, origenSrId: true, nombre: true },
      });
      for (const g of extra) nombreGrupo.set(deSucursal(g.sucursalId, g.origenSrId), g.nombre);
    }

    const lecturaDe = new Map(
      lecturas.map((l) => [deSucursal(l.sucursalId, l.almacenOrigenSrId), l]),
    );
    const claves = new Set([
      ...lecturas.map((l) => deSucursal(l.sucursalId, l.almacenOrigenSrId)),
      ...almacenes.filter((a) => a.activo).map((a) => deSucursal(a.sucursalId, a.origenSrId)),
    ]);
    const listaAlmacenes = [...claves]
      .map((k) => {
        const [sucursalId, almacenOrigenSrId] = JSON.parse(k) as [string, string];
        const l = lecturaDe.get(k) ?? null;
        return {
          sucursalId,
          almacenOrigenSrId,
          almacen: nombreAlmacen.get(k) ?? null,
          capturadoAt: l?.capturadoAt.toISOString() ?? null,
          atrasada: atrasada(l?.recibidaAt ?? null, ahora),
        };
      })
      .sort(
        (a, b) =>
          (nombreSucursal.get(a.sucursalId) ?? '').localeCompare(
            nombreSucursal.get(b.sucursalId) ?? '',
            'es',
          ) ||
          (a.almacen ?? a.almacenOrigenSrId).localeCompare(b.almacen ?? b.almacenOrigenSrId, 'es'),
      );

    return {
      conteos: conteos.map((c) =>
        this.#resumen(c, {
          sucursal: nombreSucursal.get(c.sucursalId) ?? '',
          almacen: nombreAlmacen.get(deSucursal(c.sucursalId, c.almacenOrigenSrId)) ?? null,
          grupo: c.grupoOrigenSrId
            ? (nombreGrupo.get(deSucursal(c.sucursalId, c.grupoOrigenSrId)) ?? null)
            : null,
          articulos: articulosDe.get(c.id) ?? 0,
          contados: contadosDe.get(c.id) ?? 0,
        }),
      ),
      total,
      almacenes: listaAlmacenes,
      grupos: grupos.map((g) => ({
        sucursalId: g.sucursalId,
        grupoOrigenSrId: g.origenSrId,
        grupo: g.nombre,
      })),
      sucursales: sucursales.map((s) => ({
        sucursalId: s.id,
        sucursal: s.nombre,
        zonaHoraria: s.zonaHoraria,
      })),
    };
  }

  /**
   * Un conteo con sus renglones y el reporte de diferencias. Conteo de otra empresa, fuera de
   * alcance o inexistente = el mismo 404.
   */
  async detalle(scope: EmpresaScope, id: string, empresaId: string): Promise<ConteoDetalleDto> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId);
    const c = encontradoOr404(
      await datos.conteoFisico.findFirst({ where: { id, empresaId }, select: SELECT_CABECERA }),
    );
    const deLaSucursal = { empresaId, sucursalId: c.sucursalId };
    const [sucursal, almacen, partidas] = await Promise.all([
      datos.sucursal.findFirst({
        where: { id: c.sucursalId, empresaId },
        select: { nombre: true, zonaHoraria: true },
      }),
      datos.almacenCatalogo.findFirst({
        where: { ...deLaSucursal, origenSrId: c.almacenOrigenSrId },
        select: { nombre: true },
      }),
      datos.partidaConteo.findMany({
        where: { ...deLaSucursal, conteoId: c.id },
        select: {
          insumoOrigenSrId: true,
          teorico: true,
          costoPromedio: true,
          contado: true,
          capturadoAt: true,
        },
      }),
    ]);
    const insumos =
      partidas.length === 0
        ? []
        : await datos.insumo.findMany({
            where: { ...deLaSucursal, origenSrId: { in: partidas.map((p) => p.insumoOrigenSrId) } },
            select: {
              origenSrId: true,
              nombre: true,
              clave: true,
              unidadOrigenSrId: true,
              grupoOrigenSrId: true,
            },
          });
    const unidadesPedidas = [
      ...new Set(insumos.flatMap((i) => (i.unidadOrigenSrId ? [i.unidadOrigenSrId] : []))),
    ];
    const gruposPedidos = [
      ...new Set([
        ...insumos.flatMap((i) => (i.grupoOrigenSrId ? [i.grupoOrigenSrId] : [])),
        ...(c.grupoOrigenSrId ? [c.grupoOrigenSrId] : []),
      ]),
    ];
    const [unidades, grupos] = await Promise.all([
      unidadesPedidas.length === 0
        ? []
        : datos.unidadCatalogo.findMany({
            where: { ...deLaSucursal, origenSrId: { in: unidadesPedidas } },
            select: { origenSrId: true, nombre: true },
          }),
      gruposPedidos.length === 0
        ? []
        : datos.grupoInsumo.findMany({
            where: { ...deLaSucursal, origenSrId: { in: gruposPedidos } },
            select: { origenSrId: true, nombre: true },
          }),
    ]);
    const insumoDe = new Map(insumos.map((i) => [i.origenSrId, i]));
    const unidadDe = new Map(unidades.map((u) => [u.origenSrId, u.nombre]));
    const grupoDe = new Map(grupos.map((g) => [g.origenSrId, g.nombre]));

    const renglones = partidas.map((p) => {
      const i = insumoDe.get(p.insumoOrigenSrId);
      const d = diferenciaDe(p);
      return {
        d,
        vista: {
          insumoOrigenSrId: p.insumoOrigenSrId,
          insumo: i?.nombre ?? null,
          clave: i?.clave ?? null,
          unidad: i?.unidadOrigenSrId ? (unidadDe.get(i.unidadOrigenSrId) ?? null) : null,
          grupo: i?.grupoOrigenSrId ? (grupoDe.get(i.grupoOrigenSrId) ?? null) : null,
          teorico: cant(p.teorico),
          costoPromedio: pesos(p.costoPromedio),
          contado: cant(p.contado),
          estado: d.estado,
          diferencia: cant(d.unidades),
          importe: pesos(d.importe),
          capturadoAt: p.capturadoAt?.toISOString() ?? null,
        } satisfies PartidaConteoDto,
      };
    });
    const nombre = (v: PartidaConteoDto) => v.insumo ?? v.insumoOrigenSrId;
    renglones.sort(
      (a, b) =>
        nombre(a.vista).localeCompare(nombre(b.vista), 'es') ||
        a.vista.insumoOrigenSrId.localeCompare(b.vista.insumoOrigenSrId, 'es'),
    );
    const totales = totalesDe(renglones.map((r) => r.d));
    return {
      conteo: this.#resumen(c, {
        sucursal: sucursal?.nombre ?? '',
        almacen: almacen?.nombre ?? null,
        grupo: c.grupoOrigenSrId ? (grupoDe.get(c.grupoOrigenSrId) ?? null) : null,
        articulos: totales.articulos,
        contados: totales.contados,
      }),
      zonaHoraria: sucursal?.zonaHoraria ?? 'America/Mexico_City',
      partidas: renglones.map((r) => r.vista),
      totales,
    };
  }

  async crear(actor: Actor, scope: EmpresaScope, dto: CrearConteoDto): Promise<ConteoDetalleDto> {
    // 404 con el scope del USUARIO antes de escribir (la escritura lo vuelve a verificar).
    await verificarAlcance(this.datos.para(scope), dto.empresaId, dto.sucursalId);
    const id = await this.datos.conteos(scope).crear(
      {
        empresaId: dto.empresaId,
        sucursalId: dto.sucursalId,
        almacenOrigenSrId: dto.almacenOrigenSrId,
        grupoOrigenSrId: dto.grupoOrigenSrId ?? null,
        nota: dto.nota?.trim() || null,
      },
      actor.id,
      new Date(this.reloj.ahora()),
    );
    this.auditoria.registrar(actor, {
      accion: 'conteo.crear',
      recurso: 'conteo',
      recursoId: id,
      empresaId: dto.empresaId,
    });
    return this.detalle(scope, id, dto.empresaId);
  }

  async capturar(
    actor: Actor,
    scope: EmpresaScope,
    id: string,
    dto: CapturarConteoDto,
  ): Promise<CapturaRespuestaDto> {
    const repetidos = dto.partidas.filter(
      (p, i) => dto.partidas.findIndex((x) => x.insumoOrigenSrId === p.insumoOrigenSrId) !== i,
    );
    if (repetidos.length > 0) {
      // Dos valores del mismo renglón en un lote: no hay cuál gane. Nada se guarda.
      throw new BadRequestException('Un artículo viene repetido en el lote; no se guardó nada.');
    }
    const capturas = dto.partidas.map((p) => ({
      insumoOrigenSrId: p.insumoOrigenSrId,
      contado: p.contado === null ? null : new Prisma.Decimal(p.contado),
    }));
    await verificarAlcance(this.datos.para(scope), dto.empresaId);
    await this.datos
      .conteos(scope)
      .capturar(dto.empresaId, id, capturas, actor.id, new Date(this.reloj.ahora()));
    return {
      guardadas: capturas.map((c) => ({
        insumoOrigenSrId: c.insumoOrigenSrId,
        contado: cant(c.contado),
      })),
    };
  }

  async cerrar(
    actor: Actor,
    scope: EmpresaScope,
    id: string,
    empresaId: string,
  ): Promise<ConteoDetalleDto> {
    await verificarAlcance(this.datos.para(scope), empresaId);
    await this.datos.conteos(scope).cerrar(empresaId, id, actor.id, new Date(this.reloj.ahora()));
    this.auditoria.registrar(actor, {
      accion: 'conteo.cerrar',
      recurso: 'conteo',
      recursoId: id,
      empresaId,
    });
    return this.detalle(scope, id, empresaId);
  }

  async cancelar(
    actor: Actor,
    scope: EmpresaScope,
    id: string,
    empresaId: string,
  ): Promise<ConteoDetalleDto> {
    await verificarAlcance(this.datos.para(scope), empresaId);
    await this.datos.conteos(scope).cancelar(empresaId, id, actor.id, new Date(this.reloj.ahora()));
    this.auditoria.registrar(actor, {
      accion: 'conteo.cancelar',
      recurso: 'conteo',
      recursoId: id,
      empresaId,
    });
    return this.detalle(scope, id, empresaId);
  }

  #resumen(
    c: CabeceraConteo,
    extra: {
      sucursal: string;
      almacen: string | null;
      grupo: string | null;
      articulos: number;
      contados: number;
    },
  ): ConteoResumenDto {
    return {
      id: c.id,
      folio: c.folio,
      sucursalId: c.sucursalId,
      sucursal: extra.sucursal,
      almacenOrigenSrId: c.almacenOrigenSrId,
      almacen: extra.almacen,
      grupoOrigenSrId: c.grupoOrigenSrId,
      grupo: extra.grupo,
      nota: c.nota,
      estado: c.estado,
      teoricoCapturadoAt: c.teoricoCapturadoAt.toISOString(),
      // DECISION PROVISIONAL (nocturno): la foto congelada "iba atrasada" si al crear el conteo
      // tenía más de 90 min (la misma regla de F2-121, aquí contra el corte de la foto).
      teoricoAtrasado: c.createdAt.getTime() - c.teoricoCapturadoAt.getTime() > LECTURA_ATRASADA_MS,
      creadoAt: c.createdAt.toISOString(),
      cerradoAt: c.cerradoAt?.toISOString() ?? null,
      canceladoAt: c.canceladoAt?.toISOString() ?? null,
      articulos: extra.articulos,
      contados: extra.contados,
    };
  }
}
