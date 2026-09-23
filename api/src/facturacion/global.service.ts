import { Injectable, Logger } from '@nestjs/common';

import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import type { EmpresaScope } from '../scope/empresa-scope';
import type {
  ConfiguracionGlobal,
  GlobalEmitida,
  PedidoGlobal,
} from '../scope/escritura-facturacion';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { CfdiService } from './cfdi.service';
import type {
  ConfiguracionGlobalDto,
  FacturaGlobalEmitidaDto,
  GlobalEmitidaDto,
  PeriodoGlobalDto,
  PeriodosGlobalDto,
  VistaPreviaGlobalDto,
} from './dto/global.dto';
import {
  enrollarPeriodos,
  PERIODICIDAD_DE_SAT,
  periodoGuardado,
  receptorPublicoGeneral,
  type PeriodicidadGlobalEnum,
  type PeriodoGlobal,
} from './global';

/** El scope del SISTEMA: sólo para listar qué empresas tienen la global automática. */
const SCOPE_SISTEMA: EmpresaScope = { tipo: 'global' };

/** El caso AMBIGUO de una global: los tickets siguen amarrados a la reserva hasta conciliarla. */
export const MENSAJE_GLOBAL_INCIERTA =
  'El servicio de timbrado no confirmó a tiempo y la factura global pudo haberse emitido. No la ' +
  'vuelvas a pedir: sus tickets siguen reservados. Revisa en unos minutos (o en el PAC) antes de ' +
  'reintentar.';

const DIAS_PERIODICIDAD: Readonly<Record<PeriodicidadGlobalEnum, string>> = {
  diaria: 'diaria',
  semanal: 'semanal',
  mensual: 'mensual',
};

/**
 * Cuándo la vigencia de los códigos RETRASA la global: la global de un periodo espera a que venza
 * el último ticket. Null si no la retrasa (fin de mes + mensual).
 * DECISION PROVISIONAL (nocturno): esperar a que venzan es lo conservador (nunca se globaliza algo
 * que el cliente todavía puede facturar); choca con el plazo del SAT para emitir la global cuando
 * la vigencia es más larga que el periodo. Decisión abierta para Ricardo (F2-190).
 */
export function avisoVigencia(c: ConfiguracionGlobal): string | null {
  if (c.vigencia.regla === 'dias') {
    return (
      `Los tickets se pueden facturar hasta ${c.vigencia.dias} día(s) después de su cierre: la ` +
      `factura global ${DIAS_PERIODICIDAD[c.periodicidad]} de cada periodo espera a que venza el ` +
      'último ticket, así que sale hasta ese tiempo después de que termina el periodo. El SAT pide ' +
      'emitirla poco después del cierre: revísalo con tu contador.'
    );
  }
  if (c.periodicidad !== 'mensual') {
    return (
      'Los tickets se pueden facturar hasta el fin del mes: la factura global ' +
      `${DIAS_PERIODICIDAD[c.periodicidad]} de cada periodo espera al fin de mes para salir. El ` +
      'SAT pide emitirla poco después del cierre: revísalo con tu contador.'
    );
  }
  return null;
}

function periodoDto(p: PeriodoGlobal): PeriodoGlobalDto {
  return {
    clave: p.clave,
    ultimoDia: p.ultimoDia,
    periodicidad: p.periodicidad,
    etiqueta: p.etiqueta,
    desde: p.desde.toISOString(),
    hasta: p.hasta.toISOString(),
    periodicidadSat: p.informacion.periodicidad,
    meses: p.informacion.meses,
    anio: p.informacion.anio,
  };
}

function emitidaDto(e: GlobalEmitida, zona: string): GlobalEmitidaDto {
  const periodo = periodoGuardado(e, zona);
  return {
    id: e.id,
    uuid: e.uuid,
    serieFolio: e.serieFolio,
    estado: e.estado,
    total: e.total.toFixed(2),
    emitidoAt: e.emitidoAt?.toISOString() ?? null,
    etiqueta: periodo?.etiqueta ?? null,
    periodicidad:
      e.globalPeriodicidad === null ? null : (PERIODICIDAD_DE_SAT[e.globalPeriodicidad] ?? null),
    tickets: e.tickets,
    conArchivos: e.conArchivos,
  };
}

/**
 * La FACTURA GLOBAL (F2-108): configuración por empresa, periodos por sucursal, vista previa,
 * emisión manual y la vuelta automática del programador. La emisión va por el MISMO tramo que las
 * demás (`CfdiService.emitirReserva`); lo propio de la global (candado por ticket, periodo, un
 * concepto por ticket) vive en `EscrituraFacturacion.reservarGlobal` y en `global.ts`.
 *
 * Todo con el scope de quien pide: empresa o sucursal fuera de su alcance = 404.
 */
@Injectable()
export class FacturaGlobalService {
  readonly #log = new Logger(FacturaGlobalService.name);

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly cfdi: CfdiService,
    private readonly auditoria: Auditoria,
  ) {}

  #ahora(): Date {
    return new Date(this.reloj.ahora());
  }

  #configDto(c: ConfiguracionGlobal): ConfiguracionGlobalDto {
    return {
      periodicidad: c.periodicidad,
      automatica: c.automatica,
      automaticaDesde: c.automaticaDesde?.toISOString() ?? null,
      vigencia: {
        regla: c.vigencia.regla,
        dias: c.vigencia.regla === 'dias' ? c.vigencia.dias : null,
      },
      aviso: avisoVigencia(c),
    };
  }

  async configuracion(scope: EmpresaScope, empresaId: string): Promise<ConfiguracionGlobalDto> {
    return this.#configDto(await this.datos.facturacion(scope).configuracionGlobal(empresaId));
  }

  async guardarConfiguracion(
    scope: EmpresaScope,
    actor: Actor,
    empresaId: string,
    datos: { periodicidad: PeriodicidadGlobalEnum; automatica: boolean },
  ): Promise<ConfiguracionGlobalDto> {
    const c = await this.datos
      .facturacion(scope)
      .guardarConfiguracionGlobal(empresaId, datos, actor.id, this.#ahora());
    this.auditoria.registrar(actor, {
      accion: 'factura_global.configurar',
      recurso: 'configuracion_facturacion',
      recursoId: empresaId,
      empresaId,
      campos: ['globalPeriodicidad', 'globalAutomatica'],
    });
    return this.#configDto(c);
  }

  async periodos(
    scope: EmpresaScope,
    empresaId: string,
    sucursalId: string,
    periodicidad?: PeriodicidadGlobalEnum,
  ): Promise<PeriodosGlobalDto> {
    const escritura = this.datos.facturacion(scope);
    const ahora = this.#ahora();
    const per = periodicidad ?? (await escritura.configuracionGlobal(empresaId)).periodicidad;
    const { sucursal, dias, emitidas } = await escritura.periodosGlobal(
      empresaId,
      sucursalId,
      ahora,
    );
    const periodos = enrollarPeriodos(
      dias,
      sucursal.zonaHoraria,
      per,
      ahora,
      previasPorClave(emitidas, sucursal.zonaHoraria, per),
    );
    const canceladas = previasPorClave(emitidas, sucursal.zonaHoraria, per, true);
    return {
      sucursal,
      periodicidad: per,
      periodos: periodos.map((r) => ({
        ...periodoDto(r.periodo),
        estado: r.estado,
        tickets: r.nListos,
        total: r.totalListos.toFixed(2),
        vigentes: r.nVigentes,
        vigentesHasta: r.vigentesHasta?.toISOString() ?? null,
        globalesPrevias: r.globalesPrevias,
        globalesCanceladas: canceladas.get(r.periodo.clave) ?? 0,
      })),
      emitidas: emitidas.map((e) => emitidaDto(e, sucursal.zonaHoraria)),
    };
  }

  async vistaPrevia(
    scope: EmpresaScope,
    empresaId: string,
    pedido: PedidoGlobal,
  ): Promise<VistaPreviaGlobalDto> {
    const v = await this.datos
      .facturacion(scope)
      .vistaPreviaGlobal(empresaId, pedido, this.#ahora());
    return {
      sucursal: v.sucursal,
      periodo: periodoDto(v.periodo),
      estado: v.estado,
      tickets: v.tickets.map((t) => ({
        folio: t.folio,
        cerradoAt: t.cerradoAt.toISOString(),
        total: t.total.toFixed(2),
      })),
      vigentes: v.vigentes.tickets,
      vigentesHasta: v.vigentes.hasta?.toISOString() ?? null,
      formaPago: v.formaPago,
      subtotal: v.importes?.subtotal.toFixed(2) ?? null,
      iva: v.importes?.iva.toFixed(2) ?? null,
      total: v.importes?.total.toFixed(2) ?? null,
      globalesPrevias: v.globalesPrevias,
    };
  }

  /** Emite la global de un periodo a mano (el administrador, desde la vista previa). */
  async emitir(
    scope: EmpresaScope,
    actor: Actor,
    empresaId: string,
    pedido: PedidoGlobal,
  ): Promise<FacturaGlobalEmitidaDto> {
    const emitida = await this.#emitir(scope, empresaId, pedido);
    this.auditoria.registrar(actor, {
      accion: 'cfdi.global',
      recurso: 'cfdi',
      recursoId: emitida.id,
      empresaId,
      campos: [],
    });
    return emitida;
  }

  async #emitir(
    scope: EmpresaScope,
    empresaId: string,
    pedido: PedidoGlobal,
  ): Promise<FacturaGlobalEmitidaDto> {
    const ahora = this.#ahora();
    const reserva = await this.datos.facturacion(scope).reservarGlobal(empresaId, pedido, ahora);
    const emitida = await this.cfdi.emitirReserva(
      empresaId,
      reserva,
      receptorPublicoGeneral(reserva.emisor.cp),
      { incierta: MENSAJE_GLOBAL_INCIERTA, fecha: ahora },
    );
    return {
      id: emitida.id,
      uuid: emitida.uuid,
      serieFolio: emitida.serieFolio,
      total: emitida.total,
      tickets: reserva.global!.tickets.length,
      etiqueta: reserva.global!.etiqueta,
      descargas: emitida.descargas,
    };
  }

  /**
   * Una vuelta de la emisión AUTOMÁTICA. Con el scope del sistema SÓLO se listan las empresas con
   * la global automática; después, empresa por empresa y con SU scope, sucursal por sucursal, se
   * emite cada periodo `lista`:
   * - que termine DESPUÉS de encender la automática (encenderla no timbra meses viejos de golpe);
   * - que no tenga ya una global (una complementaria —tickets que llegaron tarde— es a mano).
   * Dos vueltas a la vez (dos réplicas) no duplican: el candado es el único de `codigo_id` en
   * `cfdi_global_codigos`. Un error de un periodo se loguea y la vuelta sigue.
   */
  async vueltaAutomatica(): Promise<{ emitidas: number; fallidas: number }> {
    const empresas = await this.datos.facturacion(SCOPE_SISTEMA).empresasConGlobalAutomatica();
    let emitidas = 0;
    let fallidas = 0;
    for (const e of empresas) {
      const scope: EmpresaScope = { tipo: 'empresa', empresaId: e.empresaId };
      for (const sucursalId of e.sucursales) {
        let pendientes: PeriodoGlobal[];
        try {
          const escritura = this.datos.facturacion(scope);
          const ahora = this.#ahora();
          const {
            sucursal,
            dias,
            emitidas: previas,
          } = await escritura.periodosGlobal(e.empresaId, sucursalId, ahora);
          // F2-109. DECISION PROVISIONAL (nocturno): un periodo cuya global se CANCELÓ no se
          // re-emite solo (si salió mal, la automática la volvería a emitir igual): queda para
          // emisión manual (docs/esquema-sr.md §2).
          const canceladas = previasPorClave(previas, sucursal.zonaHoraria, e.periodicidad, true);
          pendientes = enrollarPeriodos(
            dias,
            sucursal.zonaHoraria,
            e.periodicidad,
            ahora,
            previasPorClave(previas, sucursal.zonaHoraria, e.periodicidad),
          )
            .filter(
              (r) =>
                r.estado === 'lista' &&
                r.globalesPrevias === 0 &&
                !canceladas.has(r.periodo.clave) &&
                r.periodo.hasta.getTime() > e.desde.getTime(),
            )
            .map((r) => r.periodo)
            .reverse();
        } catch (error) {
          fallidas++;
          this.#log.warn(
            `Global automática: no se pudieron leer los periodos de la sucursal ${sucursalId}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
          continue;
        }
        for (const p of pendientes) {
          try {
            const r = await this.#emitir(scope, e.empresaId, {
              sucursalId,
              periodicidad: e.periodicidad,
              clave: p.clave,
            });
            emitidas++;
            this.#log.log(
              `Global automática ${r.serieFolio} (${r.tickets} tickets) de ${p.etiqueta}, ` +
                `sucursal ${sucursalId}.`,
            );
          } catch (error) {
            fallidas++;
            this.#log.warn(
              `Global automática de ${p.etiqueta} (sucursal ${sucursalId}) no salió: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      }
    }
    return { emitidas, fallidas };
  }
}

/**
 * Cuántas globales vigentes (o en emisión) tiene ya cada periodo, por clave, para la periodicidad
 * dada. Una global de OTRA periodicidad no cuenta (su periodo es otro).
 */
function previasPorClave(
  emitidas: readonly GlobalEmitida[],
  zona: string,
  periodicidad: PeriodicidadGlobalEnum,
  /** F2-109: `true` cuenta las CANCELADAS en vez de las vigentes (o en emisión). */
  canceladas = false,
): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const e of emitidas) {
    if ((e.estado === 'cancelado') !== canceladas) continue;
    const p = periodoGuardado(e, zona);
    if (p === null || p.periodicidad !== periodicidad) continue;
    mapa.set(p.clave, (mapa.get(p.clave) ?? 0) + 1);
  }
  return mapa;
}
