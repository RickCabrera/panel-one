import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { verificarAlcance } from '../scope/alcance';
import { MAX_DIAS_RANGO } from '../scope/consulta-ventas';
import type { EmpresaScope } from '../scope/empresa-scope';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService, type DatosScoped } from '../scope/scoped-prisma.service';
import {
  POR_PAGINA_MOVIMIENTOS,
  type FilaMovimientoDto,
  type KardexDto,
  type KardexQueryDto,
  type MovimientosDto,
  type MovimientosQueryDto,
  type PolizaDetalleDto,
} from './dto/movimientos.dto';
import { armarKardex, cuadreDe, limitesDelRango } from './kardex';

/**
 * DECISION PROVISIONAL (nocturno): tope de movimientos de UN kardex en el rango pedido. Un
 * artículo de alta rotación tiene unos pocos por día; pasar de aquí pide acortar el rango.
 */
export const MAX_MOVIMIENTOS_KARDEX = 10_000;

type D = Prisma.Decimal;
const CERO = new Prisma.Decimal(0);

const deSucursal = (sucursalId: string, origen: string) => JSON.stringify([sucursalId, origen]);
const cant = (v: D) => v.toFixed(3);

/** Un día `YYYY-MM-DD` real del calendario, en ms UTC, o null. */
function dia(texto: string): number | null {
  const ms = Date.parse(`${texto}T00:00:00Z`);
  return Number.isNaN(ms) || new Date(ms).toISOString().slice(0, 10) !== texto ? null : ms;
}

function validarRango(desde: string, hasta: string): void {
  const d = dia(desde);
  const h = dia(hasta);
  const errores: string[] = [];
  if (d === null) errores.push('desde debe ser una fecha YYYY-MM-DD válida');
  if (h === null) errores.push('hasta debe ser una fecha YYYY-MM-DD válida');
  if (d !== null && h !== null) {
    const dias = (h - d) / 86_400_000 + 1;
    if (dias < 1) errores.push('desde no puede ser posterior a hasta');
    else if (dias > MAX_DIAS_RANGO)
      errores.push(`el rango no puede pasar de ${MAX_DIAS_RANGO} días`);
  }
  if (errores.length > 0) throw new BadRequestException(errores);
}

const SELECT_MOVIMIENTO = {
  id: true,
  renglon: true,
  fecha: true,
  sucursalId: true,
  almacenOrigenSrId: true,
  insumoOrigenSrId: true,
  cantidad: true,
  costoUnitario: true,
  importe: true,
  poliza: { select: { id: true, folio: true, tipo: true, cancelada: true, referencia: true } },
} as const;

/** fecha → folio → renglón: el orden del kardex (y, al revés, el de la línea de tiempo). */
const ORDEN_ASC = [
  { fecha: 'asc' as const },
  { poliza: { folio: 'asc' as const } },
  { renglon: 'asc' as const },
  { id: 'asc' as const },
];
const ORDEN_DESC = [
  { fecha: 'desc' as const },
  { poliza: { folio: 'desc' as const } },
  { renglon: 'asc' as const },
  { id: 'asc' as const },
];

interface MovimientoLeido {
  id: string;
  renglon: number;
  fecha: Date;
  sucursalId: string;
  almacenOrigenSrId: string;
  insumoOrigenSrId: string;
  cantidad: D;
  costoUnitario: D;
  importe: D;
  poliza: FilaMovimientoDto['poliza'];
}

/**
 * Movimientos, pólizas y kardex (F2-122): lo que el agente mandó por `POST
 * /ingesta/movimientos`, cruzado con los catálogos espejo (nombres). Todo por el helper de scope:
 * la empresa (y la sucursal, si viene) se verifica con el scope del usuario y va en el WHERE de
 * cada consulta, sumas incluidas (`aggregate`/`groupBy` del cliente con scope, nunca SQL crudo).
 * Fuera de alcance = 404, nunca 403. Nada de esto se escribe a SoftRestaurant.
 */
@Injectable()
export class MovimientosService {
  constructor(private readonly datos: ScopedPrismaService) {}

  async listar(scope: EmpresaScope, q: MovimientosQueryDto): Promise<MovimientosDto> {
    if (
      (q.almacenOrigenSrId !== undefined || q.insumoOrigenSrId !== undefined) &&
      q.sucursalId === undefined
    ) {
      throw new BadRequestException('almacenOrigenSrId e insumoOrigenSrId exigen sucursalId.');
    }
    validarRango(q.desde, q.hasta);
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, q.empresaId, q.sucursalId);
    const pagina = q.pagina ?? 1;
    const porPagina = q.porPagina ?? POR_PAGINA_MOVIMIENTOS;
    const deLasSucursales = {
      empresaId: q.empresaId,
      ...(q.sucursalId ? { sucursalId: q.sucursalId } : {}),
    };

    const sucursales = await datos.sucursal.findMany({
      where: { empresaId: q.empresaId, ...(q.sucursalId ? { id: q.sucursalId } : {}) },
      select: { id: true, nombre: true, zonaHoraria: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
    // El rango se corta en la zona de CADA sucursal.
    const where = {
      ...deLasSucursales,
      ...(q.almacenOrigenSrId ? { almacenOrigenSrId: q.almacenOrigenSrId } : {}),
      ...(q.insumoOrigenSrId ? { insumoOrigenSrId: q.insumoOrigenSrId } : {}),
      ...(q.tipo ? { poliza: { tipo: q.tipo } } : {}),
      OR: sucursales.map((s) => {
        const { inicio, fin } = limitesDelRango(q.desde, q.hasta, s.zonaHoraria);
        return { sucursalId: s.id, fecha: { gte: inicio, lt: fin } };
      }),
    };

    const [total, filas, conteos, almacenesPoliza, almacenesCatalogo] = await Promise.all([
      datos.movimientoInventario.count({ where }),
      datos.movimientoInventario.findMany({
        where,
        select: SELECT_MOVIMIENTO,
        orderBy: ORDEN_DESC,
        skip: (pagina - 1) * porPagina,
        take: porPagina,
      }) as Promise<MovimientoLeido[]>,
      datos.polizaInventario.groupBy({
        by: ['sucursalId'],
        where: deLasSucursales,
        _count: { _all: true },
      }),
      datos.polizaInventario.groupBy({
        by: ['sucursalId', 'almacenOrigenSrId'],
        where: deLasSucursales,
      }),
      datos.almacenCatalogo.findMany({
        where: deLasSucursales,
        select: { sucursalId: true, origenSrId: true, nombre: true, activo: true },
      }),
    ]);

    const nombres = await this.nombres(datos, deLasSucursales, filas);
    const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));
    const polizasDe = new Map(conteos.map((c) => [c.sucursalId, c._count._all]));
    const nombreAlmacen = new Map(
      almacenesCatalogo.map((a) => [deSucursal(a.sucursalId, a.origenSrId), a.nombre]),
    );
    const claves = new Set([
      ...almacenesPoliza.map((a) => deSucursal(a.sucursalId, a.almacenOrigenSrId)),
      ...almacenesCatalogo
        .filter((a) => a.activo)
        .map((a) => deSucursal(a.sucursalId, a.origenSrId)),
    ]);

    return {
      movimientos: filas.map((m) => this.fila(m, nombreSucursal, nombres)),
      total,
      pagina,
      porPagina,
      sucursales: sucursales.map((s) => ({
        sucursalId: s.id,
        sucursal: s.nombre,
        zonaHoraria: s.zonaHoraria,
        polizasRecibidas: polizasDe.get(s.id) ?? 0,
      })),
      almacenes: [...claves]
        .map((k) => {
          const [sucursalId, almacenOrigenSrId] = JSON.parse(k) as [string, string];
          return { sucursalId, almacenOrigenSrId, almacen: nombreAlmacen.get(k) ?? null };
        })
        .sort(
          (a, b) =>
            (nombreSucursal.get(a.sucursalId) ?? '').localeCompare(
              nombreSucursal.get(b.sucursalId) ?? '',
              'es',
            ) ||
            (a.almacen ?? a.almacenOrigenSrId).localeCompare(
              b.almacen ?? b.almacenOrigenSrId,
              'es',
            ),
        ),
    };
  }

  /** El detalle de una póliza con sus partidas. De otra empresa, o inexistente = el mismo 404. */
  async poliza(scope: EmpresaScope, id: string, empresaId: string): Promise<PolizaDetalleDto> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId);
    const p = encontradoOr404(
      await datos.polizaInventario.findFirst({
        where: { id, empresaId },
        select: {
          id: true,
          sucursalId: true,
          origenSrId: true,
          folio: true,
          tipo: true,
          tipoSr: true,
          fecha: true,
          referencia: true,
          cancelada: true,
          almacenOrigenSrId: true,
          recibidaAt: true,
        },
      }),
    );
    const delaSucursal = { empresaId, sucursalId: p.sucursalId };
    const [sucursal, partidas, almacen] = await Promise.all([
      datos.sucursal.findFirst({
        where: { id: p.sucursalId, empresaId },
        select: { nombre: true, zonaHoraria: true },
      }),
      datos.movimientoInventario.findMany({
        where: { polizaId: p.id, ...delaSucursal },
        select: {
          renglon: true,
          insumoOrigenSrId: true,
          cantidad: true,
          costoUnitario: true,
          importe: true,
        },
        orderBy: { renglon: 'asc' },
      }),
      datos.almacenCatalogo.findFirst({
        where: { ...delaSucursal, origenSrId: p.almacenOrigenSrId },
        select: { nombre: true },
      }),
    ]);
    const s = encontradoOr404(sucursal);
    const nombres = await this.nombres(
      datos,
      delaSucursal,
      partidas.map((x) => ({ ...x, sucursalId: p.sucursalId })),
    );
    return {
      id: p.id,
      origenSrId: p.origenSrId,
      folio: p.folio,
      tipo: p.tipo,
      tipoSr: p.tipoSr,
      fecha: p.fecha.toISOString(),
      referencia: p.referencia,
      cancelada: p.cancelada,
      sucursalId: p.sucursalId,
      sucursal: s.nombre,
      zonaHoraria: s.zonaHoraria,
      almacenOrigenSrId: p.almacenOrigenSrId,
      almacen: almacen?.nombre ?? null,
      recibidaAt: p.recibidaAt.toISOString(),
      partidas: partidas.map((x) => {
        const i = nombres.insumo(p.sucursalId, x.insumoOrigenSrId);
        return {
          renglon: x.renglon,
          insumoOrigenSrId: x.insumoOrigenSrId,
          ...i,
          cantidad: cant(x.cantidad),
          costoUnitario: x.costoUnitario.toFixed(2),
          importe: x.importe.toFixed(2),
        };
      }),
      importeTotal: partidas.reduce((acc, x) => acc.plus(x.importe), CERO).toFixed(2),
    };
  }

  /**
   * El kardex de UN artículo en UN almacén: saldo inicial (lo anterior al rango), cada movimiento
   * del rango con su saldo corrido, y el cuadre contra la existencia de la última foto (F2-121)
   * AL CORTE de esa foto.
   */
  async kardex(scope: EmpresaScope, q: KardexQueryDto): Promise<KardexDto> {
    validarRango(q.desde, q.hasta);
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, q.empresaId, q.sucursalId);
    const sucursal = encontradoOr404(
      await datos.sucursal.findFirst({
        where: { id: q.sucursalId, empresaId: q.empresaId },
        select: { id: true, nombre: true, zonaHoraria: true },
      }),
    );
    const { inicio, fin } = limitesDelRango(q.desde, q.hasta, sucursal.zonaHoraria);
    const delaSucursal = { empresaId: q.empresaId, sucursalId: q.sucursalId };
    const delAlmacen = { ...delaSucursal, almacenOrigenSrId: q.almacenOrigenSrId };
    const delArticulo = { ...delAlmacen, insumoOrigenSrId: q.insumoOrigenSrId };
    const vigente = { poliza: { cancelada: false } };
    const delRango = { ...delArticulo, fecha: { gte: inicio, lt: fin } };

    const [polizasRecibidas, antes, enRango, lectura, existencia, almacen] = await Promise.all([
      datos.polizaInventario.count({ where: delaSucursal }),
      datos.movimientoInventario.aggregate({
        where: { ...delArticulo, ...vigente, fecha: { lt: inicio } },
        _sum: { cantidad: true },
      }),
      datos.movimientoInventario.count({ where: delRango }),
      datos.lecturaExistencias.findFirst({ where: delAlmacen, select: { capturadoAt: true } }),
      datos.existencia.findFirst({ where: delArticulo, select: { cantidad: true } }),
      datos.almacenCatalogo.findFirst({
        where: { ...delaSucursal, origenSrId: q.almacenOrigenSrId },
        select: { nombre: true },
      }),
    ]);
    if (enRango > MAX_MOVIMIENTOS_KARDEX) {
      throw new BadRequestException(
        `Más de ${MAX_MOVIMIENTOS_KARDEX} movimientos en el rango: acórtalo.`,
      );
    }
    const [movimientos, alCorte] = await Promise.all([
      datos.movimientoInventario.findMany({
        where: delRango,
        select: SELECT_MOVIMIENTO,
        orderBy: ORDEN_ASC,
      }) as Promise<MovimientoLeido[]>,
      lectura
        ? datos.movimientoInventario.aggregate({
            where: { ...delArticulo, ...vigente, fecha: { lte: lectura.capturadoAt } },
            _sum: { cantidad: true },
          })
        : Promise.resolve(null),
    ]);

    const saldoInicial = antes._sum.cantidad ?? CERO;
    const k = armarKardex(
      saldoInicial,
      movimientos.map((m) => ({ ...m, cancelada: m.poliza.cancelada })),
    );
    const saldoAlCorte = alCorte ? (alCorte._sum.cantidad ?? CERO) : null;
    const { cuadra, diferencia } = cuadreDe({
      polizasRecibidas,
      existencia: existencia?.cantidad ?? null,
      saldoAlCorte,
    });
    const nombreSucursal = new Map([[sucursal.id, sucursal.nombre]]);
    const nombres = await this.nombres(datos, delaSucursal, [
      { sucursalId: q.sucursalId, insumoOrigenSrId: q.insumoOrigenSrId },
    ]);
    return {
      sucursalId: sucursal.id,
      sucursal: sucursal.nombre,
      zonaHoraria: sucursal.zonaHoraria,
      almacenOrigenSrId: q.almacenOrigenSrId,
      almacen: almacen?.nombre ?? null,
      insumoOrigenSrId: q.insumoOrigenSrId,
      ...nombres.insumo(q.sucursalId, q.insumoOrigenSrId),
      polizasRecibidas,
      saldoInicial: cant(saldoInicial),
      movimientos: k.filas.map((m) => ({
        ...this.fila(m, nombreSucursal, nombres, almacen?.nombre ?? null),
        saldo: cant(m.saldo),
      })),
      saldoFinal: cant(k.saldoFinal),
      entradas: cant(k.entradas),
      salidas: cant(k.salidas),
      corteExistencia: lectura?.capturadoAt.toISOString() ?? null,
      existencia: existencia ? cant(existencia.cantidad) : null,
      saldoAlCorte: saldoAlCorte ? cant(saldoAlCorte) : null,
      diferencia: diferencia ? cant(diferencia) : null,
      cuadra,
    };
  }

  private fila(
    m: MovimientoLeido,
    nombreSucursal: ReadonlyMap<string, string>,
    nombres: Nombres,
    almacen?: string | null,
  ): FilaMovimientoDto {
    return {
      id: m.id,
      poliza: m.poliza,
      renglon: m.renglon,
      fecha: m.fecha.toISOString(),
      sucursalId: m.sucursalId,
      sucursal: nombreSucursal.get(m.sucursalId) ?? '',
      almacenOrigenSrId: m.almacenOrigenSrId,
      almacen: almacen !== undefined ? almacen : nombres.almacen(m.sucursalId, m.almacenOrigenSrId),
      insumoOrigenSrId: m.insumoOrigenSrId,
      ...nombres.insumo(m.sucursalId, m.insumoOrigenSrId),
      cantidad: cant(m.cantidad),
      costoUnitario: m.costoUnitario.toFixed(2),
      importe: m.importe.toFixed(2),
    };
  }

  /** Los nombres de los catálogos espejo EN SU SUCURSAL, sólo de lo que se va a mostrar. */
  private async nombres(
    datos: DatosScoped,
    deLasSucursales: { empresaId: string; sucursalId?: string },
    filas: ReadonlyArray<{
      sucursalId: string;
      insumoOrigenSrId: string;
      almacenOrigenSrId?: string;
    }>,
  ): Promise<Nombres> {
    const insumosPedidos = [...new Set(filas.map((f) => f.insumoOrigenSrId))];
    const almacenesPedidos = [
      ...new Set(filas.flatMap((f) => (f.almacenOrigenSrId ? [f.almacenOrigenSrId] : []))),
    ];
    const [insumos, almacenes] = await Promise.all([
      insumosPedidos.length === 0
        ? []
        : datos.insumo.findMany({
            where: { ...deLasSucursales, origenSrId: { in: insumosPedidos } },
            select: {
              sucursalId: true,
              origenSrId: true,
              nombre: true,
              clave: true,
              unidadOrigenSrId: true,
            },
          }),
      almacenesPedidos.length === 0
        ? []
        : datos.almacenCatalogo.findMany({
            where: { ...deLasSucursales, origenSrId: { in: almacenesPedidos } },
            select: { sucursalId: true, origenSrId: true, nombre: true },
          }),
    ]);
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
    const insumoDe = new Map(insumos.map((i) => [deSucursal(i.sucursalId, i.origenSrId), i]));
    const unidadDe = new Map(
      unidades.map((u) => [deSucursal(u.sucursalId, u.origenSrId), u.nombre]),
    );
    const almacenDe = new Map(
      almacenes.map((a) => [deSucursal(a.sucursalId, a.origenSrId), a.nombre]),
    );
    return {
      insumo: (sucursalId, origen) => {
        const i = insumoDe.get(deSucursal(sucursalId, origen));
        return {
          insumo: i?.nombre ?? null,
          clave: i?.clave ?? null,
          unidad: i?.unidadOrigenSrId
            ? (unidadDe.get(deSucursal(sucursalId, i.unidadOrigenSrId)) ?? null)
            : null,
        };
      },
      almacen: (sucursalId, origen) => almacenDe.get(deSucursal(sucursalId, origen)) ?? null,
    };
  }
}

interface Nombres {
  insumo(
    sucursalId: string,
    origen: string,
  ): { insumo: string | null; clave: string | null; unidad: string | null };
  almacen(sucursalId: string, origen: string): string | null;
}
