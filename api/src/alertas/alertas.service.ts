import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { MotivoCierreAlerta, Prisma, SeveridadAlerta, TipoAlerta } from '@prisma/client';

import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { NotificacionesService } from '../notificaciones/notificaciones.service';
import {
  CandadoAlertasOcupado,
  type AlertaRecienAbierta,
  type TransaccionAlertas,
} from '../scope/escritura-alertas';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { AgregadosVentasService } from '../ventas/agregados-ventas.service';
import {
  evaluar,
  type ExistenciasObservadas,
  type Observacion,
  type SucursalObservada,
  type TraspasoObservado,
  type VentaObservada,
} from './evaluador';
import {
  cuentasDelSnapshot,
  diaLocal,
  existenciasObservadas,
  fallaActualizacion,
  restarDias,
} from './observar';
import {
  definicion,
  REGLAS,
  reglasEfectivas,
  SNAPSHOT_VIVO_S,
  type ReglaEfectiva,
  type UnidadUmbral,
} from './reglas';

export interface AlertaVista {
  id: string;
  sucursalId: string;
  sucursal: string;
  tipo: TipoAlerta;
  severidad: SeveridadAlerta;
  llave: string;
  umbral: number;
  detalle: Prisma.JsonValue;
  abiertaAt: string;
  cerradaAt: string | null;
  motivoCierre: MotivoCierreAlerta | null;
}

export interface HistorialAlertas {
  total: number;
  pagina: number;
  porPagina: number;
  filas: AlertaVista[];
}

export interface ReglaVista extends ReglaEfectiva {
  unidad: UnidadUmbral;
  minimo: number;
  maximo: number;
  valorPorDefecto: number;
}

export const POR_PAGINA = 50;

const SELECT_ALERTA = {
  id: true,
  sucursalId: true,
  tipo: true,
  severidad: true,
  llave: true,
  umbral: true,
  detalle: true,
  abiertaAt: true,
  cerradaAt: true,
  motivoCierre: true,
  sucursal: { select: { nombre: true } },
} as const;

type FilaAlerta = Prisma.AlertaGetPayload<{ select: typeof SELECT_ALERTA }>;

function vista(f: FilaAlerta): AlertaVista {
  return {
    id: f.id,
    sucursalId: f.sucursalId,
    sucursal: f.sucursal.nombre,
    tipo: f.tipo,
    severidad: f.severidad,
    llave: f.llave,
    umbral: f.umbral,
    detalle: f.detalle,
    abiertaAt: f.abiertaAt.toISOString(),
    cerradaAt: f.cerradaAt?.toISOString() ?? null,
    motivoCierre: f.motivoCierre,
  };
}

/** El scope interno de la evaluación: la empresa que se evalúa, nada más. */
function scopeDe(empresaId: string): EmpresaScope {
  return { tipo: 'empresa', empresaId };
}

const SCOPE_SISTEMA: EmpresaScope = { tipo: 'global' };

/**
 * Centro de alertas (F2-224). La evaluación es lo único que escribe, en dos fases:
 * `observar` (lecturas con scope, sin candado, sin reglas) y `aplicar` (bajo el candado de la
 * empresa: reglas, abiertas y qué sigue activo se leen adentro). Los GET no escriben.
 */
@Injectable()
export class AlertasService {
  private readonly logger = new Logger('Alertas');

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly ventas: AgregadosVentasService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
    private readonly notificaciones: NotificacionesService,
  ) {}

  // ---------------------------------------------------------------- evaluación

  /** Todo lo que el evaluador necesita saber de la empresa, SIN depender de las reglas. */
  async observar(empresaId: string, ahora: number): Promise<Observacion> {
    const scope = scopeDe(empresaId);
    const datos = this.datos.para(scope);
    const empresa = await datos.empresa.findFirst({
      where: { id: empresaId },
      select: { activo: true },
    });
    if (!empresa?.activo) {
      return { empresaId, sucursales: [] };
    }
    const sucursales = await datos.sucursal.findMany({
      where: { empresaId, activo: true },
      select: { id: true, zonaHoraria: true, actualizacionAutomatica: true },
      orderBy: { id: 'asc' },
    });
    const ids = sucursales.map((s) => s.id);
    const contactos = await datos.agenteContacto.findMany({
      where: { empresaId, sucursalId: { in: ids } },
      select: { sucursalId: true, ultimoContactoAt: true },
    });
    const contactoDe = new Map(contactos.map((c) => [c.sucursalId, c.ultimoContactoAt]));
    const ventas = await this.ventasPorZona(scope, empresaId, sucursales, ahora);
    const existencias = await this.existenciasPorSucursal(scope, empresaId, ids);
    const traspasos = await this.traspasosPorSucursal(scope, empresaId, ids, ahora);
    // F2-143: el reporte de actualización del agente, su versión y la vigente del canal.
    const [reportes, estados, vigente] = await Promise.all([
      datos.agenteActualizacion.findMany({ where: { empresaId, sucursalId: { in: ids } } }),
      datos.agenteEstado.findMany({
        where: { empresaId, sucursalId: { in: ids } },
        select: { sucursalId: true, versionAgente: true },
      }),
      this.datos.versionesAgente().vigente(),
    ]);
    const reporteDe = new Map(reportes.map((r) => [r.sucursalId, r]));
    const versionDe = new Map(estados.map((e) => [e.sucursalId, e.versionAgente]));

    const observadas = await Promise.all(
      sucursales.map(async (s): Promise<SucursalObservada> => {
        const snap = await datos.mesaSnapshot.findFirst({
          where: { sucursalId: s.id },
          orderBy: { capturadoAt: 'desc' },
          select: { capturadoAt: true, recibidoAt: true, payload: true },
        });
        const contacto = contactoDe.get(s.id) ?? null;
        // "Último reporte": lo más reciente entre el último lote aceptado y el último
        // snapshot recibido, ambos con el reloj del SERVIDOR.
        const ultimo = Math.max(
          contacto?.getTime() ?? -Infinity,
          snap?.recibidoAt.getTime() ?? -Infinity,
        );
        const edadReporteS = Number.isFinite(ultimo)
          ? Math.max(0, Math.floor((ahora - ultimo) / 1000))
          : null;
        const edadRecepcionS = snap
          ? Math.max(0, Math.floor((ahora - snap.recibidoAt.getTime()) / 1000))
          : null;
        const snapshotVivo = edadRecepcionS !== null && edadRecepcionS <= SNAPSHOT_VIVO_S;
        return {
          sucursalId: s.id,
          edadReporteS,
          snapshotVivo,
          cuentas:
            snap && snapshotVivo
              ? cuentasDelSnapshot(snap.payload, snap.capturadoAt, edadRecepcionS!)
              : [],
          venta: ventas.get(s.id) ?? null,
          existencias: existencias.get(s.id) ?? null,
          traspasos: traspasos.get(s.id) ?? [],
          actualizacion: fallaActualizacion({
            automatica: s.actualizacionAutomatica,
            vigente: vigente?.version ?? null,
            reporte: reporteDe.get(s.id) ?? null,
            versionAgente: versionDe.get(s.id) ?? null,
            ahora,
          }),
        };
      }),
    );
    return { empresaId, sucursales: observadas };
  }

  /**
   * Los traspasos del panel (F2-124) sin conciliar, no cancelados, por su sucursal de ORIGEN, con
   * su edad desde el envío. Con el scope de la empresa. Los nombres de destino salen de los
   * catálogos (el almacén, sin catálogo, va por su id).
   */
  private async traspasosPorSucursal(
    scope: EmpresaScope,
    empresaId: string,
    ids: readonly string[],
    ahora: number,
  ): Promise<Map<string, TraspasoObservado[]>> {
    const datos = this.datos.para(scope);
    const filas = await datos.traspaso.findMany({
      where: {
        empresaId,
        sucursalId: { in: [...ids] },
        estado: { not: 'cancelado' },
        conciliadoAt: null,
      },
      select: {
        id: true,
        folio: true,
        sucursalId: true,
        almacenOrigenSrId: true,
        sucursalDestinoId: true,
        almacenDestinoSrId: true,
        enviadoAt: true,
      },
      orderBy: [{ enviadoAt: 'asc' }, { folio: 'asc' }],
    });
    const salida = new Map<string, TraspasoObservado[]>();
    if (filas.length === 0) return salida;
    const [sucursales, almacenes] = await Promise.all([
      datos.sucursal.findMany({ where: { empresaId }, select: { id: true, nombre: true } }),
      datos.almacenCatalogo.findMany({
        where: {
          empresaId,
          sucursalId: { in: [...new Set(filas.flatMap((f) => [f.sucursalId, f.sucursalDestinoId]))] },
        },
        select: { sucursalId: true, origenSrId: true, nombre: true },
      }),
    ]);
    const nombreSucursal = new Map(sucursales.map((s) => [s.id, s.nombre]));
    const nombreAlmacen = new Map(
      almacenes.map((a) => [JSON.stringify([a.sucursalId, a.origenSrId]), a.nombre]),
    );
    const almacen = (s: string, a: string) => nombreAlmacen.get(JSON.stringify([s, a])) ?? a;
    for (const f of filas) {
      const lista = salida.get(f.sucursalId) ?? [];
      lista.push({
        id: f.id,
        folio: f.folio,
        edadS: Math.max(0, Math.floor((ahora - f.enviadoAt.getTime()) / 1000)),
        almacenOrigen: almacen(f.sucursalId, f.almacenOrigenSrId),
        sucursalDestino: nombreSucursal.get(f.sucursalDestinoId) ?? '',
        almacenDestino: almacen(f.sucursalDestinoId, f.almacenDestinoSrId),
      });
      salida.set(f.sucursalId, lista);
    }
    return salida;
  }

  /**
   * Lo que la regla de bajo mínimo (F2-121) necesita de cada sucursal: sus lecturas, sus
   * límites con mínimo, la existencia de esos artículos en la última foto y el nombre del
   * insumo. Todo con el scope de la empresa. Sin lectura = sin entrada (no se evalúa).
   */
  private async existenciasPorSucursal(
    scope: EmpresaScope,
    empresaId: string,
    ids: readonly string[],
  ): Promise<Map<string, ExistenciasObservadas>> {
    const datos = this.datos.para(scope);
    const deEstas = { empresaId, sucursalId: { in: [...ids] } };
    const [lecturas, limites] = await Promise.all([
      datos.lecturaExistencias.groupBy({
        by: ['sucursalId'],
        where: deEstas,
        _count: { _all: true },
      }),
      datos.limiteExistencia.findMany({
        where: { ...deEstas, minimo: { not: null } },
        select: { sucursalId: true, almacenOrigenSrId: true, insumoOrigenSrId: true, minimo: true },
      }),
    ]);
    const salida = new Map<string, ExistenciasObservadas>();
    const conLectura = lecturas.filter((l) => l._count._all > 0).map((l) => l.sucursalId);
    if (conLectura.length === 0) return salida;
    const insumos = [...new Set(limites.map((l) => l.insumoOrigenSrId))];
    const [filas, catalogo] = await Promise.all([
      insumos.length === 0
        ? Promise.resolve([])
        : datos.existencia.findMany({
            where: { empresaId, sucursalId: { in: conLectura }, insumoOrigenSrId: { in: insumos } },
            select: {
              sucursalId: true,
              almacenOrigenSrId: true,
              insumoOrigenSrId: true,
              cantidad: true,
            },
          }),
      insumos.length === 0
        ? Promise.resolve([])
        : datos.insumo.findMany({
            where: { empresaId, sucursalId: { in: conLectura }, origenSrId: { in: insumos } },
            select: { sucursalId: true, origenSrId: true, nombre: true },
          }),
    ]);
    for (const sucursalId of conLectura) {
      const obs = existenciasObservadas({
        lecturas: lecturas.find((l) => l.sucursalId === sucursalId)?._count._all ?? 0,
        limites: limites.flatMap((l) =>
          l.sucursalId === sucursalId && l.minimo !== null ? [{ ...l, minimo: l.minimo }] : [],
        ),
        filas: filas.filter((f) => f.sucursalId === sucursalId),
        nombres: new Map(
          catalogo.filter((c) => c.sucursalId === sucursalId).map((c) => [c.origenSrId, c.nombre]),
        ),
      });
      if (obs) salida.set(sucursalId, obs);
    }
    return salida;
  }

  /**
   * Venta de hoy (día local de cada sucursal) y la del mismo día de la semana pasada cortada
   * a la misma altura (`alturaAl` = ahora, el corte de F2-220 por zona de cada sucursal). Una
   * consulta por zona: el "hoy" de cada zona es otro día. Sin cálculo propio: los mismos
   * agregados que pintan Inicio y el Resumen.
   */
  private async ventasPorZona(
    scope: EmpresaScope,
    empresaId: string,
    sucursales: ReadonlyArray<{ id: string; zonaHoraria: string }>,
    ahora: number,
  ): Promise<Map<string, VentaObservada>> {
    const porZona = new Map<string, Set<string>>();
    for (const s of sucursales) {
      const ids = porZona.get(s.zonaHoraria) ?? new Set<string>();
      ids.add(s.id);
      porZona.set(s.zonaHoraria, ids);
    }
    const salida = new Map<string, VentaObservada>();
    for (const [zona, ids] of porZona) {
      const dia = diaLocal(ahora, zona);
      const base = restarDias(dia, 7);
      const [hoy, antes] = await Promise.all([
        this.ventas.comparativoSucursales(scope, { empresaId, desde: dia, hasta: dia }),
        this.ventas.comparativoSucursales(scope, {
          empresaId,
          desde: base,
          hasta: base,
          alturaAl: new Date(ahora).toISOString(),
        }),
      ]);
      for (const h of hoy) {
        if (!ids.has(h.sucursalId)) continue;
        const b = antes.find((x) => x.sucursalId === h.sucursalId);
        if (!b) continue;
        salida.set(h.sucursalId, { dia, hoy: h.venta, base: b.venta, cuentasBase: b.cuentas });
      }
    }
    return salida;
  }

  /**
   * Aplica una observación bajo el candado ya tomado. Cierra antes de abrir.
   *
   * Marca de agua (bloqueo B1 del revisor, gate del entregable): el candado ordena las
   * APLICACIONES, no las observaciones. Una observación tomada FUERA del candado con un
   * instante anterior a la última aplicada llegó tarde: aplicarla cerraría con una hora
   * anterior a la apertura (viola `alertas_abierta_chk`) o abriría una fila fantasma. Se
   * descarta (devuelve `null`). Una observación tomada DENTRO del candado (`fresca`) es la
   * más nueva por construcción y siempre se aplica. La hora que se escribe nunca es anterior
   * a la marca, así que `cerrada_at >= abierta_at` se sostiene aunque el reloj retroceda.
   *
   * Aplicada, devuelve las alertas que abrió DE VERDAD (F2-146: su push sale después del
   * commit, en quien llamó).
   */
  private async aplicarEn(
    tx: TransaccionAlertas,
    obs: Observacion,
    observadoAt: number,
    fresca: boolean,
  ): Promise<AlertaRecienAbierta[] | null> {
    const marca = await tx.marcaDeAgua();
    if (!fresca && marca !== null && observadoAt < marca) {
      return null;
    }
    const ahora = marca === null ? observadoAt : Math.max(observadoAt, marca);
    const [empresaActiva, sucursalesActivas, guardadas, abiertas] = await Promise.all([
      tx.empresaActiva(),
      tx.sucursalesActivas(),
      tx.reglas(),
      tx.abiertas(),
    ]);
    const cambios = evaluar(obs, {
      empresaActiva,
      sucursalesActivas,
      reglas: reglasEfectivas(guardadas),
      abiertas,
    });
    const instante = new Date(ahora);
    const porMotivo = new Map<MotivoCierreAlerta, string[]>();
    for (const c of cambios.cerrar) {
      porMotivo.set(c.motivo, [...(porMotivo.get(c.motivo) ?? []), c.id]);
    }
    for (const [motivo, ids] of porMotivo) {
      await tx.cerrar(ids, instante, motivo);
    }
    const abiertasNuevas = await tx.abrir(cambios.abrir, instante);
    await tx.avanzarMarca(instante);
    return abiertasNuevas;
  }

  /**
   * Aplica una observación tomada ANTES (fuera del candado) bajo el candado de su empresa.
   * Devuelve `false` si llegó tarde y se descartó (ver `aplicarEn`).
   */
  async aplicar(obs: Observacion, observadoAt: number): Promise<boolean> {
    const abiertas = await this.datos
      .alertas(SCOPE_SISTEMA)
      .bajoCandado(obs.empresaId, (tx) => this.aplicarEn(tx, obs, observadoAt, false));
    if (abiertas === null) return false;
    // F2-146: el push sale DESPUÉS del commit y sin esperar (nunca bajo el candado).
    this.notificaciones.alertasAbiertas(abiertas);
    return true;
  }

  /**
   * Una vuelta completa para una empresa: observar y aplicar. La usa el programador. Si otra
   * evaluación más nueva se aplicó primero, ésta se descarta sin error: la siguiente vuelta
   * vuelve a observar.
   */
  async evaluarEmpresa(empresaId: string): Promise<boolean> {
    await this.conciliarTraspasos(empresaId);
    const ahora = this.reloj.ahora();
    const obs = await this.observar(empresaId, ahora);
    return this.aplicar(obs, ahora);
  }

  /**
   * F2-124: concilia los traspasos de la empresa ANTES de observar, en la misma vuelta: así una
   * alerta de "sin conciliar" nunca se abre sobre un traspaso cuyo espejo ya llegó. Con el scope de
   * la EMPRESA (nunca el global). Si el candado está ocupado (otra escritura de traspasos en
   * curso) se registra y se evalúa con lo que hay: a lo más retrasa una alerta una vuelta, nunca
   * inventa una. Cualquier otro error se propaga (no se deja la alerta ciega en silencio).
   */
  async conciliarTraspasos(empresaId: string): Promise<void> {
    try {
      await this.datos
        .traspasos(scopeDe(empresaId))
        .conciliar(empresaId, new Date(this.reloj.ahora()));
    } catch (error) {
      if (!(error instanceof ServiceUnavailableException)) throw error;
      this.logger.warn(`Conciliación de traspasos de ${empresaId} pospuesta: ${error.message}`);
    }
  }

  /** Empresas a evaluar: las activas, más las inactivas que aún tengan alertas abiertas. */
  async empresasAEvaluar(): Promise<string[]> {
    const filas = await this.datos.para(SCOPE_SISTEMA).empresa.findMany({
      where: { OR: [{ activo: true }, { alertas: { some: { cerradaAt: null } } }] },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return filas.map((f) => f.id);
  }

  // ---------------------------------------------------------------- lectura

  async abiertas(
    scope: EmpresaScope,
    empresaId: string,
    sucursalId?: string,
  ): Promise<AlertaVista[]> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId, sucursalId);
    const filas = await datos.alerta.findMany({
      where: { empresaId, cerradaAt: null, ...(sucursalId ? { sucursalId } : {}) },
      select: SELECT_ALERTA,
      // El ENUM ordena como se declaró: crítica primero.
      orderBy: [{ severidad: 'asc' }, { abiertaAt: 'asc' }, { id: 'asc' }],
    });
    return filas.map(vista);
  }

  async historial(
    scope: EmpresaScope,
    empresaId: string,
    pagina: number,
    sucursalId?: string,
  ): Promise<HistorialAlertas> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId, sucursalId);
    const where = { empresaId, ...(sucursalId ? { sucursalId } : {}) };
    const [total, filas] = await Promise.all([
      datos.alerta.count({ where }),
      datos.alerta.findMany({
        where,
        select: SELECT_ALERTA,
        orderBy: [{ abiertaAt: 'desc' }, { id: 'desc' }],
        skip: (pagina - 1) * POR_PAGINA,
        take: POR_PAGINA,
      }),
    ]);
    return { total, pagina, porPagina: POR_PAGINA, filas: filas.map(vista) };
  }

  async reglas(scope: EmpresaScope, empresaId: string): Promise<ReglaVista[]> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId);
    const guardadas = await datos.reglaAlerta.findMany({
      where: { empresaId },
      select: { tipo: true, activa: true, umbral: true },
    });
    return reglasEfectivas(guardadas).map((r) => {
      const d = definicion(r.tipo);
      return {
        ...r,
        unidad: d.unidad,
        minimo: d.minimo,
        maximo: d.maximo,
        valorPorDefecto: d.porDefecto,
      };
    });
  }

  /**
   * Guarda una regla y, en la MISMA transacción y bajo el candado, recalcula las alertas de
   * la empresa con ella: un umbral nuevo o una regla apagada se reflejan al responder, sin
   * esperar al programador ni reiniciar nada. El historial nunca se borra.
   */
  async guardarRegla(
    actor: Actor,
    scope: EmpresaScope,
    empresaId: string,
    tipo: TipoAlerta,
    cambio: { activa: boolean; umbral: number },
  ): Promise<ReglaVista[]> {
    const d = definicion(tipo);
    if (!Number.isInteger(cambio.umbral) || cambio.umbral < d.minimo || cambio.umbral > d.maximo) {
      throw new BadRequestException(
        `umbral de ${tipo} debe ser un entero entre ${d.minimo} y ${d.maximo} (${d.unidad}).`,
      );
    }
    // 404 con el scope del USUARIO antes de observar nada.
    await verificarAlcance(this.datos.para(scope), empresaId);
    // Como en la vuelta del programador: primero se concilian los traspasos (F2-124).
    await this.conciliarTraspasos(empresaId);
    try {
      const abiertas = await this.datos.alertas(scope).bajoCandado(empresaId, async (tx) => {
        await tx.guardarRegla(tipo, cambio.activa, cambio.umbral);
        // Se observa CON el candado tomado: ninguna otra aplicación puede colarse entre esta
        // observación y su aplicación, así que es la más nueva y nunca se descarta.
        const ahora = this.reloj.ahora();
        const obs = await this.observar(empresaId, ahora);
        return this.aplicarEn(tx, obs, ahora, true);
      });
      // F2-146: bajar un umbral puede abrir alertas; su push sale después del commit.
      if (abiertas !== null) this.notificaciones.alertasAbiertas(abiertas);
    } catch (error) {
      if (error instanceof CandadoAlertasOcupado) {
        throw new ServiceUnavailableException(error.message);
      }
      throw error;
    }
    this.auditoria.registrar(actor, {
      accion: 'regla_alerta.editar',
      recurso: 'regla_alerta',
      recursoId: `${empresaId}:${tipo}`,
      empresaId,
      campos: ['activa', 'umbral'],
    });
    return this.reglas(scope, empresaId);
  }
}

/** Las reglas en su orden, para documentación y validación del parámetro de ruta. */
export const TIPOS_ALERTA: readonly TipoAlerta[] = REGLAS.map((r) => r.tipo);
