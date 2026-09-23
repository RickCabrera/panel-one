import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { diaLocal } from '../alertas/observar';
import { Reloj } from '../comun/reloj';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import type {
  AvisoProyeccion,
  FilaProyeccionDto,
  ProyeccionesDto,
  ProyeccionesQueryDto,
  SucursalProyeccionDto,
} from './dto/proyecciones.dto';
import { atrasada } from './existencias';
import { MAX_FILAS_EXISTENCIAS } from './existencias.service';
import { limitesDelRango } from './kardex';
import {
  DIAS_VENTANA,
  diasDeHistorial,
  diasDelHorizonte,
  HORIZONTE_DEFECTO,
  PESOS,
  proyectar,
  sugerido,
  tieneHistorial,
  TIPOS_DEMANDA,
  ventanaDe,
} from './proyecciones';

type D = Prisma.Decimal;
const CERO = new Prisma.Decimal(0);
const texto = (v: D | null) => v?.toFixed(3) ?? null;

const llave = (sucursalId: string, almacen: string, insumo: string) =>
  JSON.stringify([sucursalId, almacen, insumo]);
const deSucursal = (sucursalId: string, origen: string) => JSON.stringify([sucursalId, origen]);

/**
 * Proyecciones y sugerido de compra (F2-127). Por cada artículo de cada almacén: la demanda de
 * las 4 semanas completas anteriores a hoy (salidas por consumo, merma y traspaso, de pólizas
 * de F2-122 no canceladas), su promedio ponderado por día de la semana proyectado sobre el
 * horizonte, y el sugerido contra la última foto de existencias y el mínimo del panel (F2-121).
 *
 * Todo por el helper de scope: la empresa (y la sucursal) se verifica con el scope del usuario y
 * va en el WHERE de cada consulta; fuera de alcance = 404, nunca 403. Sin SQL crudo: la demanda
 * por día local sale de un `groupBy` por día (28), cortado en la zona de CADA sucursal. Nada se
 * guarda ni se escribe a SoftRestaurant: se calcula al vuelo.
 *
 * Sin `statement_timeout` propio (igual que Movimientos y Recetas): es Postgres nuestro, la
 * ventana está acotada a 28 días y el primer movimiento usa el índice del kardex.
 */
@Injectable()
export class ProyeccionesService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
  ) {}

  async listar(scope: EmpresaScope, q: ProyeccionesQueryDto): Promise<ProyeccionesDto> {
    if (q.almacenOrigenSrId !== undefined && q.sucursalId === undefined) {
      throw new BadRequestException('almacenOrigenSrId exige sucursalId.');
    }
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, q.empresaId, q.sucursalId);
    const horizonte = q.horizonte ?? HORIZONTE_DEFECTO;
    const ahora = this.reloj.ahora();
    const deLasSucursales = {
      empresaId: q.empresaId,
      ...(q.sucursalId ? { sucursalId: q.sucursalId } : {}),
    };

    const [sucursales, polizas, lecturas] = await Promise.all([
      datos.sucursal.findMany({
        where: { empresaId: q.empresaId, ...(q.sucursalId ? { id: q.sucursalId } : {}) },
        select: { id: true, nombre: true, zonaHoraria: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      datos.polizaInventario.groupBy({
        by: ['sucursalId'],
        where: deLasSucursales,
        _count: { _all: true },
      }),
      datos.lecturaExistencias.findMany({
        where: deLasSucursales,
        select: { sucursalId: true, almacenOrigenSrId: true, recibidaAt: true },
      }),
    ]);
    const polizasDe = new Map(polizas.map((p) => [p.sucursalId, p._count._all]));

    const estado = sucursales.map((s) => {
      const hoy = diaLocal(ahora, s.zonaHoraria);
      const ventana = ventanaDe(hoy);
      const horizonteDias = diasDelHorizonte(hoy, horizonte);
      const recibidas = polizasDe.get(s.id) ?? 0;
      return {
        zona: s.zonaHoraria,
        dto: {
          sucursalId: s.id,
          sucursal: s.nombre,
          zonaHoraria: s.zonaHoraria,
          calculada: recibidas > 0,
          motivo: recibidas > 0 ? null : 'sin_polizas',
          polizasRecibidas: recibidas,
          almacenesConFoto: lecturas.filter((l) => l.sucursalId === s.id).length,
          hoy,
          ventanaDesde: ventana.desde,
          ventanaHasta: ventana.hasta,
          horizonteDesde: horizonteDias[0],
          horizonteHasta: horizonteDias[horizonteDias.length - 1],
        } satisfies SucursalProyeccionDto,
      };
    });
    const calculables = estado.filter((s) => s.dto.calculada);
    const respuesta = (filas: FilaProyeccionDto[]): ProyeccionesDto => ({
      horizonte,
      pesos: [...PESOS],
      sucursales: estado.map((s) => s.dto),
      filas,
      kpis: {
        filas: filas.length,
        conSugerido: filas.filter((f) => f.sugerido !== null && Number(f.sugerido) > 0).length,
        sinHistorial: filas.filter((f) => f.estado === 'sin_historial').length,
      },
    });
    if (calculables.length === 0) return respuesta([]);

    const delFiltro = {
      empresaId: q.empresaId,
      sucursalId: { in: calculables.map((s) => s.dto.sucursalId) },
      ...(q.almacenOrigenSrId ? { almacenOrigenSrId: q.almacenOrigenSrId } : {}),
    };
    const vivas = { poliza: { cancelada: false } };

    // El primer movimiento (cualquier tipo, no cancelado) de cada artículo: su historial.
    const primeros = await datos.movimientoInventario.groupBy({
      by: ['sucursalId', 'almacenOrigenSrId', 'insumoOrigenSrId'],
      where: { ...delFiltro, ...vivas },
      _min: { fecha: true },
    });
    if (primeros.length > MAX_FILAS_EXISTENCIAS) {
      throw new BadRequestException(
        `Más de ${MAX_FILAS_EXISTENCIAS} artículos: filtra por sucursal o almacén.`,
      );
    }

    // La demanda de cada día de la ventana: un groupBy por día, [00:00, 24:00) LOCAL de cada
    // sucursal (su "hoy" puede ser distinto: se corta en su zona, nunca en la del servidor).
    const porDia = await Promise.all(
      Array.from({ length: DIAS_VENTANA }, (_, i) =>
        datos.movimientoInventario.groupBy({
          by: ['sucursalId', 'almacenOrigenSrId', 'insumoOrigenSrId'],
          where: {
            ...delFiltro,
            cantidad: { lt: 0 },
            poliza: { tipo: { in: [...TIPOS_DEMANDA] }, cancelada: false },
            OR: calculables.map((s) => {
              const dia = ventanaDe(s.dto.hoy).dias[i];
              const { inicio, fin } = limitesDelRango(dia, dia, s.zona);
              return { sucursalId: s.dto.sucursalId, fecha: { gte: inicio, lt: fin } };
            }),
          },
          _sum: { cantidad: true },
        }),
      ),
    );

    const [existencias, limites, almacenes, insumos] = await Promise.all([
      datos.existencia.findMany({
        where: delFiltro,
        select: {
          sucursalId: true,
          almacenOrigenSrId: true,
          insumoOrigenSrId: true,
          cantidad: true,
        },
      }),
      datos.limiteExistencia.findMany({
        where: delFiltro,
        select: {
          sucursalId: true,
          almacenOrigenSrId: true,
          insumoOrigenSrId: true,
          minimo: true,
        },
      }),
      datos.almacenCatalogo.findMany({
        where: { empresaId: q.empresaId, sucursalId: delFiltro.sucursalId },
        select: { sucursalId: true, origenSrId: true, nombre: true },
      }),
      datos.insumo.findMany({
        where: { empresaId: q.empresaId, sucursalId: delFiltro.sucursalId },
        select: {
          sucursalId: true,
          origenSrId: true,
          nombre: true,
          clave: true,
          unidadOrigenSrId: true,
        },
      }),
    ]);
    const unidadesPedidas = [
      ...new Set(insumos.flatMap((i) => (i.unidadOrigenSrId ? [i.unidadOrigenSrId] : []))),
    ];
    const unidades =
      unidadesPedidas.length === 0
        ? []
        : await datos.unidadCatalogo.findMany({
            where: {
              empresaId: q.empresaId,
              sucursalId: delFiltro.sucursalId,
              origenSrId: { in: unidadesPedidas },
            },
            select: { sucursalId: true, origenSrId: true, nombre: true },
          });

    const sucursalDe = new Map(calculables.map((s) => [s.dto.sucursalId, s]));
    const nombreAlmacen = new Map(
      almacenes.map((a) => [deSucursal(a.sucursalId, a.origenSrId), a.nombre]),
    );
    const insumoDe = new Map(insumos.map((i) => [deSucursal(i.sucursalId, i.origenSrId), i]));
    const unidadDe = new Map(
      unidades.map((u) => [deSucursal(u.sucursalId, u.origenSrId), u.nombre]),
    );
    const primerDe = new Map(
      primeros.map((p) => [llave(p.sucursalId, p.almacenOrigenSrId, p.insumoOrigenSrId), p]),
    );
    const existenciaDe = new Map(
      existencias.map((e) => [
        llave(e.sucursalId, e.almacenOrigenSrId, e.insumoOrigenSrId),
        e.cantidad,
      ]),
    );
    const minimoDe = new Map(
      limites.map((l) => [llave(l.sucursalId, l.almacenOrigenSrId, l.insumoOrigenSrId), l.minimo]),
    );
    const lecturaDe = new Map(
      lecturas.map((l) => [deSucursal(l.sucursalId, l.almacenOrigenSrId), l.recibidaAt]),
    );
    // demanda[llave] = día local → salida (positiva).
    const demanda = new Map<string, Map<string, D>>();
    porDia.forEach((grupos, i) => {
      for (const g of grupos) {
        const s = sucursalDe.get(g.sucursalId);
        if (!s || g._sum.cantidad === null) continue;
        const k = llave(g.sucursalId, g.almacenOrigenSrId, g.insumoOrigenSrId);
        const m = demanda.get(k) ?? new Map<string, D>();
        m.set(ventanaDe(s.dto.hoy).dias[i], g._sum.cantidad.negated());
        demanda.set(k, m);
      }
    });

    // Los artículos: con movimientos, con existencia o con límite.
    const claves = new Set([...primerDe.keys(), ...existenciaDe.keys(), ...minimoDe.keys()]);
    if (claves.size > MAX_FILAS_EXISTENCIAS) {
      throw new BadRequestException(
        `Más de ${MAX_FILAS_EXISTENCIAS} artículos: filtra por sucursal o almacén.`,
      );
    }
    const filas: FilaProyeccionDto[] = [...claves].map((k) => {
      const [sucursalId, almacen, insumo] = JSON.parse(k) as [string, string, string];
      const s = sucursalDe.get(sucursalId)!;
      const primer = primerDe.get(k)?._min.fecha ?? null;
      const dias = diasDeHistorial(primer ? diaLocal(primer.getTime(), s.zona) : null, s.dto.hoy);
      const avisos: AvisoProyeccion[] = [];
      const leida = lecturaDe.has(deSucursal(sucursalId, almacen));
      let existencia: D | null = null;
      if (!leida) {
        avisos.push('sin_foto');
      } else {
        existencia = existenciaDe.get(k) ?? null;
        if (existencia === null) {
          existencia = CERO;
          avisos.push('fuera_de_foto');
        }
        if (atrasada(lecturaDe.get(deSucursal(sucursalId, almacen)) ?? null, ahora)) {
          avisos.push('foto_atrasada');
        }
      }
      const minimo = minimoDe.get(k) ?? null;
      if (minimo === null) avisos.push('sin_minimo');
      const i = insumoDe.get(deSucursal(sucursalId, insumo));
      const base = {
        sucursalId,
        sucursal: s.dto.sucursal,
        almacenOrigenSrId: almacen,
        almacen: nombreAlmacen.get(deSucursal(sucursalId, almacen)) ?? null,
        insumoOrigenSrId: insumo,
        insumo: i?.nombre ?? null,
        clave: i?.clave ?? null,
        unidad: i?.unidadOrigenSrId
          ? (unidadDe.get(deSucursal(sucursalId, i.unidadOrigenSrId)) ?? null)
          : null,
        diasHistorial: dias,
        existencia: texto(existencia),
        minimo: texto(minimo),
        avisos,
      };
      if (!tieneHistorial(dias)) {
        return {
          ...base,
          estado: 'sin_historial',
          semanas: null,
          proyeccion: null,
          sugerido: null,
        };
      }
      const p = proyectar(demanda.get(k) ?? new Map(), s.dto.hoy, horizonte);
      return {
        ...base,
        estado: 'calculada',
        semanas: p.semanas.map((v) => v.toFixed(3)),
        proyeccion: p.proyeccion.toFixed(3),
        sugerido: texto(sugerido(p.proyeccion, existencia, minimo)),
      };
    });

    const orden = (f: FilaProyeccionDto) => [
      f.sucursal,
      f.almacen ?? f.almacenOrigenSrId,
      f.insumo ?? f.insumoOrigenSrId,
      f.insumoOrigenSrId,
    ];
    filas.sort((a, b) => {
      const x = orden(a);
      const y = orden(b);
      for (let j = 0; j < x.length; j++) {
        const c = x[j].localeCompare(y[j], 'es');
        if (c !== 0) return c;
      }
      return 0;
    });
    return respuesta(filas);
  }
}
