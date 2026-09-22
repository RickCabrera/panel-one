import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TipoAlerta, type EstadoTraspaso } from '@prisma/client';

import { definicion, reglasEfectivas } from '../alertas/reglas';
import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService, type DatosScoped } from '../scope/scoped-prisma.service';
import {
  MAX_POLIZAS_TRASPASO_SR,
  type EnviarTraspasoDto,
  type EspejoDto,
  type PartidaTraspasoDto,
  type TraspasoDetalleDto,
  type TraspasoResumenDto,
  type TraspasosDto,
  type TraspasosQueryDto,
  type TraspasoSrDto,
  type TraspasosSrDto,
  type TraspasosSrQueryDto,
} from './dto/traspasos.dto';
import { limitesDelRango } from './kardex';
import { validarRango } from './movimientos.service';
import {
  estadoConciliacion,
  importeDe,
  llaveEspejo,
  sirveDeEntrada,
  sirveDeSalida,
  type Espejo,
  type MovimientoCandidato,
  type RenglonAConciliar,
} from './traspasos';

/** Cuántos traspasos devuelve la lista (los más recientes). */
export const MAX_TRASPASOS_LISTA = 200;

type D = Prisma.Decimal;
const CERO = new Prisma.Decimal(0);
const deSucursal = (sucursalId: string, origen: string) => JSON.stringify([sucursalId, origen]);
const cant = (v: D) => v.toFixed(3);
const pesos = (v: D | null) => v?.toFixed(2) ?? null;

const SELECT_CABECERA = {
  id: true,
  folio: true,
  sucursalId: true,
  almacenOrigenSrId: true,
  sucursalDestinoId: true,
  almacenDestinoSrId: true,
  nota: true,
  estado: true,
  enviadoAt: true,
  recibidoAt: true,
  canceladoAt: true,
  conciliadoAt: true,
} as const;

const SELECT_PARTIDA = {
  id: true,
  traspasoId: true,
  insumoOrigenSrId: true,
  cantidad: true,
  costoUnitario: true,
  polizaSalidaId: true,
  renglonSalida: true,
  polizaEntradaId: true,
  renglonEntrada: true,
} as const;

interface Cabecera {
  id: string;
  folio: number;
  sucursalId: string;
  almacenOrigenSrId: string;
  sucursalDestinoId: string;
  almacenDestinoSrId: string;
  nota: string | null;
  estado: EstadoTraspaso;
  enviadoAt: Date;
  recibidoAt: Date | null;
  canceladoAt: Date | null;
  conciliadoAt: Date | null;
}

interface Partida {
  id: string;
  traspasoId: string;
  insumoOrigenSrId: string;
  cantidad: D;
  costoUnitario: D | null;
  polizaSalidaId: string | null;
  renglonSalida: number | null;
  polizaEntradaId: string | null;
  renglonEntrada: number | null;
}

/** Lo que se sabe de un espejo guardado, re-verificado al LEER. */
interface EspejoVigente {
  salida: EspejoDto | null;
  entrada: EspejoDto | null;
}

/**
 * Traspasos (F2-124). Todo por el helper de scope: la empresa (y la sucursal, si viene) se verifica
 * con el scope del usuario y va en el WHERE de cada consulta; las escrituras van por
 * `datos.traspasos(scope)`. Fuera de alcance = 404, nunca 403. Nada se escribe a SoftRestaurant.
 *
 * Los GET NO concilian (no escriben): la conciliación corre en la vuelta del centro de alertas.
 * Pero un espejo guardado se RE-VERIFICA al leer (sigue siendo del almacén, insumo, cantidad,
 * tipo y ventana, y su póliza no está cancelada): si SR canceló la póliza en el último minuto, la
 * vista ya no lo pinta ni lo cuenta como conciliado, aunque la siguiente vuelta aún no lo suelte.
 */
@Injectable()
export class TraspasosService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
  ) {}

  async listar(scope: EmpresaScope, q: TraspasosQueryDto): Promise<TraspasosDto> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, q.empresaId, q.sucursalId);
    const ahora = this.reloj.ahora();
    const filtro = {
      empresaId: q.empresaId,
      ...(q.sucursalId
        ? { OR: [{ sucursalId: q.sucursalId }, { sucursalDestinoId: q.sucursalId }] }
        : {}),
      ...(q.estado ? { estado: q.estado } : {}),
    };
    const [sucursales, total, traspasos, umbral, almacenes, lecturas] = await Promise.all([
      datos.sucursal.findMany({
        where: { empresaId: q.empresaId },
        select: { id: true, nombre: true, zonaHoraria: true, activo: true },
        orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
      }),
      datos.traspaso.count({ where: filtro }),
      datos.traspaso.findMany({
        where: filtro,
        select: SELECT_CABECERA,
        orderBy: [{ enviadoAt: 'desc' }, { folio: 'desc' }],
        take: MAX_TRASPASOS_LISTA,
      }),
      this.#umbral(datos, q.empresaId),
      datos.almacenCatalogo.findMany({
        where: { empresaId: q.empresaId },
        select: { sucursalId: true, origenSrId: true, nombre: true, activo: true },
      }),
      datos.lecturaExistencias.findMany({
        where: { empresaId: q.empresaId },
        select: { sucursalId: true, almacenOrigenSrId: true },
      }),
    ]);
    const partidas = await this.#partidas(
      datos,
      q.empresaId,
      traspasos.map((t) => t.id),
    );
    const vigentes = await this.#espejosVigentes(datos, q.empresaId, traspasos, partidas);
    const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));
    const nombreAlmacen = new Map(
      almacenes.map((a) => [deSucursal(a.sucursalId, a.origenSrId), a.nombre]),
    );
    const activas = new Set(sucursales.filter((s) => s.activo).map((s) => s.id));
    const claves = new Set([
      ...lecturas.map((l) => deSucursal(l.sucursalId, l.almacenOrigenSrId)),
      ...almacenes.filter((a) => a.activo).map((a) => deSucursal(a.sucursalId, a.origenSrId)),
    ]);
    const listaAlmacenes = [...claves]
      .map((k) => {
        const [sucursalId, almacenOrigenSrId] = JSON.parse(k) as [string, string];
        return { sucursalId, almacenOrigenSrId, almacen: nombreAlmacen.get(k) ?? null };
      })
      .filter((a) => activas.has(a.sucursalId))
      .sort(
        (a, b) =>
          (nombreSucursal.get(a.sucursalId) ?? '').localeCompare(
            nombreSucursal.get(b.sucursalId) ?? '',
            'es',
          ) ||
          (a.almacen ?? a.almacenOrigenSrId).localeCompare(b.almacen ?? b.almacenOrigenSrId, 'es'),
      );
    return {
      traspasos: traspasos.map((t) =>
        this.#resumen(
          t,
          partidas.filter((p) => p.traspasoId === t.id),
          vigentes,
          { nombreSucursal, nombreAlmacen, ahora, umbral },
        ),
      ),
      total,
      umbralAlertaHoras: umbral,
      sucursales: sucursales
        .filter((s) => s.activo)
        .filter((s) => !q.sucursalId || s.id === q.sucursalId)
        .map((s) => ({ sucursalId: s.id, sucursal: s.nombre, zonaHoraria: s.zonaHoraria })),
      almacenes: listaAlmacenes,
    };
  }

  /** Un traspaso con sus renglones y sus espejos vigentes. De otra empresa o inexistente = 404. */
  async detalle(scope: EmpresaScope, id: string, empresaId: string): Promise<TraspasoDetalleDto> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId);
    const t = encontradoOr404(
      await datos.traspaso.findFirst({ where: { id, empresaId }, select: SELECT_CABECERA }),
    );
    const [partidas, sucursales, almacenes, umbral] = await Promise.all([
      this.#partidas(datos, empresaId, [t.id]),
      datos.sucursal.findMany({
        where: { empresaId, id: { in: [t.sucursalId, t.sucursalDestinoId] } },
        select: { id: true, nombre: true, zonaHoraria: true },
      }),
      datos.almacenCatalogo.findMany({
        where: {
          empresaId,
          OR: [
            { sucursalId: t.sucursalId, origenSrId: t.almacenOrigenSrId },
            { sucursalId: t.sucursalDestinoId, origenSrId: t.almacenDestinoSrId },
          ],
        },
        select: { sucursalId: true, origenSrId: true, nombre: true },
      }),
      this.#umbral(datos, empresaId),
    ]);
    const vigentes = await this.#espejosVigentes(datos, empresaId, [t], partidas);
    const deOrigen = { empresaId, sucursalId: t.sucursalId };
    const insumos =
      partidas.length === 0
        ? []
        : await datos.insumo.findMany({
            where: { ...deOrigen, origenSrId: { in: partidas.map((p) => p.insumoOrigenSrId) } },
            select: { origenSrId: true, nombre: true, clave: true, unidadOrigenSrId: true },
          });
    const unidadesPedidas = [
      ...new Set(insumos.flatMap((i) => (i.unidadOrigenSrId ? [i.unidadOrigenSrId] : []))),
    ];
    const unidades =
      unidadesPedidas.length === 0
        ? []
        : await datos.unidadCatalogo.findMany({
            where: { ...deOrigen, origenSrId: { in: unidadesPedidas } },
            select: { origenSrId: true, nombre: true },
          });
    const insumoDe = new Map(insumos.map((i) => [i.origenSrId, i]));
    const unidadDe = new Map(unidades.map((u) => [u.origenSrId, u.nombre]));
    const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));
    const nombreAlmacen = new Map(
      almacenes.map((a) => [deSucursal(a.sucursalId, a.origenSrId), a.nombre]),
    );

    let importe = CERO;
    let sinCosto = 0;
    const renglones: PartidaTraspasoDto[] = partidas.map((p) => {
      const i = insumoDe.get(p.insumoOrigenSrId);
      const imp = importeDe(p.cantidad, p.costoUnitario);
      if (imp === null) sinCosto++;
      else importe = importe.plus(imp);
      const v = vigentes.get(p.id) ?? { salida: null, entrada: null };
      return {
        insumoOrigenSrId: p.insumoOrigenSrId,
        insumo: i?.nombre ?? null,
        clave: i?.clave ?? null,
        unidad: i?.unidadOrigenSrId ? (unidadDe.get(i.unidadOrigenSrId) ?? null) : null,
        cantidad: cant(p.cantidad),
        costoUnitario: pesos(p.costoUnitario),
        importe: pesos(imp),
        salida: v.salida,
        entrada: v.entrada,
      };
    });
    const nombre = (r: PartidaTraspasoDto) => r.insumo ?? r.insumoOrigenSrId;
    renglones.sort(
      (a, b) =>
        nombre(a).localeCompare(nombre(b), 'es') ||
        a.insumoOrigenSrId.localeCompare(b.insumoOrigenSrId, 'es'),
    );
    return {
      traspaso: this.#resumen(t, partidas, vigentes, {
        nombreSucursal,
        nombreAlmacen,
        ahora: this.reloj.ahora(),
        umbral,
      }),
      zonaHoraria:
        sucursales.find((s) => s.id === t.sucursalId)?.zonaHoraria ?? 'America/Mexico_City',
      partidas: renglones,
      totales: { importe: importe.toFixed(2), sinCosto },
    };
  }

  /**
   * Los traspasos LEÍDOS de SR: las pólizas `traspaso_salida` / `traspaso_entrada` (F2-122) del
   * rango, cortado en la zona de CADA sucursal, agrupadas por su `referencia` (el documento de SR;
   * sin referencia, cada póliza va sola), con los traspasos del panel conciliados contra ellas.
   */
  async leidosDeSr(scope: EmpresaScope, q: TraspasosSrQueryDto): Promise<TraspasosSrDto> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, q.empresaId, q.sucursalId);
    validarRango(q.desde, q.hasta);
    const sucursales = await datos.sucursal.findMany({
      where: { empresaId: q.empresaId, ...(q.sucursalId ? { id: q.sucursalId } : {}) },
      select: { id: true, nombre: true, zonaHoraria: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
    const tipos = { in: ['traspaso_salida', 'traspaso_entrada'] as const } as {
      in: Array<'traspaso_salida' | 'traspaso_entrada'>;
    };
    const ids = sucursales.map((s) => s.id);
    const [polizas, alguna] = await Promise.all([
      datos.polizaInventario.findMany({
        where: {
          empresaId: q.empresaId,
          tipo: tipos,
          // El rango se corta en la zona de CADA sucursal.
          OR: sucursales.map((s) => {
            const { inicio, fin } = limitesDelRango(q.desde, q.hasta, s.zonaHoraria);
            return { sucursalId: s.id, fecha: { gte: inicio, lt: fin } };
          }),
        },
        select: {
          id: true,
          folio: true,
          tipo: true,
          sucursalId: true,
          almacenOrigenSrId: true,
          fecha: true,
          referencia: true,
          cancelada: true,
          partidas: true,
        },
        orderBy: [{ fecha: 'desc' }, { folio: 'desc' }, { id: 'asc' }],
        take: MAX_POLIZAS_TRASPASO_SR + 1,
      }),
      datos.polizaInventario.findFirst({
        where: { empresaId: q.empresaId, sucursalId: { in: ids }, tipo: tipos },
        select: { id: true },
      }),
    ]);
    const truncado = polizas.length > MAX_POLIZAS_TRASPASO_SR;
    const vistas = polizas.slice(0, MAX_POLIZAS_TRASPASO_SR);
    const polizaIds = vistas.map((p) => p.id);

    // Los traspasos del panel que apuntan a estas pólizas, con sus espejos re-verificados.
    const apuntan =
      polizaIds.length === 0
        ? []
        : await datos.partidaTraspaso.findMany({
            where: {
              empresaId: q.empresaId,
              OR: [{ polizaSalidaId: { in: polizaIds } }, { polizaEntradaId: { in: polizaIds } }],
            },
            select: SELECT_PARTIDA,
          });
    const cabeceras =
      apuntan.length === 0
        ? []
        : await datos.traspaso.findMany({
            where: {
              empresaId: q.empresaId,
              id: { in: [...new Set(apuntan.map((a) => a.traspasoId))] },
            },
            select: SELECT_CABECERA,
          });
    const vigentes = await this.#espejosVigentes(datos, q.empresaId, cabeceras, apuntan);
    const folioDe = new Map(cabeceras.map((c) => [c.id, c.folio]));
    const panelDe = new Map<string, Map<string, number>>();
    for (const a of apuntan) {
      const v = vigentes.get(a.id);
      for (const e of [v?.salida, v?.entrada]) {
        if (!e) continue;
        const m = panelDe.get(e.polizaId) ?? new Map<string, number>();
        m.set(a.traspasoId, folioDe.get(a.traspasoId)!);
        panelDe.set(e.polizaId, m);
      }
    }

    const almacenes = await datos.almacenCatalogo.findMany({
      where: { empresaId: q.empresaId, sucursalId: { in: ids } },
      select: { sucursalId: true, origenSrId: true, nombre: true },
    });
    const nombreAlmacen = new Map(
      almacenes.map((a) => [deSucursal(a.sucursalId, a.origenSrId), a.nombre]),
    );
    const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));
    const grupos = new Map<string, TraspasoSrDto>();
    for (const p of vistas) {
      const llave = p.referencia ? `ref:${p.referencia}` : `pol:${p.id}`;
      const g = grupos.get(llave) ?? { referencia: p.referencia, polizas: [], traspasosPanel: [] };
      g.polizas.push({
        polizaId: p.id,
        folio: p.folio,
        tipo: p.tipo as 'traspaso_salida' | 'traspaso_entrada',
        sucursalId: p.sucursalId,
        sucursal: nombreSucursal.get(p.sucursalId) ?? '',
        almacenOrigenSrId: p.almacenOrigenSrId,
        almacen: nombreAlmacen.get(deSucursal(p.sucursalId, p.almacenOrigenSrId)) ?? null,
        fecha: p.fecha.toISOString(),
        cancelada: p.cancelada,
        partidas: p.partidas,
      });
      for (const [id, folio] of panelDe.get(p.id) ?? []) {
        if (!g.traspasosPanel.some((t) => t.id === id)) g.traspasosPanel.push({ id, folio });
      }
      grupos.set(llave, g);
    }
    for (const g of grupos.values()) {
      // Salida antes que entrada; el panel, por folio.
      g.polizas.sort((a, b) => a.tipo.localeCompare(b.tipo) * -1 || a.fecha.localeCompare(b.fecha));
      g.traspasosPanel.sort((a, b) => a.folio - b.folio);
    }
    return {
      traspasos: [...grupos.values()],
      truncado,
      hayPolizas: alguna !== null,
      sucursales: sucursales.map((s) => ({
        sucursalId: s.id,
        sucursal: s.nombre,
        zonaHoraria: s.zonaHoraria,
      })),
    };
  }

  async enviar(
    actor: Actor,
    scope: EmpresaScope,
    dto: EnviarTraspasoDto,
  ): Promise<TraspasoDetalleDto> {
    const cantidades = dto.partidas.map((p) => new Prisma.Decimal(p.cantidad));
    if (cantidades.some((c) => c.lte(0))) {
      throw new BadRequestException('La cantidad de cada artículo tiene que ser mayor que 0.');
    }
    // 404 con el scope del USUARIO antes de escribir (la escritura lo vuelve a verificar).
    await verificarAlcance(this.datos.para(scope), dto.empresaId, dto.sucursalOrigenId);
    await verificarAlcance(this.datos.para(scope), dto.empresaId, dto.sucursalDestinoId);
    const id = await this.datos.traspasos(scope).enviar(
      {
        empresaId: dto.empresaId,
        sucursalOrigenId: dto.sucursalOrigenId,
        almacenOrigenSrId: dto.almacenOrigenSrId,
        sucursalDestinoId: dto.sucursalDestinoId,
        almacenDestinoSrId: dto.almacenDestinoSrId,
        nota: dto.nota?.trim() || null,
        partidas: dto.partidas.map((p, i) => ({
          insumoOrigenSrId: p.insumoOrigenSrId,
          cantidad: cantidades[i],
        })),
      },
      actor.id,
      new Date(this.reloj.ahora()),
    );
    this.auditoria.registrar(actor, {
      accion: 'traspaso.enviar',
      recurso: 'traspaso',
      recursoId: id,
      empresaId: dto.empresaId,
    });
    return this.detalle(scope, id, dto.empresaId);
  }

  async recibir(
    actor: Actor,
    scope: EmpresaScope,
    id: string,
    empresaId: string,
  ): Promise<TraspasoDetalleDto> {
    await verificarAlcance(this.datos.para(scope), empresaId);
    await this.datos
      .traspasos(scope)
      .recibir(empresaId, id, actor.id, new Date(this.reloj.ahora()));
    this.auditoria.registrar(actor, {
      accion: 'traspaso.recibir',
      recurso: 'traspaso',
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
  ): Promise<TraspasoDetalleDto> {
    await verificarAlcance(this.datos.para(scope), empresaId);
    await this.datos
      .traspasos(scope)
      .cancelar(empresaId, id, actor.id, new Date(this.reloj.ahora()));
    this.auditoria.registrar(actor, {
      accion: 'traspaso.cancelar',
      recurso: 'traspaso',
      recursoId: id,
      empresaId,
    });
    return this.detalle(scope, id, empresaId);
  }

  // ------------------------------------------------------------------ internos

  /** El umbral efectivo (horas) de la regla `traspaso_sin_conciliar` de la empresa. */
  async #umbral(datos: DatosScoped, empresaId: string): Promise<number> {
    const guardadas = await datos.reglaAlerta.findMany({
      where: { empresaId, tipo: TipoAlerta.traspaso_sin_conciliar },
      select: { tipo: true, activa: true, umbral: true },
    });
    return (
      reglasEfectivas(guardadas).find((r) => r.tipo === TipoAlerta.traspaso_sin_conciliar)
        ?.umbral ?? definicion(TipoAlerta.traspaso_sin_conciliar).porDefecto
    );
  }

  #partidas(datos: DatosScoped, empresaId: string, ids: readonly string[]): Promise<Partida[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return datos.partidaTraspaso.findMany({
      where: { empresaId, traspasoId: { in: [...ids] } },
      select: SELECT_PARTIDA,
      orderBy: [{ insumoOrigenSrId: 'asc' }, { id: 'asc' }],
    });
  }

  /**
   * Los espejos guardados que SIGUEN sirviendo (la misma regla de la conciliación), por partida.
   * Un espejo cuyo movimiento ya no está en (póliza, renglón), cambió, o cuya póliza se canceló,
   * sale nulo: la vista no lo pinta aunque la conciliación todavía no lo haya soltado.
   */
  async #espejosVigentes(
    datos: DatosScoped,
    empresaId: string,
    cabeceras: readonly Cabecera[],
    partidas: readonly Partida[],
  ): Promise<Map<string, EspejoVigente>> {
    const salida = new Map<string, EspejoVigente>();
    const polizaIds = [
      ...new Set(
        partidas.flatMap((p) => [p.polizaSalidaId, p.polizaEntradaId]).filter((x) => x !== null),
      ),
    ] as string[];
    if (polizaIds.length === 0) return salida;
    const [movimientos, polizas] = await Promise.all([
      datos.movimientoInventario.findMany({
        where: { empresaId, polizaId: { in: polizaIds } },
        select: {
          polizaId: true,
          renglon: true,
          sucursalId: true,
          almacenOrigenSrId: true,
          insumoOrigenSrId: true,
          cantidad: true,
          fecha: true,
        },
      }),
      datos.polizaInventario.findMany({
        where: { empresaId, id: { in: polizaIds } },
        select: { id: true, folio: true, referencia: true, tipo: true, cancelada: true },
      }),
    ]);
    const polizaDe = new Map(polizas.map((p) => [p.id, p]));
    const movDe = new Map<string, MovimientoCandidato>();
    for (const m of movimientos) {
      const p = polizaDe.get(m.polizaId);
      if (!p || (p.tipo !== 'traspaso_salida' && p.tipo !== 'traspaso_entrada')) continue;
      const c: MovimientoCandidato = {
        polizaId: m.polizaId,
        renglon: m.renglon,
        sucursalId: m.sucursalId,
        almacen: m.almacenOrigenSrId,
        insumo: m.insumoOrigenSrId,
        cantidad: m.cantidad,
        fecha: m.fecha.getTime(),
        tipo: p.tipo,
        cancelada: p.cancelada,
      };
      movDe.set(llaveEspejo(c), c);
    }
    const cabeceraDe = new Map(cabeceras.map((c) => [c.id, c]));
    const vista = (e: Espejo, m: MovimientoCandidato): EspejoDto => {
      const p = polizaDe.get(e.polizaId)!;
      return {
        polizaId: e.polizaId,
        folio: p.folio,
        referencia: p.referencia,
        renglon: e.renglon,
        fecha: new Date(m.fecha).toISOString(),
      };
    };
    for (const p of partidas) {
      const t = cabeceraDe.get(p.traspasoId);
      if (!t || t.estado === 'cancelado') continue;
      const r: RenglonAConciliar = {
        partidaId: p.id,
        sucursalOrigenId: t.sucursalId,
        almacenOrigen: t.almacenOrigenSrId,
        sucursalDestinoId: t.sucursalDestinoId,
        almacenDestino: t.almacenDestinoSrId,
        insumo: p.insumoOrigenSrId,
        cantidad: p.cantidad,
        enviadoAt: t.enviadoAt.getTime(),
        recibidoAt: t.recibidoAt?.getTime() ?? null,
        salida: null,
        entrada: null,
      };
      const s: Espejo | null =
        p.polizaSalidaId !== null
          ? { polizaId: p.polizaSalidaId, renglon: p.renglonSalida! }
          : null;
      const e: Espejo | null =
        p.polizaEntradaId !== null
          ? { polizaId: p.polizaEntradaId, renglon: p.renglonEntrada! }
          : null;
      const ms = s ? movDe.get(llaveEspejo(s)) : undefined;
      const me = e ? movDe.get(llaveEspejo(e)) : undefined;
      salida.set(p.id, {
        salida: s && ms && sirveDeSalida(r, ms) ? vista(s, ms) : null,
        entrada: e && me && sirveDeEntrada(r, me) ? vista(e, me) : null,
      });
    }
    return salida;
  }

  #resumen(
    t: Cabecera,
    partidas: readonly Partida[],
    vigentes: ReadonlyMap<string, EspejoVigente>,
    op: {
      nombreSucursal: ReadonlyMap<string, string>;
      nombreAlmacen: ReadonlyMap<string, string>;
      ahora: number;
      umbral: number;
    },
  ): TraspasoResumenDto {
    const conciliados = partidas.filter((p) => {
      const v = vigentes.get(p.id);
      return v?.salida != null && v.entrada != null;
    }).length;
    // Conciliado para la VISTA = lo guardó la conciliación Y sus espejos siguen vigentes.
    const vigente = partidas.length > 0 && conciliados === partidas.length;
    return {
      id: t.id,
      folio: t.folio,
      sucursalId: t.sucursalId,
      sucursal: op.nombreSucursal.get(t.sucursalId) ?? '',
      almacenOrigenSrId: t.almacenOrigenSrId,
      almacenOrigen: op.nombreAlmacen.get(deSucursal(t.sucursalId, t.almacenOrigenSrId)) ?? null,
      sucursalDestinoId: t.sucursalDestinoId,
      sucursalDestino: op.nombreSucursal.get(t.sucursalDestinoId) ?? '',
      almacenDestinoSrId: t.almacenDestinoSrId,
      almacenDestino:
        op.nombreAlmacen.get(deSucursal(t.sucursalDestinoId, t.almacenDestinoSrId)) ?? null,
      nota: t.nota,
      estado: t.estado,
      conciliacion: estadoConciliacion({
        estado: t.estado,
        conciliadoAt: vigente ? t.conciliadoAt : null,
        enviadoAt: t.enviadoAt,
        ahora: op.ahora,
        umbralHoras: op.umbral,
      }),
      enviadoAt: t.enviadoAt.toISOString(),
      recibidoAt: t.recibidoAt?.toISOString() ?? null,
      canceladoAt: t.canceladoAt?.toISOString() ?? null,
      conciliadoAt: vigente ? (t.conciliadoAt?.toISOString() ?? null) : null,
      articulos: partidas.length,
      conciliados,
    };
  }
}
