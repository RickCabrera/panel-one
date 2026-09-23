import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import { CAMPO_DE_ERROR, MENSAJE_RECHAZO_GENERICO } from '../adaptadores/timbrado/errores-sat';
import {
  ErrorTimbrado,
  type CfdiTimbrado,
  type CodigoErrorTimbrado,
  type PuertoTimbrado,
  type SolicitudCfdi,
} from '../adaptadores/timbrado/puerto';
import { Reloj } from '../comun/reloj';
import type { EmpresaScope } from '../scope/empresa-scope';
import { perfilEmite, type ReservaCfdi } from '../scope/escritura-facturacion';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { solicitudDesdeCheque } from './cfdi';
import type { EmisionPortal, FacturaPortal, SolicitudFacturaPortal } from './emision-portal';

/** El punto de espera entre reintentos. Un provider para que los tests no duerman. */
@Injectable()
export class Espera {
  esperar(ms: number): Promise<void> {
    return new Promise((listo) => setTimeout(listo, ms));
  }
}

/** Esperas entre intentos: hasta 3 reintentos (4 intentos en total). */
export const BACKOFF_MS: readonly number[] = [500, 1000, 2000];

/**
 * Lo ÚNICO que se reintenta: el PAC dijo que no procesó (429/503) o nunca se llegó a conectar.
 * DECISION PROVISIONAL (nocturno): `PAC_SIN_RESPUESTA` (timeout, corte, 500/502/504) NO se
 * reintenta: el PAC pudo haber timbrado y reintentar duplicaría un CFDI ante el SAT.
 */
const REINTENTABLES: ReadonlySet<CodigoErrorTimbrado> = new Set([
  'PAC_NO_DISPONIBLE',
  'PAC_SIN_CONEXION',
]);

export const MENSAJE_PAC_CAIDO =
  'El servicio de timbrado no está disponible en este momento. Tus datos no se guardaron: ' +
  'intenta de nuevo en unos minutos.';
export const MENSAJE_EMISION_INCIERTA =
  'Tu factura se está emitiendo, pero el servicio de timbrado no confirmó a tiempo. No la ' +
  'vuelvas a solicitar: si en unos minutos no te llega, pídela en el restaurante con tu ticket.';

/**
 * La emisión de un CFDI de consumo (F2-104), y el puerto `EMISION_PORTAL` del portal de
 * autofactura (F2-103). Tres pasos, y el PAC nunca corre dentro de una transacción:
 *
 * 1. RESERVAR (`EscrituraFacturacion.reservarCfdi`): el candado por código, con todo re-medido.
 * 2. TIMBRAR por `PUERTO_TIMBRADO`, reintentando SÓLO lo que es seguro reintentar.
 * 3. CONFIRMAR (CFDI vigente + código facturado + receptor frecuente, en una transacción), o
 *    LIBERAR la reserva si el PAC rechazó sin timbrar. Si el resultado es AMBIGUO (el PAC pudo
 *    timbrar y no lo sabemos), la reserva se QUEDA en `timbrando`: el código dice `en_proceso` y
 *    nadie puede pedir otro CFDI para él. Resolverla consultando al PAC es de F2-110.
 *
 * El scope es el de la empresa que YA salió de la base (el portal la resuelve por el slug y el
 * código); nada del público elige la empresa.
 */
@Injectable()
export class CfdiService implements EmisionPortal {
  readonly #log = new Logger(CfdiService.name);

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly espera: Espera,
    @Inject(PUERTO_TIMBRADO) private readonly pac: PuertoTimbrado,
  ) {}

  async disponible(empresaId: string): Promise<boolean> {
    const scope: EmpresaScope = { tipo: 'empresa', empresaId };
    const perfil = await this.datos.para(scope).perfilFiscal.findFirst({
      where: { empresaId },
      select: {
        activo: true,
        facturamaOrgId: true,
        csdNoCertificado: true,
        csdVigenteDesde: true,
        csdVigenteHasta: true,
      },
    });
    return perfil !== null && perfilEmite(perfil, new Date(this.reloj.ahora()));
  }

  async emitir(s: SolicitudFacturaPortal): Promise<FacturaPortal> {
    const scope: EmpresaScope = { tipo: 'empresa', empresaId: s.empresaId };
    const escritura = this.datos.facturacion(scope);
    const ahora = new Date(this.reloj.ahora());
    const receptor = {
      rfc: s.receptor.rfc,
      razonSocial: s.receptor.razonSocial,
      regimenFiscal: s.receptor.regimenFiscal,
      cp: s.receptor.cp,
      usoCfdi: s.receptor.usoCfdi,
      email: s.receptor.email,
    };
    const reserva = await escritura.reservarCfdi(
      s.empresaId,
      { codigoId: s.codigoId, chequeId: s.chequeId, sucursalId: s.sucursalId, receptor },
      ahora,
    );

    let timbre: CfdiTimbrado;
    try {
      timbre = await this.#timbrar(solicitudDe(reserva, receptor, ahora));
    } catch (error) {
      throw await this.#fallaDelPac(error, s.empresaId, reserva.reservaId);
    }

    try {
      await escritura.confirmarCfdi(
        s.empresaId,
        reserva.reservaId,
        { uuid: timbre.uuid, idPac: timbre.idPac, fechaTimbrado: timbre.fechaTimbrado },
        receptor,
        new Date(this.reloj.ahora()),
      );
    } catch (error) {
      // El CFDI YA existe ante el SAT: la reserva se queda en `timbrando` y el UUID (no es
      // secreto) queda en el log para que alguien la concilie (F2-110).
      this.#log.error(
        `CFDI timbrado SIN confirmar: reserva ${reserva.reservaId}, UUID ${timbre.uuid}, ` +
          `idPac ${timbre.idPac}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadGatewayException(MENSAJE_EMISION_INCIERTA);
    }

    return {
      uuid: timbre.uuid,
      serieFolio: `${reserva.serie}-${reserva.folio}`,
      total: reserva.importes.total.toFixed(2),
      email: s.receptor.email,
      // F2-105 guarda los archivos y da los enlaces temporales.
      descargas: { xml: null, pdf: null },
    };
  }

  /** Timbra con reintento y backoff SÓLO en lo que es seguro reintentar. */
  async #timbrar(solicitud: SolicitudCfdi): Promise<CfdiTimbrado> {
    for (let intento = 0; ; intento++) {
      try {
        return await this.pac.emitir(solicitud);
      } catch (error) {
        const reintentar =
          error instanceof ErrorTimbrado &&
          REINTENTABLES.has(error.codigo) &&
          intento < BACKOFF_MS.length;
        if (!reintentar) throw error;
        this.#log.warn(
          `Timbrado de ${solicitud.referencia}: ${error.codigo}, reintento ${intento + 1} de ` +
            `${BACKOFF_MS.length}.`,
        );
        await this.espera.esperar(BACKOFF_MS[intento]);
      }
    }
  }

  /**
   * Qué se hace con la reserva y qué se le contesta al cliente cuando el PAC no timbró (o no se
   * sabe). El texto crudo del PAC sólo va al log.
   */
  async #fallaDelPac(error: unknown, empresaId: string, reservaId: string): Promise<Error> {
    const definitivo = error instanceof ErrorTimbrado && error.codigo !== 'PAC_SIN_RESPUESTA';
    if (!definitivo) {
      // AMBIGUO (timeout, 5xx que no es 503, o un error que no es del puerto): el PAC pudo haber
      // timbrado. La reserva se queda.
      this.#log.error(
        `Timbrado AMBIGUO de la reserva ${reservaId}; se queda en timbrando: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return new BadGatewayException(MENSAJE_EMISION_INCIERTA);
    }
    try {
      await this.datos
        .facturacion({ tipo: 'empresa', empresaId })
        .liberarReserva(empresaId, reservaId);
    } catch (e) {
      this.#log.error(
        `No se pudo liberar la reserva ${reservaId} (queda en timbrando): ` +
          `${e instanceof Error ? e.message : String(e)}`,
      );
    }
    const campo = CAMPO_DE_ERROR[error.codigo];
    if (campo) {
      return new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: [error.message],
        campos: { [campo]: error.message },
      });
    }
    if (REINTENTABLES.has(error.codigo)) {
      return new ServiceUnavailableException(MENSAJE_PAC_CAIDO);
    }
    this.#log.warn(`El PAC rechazó la reserva ${reservaId} (${error.codigo}): ${error.message}`);
    return new UnprocessableEntityException(MENSAJE_RECHAZO_GENERICO);
  }
}

function solicitudDe(
  r: ReservaCfdi,
  receptor: {
    rfc: string;
    razonSocial: string;
    regimenFiscal: string;
    cp: string;
    usoCfdi: string;
  },
  fecha: Date,
): SolicitudCfdi {
  return solicitudDesdeCheque({
    reservaId: r.reservaId,
    serie: r.serie,
    folio: r.folio,
    fecha,
    emisor: r.emisor,
    sucursal: r.sucursal,
    cheque: r.cheque,
    receptor,
    formaPago: r.formaPago,
  });
}
