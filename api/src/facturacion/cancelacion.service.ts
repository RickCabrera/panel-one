import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { PUERTO_CORREO, PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import type { PuertoCorreo } from '../adaptadores/correo/puerto';
import {
  ErrorTimbrado,
  type EstadoCfdi,
  type EstadoTrasCancelar,
  type MotivoCancelacion,
  type PuertoTimbrado,
} from '../adaptadores/timbrado/puerto';
import { Auditoria, type Actor } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  MAX_ERROR_ENVIO,
  type AnotacionCancelacion,
  type AvisoCancelacion,
  type SolicitudAbierta,
  type SolicitudSinConfirmar,
} from '../scope/escritura-facturacion';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import {
  MENSAJE_CANCELACION_ABIERTA,
  MENSAJE_CANCELACION_INCIERTA,
  MENSAJE_PAC_CAIDO_CANCELACION,
  MENSAJE_PAC_NO_CONOCE,
  MENSAJE_SIN_SOLICITUD,
  SOLICITUD_VENCIDA_MS,
  plantillaCancelacion,
  resolucionDeConsulta,
  textoErrorPac,
  type EstadoSolicitudAbierta,
} from './cancelacion';
import { ventanaVencida } from './conciliacion';
import { textoDeError } from './entrega';

const SCOPE_SISTEMA: EmpresaScope = { tipo: 'global' };
/** Cuántas solicitudes abiertas revisa el sondeo por vuelta (las más viejas primero). */
export const LIMITE_SONDEO = 200;

export const MENSAJE_EN_PROCESO =
  'La cancelación está EN PROCESO: el SAT espera la respuesta del receptor (hasta 72 horas; sin ' +
  'respuesta, procede). Mientras tanto la factura sigue vigente.';
export const MENSAJE_PAC_SIN_ESTADO_CANCELACION =
  'No se pudo consultar al PAC el estado de la cancelación. Intenta de nuevo en unos minutos.';

/** Lo que responde pedir una cancelación (F2-109). */
export interface ResultadoCancelacionCfdi {
  cfdiId: string;
  uuid: string;
  motivo: MotivoCancelacion;
  /** `en_proceso` = el SAT espera al receptor; la factura sigue vigente. */
  estado: 'cancelado' | 'en_proceso';
  mensaje: string | null;
}

/** En qué quedó la solicitud abierta de un CFDI después de consultar al PAC. */
export type EstadoTrasConsulta = EstadoSolicitudAbierta | 'aceptada' | 'rechazada' | 'no_procedio';

export interface ConsultaCancelacionCfdi {
  cfdiId: string;
  estado: EstadoTrasConsulta;
  mensaje: string | null;
}

const MENSAJE_TRAS_CONSULTA: Readonly<Record<EstadoTrasConsulta, string | null>> = {
  solicitando: MENSAJE_CANCELACION_INCIERTA,
  en_proceso: MENSAJE_EN_PROCESO,
  aceptada: null,
  rechazada:
    'El receptor RECHAZÓ la cancelación: la factura sigue vigente. Si procede, se puede volver a ' +
    'solicitar.',
  no_procedio:
    'El PAC no registró la cancelación: la factura sigue vigente y se puede volver a solicitar.',
};

/**
 * Cancelación de CFDI ante el SAT (F2-109). Tres tramos y el PAC SIEMPRE fuera de una transacción:
 * 1. ABRIR la solicitud (`EscrituraFacturacion.abrirCancelacion`, bajo candado del CFDI);
 * 2. hablar con el PAC: primero CONSULTA (una cancelación anterior que no se alcanzó a anotar sólo se
 *    anota; no se pide dos veces), y si sigue vigente, CANCELA;
 * 3. ANOTAR lo que contestó (`anotarCancelacion`, condicional: si dos procesos la resuelven a la vez,
 *    uno solo aplica los efectos y avisa al receptor).
 * Una respuesta AMBIGUA (timeout, 5xx, estado desconocido) deja la solicitud en `solicitando`: nadie
 * la vuelve a pedir a ciegas; se CONSULTA (a mano o con el sondeo) pasados `SOLICITUD_VENCIDA_MS`.
 */
@Injectable()
export class CancelacionCfdiService {
  readonly #log = new Logger(CancelacionCfdiService.name);

  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
    private readonly auditoria: Auditoria,
    @Inject(PUERTO_TIMBRADO) private readonly pac: PuertoTimbrado,
    @Inject(PUERTO_CORREO) private readonly correo: PuertoCorreo,
  ) {}

  #ahora(): Date {
    return new Date(this.reloj.ahora());
  }

  /**
   * Pide la cancelación de un CFDI con `motivo` (y el UUID de su sustituto si es 01). `actor` null =
   * la pide otro servicio que ya audita (la refacturación, F2-107).
   */
  async solicitar(
    scope: EmpresaScope,
    actor: Actor | null,
    cfdiId: string,
    pedido: { motivo: MotivoCancelacion; uuidSustitucion?: string | null },
  ): Promise<ResultadoCancelacionCfdi> {
    const uuidSustitucion =
      pedido.motivo === '01' ? (pedido.uuidSustitucion ?? '').trim().toUpperCase() : null;
    if (uuidSustitucion === '') {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: ['Con motivo 01 hay que indicar el folio fiscal (UUID) del sustituto.'],
        campos: { uuidSustitucion: 'Con motivo 01 hay que indicar el folio fiscal del sustituto.' },
      });
    }
    const escritura = this.datos.facturacion(scope);
    const p = { motivo: pedido.motivo, uuidSustitucion };
    let apertura = await escritura.abrirCancelacion(cfdiId, p, this.#ahora());
    if (apertura.tipo === 'por_conciliar') {
      // Una solicitud anterior se quedó ambigua: se resuelve consultando ANTES de pedir otra.
      await this.#conciliar(scope, apertura.solicitud, false);
      apertura = await escritura.abrirCancelacion(cfdiId, p, this.#ahora());
      if (apertura.tipo === 'por_conciliar')
        throw new ConflictException(MENSAJE_CANCELACION_ABIERTA);
    }
    const s = apertura.solicitud;
    if (actor) {
      this.auditoria.registrar(actor, {
        accion: 'cfdi.cancelacion',
        recurso: 'cfdi',
        recursoId: s.cfdiId,
        empresaId: s.empresaId,
        campos: [],
      });
    }
    return this.#pedirAlPac(scope, actor, s);
  }

  async #pedirAlPac(
    scope: EmpresaScope,
    actor: Actor | null,
    s: SolicitudAbierta,
  ): Promise<ResultadoCancelacionCfdi> {
    const referencia = { uuid: s.uuid, idPac: s.idPac };
    let enviada = false;
    let estado: EstadoTrasCancelar;
    let fecha = this.#ahora();
    try {
      const actual = (await this.pac.consultarEstado(referencia)).estado;
      if (actual === 'no_encontrado') {
        await this.#noProcedio(scope, actor, s, 'CFDI_NO_ENCONTRADO');
        throw new ConflictException(MENSAJE_PAC_NO_CONOCE);
      }
      if (actual === 'vigente') {
        enviada = true;
        const r = await this.pac.cancelar({
          ...referencia,
          motivo: s.motivo,
          ...(s.uuidSustitucion ? { folioSustitucion: s.uuidSustitucion } : {}),
        });
        estado = r.estado;
        fecha = r.fecha;
      } else {
        // Ya cancelado (un intento anterior que no se anotó) o ya en proceso: sólo se anota.
        estado = actual;
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw await this.#falloDelPac(scope, actor, s, error, enviada);
    }

    const anotacion: AnotacionCancelacion =
      estado === 'cancelado' ? { tipo: 'aceptada', fecha } : { tipo: 'en_proceso' };
    try {
      const r = await this.datos
        .facturacion(scope)
        .anotarCancelacion(s.empresaId, s.solicitudId, 'solicitando', anotacion, this.#ahora());
      if (r.aviso) await this.#avisar(scope, r.aviso);
    } catch (error) {
      // El PAC ya contestó; la solicitud se queda en `solicitando` y la consulta la cierra.
      this.#log.error(
        `Cancelación del CFDI ${s.uuid} (${estado} en el PAC) SIN anotar: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      throw new BadGatewayException(MENSAJE_CANCELACION_INCIERTA);
    }
    return {
      cfdiId: s.cfdiId,
      uuid: s.uuid,
      motivo: s.motivo,
      estado: estado === 'cancelado' ? 'cancelado' : 'en_proceso',
      mensaje: estado === 'cancelado' ? null : MENSAJE_EN_PROCESO,
    };
  }

  /**
   * Qué hacer cuando el PAC falla. ANTES de enviar la cancelación (la consulta previa) nada salió:
   * se libera. DESPUÉS: "no disponible"/"sin conexión" = no procesó (se libera, 503); un rechazo
   * claro del PAC = no hizo nada (se libera, 422); lo AMBIGUO (timeout, 5xx, estado desconocido,
   * error inesperado) deja la solicitud en `solicitando` (502).
   */
  async #falloDelPac(
    scope: EmpresaScope,
    actor: Actor | null,
    s: SolicitudAbierta,
    error: unknown,
    enviada: boolean,
  ): Promise<HttpException> {
    this.#log.warn(`Cancelación del CFDI ${s.uuid}: ${textoErrorPac(error)}`);
    const codigo = error instanceof ErrorTimbrado ? error.codigo : null;
    const noProceso = codigo === 'PAC_NO_DISPONIBLE' || codigo === 'PAC_SIN_CONEXION';
    const ambiguo = enviada && !noProceso && (codigo === null || AMBIGUOS.has(codigo));
    if (ambiguo) {
      await this.datos
        .facturacion(scope)
        .marcarConsultada(s.empresaId, s.solicitudId, textoErrorPac(error), this.#ahora())
        .catch(() => false);
      return new BadGatewayException(MENSAJE_CANCELACION_INCIERTA);
    }
    await this.#noProcedio(scope, actor, s, codigo ?? 'ERROR');
    if (noProceso) return new ServiceUnavailableException(MENSAJE_PAC_CAIDO_CANCELACION);
    if (!enviada) return new BadGatewayException(MENSAJE_PAC_SIN_ESTADO_CANCELACION);
    return new UnprocessableEntityException(
      error instanceof ErrorTimbrado ? error.message : 'El PAC rechazó la cancelación.',
    );
  }

  /** Borra una solicitud que el PAC no registró, y lo deja en el log y en la auditoría. */
  async #noProcedio(
    scope: EmpresaScope,
    actor: Actor | null,
    s: SolicitudAbierta,
    codigo: string,
  ): Promise<void> {
    await this.datos
      .facturacion(scope)
      .anotarCancelacion(
        s.empresaId,
        s.solicitudId,
        s.estado,
        { tipo: 'no_procedio' },
        this.#ahora(),
      );
    this.#log.warn(
      `Solicitud de cancelación ${s.solicitudId} (CFDI ${s.uuid}) no procedió: ${codigo}.`,
    );
    if (actor) {
      this.auditoria.registrar(actor, {
        accion: 'cfdi.cancelacion_no_procedio',
        recurso: 'cfdi',
        recursoId: s.cfdiId,
        empresaId: s.empresaId,
        campos: [],
      });
    }
  }

  /** "Actualizar estado": consulta al PAC la solicitud abierta de un CFDI y la resuelve. */
  async actualizar(
    scope: EmpresaScope,
    actor: Actor,
    cfdiId: string,
  ): Promise<ConsultaCancelacionCfdi> {
    const s = await this.datos.facturacion(scope).cancelacionAbierta(cfdiId);
    if (s === null) throw new ConflictException(MENSAJE_SIN_SOLICITUD);
    this.auditoria.registrar(actor, {
      accion: 'cfdi.cancelacion_consulta',
      recurso: 'cfdi',
      recursoId: s.cfdiId,
      empresaId: s.empresaId,
      campos: [],
    });
    const estado = await this.#conciliar(scope, s, true);
    return { cfdiId: s.cfdiId, estado, mensaje: MENSAJE_TRAS_CONSULTA[estado] };
  }

  /**
   * Consulta al PAC una solicitud abierta y anota lo que se concluye (`resolucionDeConsulta`).
   * `lanzar` = una persona está esperando la respuesta (errores como HTTP); el sondeo no lanza.
   * Un error del PAC se guarda en la solicitud y se loguea UNA vez por solicitud (sólo si cambió).
   * Toda consulta que no la resuelve la marca (`marcarConsultada`): el sondeo rota por `updated_at`.
   *
   * La fecha de cancelación que se anota al resolverla aquí es la de la CONSULTA, no la del PAC (el
   * GET no la trae en lo que sabemos; supuesto no validado, F2-190).
   */
  async #conciliar(
    scope: EmpresaScope,
    s: SolicitudAbierta,
    lanzar: boolean,
  ): Promise<EstadoTrasConsulta> {
    const escritura = this.datos.facturacion(scope);
    let pac: EstadoCfdi;
    try {
      pac = (await this.pac.consultarEstado({ uuid: s.uuid, idPac: s.idPac })).estado;
    } catch (error) {
      await this.#errorDeConsulta(scope, s, textoErrorPac(error));
      if (!lanzar) return s.estado;
      if (error instanceof ErrorTimbrado && error.reintentable) {
        throw new ServiceUnavailableException(MENSAJE_PAC_SIN_ESTADO_CANCELACION);
      }
      throw new BadGatewayException(MENSAJE_PAC_SIN_ESTADO_CANCELACION);
    }
    if (pac === 'no_encontrado') {
      await this.#errorDeConsulta(scope, s, `CFDI_NO_ENCONTRADO: ${MENSAJE_PAC_NO_CONOCE}`);
      if (lanzar) throw new ConflictException(MENSAJE_PAC_NO_CONOCE);
      return s.estado;
    }
    const ahora = this.#ahora();
    const vencida = ahora.getTime() - s.solicitadaAt.getTime() >= SOLICITUD_VENCIDA_MS;
    const res = resolucionDeConsulta(s.estado, pac, vencida);
    if (res === 'sin_cambio') {
      // Se consultó y el PAC contestó bien: pasa al final de la fila del sondeo y sin error.
      await escritura.marcarConsultada(s.empresaId, s.solicitudId, null, ahora).catch(() => false);
      return s.estado;
    }
    // F2-110b: "no procedió" tras una solicitud AMBIGUA ya no se borra: queda `sin_confirmar` para que
    // la conciliación la vuelva a consultar (Facturama pudo registrarla tarde). Deja de estar abierta:
    // se puede volver a pedir, igual que antes.
    const anotacion: AnotacionCancelacion =
      res === 'aceptada'
        ? { tipo: 'aceptada', fecha: ahora }
        : res === 'no_procedio'
          ? { tipo: 'sin_confirmar' }
          : { tipo: res };
    const r = await escritura.anotarCancelacion(
      s.empresaId,
      s.solicitudId,
      s.estado,
      anotacion,
      ahora,
    );
    if (!r.gano) return s.estado;
    if (res === 'no_procedio') {
      this.#log.warn(
        `Solicitud de cancelación ${s.solicitudId} (CFDI ${s.uuid}): el PAC no la registró; queda ` +
          'sin confirmar (la conciliación la vuelve a consultar).',
      );
    }
    if (r.aviso) await this.#avisar(scope, r.aviso);
    return res;
  }

  async #errorDeConsulta(scope: EmpresaScope, s: SolicitudAbierta, texto: string): Promise<void> {
    const cambio = await this.datos
      .facturacion(scope)
      .marcarConsultada(s.empresaId, s.solicitudId, texto, this.#ahora())
      .catch(() => false);
    if (cambio) {
      this.#log.warn(`Solicitud de cancelación ${s.solicitudId}: no se pudo consultar: ${texto}`);
    }
  }

  /**
   * El aviso por correo al receptor de una factura que quedó cancelada. Sin correo del receptor no
   * se manda. Nunca lanza: lo que pasó queda en la solicitud (`aviso_enviado_at` / `aviso_error`).
   */
  async #avisar(scope: EmpresaScope, a: AvisoCancelacion): Promise<void> {
    if (a.email === null) return;
    let resultado: { ok: true } | { ok: false; error: string };
    try {
      await this.correo.enviar(
        { email: a.email },
        plantillaCancelacion({ ...a, total: a.total.toFixed(2) }),
        [],
        { empresaId: a.empresaId },
      );
      resultado = { ok: true };
    } catch (error) {
      resultado = { ok: false, error: textoDeError(error, MAX_ERROR_ENVIO) };
      this.#log.warn(`Falló el aviso de cancelación del CFDI ${a.uuid}.`);
    }
    try {
      await this.datos
        .facturacion(scope)
        .anotarAvisoCancelacion(a.empresaId, a.solicitudId, resultado, this.#ahora());
    } catch (error) {
      this.#log.error(
        `No se pudo anotar el aviso de cancelación ${a.solicitudId}: ${String(error)}`,
      );
    }
  }

  /**
   * F2-110b: vuelve a consultar al PAC una solicitud `sin_confirmar` (la que a los 10 min se dio por
   * no registrada) y la resuelve. Nunca lanza por el PAC (la conciliación sigue con la siguiente):
   * - `cancelado` → `aceptada` con la fecha de la consulta (el GET no trae la de la cancelación;
   *   misma convención que `#conciliar`), con TODOS los efectos de F2-109 y el aviso al receptor.
   * - `en_cancelacion` → `en_proceso` (la sigue el sondeo de F2-109). Si el CFDI ya tiene otra
   *   solicitud abierta, el único parcial lo impide: se deja y se reintenta.
   * - `vigente` / `no_encontrado` → nada, hasta que vence `VENTANA_SIN_CONFIRMAR_MS`: entonces se
   *   borra (como antes de F2-110b).
   */
  async revisarSinConfirmar(
    scope: EmpresaScope,
    s: SolicitudSinConfirmar,
  ): Promise<'cancelada' | 'en_proceso' | 'descartada' | 'sin_cambio' | 'fallida'> {
    const escritura = this.datos.facturacion(scope);
    let pac: EstadoCfdi;
    try {
      pac = (await this.pac.consultarEstado({ uuid: s.uuid, idPac: s.idPac })).estado;
    } catch (error) {
      await escritura
        .marcarConsultada(s.empresaId, s.solicitudId, textoErrorPac(error), this.#ahora())
        .catch(() => false);
      return 'fallida';
    }
    const ahora = this.#ahora();
    if (pac === 'cancelado' || pac === 'en_cancelacion') {
      const anotacion: AnotacionCancelacion =
        pac === 'cancelado' ? { tipo: 'aceptada', fecha: ahora } : { tipo: 'en_proceso' };
      let r: { gano: boolean; aviso: AvisoCancelacion | null };
      try {
        r = await escritura.anotarCancelacion(
          s.empresaId,
          s.solicitudId,
          'sin_confirmar',
          anotacion,
          ahora,
        );
      } catch (error) {
        this.#log.warn(
          `Cancelación sin confirmar ${s.solicitudId} (CFDI ${s.uuid}, ${pac} en el PAC) sin ` +
            `anotar: ${error instanceof Error ? error.message : String(error)}`,
        );
        await escritura
          .marcarConsultada(s.empresaId, s.solicitudId, null, ahora)
          .catch(() => false);
        return 'fallida';
      }
      if (!r.gano) return 'descartada';
      if (r.aviso) await this.#avisar(scope, r.aviso);
      this.#log.warn(
        `Cancelación del CFDI ${s.uuid} registrada TARDE por el PAC: ` +
          (pac === 'cancelado' ? 'se anota cancelada.' : 'queda en proceso.'),
      );
      return pac === 'cancelado' ? 'cancelada' : 'en_proceso';
    }
    if (ventanaVencida(s.solicitadaAt, ahora)) {
      const r = await escritura.anotarCancelacion(
        s.empresaId,
        s.solicitudId,
        'sin_confirmar',
        { tipo: 'no_procedio' },
        ahora,
      );
      if (r.gano) {
        this.#log.warn(
          `Cancelación sin confirmar ${s.solicitudId} (CFDI ${s.uuid}): el PAC la sigue viendo ` +
            `${pac} al vencer la ventana; se da por no registrada.`,
        );
      }
      return 'descartada';
    }
    await escritura
      .marcarConsultada(
        s.empresaId,
        s.solicitudId,
        pac === 'no_encontrado' ? `CFDI_NO_ENCONTRADO: ${MENSAJE_PAC_NO_CONOCE}` : null,
        ahora,
      )
      .catch(() => false);
    return 'sin_cambio';
  }

  /**
   * Una vuelta del sondeo (F2-109): consulta al PAC las solicitudes abiertas de TODAS las empresas,
   * cada una con el scope de su empresa. Nunca lanza por una solicitud: sigue con la siguiente.
   */
  async vueltaAutomatica(): Promise<{ revisadas: number; resueltas: number; fallidas: number }> {
    const abiertas = await this.datos.facturacion(SCOPE_SISTEMA).solicitudesAbiertas(LIMITE_SONDEO);
    let resueltas = 0;
    let fallidas = 0;
    for (const s of abiertas) {
      try {
        const r = await this.#conciliar({ tipo: 'empresa', empresaId: s.empresaId }, s, false);
        if (r !== s.estado) resueltas++;
      } catch (error) {
        fallidas++;
        this.#log.warn(
          `Sondeo de cancelaciones: la solicitud ${s.solicitudId} falló: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { revisadas: abiertas.length, resueltas, fallidas };
  }
}

/** Errores del PAC que, DESPUÉS de enviar la cancelación, no dicen si se registró. */
const AMBIGUOS: ReadonlySet<string> = new Set(['PAC_SIN_RESPUESTA', 'ESTADO_DESCONOCIDO']);
