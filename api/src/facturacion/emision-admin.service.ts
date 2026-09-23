import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

import { PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import {
  ErrorTimbrado,
  type EstadoCfdi,
  type PuertoTimbrado,
} from '../adaptadores/timbrado/puerto';
import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  MENSAJE_YA_CANCELADO,
  MENSAJE_SUSTITUCION_EN_CURSO,
  type CfdiParaRefacturar,
  type DatosReceptor,
} from '../scope/escritura-facturacion';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { MENSAJE_REFACTURAR_CON_CANCELACION } from './cancelacion';
import { CancelacionCfdiService } from './cancelacion.service';
import { FORMA_PAGO_SAT, MENSAJE_TOTAL_MANUAL, totalManual, type FormaPagoEnum } from './cfdi';
import { CfdiService, MENSAJE_EMISION_INCIERTA_ADMIN, MENSAJE_PAC_CAIDO } from './cfdi.service';
import { validarReceptor, type ErroresReceptor, type ReceptorPortal } from './portal';
import { normalizarRfc } from './sat';

/** Lo que captura el administrador en "Facturar sin ticket" (F2-107), recortado por el DTO. */
export interface CapturaManual {
  empresaId: string;
  sucursalId: string;
  solicitudId: string;
  /** Texto: nunca pasa por `number`. */
  total: string;
  formaPago: Exclude<FormaPagoEnum, 'otro'>;
  receptor: ReceptorAdmin;
}

/** El receptor como lo captura el administrador: el correo es opcional. */
export type ReceptorAdmin = Omit<ReceptorPortal, 'email'> & { email?: string | null };

export interface FacturaEmitidaAdmin {
  id: string;
  uuid: string;
  serieFolio: string;
  total: string;
  origen: 'ticket' | 'manual';
  /** Null si no hubo correo del receptor (no se envía). */
  email: string | null;
  descargas: { xml: string | null; pdf: string | null };
}

export type EstadoCancelacionRefacturacion = 'cancelado' | 'pendiente';

export interface ResultadoRefacturacion {
  anterior: { id: string; uuid: string; estado: 'vigente' | 'cancelado' };
  nuevo: { id: string; uuid: string; serieFolio: string; total: string };
  /** `pendiente` = el sustituto ya se emitió pero la cancelación del anterior no salió: reintentar. */
  cancelacion: EstadoCancelacionRefacturacion;
  mensaje: string | null;
}

export const MOTIVO_SUSTITUCION = '01' as const;

export const MENSAJE_PAC_NO_VIGENTE: Readonly<Record<Exclude<EstadoCfdi, 'vigente'>, string>> = {
  cancelado:
    'El PAC reporta esta factura como CANCELADA. No se emitió nada: la cancelación se anotará al ' +
    'conciliar con el PAC.',
  en_cancelacion:
    'El PAC reporta una solicitud de cancelación EN PROCESO para esta factura (espera la respuesta ' +
    'del receptor). No se emitió nada: espera a que se resuelva.',
  no_encontrado:
    'El PAC no tiene registro de esta factura (p. ej. una factura de demostración que el PAC de ' +
    'prueba no emitió en esta corrida). No se emitió nada.',
};
export const MENSAJE_PAC_SIN_ESTADO =
  'No se pudo confirmar con el PAC que la factura siga vigente. No se emitió nada: intenta de ' +
  'nuevo en unos minutos.';
export const MENSAJE_CANCELACION_PENDIENTE =
  'El sustituto ya se emitió, pero el PAC no confirmó la cancelación de la factura anterior. ' +
  'Vuelve a pulsar Refacturar para reintentar SÓLO la cancelación (no se emite otro sustituto).';
export const MENSAJE_SUSTITUTO_CANCELADO =
  'El sustituto de esta factura fue cancelado. Una segunda refacturación del mismo comprobante no ' +
  'se hace: cancélala con motivo 02 o 03 (el ticket vuelve a poderse facturar).';

/**
 * Emisiones que pide un ADMINISTRADOR (F2-107), sobre el mismo tramo de timbrado que el portal
 * (`CfdiService.emitirReserva`):
 *
 * - **Factura sin ticket**: importe capturado a mano, `origen = manual`, sin cheque ni código. La
 *   llave `solicitudId` del formulario hace que un doble clic no emita dos veces.
 * - **Refacturación**: sobre un CFDI vigente, emite un SUSTITUTO con `TipoRelacion` 04 (receptor
 *   corregido, mismos importes) y DESPUÉS cancela el anterior con motivo 01 y el UUID del sustituto
 *   (el orden que exige el SAT). Es RE-ENTRANTE: si el sustituto ya existe y la cancelación quedó
 *   pendiente, volver a pedirla sólo reintenta la cancelación.
 *
 * Todo con el scope de quien pide: una empresa, sucursal o CFDI fuera de su alcance es 404.
 */
@Injectable()
export class EmisionAdminService {
  readonly #log = new Logger(EmisionAdminService.name);

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly cfdi: CfdiService,
    private readonly auditoria: Auditoria,
    private readonly cancelacion: CancelacionCfdiService,
    @Inject(PUERTO_TIMBRADO) private readonly pac: PuertoTimbrado,
  ) {}

  #ahora(): Date {
    return new Date(this.reloj.ahora());
  }

  async emitirManual(
    scope: EmpresaScope,
    actor: Actor,
    c: CapturaManual,
  ): Promise<FacturaEmitidaAdmin> {
    const receptor = receptorValidado(c.receptor, { total: c.total });
    const total = totalManual(c.total)!;
    const ahora = this.#ahora();
    const reserva = await this.datos.facturacion(scope).reservarCfdiManual(
      c.empresaId,
      {
        sucursalId: c.sucursalId,
        solicitudId: c.solicitudId,
        total,
        formaPago: FORMA_PAGO_SAT[c.formaPago],
        receptor,
      },
      ahora,
    );
    const emitida = await this.cfdi.emitirReserva(c.empresaId, reserva, receptor, {
      incierta: MENSAJE_EMISION_INCIERTA_ADMIN,
      fecha: ahora,
    });
    this.auditoria.registrar(actor, {
      accion: 'cfdi.manual',
      recurso: 'cfdi',
      recursoId: emitida.id,
      empresaId: c.empresaId,
      campos: [],
    });
    return {
      id: emitida.id,
      uuid: emitida.uuid,
      serieFolio: emitida.serieFolio,
      total: emitida.total,
      origen: 'manual',
      email: receptor.email,
      descargas: emitida.descargas,
    };
  }

  async refacturar(
    scope: EmpresaScope,
    actor: Actor,
    cfdiId: string,
    receptorCapturado: ReceptorAdmin,
  ): Promise<ResultadoRefacturacion> {
    const receptor = receptorValidado(receptorCapturado);
    const escritura = this.datos.facturacion(scope);
    const viejo = await escritura.cfdiParaRefacturar(cfdiId);
    if (viejo.estado === 'cancelado') throw new ConflictException(MENSAJE_YA_CANCELADO);
    // F2-109: con una cancelación abierta no se emite un sustituto (se decide ANTES de consultar
    // al PAC; `reservarSustituto` lo vuelve a medir bajo candado). Con el sustituto ya emitido, la
    // única abierta posible es SU 01, y la re-entrada de abajo contesta `pendiente`.
    if (
      viejo.cancelacionAbierta !== null &&
      (!viejo.sustituto || viejo.cancelacionAbierta !== '01')
    ) {
      throw new ConflictException(MENSAJE_REFACTURAR_CON_CANCELACION);
    }

    let nuevo: ResultadoRefacturacion['nuevo'];
    if (viejo.sustituto) {
      // Re-entrada: el sustituto ya existe. Nada se emite otra vez.
      if (viejo.sustituto.estado === 'timbrando' || viejo.sustituto.uuid === null) {
        throw new ConflictException(MENSAJE_SUSTITUCION_EN_CURSO);
      }
      if (viejo.sustituto.estado === 'cancelado') {
        throw new ConflictException(MENSAJE_SUSTITUTO_CANCELADO);
      }
      nuevo = {
        id: viejo.sustituto.id,
        uuid: viejo.sustituto.uuid,
        serieFolio: viejo.sustituto.serieFolio,
        total: viejo.sustituto.total.toFixed(2),
      };
    } else {
      // Antes de emitir: el PAC tiene que ver vigente al anterior. Si no, un sustituto quedaría
      // colgado de algo que no se puede cancelar.
      const estado = await this.#estadoEnPac(viejo);
      if (estado !== 'vigente') throw new ConflictException(MENSAJE_PAC_NO_VIGENTE[estado]);
      const ahora = this.#ahora();
      const reserva = await escritura.reservarSustituto(viejo.empresaId, viejo.id, receptor, ahora);
      const emitida = await this.cfdi.emitirReserva(viejo.empresaId, reserva, receptor, {
        incierta: MENSAJE_EMISION_INCIERTA_ADMIN,
        fecha: ahora,
      });
      nuevo = {
        id: emitida.id,
        uuid: emitida.uuid,
        serieFolio: emitida.serieFolio,
        total: emitida.total,
      };
    }

    const cancelacion = await this.#cancelarSustituido(viejo, nuevo.uuid);
    this.auditoria.registrar(actor, {
      accion: 'cfdi.refacturacion',
      recurso: 'cfdi',
      recursoId: viejo.id,
      empresaId: viejo.empresaId,
      campos: [],
    });
    return {
      anterior: {
        id: viejo.id,
        uuid: viejo.uuid,
        estado: cancelacion === 'cancelado' ? 'cancelado' : 'vigente',
      },
      nuevo,
      cancelacion,
      mensaje: cancelacion === 'pendiente' ? MENSAJE_CANCELACION_PENDIENTE : null,
    };
  }

  /** El estado del CFDI en el PAC. Si el PAC no contesta, NO se emite nada (503/502). */
  async #estadoEnPac(viejo: CfdiParaRefacturar): Promise<EstadoCfdi> {
    try {
      return (await this.pac.consultarEstado({ uuid: viejo.uuid, idPac: viejo.idPac })).estado;
    } catch (error) {
      this.#log.warn(
        `No se pudo consultar en el PAC el CFDI ${viejo.uuid}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      if (error instanceof ErrorTimbrado && error.reintentable) {
        throw new ServiceUnavailableException(MENSAJE_PAC_CAIDO);
      }
      throw new BadGatewayException(MENSAJE_PAC_SIN_ESTADO);
    }
  }

  /**
   * Cancela el anterior con motivo 01 y el UUID del sustituto sobre el núcleo de F2-109 (la
   * solicitud queda en `cfdi_cancelaciones`, con su candado y su sondeo). Nunca lanza: lo que no
   * quedó cancelado (en proceso, ambiguo, PAC caído, otra solicitud abierta) es `pendiente`, y
   * reintentar es seguro porque el núcleo consulta al PAC antes de volver a cancelar.
   */
  async #cancelarSustituido(
    viejo: CfdiParaRefacturar,
    uuidSustituto: string,
  ): Promise<EstadoCancelacionRefacturacion> {
    try {
      const r = await this.cancelacion.solicitar(
        { tipo: 'empresa', empresaId: viejo.empresaId },
        null,
        viejo.id,
        { motivo: MOTIVO_SUSTITUCION, uuidSustitucion: uuidSustituto },
      );
      return r.estado === 'cancelado' ? 'cancelado' : 'pendiente';
    } catch (error) {
      this.#log.warn(
        `Cancelación 01 del CFDI ${viejo.uuid} (sustituto ${uuidSustituto}) pendiente: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return 'pendiente';
    }
  }
}

/**
 * Valida el receptor con la MISMA regla del portal (correo opcional) y, si viene, el total. Todo
 * error sale junto, por campo, en el 400 que el web ya sabe pintar.
 */
function receptorValidado(r: ReceptorAdmin, extra?: { total: string }): DatosReceptor {
  const email = (r.email ?? '').trim();
  const campos: ErroresReceptor & { total?: string } = validarReceptor(
    { ...r, email },
    { emailOpcional: true },
  );
  if (extra && totalManual(extra.total) === null) campos.total = MENSAJE_TOTAL_MANUAL;
  if (Object.keys(campos).length > 0) {
    throw new BadRequestException({
      statusCode: 400,
      error: 'Bad Request',
      message: Object.values(campos),
      campos,
    });
  }
  return {
    rfc: normalizarRfc(r.rfc),
    razonSocial: r.razonSocial.trim(),
    regimenFiscal: r.regimenFiscal,
    cp: r.cp.trim(),
    usoCfdi: r.usoCfdi,
    email: email.length > 0 ? email : null,
  };
}
