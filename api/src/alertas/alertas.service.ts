import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { MotivoCierreAlerta, Prisma, SeveridadAlerta, TipoAlerta } from '@prisma/client';

import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { CandadoAlertasOcupado, type TransaccionAlertas } from '../scope/escritura-alertas';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { AgregadosVentasService } from '../ventas/agregados-ventas.service';
import {
  evaluar,
  type Observacion,
  type SucursalObservada,
  type VentaObservada,
} from './evaluador';
import { cuentasDelSnapshot, diaLocal, restarDias } from './observar';
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
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly ventas: AgregadosVentasService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
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
      select: { id: true, zonaHoraria: true },
      orderBy: { id: 'asc' },
    });
    const ids = sucursales.map((s) => s.id);
    const contactos = await datos.agenteContacto.findMany({
      where: { empresaId, sucursalId: { in: ids } },
      select: { sucursalId: true, ultimoContactoAt: true },
    });
    const contactoDe = new Map(contactos.map((c) => [c.sucursalId, c.ultimoContactoAt]));
    const ventas = await this.ventasPorZona(scope, empresaId, sucursales, ahora);

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
        };
      }),
    );
    return { empresaId, sucursales: observadas };
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

  /** Aplica una observación bajo el candado ya tomado. Cierra antes de abrir. */
  private async aplicarEn(tx: TransaccionAlertas, obs: Observacion, ahora: number): Promise<void> {
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
    await tx.abrir(cambios.abrir, instante);
  }

  /** Aplica una observación (tomada antes) bajo el candado de su empresa. */
  async aplicar(obs: Observacion, ahora: number): Promise<void> {
    await this.datos
      .alertas(SCOPE_SISTEMA)
      .bajoCandado(obs.empresaId, (tx) => this.aplicarEn(tx, obs, ahora));
  }

  /** Una vuelta completa para una empresa: observar y aplicar. La usa el programador. */
  async evaluarEmpresa(empresaId: string): Promise<void> {
    const ahora = this.reloj.ahora();
    const obs = await this.observar(empresaId, ahora);
    await this.aplicar(obs, ahora);
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
    const ahora = this.reloj.ahora();
    const obs = await this.observar(empresaId, ahora);
    try {
      await this.datos.alertas(scope).bajoCandado(empresaId, async (tx) => {
        await tx.guardarRegla(tipo, cambio.activa, cambio.umbral);
        await this.aplicarEn(tx, obs, ahora);
      });
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
