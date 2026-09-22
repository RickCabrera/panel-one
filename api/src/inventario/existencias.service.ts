import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import type {
  ExistenciasDto,
  ExistenciasQueryDto,
  FilaExistenciaDto,
  GuardarLimitesDto,
} from './dto/existencias.dto';
import { atrasada, estadoDe, kpisDe } from './existencias';

/**
 * DECISION PROVISIONAL (nocturno): tope de filas de una consulta de Existencias. El tamaño real
 * es sucursales × almacenes × insumos (cientos a pocos miles); pasar de aquí pide filtrar por
 * sucursal en vez de mandar una respuesta enorme.
 */
export const MAX_FILAS_EXISTENCIAS = 50_000;

type D = Prisma.Decimal;

const llave = (sucursalId: string, almacen: string, insumo: string) =>
  JSON.stringify([sucursalId, almacen, insumo]);
const deSucursal = (sucursalId: string, origen: string) => JSON.stringify([sucursalId, origen]);
const texto = (v: D | null) => v?.toFixed(3) ?? null;

/**
 * Existencias (F2-121): la última foto de cada almacén, cruzada con los catálogos espejo
 * (nombres) y con los límites propios del panel. Todo por el helper de scope: la empresa (y la
 * sucursal, si viene) se verifica con el scope del usuario y va en el WHERE de cada consulta.
 * Fuera de alcance = 404, nunca 403. Nada de esto se escribe a SoftRestaurant.
 */
@Injectable()
export class ExistenciasService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
  ) {}

  async listar(scope: EmpresaScope, q: ExistenciasQueryDto): Promise<ExistenciasDto> {
    if (q.almacenOrigenSrId !== undefined && q.sucursalId === undefined) {
      throw new BadRequestException('almacenOrigenSrId exige sucursalId.');
    }
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, q.empresaId, q.sucursalId);
    const ahora = this.reloj.ahora();
    const deLasSucursales = {
      empresaId: q.empresaId,
      ...(q.sucursalId ? { sucursalId: q.sucursalId } : {}),
    };
    const delFiltro = {
      ...deLasSucursales,
      ...(q.almacenOrigenSrId ? { almacenOrigenSrId: q.almacenOrigenSrId } : {}),
    };

    const total = await datos.existencia.count({ where: delFiltro });
    if (total > MAX_FILAS_EXISTENCIAS) {
      throw new BadRequestException(
        `Más de ${MAX_FILAS_EXISTENCIAS} artículos: filtra por sucursal o almacén.`,
      );
    }
    const [sucursales, existencias, limites, lecturas, almacenes] = await Promise.all([
      datos.sucursal.findMany({
        where: { empresaId: q.empresaId, ...(q.sucursalId ? { id: q.sucursalId } : {}) },
        select: { id: true, nombre: true, zonaHoraria: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      datos.existencia.findMany({
        where: delFiltro,
        select: {
          sucursalId: true,
          almacenOrigenSrId: true,
          insumoOrigenSrId: true,
          cantidad: true,
          costoPromedio: true,
          valor: true,
        },
      }),
      datos.limiteExistencia.findMany({
        where: delFiltro,
        select: {
          sucursalId: true,
          almacenOrigenSrId: true,
          insumoOrigenSrId: true,
          minimo: true,
          maximo: true,
        },
      }),
      datos.lecturaExistencias.findMany({
        where: deLasSucursales,
        select: { sucursalId: true, almacenOrigenSrId: true, capturadoAt: true, recibidaAt: true },
      }),
      datos.almacenCatalogo.findMany({
        where: deLasSucursales,
        select: { sucursalId: true, origenSrId: true, nombre: true, activo: true },
      }),
    ]);

    const insumosPedidos = [
      ...new Set([...existencias, ...limites].map((f) => f.insumoOrigenSrId)),
    ];
    const insumos =
      insumosPedidos.length === 0
        ? []
        : await datos.insumo.findMany({
            where: { ...deLasSucursales, origenSrId: { in: insumosPedidos } },
            select: {
              sucursalId: true,
              origenSrId: true,
              nombre: true,
              clave: true,
              unidadOrigenSrId: true,
            },
          });
    const unidadesPedidas = [
      ...new Set(insumos.flatMap((i) => (i.unidadOrigenSrId ? [i.unidadOrigenSrId] : []))),
    ];
    const unidades =
      unidadesPedidas.length === 0
        ? []
        : await datos.unidadCatalogo.findMany({
            where: { ...deLasSucursales, origenSrId: { in: unidadesPedidas } },
            select: { sucursalId: true, origenSrId: true, nombre: true },
          });

    const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));
    const nombreAlmacen = new Map(
      almacenes.map((a) => [deSucursal(a.sucursalId, a.origenSrId), a.nombre]),
    );
    const insumoDe = new Map(insumos.map((i) => [deSucursal(i.sucursalId, i.origenSrId), i]));
    const unidadDe = new Map(
      unidades.map((u) => [deSucursal(u.sucursalId, u.origenSrId), u.nombre]),
    );
    const limiteDe = new Map(
      limites.map((l) => [llave(l.sucursalId, l.almacenOrigenSrId, l.insumoOrigenSrId), l]),
    );

    const fila = (
      sucursalId: string,
      almacen: string,
      insumo: string,
      e: { cantidad: D; costoPromedio: D; valor: D } | null,
    ) => {
      const l = limiteDe.get(llave(sucursalId, almacen, insumo));
      const i = insumoDe.get(deSucursal(sucursalId, insumo));
      const minimo = l?.minimo ?? null;
      const maximo = l?.maximo ?? null;
      return {
        vista: {
          sucursalId,
          sucursal: nombreSucursal.get(sucursalId) ?? '',
          almacenOrigenSrId: almacen,
          almacen: nombreAlmacen.get(deSucursal(sucursalId, almacen)) ?? null,
          insumoOrigenSrId: insumo,
          insumo: i?.nombre ?? null,
          clave: i?.clave ?? null,
          unidad: i?.unidadOrigenSrId
            ? (unidadDe.get(deSucursal(sucursalId, i.unidadOrigenSrId)) ?? null)
            : null,
          cantidad: texto(e?.cantidad ?? null),
          costoPromedio: e?.costoPromedio.toFixed(2) ?? null,
          valor: e?.valor.toFixed(2) ?? null,
          minimo: texto(minimo),
          maximo: texto(maximo),
          estado: estadoDe(e?.cantidad ?? null, minimo, maximo),
        } satisfies FilaExistenciaDto,
        valor: e?.valor ?? null,
      };
    };

    const conLectura = new Set(
      existencias.map((e) => llave(e.sucursalId, e.almacenOrigenSrId, e.insumoOrigenSrId)),
    );
    let filas = [
      ...existencias.map((e) => fila(e.sucursalId, e.almacenOrigenSrId, e.insumoOrigenSrId, e)),
      // Un límite cuyo artículo ya no viene en la foto: se muestra "sin lectura", no se oculta.
      ...limites
        .filter(
          (l) => !conLectura.has(llave(l.sucursalId, l.almacenOrigenSrId, l.insumoOrigenSrId)),
        )
        .map((l) => fila(l.sucursalId, l.almacenOrigenSrId, l.insumoOrigenSrId, null)),
    ];
    if (q.q) {
      const buscado = q.q.toLocaleLowerCase('es');
      filas = filas.filter((f) =>
        [f.vista.insumo, f.vista.clave, f.vista.insumoOrigenSrId].some(
          (v) => v !== null && v.toLocaleLowerCase('es').includes(buscado),
        ),
      );
    }
    const orden = (f: FilaExistenciaDto) => [
      f.sucursal,
      f.almacen ?? f.almacenOrigenSrId,
      f.insumo ?? f.insumoOrigenSrId,
      f.insumoOrigenSrId,
    ];
    filas.sort((a, b) => {
      const x = orden(a.vista);
      const y = orden(b.vista);
      for (let i = 0; i < x.length; i++) {
        const c = x[i].localeCompare(y[i], 'es');
        if (c !== 0) return c;
      }
      return 0;
    });

    // Los almacenes: los que tienen lectura y los del catálogo activos que todavía no la tienen.
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
          recibidaAt: l?.recibidaAt.toISOString() ?? null,
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
      kpis: kpisDe(filas.map((f) => ({ estado: f.vista.estado, valor: f.valor }))),
      filas: filas.map((f) => f.vista),
      almacenes: listaAlmacenes,
      sucursales: sucursales.map((s) => ({
        sucursalId: s.id,
        sucursal: s.nombre,
        zonaHoraria: s.zonaHoraria,
        almacenesLeidos: lecturas.filter((l) => l.sucursalId === s.id).length,
      })),
    };
  }

  /**
   * Guarda (o con los dos nulos borra) el mínimo y el máximo de un artículo en su almacén. Sólo
   * en Postgres: NUNCA se escribe a SoftRestaurant. Sucursal de otra empresa, fuera de alcance,
   * o un artículo sin existencia ni límite en ese almacén = el mismo 404.
   */
  async guardarLimites(
    actor: Actor,
    scope: EmpresaScope,
    dto: GuardarLimitesDto,
  ): Promise<FilaExistenciaDto> {
    const minimo = dto.minimo ? new Prisma.Decimal(dto.minimo) : null;
    const maximo = dto.maximo ? new Prisma.Decimal(dto.maximo) : null;
    if (minimo && maximo && minimo.greaterThan(maximo)) {
      throw new BadRequestException('minimo no puede ser mayor que maximo.');
    }
    // 404 con el scope del USUARIO antes de escribir (la escritura lo vuelve a verificar).
    await verificarAlcance(this.datos.para(scope), dto.empresaId, dto.sucursalId);
    await this.datos.existencias(scope).guardarLimites(
      {
        empresaId: dto.empresaId,
        sucursalId: dto.sucursalId,
        almacenOrigenSrId: dto.almacenOrigenSrId,
        insumoOrigenSrId: dto.insumoOrigenSrId,
      },
      minimo,
      maximo,
      actor.id,
      new Date(this.reloj.ahora()),
    );
    this.auditoria.registrar(actor, {
      accion: 'existencia_limites.editar',
      recurso: 'existencia',
      recursoId: `${dto.sucursalId}:${dto.almacenOrigenSrId}:${dto.insumoOrigenSrId}`,
      empresaId: dto.empresaId,
      campos: ['minimo', 'maximo'],
    });
    const r = await this.listar(scope, {
      empresaId: dto.empresaId,
      sucursalId: dto.sucursalId,
      almacenOrigenSrId: dto.almacenOrigenSrId,
    });
    const f = r.filas.find((x) => x.insumoOrigenSrId === dto.insumoOrigenSrId);
    // Se borraron los límites de un artículo sin lectura: ya no hay fila que mostrar.
    return (
      f ?? {
        sucursalId: dto.sucursalId,
        sucursal: r.sucursales[0]?.sucursal ?? '',
        almacenOrigenSrId: dto.almacenOrigenSrId,
        almacen: null,
        insumoOrigenSrId: dto.insumoOrigenSrId,
        insumo: null,
        clave: null,
        unidad: null,
        cantidad: null,
        costoPromedio: null,
        valor: null,
        minimo: null,
        maximo: null,
        estado: 'sin_lectura',
      }
    );
  }
}
