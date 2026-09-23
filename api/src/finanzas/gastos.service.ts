import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { diaLocal } from '../alertas/observar';
import { Reloj } from '../comun/reloj';
import { validarRango } from '../inventario/movimientos.service';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { fechaDeDia } from '../scope/escritura-gastos';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService, type DatosScoped } from '../scope/scoped-prisma.service';
import type {
  AlcanceQueryDto,
  CambiarCategoriaDto,
  CategoriasGastoDto,
  CrearCategoriaDto,
  CrearGastoDto,
  EditarGastoDto,
  GastoCategoriaTotalDto,
  GastoCreadoDto,
  GastosDto,
  GastosQueryDto,
} from './dto/finanzas.dto';

/** Tope de gastos de la lista (los totales no se recortan). */
export const MAX_GASTOS_LISTA = 2000;

type D = Prisma.Decimal;
const CERO = new Prisma.Decimal(0);
const pesos = (v: D) => v.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
const textoDia = (d: Date) => d.toISOString().slice(0, 10);

/** ¿`YYYY-MM-DD` es un día de calendario real? (2026-02-30 no.) */
export function diaValido(dia: string): boolean {
  const t = Date.parse(`${dia}T00:00:00Z`);
  return !Number.isNaN(t) && new Date(t).toISOString().slice(0, 10) === dia;
}

/** Un monto ya validado con `MONTO`: tiene que ser > 0. */
export function montoPositivo(texto: string): D {
  const v = new Prisma.Decimal(texto);
  if (!v.greaterThan(0)) throw new BadRequestException(['monto debe ser mayor que 0']);
  return v;
}

/**
 * Gastos de operación por sucursal y sus categorías (F2-126): dato NUESTRO, capturado en el panel,
 * que nunca se escribe a SoftRestaurant. Las lecturas van por `para(scope)` con la empresa en el
 * WHERE; las escrituras, por `gastos(scope)`. Fuera de alcance = 404, nunca 403.
 *
 * `dia` es el día CONTABLE local de la sucursal (DATE): un gasto con día posterior al "hoy" de la
 * zona de su sucursal se rechaza (400). Monto SIN IVA acreditable (DECISION PROVISIONAL
 * (nocturno), esquema-sr §10).
 */
@Injectable()
export class GastosService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
  ) {}

  /** 400 si el día no existe o es posterior a hoy en la zona de la sucursal. */
  private async validarDia(datos: DatosScoped, empresaId: string, sucursalId: string, dia: string) {
    if (!diaValido(dia))
      throw new BadRequestException(['dia debe ser una fecha YYYY-MM-DD válida']);
    const s = encontradoOr404(
      await datos.sucursal.findFirst({
        where: { id: sucursalId, empresaId },
        select: { zonaHoraria: true },
      }),
    );
    if (dia > diaLocal(this.reloj.ahora(), s.zonaHoraria)) {
      throw new BadRequestException(['dia no puede ser posterior a hoy en la zona de la sucursal']);
    }
  }

  async categorias(scope: EmpresaScope, q: AlcanceQueryDto): Promise<CategoriasGastoDto> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, q.empresaId);
    const categorias = await datos.categoriaGasto.findMany({
      where: { empresaId: q.empresaId },
      select: { id: true, nombre: true, activa: true },
      orderBy: [{ nombreClave: 'asc' }, { id: 'asc' }],
    });
    return { categorias };
  }

  async crearCategoria(scope: EmpresaScope, dto: CrearCategoriaDto): Promise<GastoCreadoDto> {
    const id = await this.datos
      .gastos(scope)
      .crearCategoria(dto.empresaId, dto.nombre, new Date(this.reloj.ahora()));
    return { id };
  }

  async cambiarCategoria(scope: EmpresaScope, id: string, dto: CambiarCategoriaDto): Promise<void> {
    if (dto.nombre === undefined && dto.activa === undefined) {
      throw new BadRequestException(['nada que cambiar: manda nombre o activa']);
    }
    await this.datos
      .gastos(scope)
      .cambiarCategoria(
        dto.empresaId,
        id,
        { nombre: dto.nombre, activa: dto.activa },
        new Date(this.reloj.ahora()),
      );
  }

  async listar(scope: EmpresaScope, q: GastosQueryDto): Promise<GastosDto> {
    validarRango(q.desde, q.hasta);
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, q.empresaId, q.sucursalId);
    const where = {
      empresaId: q.empresaId,
      ...(q.sucursalId ? { sucursalId: q.sucursalId } : {}),
      ...(q.categoriaId ? { categoriaId: q.categoriaId } : {}),
      dia: { gte: fechaDeDia(q.desde), lte: fechaDeDia(q.hasta) },
    };
    const [gastos, cuantos, porCategoria] = await Promise.all([
      datos.gasto.findMany({
        where: q.incluirAnulados ? where : { ...where, anuladoAt: null },
        select: {
          id: true,
          sucursalId: true,
          dia: true,
          categoriaId: true,
          concepto: true,
          monto: true,
          anuladoAt: true,
          categoria: { select: { nombre: true } },
        },
        orderBy: [{ dia: 'desc' }, { creadoAt: 'desc' }, { id: 'asc' }],
        take: MAX_GASTOS_LISTA,
      }),
      datos.gasto.count({ where: q.incluirAnulados ? where : { ...where, anuladoAt: null } }),
      this.porCategoria(datos, { ...where, anuladoAt: null }),
    ]);
    return {
      gastos: gastos.map((g) => ({
        id: g.id,
        sucursalId: g.sucursalId,
        dia: textoDia(g.dia),
        categoriaId: g.categoriaId,
        categoria: g.categoria.nombre,
        concepto: g.concepto,
        monto: pesos(g.monto),
        anulado: g.anuladoAt !== null,
      })),
      truncado: cuantos > gastos.length,
      total: pesos(porCategoria.reduce<D>((acc, c) => acc.plus(c.monto), CERO)),
      porCategoria,
    };
  }

  /** Σ por categoría (monto desc, luego nombre), con el `where` que ya trae empresa y rango. */
  async porCategoria(
    datos: DatosScoped,
    where: { empresaId: string } & Record<string, unknown>,
  ): Promise<GastoCategoriaTotalDto[]> {
    const grupos = await datos.gasto.groupBy({
      by: ['categoriaId'],
      where,
      _sum: { monto: true },
    });
    if (grupos.length === 0) return [];
    const nombres = await datos.categoriaGasto.findMany({
      where: { empresaId: where.empresaId, id: { in: grupos.map((g) => g.categoriaId) } },
      select: { id: true, nombre: true },
    });
    const nombre = new Map(nombres.map((n) => [n.id, n.nombre]));
    return grupos
      .map((g) => ({
        categoriaId: g.categoriaId,
        categoria: nombre.get(g.categoriaId) ?? '',
        m: g._sum.monto ?? CERO,
      }))
      .sort((a, b) => b.m.comparedTo(a.m) || a.categoria.localeCompare(b.categoria, 'es-MX'))
      .map(({ m, ...c }) => ({ ...c, monto: pesos(m) }));
  }

  async crear(scope: EmpresaScope, actorId: string, dto: CrearGastoDto): Promise<GastoCreadoDto> {
    const monto = montoPositivo(dto.monto);
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, dto.empresaId, dto.sucursalId);
    await this.validarDia(datos, dto.empresaId, dto.sucursalId, dto.dia);
    const id = await this.datos.gastos(scope).crear(
      {
        empresaId: dto.empresaId,
        sucursalId: dto.sucursalId,
        categoriaId: dto.categoriaId,
        dia: dto.dia,
        concepto: dto.concepto,
        monto,
      },
      actorId,
      new Date(this.reloj.ahora()),
    );
    return { id };
  }

  async editar(
    scope: EmpresaScope,
    actorId: string,
    id: string,
    dto: EditarGastoDto,
  ): Promise<void> {
    const cambios = {
      categoriaId: dto.categoriaId,
      dia: dto.dia,
      concepto: dto.concepto,
      monto: dto.monto === undefined ? undefined : montoPositivo(dto.monto),
    };
    if (Object.values(cambios).every((v) => v === undefined)) {
      throw new BadRequestException(['nada que cambiar']);
    }
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, dto.empresaId);
    if (dto.dia !== undefined) {
      const g = encontradoOr404(
        await datos.gasto.findFirst({
          where: { id, empresaId: dto.empresaId },
          select: { sucursalId: true },
        }),
      );
      await this.validarDia(datos, dto.empresaId, g.sucursalId, dto.dia);
    }
    await this.datos
      .gastos(scope)
      .editar(dto.empresaId, id, cambios, actorId, new Date(this.reloj.ahora()));
  }

  async anular(
    scope: EmpresaScope,
    actorId: string,
    id: string,
    q: AlcanceQueryDto,
  ): Promise<void> {
    await this.datos.gastos(scope).anular(q.empresaId, id, actorId, new Date(this.reloj.ahora()));
  }
}
