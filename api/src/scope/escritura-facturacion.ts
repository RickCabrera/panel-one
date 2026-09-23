import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma, type EstadoEmisionCfdi, type OrigenCfdi } from '@prisma/client';

import type {
  CfdiRelacionados,
  InformacionGlobal,
  MotivoCancelacion,
} from '../adaptadores/timbrado/puerto';

import {
  esFacturable,
  estadoPublico,
  mensajeEstado,
  periodoGlobalDe,
  type EstadoPublico,
  type VigenciaCodigos,
} from '../facturacion/codigo';
import { formaPagoSat, importesDeTotal, type FormaPagoEnum } from '../facturacion/cfdi';
import {
  anioPermitido,
  diaLocal,
  estadoPeriodo,
  formaPagoGlobal,
  importesGlobal,
  periodoDeClave,
  receptorPublicoGeneral,
  type DiaGlobal,
  type EstadoPeriodoGlobal,
  type PeriodicidadGlobalEnum,
  type PeriodoGlobal,
  type TicketGlobal,
} from '../facturacion/global';
import { instanteDesdeLocal } from '../comun/fechas';
import { MENSAJE_EMISION_NO_DISPONIBLE } from '../facturacion/emision-portal';
import { normalizarRfc, RFC_GENERICOS } from '../facturacion/sat';
import type { EmpresaScope } from './empresa-scope';
import { encontradoOr404, whereScoped } from './scope.helper';

/**
 * Las escrituras de facturación (F2-100): el perfil fiscal de una empresa, la metadata de su CSD
 * y los receptores frecuentes; y la regla de vigencia de los códigos de facturación (F2-101). Parte del helper obligatorio de scope: sólo
 * `ScopedPrismaService.facturacion(scope)` construye esta clase.
 *
 * - La empresa se verifica CON el scope del usuario ANTES de cualquier otra cosa: una empresa de
 *   otro cliente o inexistente da el mismo 404, tenga o no perfil fiscal (nunca un 409 que
 *   confirme que existe).
 * - Cada operación corre en UNA transacción con timeouts cortos.
 * - Del CSD sólo se escribe METADATA. Esta clase no recibe ni el `.cer`, ni el `.key`, ni la
 *   contraseña: no hay por dónde guardarlos.
 * - Dato NUESTRO: nada de esto escribe a SoftRestaurant.
 */

const TIMEOUT_SENTENCIA_MS = 5000;
const TIMEOUT_TRANSACCION_MS = 15_000;
const ESPERA_CONEXION_MS = 5000;

type Tx = Prisma.TransactionClient;

export interface ClienteFacturacion {
  $transaction<T>(
    fn: (tx: Tx) => Promise<T>,
    opciones: { maxWait: number; timeout: number },
  ): Promise<T>;
}

function exigir(nombre: string, valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new Error(`Escritura de facturación: ${nombre} vacío o ausente en un filtro.`);
  }
  return valor;
}

/** Los datos fiscales que se capturan (ya validados y con el RFC normalizado). */
export interface DatosPerfil {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  cp: string;
  serie: string;
}

export interface CsdCargado {
  /** El RFC del perfil contra el que se validó: si cambió mientras tanto, no se guarda (409). */
  rfcValidado: string;
  noCertificado: string;
  rfc: string;
  vigenteDesde: Date;
  vigenteHasta: Date;
  facturamaOrgId: string;
}

export interface DatosReceptor {
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  cp: string;
  usoCfdi: string;
  email: string | null;
}

/** Lo que la emisión (F2-104) pide reservar: todo sale de la base, nada del público. */
export interface PedidoReserva {
  codigoId: string;
  chequeId: string;
  sucursalId: string;
  /** Ya validado por el portal, con el RFC normalizado. */
  receptor: DatosReceptor & { email: string };
}

/** La reserva creada: lo que hace falta para armar la solicitud al PAC. */
export interface ReservaCfdi {
  reservaId: string;
  /** F2-107: `ticket` o `manual` (sin cheque). */
  origen: OrigenCfdi;
  serie: string;
  folio: number;
  emisor: { rfc: string; razonSocial: string; regimenFiscal: string; cp: string };
  /** La sucursal que expide, con la marca de su portal para el correo (F2-105). */
  sucursal: { zonaHoraria: string; nombre: string; colorPortal: string | null };
  /** El ticket que se factura; null en una factura sin ticket (F2-107). */
  cheque: { folio: string } | null;
  formaPago: string;
  importes: { subtotal: Prisma.Decimal; iva: Prisma.Decimal; total: Prisma.Decimal };
  /** F2-107: el CFDI que sustituye (relación 04), si es un sustituto. */
  relacionados?: CfdiRelacionados;
  /** F2-108: la factura global (su InformacionGlobal y un concepto por ticket), si es una global. */
  global?: { informacion: InformacionGlobal; etiqueta: string; tickets: TicketGlobal[] };
}

/** Lo que pide una factura sin ticket (F2-107), ya validado: todo del administrador. */
export interface PedidoManual {
  sucursalId: string;
  /** La llave de idempotencia de la captura (la genera el formulario). */
  solicitudId: string;
  total: Prisma.Decimal;
  /** c_FormaPago ya resuelta (`FORMA_PAGO_SAT`). */
  formaPago: string;
  receptor: DatosReceptor;
}

/** El CFDI que se quiere refacturar (F2-107), con su sustituto si ya lo tiene. */
export interface CfdiParaRefacturar {
  id: string;
  empresaId: string;
  estado: 'vigente' | 'cancelado';
  uuid: string;
  idPac: string;
  sustituto: {
    id: string;
    estado: EstadoEmisionCfdi;
    uuid: string | null;
    serieFolio: string;
    total: Prisma.Decimal;
  } | null;
}

/** c_TipoRelacion de la sustitución de CFDI previos (F2-107). */
export const TIPO_RELACION_SUSTITUCION = '04' as const;

export const MENSAJE_EMISION_NO_DISPONIBLE_ADMIN =
  'La empresa no puede emitir facturas: falta el perfil fiscal activo o un CSD vigente (ver ' +
  'Facturación → Datos fiscales).';
export const MENSAJE_YA_CANCELADO = 'Esta factura ya está cancelada: no se puede refacturar.';
export const MENSAJE_SUSTITUCION_EN_CURSO =
  'Esta factura ya tiene un sustituto en emisión. Si no se confirma en unos minutos, hay una ' +
  'emisión sin confirmar del PAC: revísala en el PAC antes de volver a intentar (la conciliación ' +
  'de reservas colgadas es F2-110).';
export const MENSAJE_CAPTURA_EN_CURSO =
  'Esta captura ya se está emitiendo. Si no se confirma en unos minutos, hay una emisión sin ' +
  'confirmar del PAC: revísala en el PAC antes de capturarla de nuevo (la conciliación de ' +
  'reservas colgadas es F2-110).';

/** El 409 de una captura manual cuya llave ya se usó: dice qué CFDI salió de ella. */
export function conflictoDeSolicitud(previa: {
  id: string;
  estado: EstadoEmisionCfdi;
  serie: string;
  folio: number;
}): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message:
      previa.estado === 'timbrando'
        ? MENSAJE_CAPTURA_EN_CURSO
        : `Esta captura ya se emitió como la factura ${previa.serie}-${previa.folio}.`,
    cfdiId: previa.id,
    estado: previa.estado,
  });
}

/** ¿Es un P2002 (único violado) sobre una llave que incluye `columna`? */
function esUnicoDe(error: unknown, columna: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const meta = error.meta as { target?: unknown; constraint?: unknown } | undefined;
  const texto = JSON.stringify([meta?.target, meta?.constraint]);
  const camel = columna.replace(/_([a-z])/g, (_, l: string) => l.toUpperCase());
  return texto.includes(columna) || texto.includes(camel);
}

function emisorDe(p: { rfc: string; razonSocial: string; regimenFiscal: string; cp: string }) {
  return { rfc: p.rfc, razonSocial: p.razonSocial, regimenFiscal: p.regimenFiscal, cp: p.cp };
}

/** El timbre que devolvió el PAC. */
export interface TimbreCfdi {
  uuid: string;
  idPac: string;
  fechaTimbrado: Date;
}

/** Las claves en `PuertoArchivos` del XML y el PDF de un CFDI (F2-105). */
export interface ArchivosCfdi {
  xmlClave: string;
  pdfClave: string;
}

/** Un envío por correo reclamado: la fila y a quién va (el correo guardado en el CFDI). */
export interface EnvioReclamado {
  envioId: string;
  email: string;
  intentos: number;
}

/** Cómo terminó un intento de envío. */
export type ResultadoEnvio = { ok: true; correoId: string } | { ok: false; error: string };

/**
 * Un envío en `enviando` más viejo que esto se da por muerto (el proceso cayó a media llamada) y se
 * puede reintentar a mano. 20 veces el tope HTTP del puerto (`TIMEOUT_HTTP_MS` = 30 s): un envío que
 * sigue en vuelo nunca se ve vencido, así que el reintento no manda un correo doble.
 */
export const ENVIO_VENCIDO_MS = 10 * 60 * 1000;

/** Largo máximo del error que se guarda de un envío fallido. */
export const MAX_ERROR_ENVIO = 500;

export const MENSAJE_SIN_ENVIO_QUE_REINTENTAR =
  'Esta factura no tiene un envío fallido que reintentar (ya salió, o se está enviando ahora).';

/** Envíos que alguien tiene que reintentar: fallidos, o `enviando` vencidos. */
export function whereEnvioAReintentar(ahora: Date): Prisma.CfdiEnvioWhereInput {
  return {
    OR: [
      { estado: 'fallido' },
      { estado: 'enviando', ultimoIntentoAt: { lt: new Date(ahora.getTime() - ENVIO_VENCIDO_MS) } },
    ],
  };
}

/** El correo guardado en el receptor del CFDI, o null si no trae uno usable. */
export function emailDelReceptor(receptor: Prisma.JsonValue): string | null {
  if (receptor === null || typeof receptor !== 'object' || Array.isArray(receptor)) return null;
  const email = (receptor as Record<string, unknown>).email;
  return typeof email === 'string' && email.trim().length > 0 ? email.trim() : null;
}

export const MENSAJE_SIN_FORMA_PAGO =
  'Este ticket no se puede facturar en línea (su forma de pago no se puede declarar ante el SAT ' +
  'desde aquí). Pide tu factura en el restaurante con tu ticket.';
export const MENSAJE_NO_FACTURABLE =
  'Esta cuenta no se puede facturar en este momento. Pide tu factura en el restaurante con tu ' +
  'ticket.';

/** ¿El perfil puede emitir en este instante? Activo, con CSD registrado en el PAC y vigente. */
export function perfilEmite(
  p: {
    activo: boolean;
    facturamaOrgId: string | null;
    csdNoCertificado: string | null;
    csdVigenteDesde: Date | null;
    csdVigenteHasta: Date | null;
  },
  ahora: Date,
): boolean {
  return (
    p.activo &&
    p.facturamaOrgId !== null &&
    p.csdNoCertificado !== null &&
    p.csdVigenteDesde !== null &&
    p.csdVigenteHasta !== null &&
    p.csdVigenteDesde.getTime() <= ahora.getTime() &&
    ahora.getTime() < p.csdVigenteHasta.getTime()
  );
}

/**
 * El 409 que el portal ya sabe pintar: el estado público actual del código (con el periodo de la
 * factura global si entró a una, F2-108).
 */
export function conflictoDeEstado(
  estado: EstadoPublico,
  periodoGlobal: string | null = null,
): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: mensajeEstado(estado, periodoGlobal),
    estado,
  });
}

/** F2-108: lo que pide una factura global (el administrador o el programador). */
export interface PedidoGlobal {
  sucursalId: string;
  periodicidad: PeriodicidadGlobalEnum;
  /** El primer día local del periodo (`AAAA-MM-DD`). */
  clave: string;
}

export interface ConfiguracionGlobal {
  periodicidad: PeriodicidadGlobalEnum;
  automatica: boolean;
  automaticaDesde: Date | null;
  /** La vigencia de los códigos: la global espera a que venzan (la UI avisa si la retrasa). */
  vigencia: VigenciaCodigos;
}

export interface SucursalGlobal {
  id: string;
  nombre: string;
  zonaHoraria: string;
}

export interface GlobalEmitida {
  id: string;
  uuid: string | null;
  serieFolio: string;
  estado: EstadoEmisionCfdi;
  total: Prisma.Decimal;
  emitidoAt: Date | null;
  globalPeriodicidad: string | null;
  globalDesde: Date | null;
  tickets: number;
  conArchivos: boolean;
}

export interface VistaPreviaGlobal {
  sucursal: SucursalGlobal;
  periodo: PeriodoGlobal;
  estado: EstadoPeriodoGlobal;
  tickets: { folio: string; cerradoAt: Date; total: Prisma.Decimal }[];
  vigentes: { tickets: number; hasta: Date | null };
  formaPago: string | null;
  importes: { subtotal: Prisma.Decimal; iva: Prisma.Decimal; total: Prisma.Decimal } | null;
  globalesPrevias: number;
}

export const MENSAJE_CLAVE_PERIODO =
  'El periodo no es válido: la clave tiene que ser el primer día (AAAA-MM-DD) de un periodo de esa ' +
  'periodicidad.';
export const MENSAJE_GLOBAL_EN_CURSO =
  'Este periodo todavía no termina: su factura global se emite cuando termine.';
export const MENSAJE_GLOBAL_FUERA_DE_PLAZO =
  'El SAT ya no acepta una factura global de ese año (sólo del año en curso o del anterior).';
export const MENSAJE_GLOBAL_SIN_TICKETS =
  'No hay tickets que incluir en la factura global de este periodo (ya se incluyeron en otra, o ' +
  'todos se facturaron).';
export const MENSAJE_GLOBAL_SIN_FORMA =
  'Ningún pago de estos tickets tiene una forma de pago que se pueda declarar ante el SAT ' +
  '(efectivo, tarjeta o transferencia): la factura global no se puede emitir desde aquí.';
export const MENSAJE_GLOBAL_NO_SE_REFACTURA =
  'Una factura global no se refactura: el receptor es siempre público en general. Si hay que ' +
  'corregirla, se cancela (F2-109) y se emite de nuevo.';

export function mensajeGlobalEsperando(n: number): string {
  return (
    `Este periodo todavía no está listo: ${n === 1 ? 'un ticket todavía se puede' : `${n} tickets todavía se pueden`} ` +
    'facturar en el portal. La factura global espera a que venza su plazo.'
  );
}

/** El enlace y la marca del portal de autofactura de una sucursal (F2-103), ya validados. */
export interface DatosPortal {
  slug: string;
  color: string;
  activo: boolean;
}

export const MENSAJE_SLUG_OCUPADO =
  'Ese enlace ya lo usa otro portal. Elige otro (p. ej. agrega el nombre de la ciudad).';

/** Vacía la metadata del CSD: la del RFC anterior ya no aplica. */
const SIN_CSD = {
  facturamaOrgId: null,
  csdNoCertificado: null,
  csdRfc: null,
  csdVigenteDesde: null,
  csdVigenteHasta: null,
  csdCargadoAt: null,
  csdCargadoPor: null,
} as const;

export class EscrituraFacturacion {
  readonly #cliente: ClienteFacturacion;
  readonly #scope: EmpresaScope;

  constructor(cliente: ClienteFacturacion, scope: EmpresaScope) {
    this.#cliente = cliente;
    this.#scope = scope;
  }

  #enTransaccion<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.#cliente.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('statement_timeout', ${String(TIMEOUT_SENTENCIA_MS)}, true)`;
        return fn(tx);
      },
      { maxWait: ESPERA_CONEXION_MS, timeout: TIMEOUT_TRANSACCION_MS },
    );
  }

  async #empresa(tx: Tx, empresaId: string) {
    return encontradoOr404(
      await tx.empresa.findFirst({
        where: whereScoped(this.#scope, 'Empresa', { id: exigir('empresaId', empresaId) }),
        select: { id: true },
      }),
    );
  }

  /**
   * Verifica la empresa con el scope (404 si no) y devuelve su perfil, o null. Es lo PRIMERO que
   * hace la carga del CSD: el 409 de "sin perfil" sólo sale para una empresa en alcance.
   */
  async perfilDe(
    empresaId: string,
  ): Promise<{ rfc: string; facturamaOrgId: string | null } | null> {
    return this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      return tx.perfilFiscal.findFirst({
        where: whereScoped(this.#scope, 'PerfilFiscal', { empresaId }),
        select: { rfc: true, facturamaOrgId: true },
      });
    });
  }

  /**
   * Crea o edita el perfil fiscal de la empresa. Si el RFC cambia, la metadata del CSD y el id del
   * emisor en el PAC se vacían (eran de otro RFC). Devuelve si se vació.
   */
  async guardarPerfil(
    empresaId: string,
    datos: DatosPerfil,
    actorId: string | null,
    ahora: Date,
  ): Promise<{ creado: boolean; csdQuitado: boolean }> {
    return this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      const actual = await tx.perfilFiscal.findFirst({
        where: whereScoped(this.#scope, 'PerfilFiscal', { empresaId }),
        select: { id: true, rfc: true, csdNoCertificado: true, facturamaOrgId: true },
      });
      if (!actual) {
        try {
          await tx.perfilFiscal.create({
            data: {
              empresaId,
              ...datos,
              activo: true,
              creadoPor: actorId,
              actualizadoPor: actorId,
              updatedAt: ahora,
            },
            select: { id: true },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new ConflictException(
              'Otro administrador acaba de guardar los datos fiscales de esta empresa. Recarga.',
            );
          }
          throw error;
        }
        return { creado: true, csdQuitado: false };
      }
      const cambiaRfc = actual.rfc !== datos.rfc;
      const teniaCsd = actual.csdNoCertificado !== null || actual.facturamaOrgId !== null;
      const { count } = await tx.perfilFiscal.updateMany({
        where: { id: actual.id, empresaId, rfc: actual.rfc },
        data: {
          ...datos,
          ...(cambiaRfc ? SIN_CSD : {}),
          actualizadoPor: actorId,
          updatedAt: ahora,
        },
      });
      if (count !== 1) {
        throw new ConflictException(
          'Los datos fiscales cambiaron mientras los editabas. Recarga y vuelve a intentar.',
        );
      }
      return { creado: false, csdQuitado: cambiaRfc && teniaCsd };
    });
  }

  /**
   * Guarda la metadata de un CSD YA validado y ya registrado en el PAC. Condicionado a que el RFC
   * del perfil siga siendo el validado: si alguien lo cambió entre la validación y aquí, 409.
   */
  async guardarCsd(
    empresaId: string,
    csd: CsdCargado,
    /** Null sólo desde el seed (metadata sintética, sin nadie que la haya cargado). */
    actorId: string | null,
    ahora: Date,
  ): Promise<void> {
    await this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      const { count } = await tx.perfilFiscal.updateMany({
        where: whereScoped(this.#scope, 'PerfilFiscal', {
          empresaId,
          rfc: exigir('rfcValidado', csd.rfcValidado),
        }),
        data: {
          facturamaOrgId: csd.facturamaOrgId,
          csdNoCertificado: csd.noCertificado,
          csdRfc: csd.rfc,
          csdVigenteDesde: csd.vigenteDesde,
          csdVigenteHasta: csd.vigenteHasta,
          csdCargadoAt: ahora,
          csdCargadoPor: actorId,
          actualizadoPor: actorId,
          updatedAt: ahora,
        },
      });
      if (count !== 1) {
        throw new ConflictException(
          'El RFC de los datos fiscales cambió mientras se cargaba el CSD. Recarga y vuelve a subirlo.',
        );
      }
    });
  }

  /**
   * Guarda (o actualiza) un receptor frecuente por (empresa, RFC normalizado). Lo usa el seed y lo
   * usará el portal de autofactura (F2-103). Devuelve su id.
   */
  async guardarReceptor(empresaId: string, receptor: DatosReceptor, ahora: Date): Promise<string> {
    const r = { ...receptor, rfc: normalizarRfc(receptor.rfc) };
    // "Público en general" y "extranjero" no identifican a nadie: no se guardan como frecuentes.
    if (RFC_GENERICOS.includes(r.rfc)) {
      throw new BadRequestException(['un RFC genérico no se guarda como receptor frecuente']);
    }
    return this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      return this.#guardarReceptorTx(tx, empresaId, r, ahora);
    });
  }

  /** El upsert del receptor frecuente DENTRO de una transacción ya abierta (y ya verificada). */
  async #guardarReceptorTx(
    tx: Tx,
    empresaId: string,
    r: DatosReceptor,
    ahora: Date,
  ): Promise<string> {
    {
      const existente = await tx.receptorFrecuente.findFirst({
        where: whereScoped(this.#scope, 'ReceptorFrecuente', { empresaId, rfc: r.rfc }),
        select: { id: true },
      });
      if (existente) {
        await tx.receptorFrecuente.updateMany({
          where: { id: existente.id, empresaId },
          data: {
            razonSocial: r.razonSocial,
            regimenFiscal: r.regimenFiscal,
            cp: r.cp,
            usoCfdi: r.usoCfdi,
            email: r.email,
            updatedAt: ahora,
          },
        });
        return existente.id;
      }
      const { id } = await tx.receptorFrecuente.create({
        data: { empresaId, ...r, updatedAt: ahora },
        select: { id: true },
      });
      return id;
    }
  }

  // -------------------------------------------------------------------------
  // F2-104 · Emisión de CFDI: reservar → (PAC) → confirmar, o liberar.
  // -------------------------------------------------------------------------

  /**
   * RESERVA el CFDI de un código: el candado de "doble clic no emite dos veces". En UNA
   * transacción, y en este orden:
   * 1. La empresa, con el scope (404). El código se BLOQUEA (`FOR UPDATE`) filtrado por
   *    (id, empresa, cheque, sucursal): de otra empresa, o con ids que no casan = 404.
   * 2. Con el candado puesto se vuelve a medir TODO (entre la consulta del portal y aquí el código
   *    pudo vencer, el cheque cancelarse o alguien más reservar): sucursal y empresa activas (404),
   *    estado público `pendiente` (si no, 409 con `estado`), cheque facturable (422).
   * 3. Perfil fiscal que emite hoy (activo, CSD registrado y vigente); si no, 503.
   * 4. Forma de pago facturable en línea (422). ANTES de consumir folio: un rechazo aquí no deja
   *    hueco.
   * 5. `folio_actual + 1` del perfil (el UPDATE bloquea la fila: folios en serie) e INSERT de la
   *    reserva en `timbrando`. El UNIQUE de `codigo_id` es la segunda red: si otra transacción
   *    ganó, 409 `en_proceso`.
   */
  async reservarCfdi(empresaId: string, pedido: PedidoReserva, ahora: Date): Promise<ReservaCfdi> {
    try {
      return await this.#enTransaccion(async (tx) => {
        await this.#empresa(tx, empresaId);
        const bloqueado = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM codigos_facturacion
          WHERE id = ${exigir('codigoId', pedido.codigoId)}::uuid
            AND empresa_id = ${empresaId}::uuid
            AND cheque_id = ${exigir('chequeId', pedido.chequeId)}::uuid
            AND sucursal_id = ${exigir('sucursalId', pedido.sucursalId)}::uuid
          FOR UPDATE`;
        encontradoOr404(bloqueado[0] ?? null);
        const codigo = encontradoOr404(
          await tx.codigoFacturacion.findFirst({
            where: whereScoped(this.#scope, 'CodigoFacturacion', {
              id: pedido.codigoId,
              empresaId,
            }),
            select: {
              estado: true,
              expiraAt: true,
              cfdi: { select: { estado: true } },
              // F2-108: un ticket que entró a una global (o a su reserva) ya no se autofactura.
              global: {
                select: {
                  cfdi: { select: { estado: true, globalPeriodicidad: true, globalDesde: true } },
                },
              },
              cheque: {
                select: {
                  folio: true,
                  cerradoAt: true,
                  cancelado: true,
                  total: true,
                  pagos: { select: { formaRaw: true, monto: true }, orderBy: { id: 'asc' } },
                },
              },
              sucursal: {
                select: {
                  activo: true,
                  zonaHoraria: true,
                  nombre: true,
                  portalFacturacion: { select: { color: true } },
                  empresa: { select: { activo: true } },
                },
              },
            },
          }),
        );
        if (!codigo.sucursal.activo || !codigo.sucursal.empresa.activo) encontradoOr404(null);
        const estado = estadoPublico(codigo, codigo.cheque, ahora.getTime());
        if (estado !== 'pendiente') {
          throw conflictoDeEstado(
            estado,
            periodoGlobalDe(estado, codigo.global, codigo.sucursal.zonaHoraria),
          );
        }
        if (!esFacturable(codigo.cheque)) {
          throw new UnprocessableEntityException(MENSAJE_NO_FACTURABLE);
        }

        const perfil = await this.#perfilPortal(tx, empresaId, ahora);

        const catalogo = await tx.formaPagoCatalogo.findMany({
          where: whereScoped(this.#scope, 'FormaPagoCatalogo', { empresaId }),
          select: { formaRaw: true, forma: true },
        });
        const formaPago = formaPagoSat(
          codigo.cheque.pagos,
          new Map(catalogo.map((c) => [c.formaRaw, c.forma as FormaPagoEnum])),
        );
        if (formaPago === null) throw new UnprocessableEntityException(MENSAJE_SIN_FORMA_PAGO);

        const importes = importesDeTotal(codigo.cheque.total);
        const folio = await this.#siguienteFolio(tx, perfil.id, empresaId);
        const { id } = await tx.cfdi.create({
          data: {
            empresaId,
            sucursalId: pedido.sucursalId,
            chequeId: pedido.chequeId,
            codigoId: pedido.codigoId,
            perfilFiscalId: perfil.id,
            serie: perfil.serie,
            folio,
            receptor: { ...pedido.receptor },
            formaPago,
            subtotal: importes.subtotal,
            iva: importes.iva,
            total: importes.total,
            estado: 'timbrando',
            updatedAt: ahora,
          },
          select: { id: true },
        });
        return {
          reservaId: id,
          origen: 'ticket',
          serie: perfil.serie,
          folio,
          emisor: emisorDe(perfil),
          sucursal: {
            zonaHoraria: codigo.sucursal.zonaHoraria,
            nombre: codigo.sucursal.nombre,
            colorPortal: codigo.sucursal.portalFacturacion?.color ?? null,
          },
          cheque: { folio: codigo.cheque.folio },
          formaPago,
          importes,
        };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Otra transacción reservó el mismo código entre la lectura y el INSERT.
        throw conflictoDeEstado('en_proceso');
      }
      throw error;
    }
  }

  /**
   * CONFIRMA una reserva con el timbre del PAC, en UNA transacción: la reserva pasa a `vigente`,
   * el código a `facturado`, y el receptor queda como frecuente (F2-100). Si la reserva no está
   * en el scope o ya no está en `timbrando` (nadie más la toca, así que no debería pasar), 404: la
   * transacción se deshace y quien llama deja constancia del UUID en el log.
   */
  async confirmarCfdi(
    empresaId: string,
    reservaId: string,
    timbre: TimbreCfdi,
    receptor: DatosReceptor,
    ahora: Date,
  ): Promise<{ codigoFacturado: boolean }> {
    return this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      // Fuera del scope, de otra empresa, o que ya no está en `timbrando`: el mismo 404.
      const reserva = encontradoOr404(
        await tx.cfdi.findFirst({
          where: whereScoped(this.#scope, 'Cfdi', {
            id: exigir('reservaId', reservaId),
            empresaId,
            estado: 'timbrando',
          }),
          select: { id: true, codigoId: true, sustituyeAId: true, origen: true },
        }),
      );
      await tx.cfdi.updateMany({
        where: { id: reserva.id, empresaId, estado: 'timbrando' },
        data: {
          estado: 'vigente',
          uuid: exigir('uuid', timbre.uuid),
          idPac: exigir('idPac', timbre.idPac),
          emitidoAt: timbre.fechaTimbrado,
          updatedAt: ahora,
        },
      });
      // F2-107: el código del ticket PASA al sustituto (primero se suelta del viejo: `codigo_id` es
      // único), para que el código facturado apunte a la factura válida.
      if (reserva.sustituyeAId) {
        const viejo = await tx.cfdi.findFirst({
          where: whereScoped(this.#scope, 'Cfdi', { id: reserva.sustituyeAId, empresaId }),
          select: { codigoId: true },
        });
        if (viejo?.codigoId) {
          await tx.cfdi.updateMany({
            where: whereScoped(this.#scope, 'Cfdi', { id: reserva.sustituyeAId, empresaId }),
            data: { codigoId: null, updatedAt: ahora },
          });
          await tx.cfdi.updateMany({
            where: whereScoped(this.#scope, 'Cfdi', { id: reserva.id, empresaId }),
            data: { codigoId: viejo.codigoId, updatedAt: ahora },
          });
        }
      }
      // F2-108: los tickets de una global pasan a `en_global` en la MISMA transacción.
      if (reserva.origen === 'global') {
        await tx.codigoFacturacion.updateMany({
          where: whereScoped(this.#scope, 'CodigoFacturacion', {
            empresaId,
            estado: { in: ['pendiente', 'expirado'] },
            global: { cfdiId: reserva.id, empresaId },
          }),
          data: { estado: 'en_global', updatedAt: ahora },
        });
      }
      let codigoFacturado = false;
      if (reserva.codigoId) {
        const { count } = await tx.codigoFacturacion.updateMany({
          where: { id: reserva.codigoId, empresaId, estado: 'pendiente' },
          data: { estado: 'facturado', updatedAt: ahora },
        });
        codigoFacturado = count === 1;
      }
      const r = { ...receptor, rfc: normalizarRfc(receptor.rfc) };
      if (!RFC_GENERICOS.includes(r.rfc)) await this.#guardarReceptorTx(tx, empresaId, r, ahora);
      return { codigoFacturado };
    });
  }

  // -------------------------------------------------------------------------
  // F2-107 · Factura sin ticket y refacturación.
  // -------------------------------------------------------------------------

  /** El perfil fiscal de la empresa, si emite HOY (activo, CSD registrado y vigente); si no, 503. */
  async #perfilQueEmite(tx: Tx, empresaId: string, ahora: Date) {
    const perfil = await tx.perfilFiscal.findFirst({
      where: whereScoped(this.#scope, 'PerfilFiscal', { empresaId }),
      select: {
        id: true,
        rfc: true,
        razonSocial: true,
        regimenFiscal: true,
        cp: true,
        serie: true,
        activo: true,
        facturamaOrgId: true,
        csdNoCertificado: true,
        csdVigenteDesde: true,
        csdVigenteHasta: true,
      },
    });
    if (!perfil || !perfilEmite(perfil, ahora)) {
      throw new ServiceUnavailableException(MENSAJE_EMISION_NO_DISPONIBLE_ADMIN);
    }
    return perfil;
  }

  /** `folio_actual + 1` del perfil: el UPDATE bloquea la fila, así que los folios salen en serie. */
  async #siguienteFolio(tx: Tx, perfilId: string, empresaId: string): Promise<number> {
    const [{ folio_actual: folio }] = await tx.$queryRaw<{ folio_actual: number }[]>`
      UPDATE perfiles_fiscales SET folio_actual = folio_actual + 1
      WHERE id = ${perfilId}::uuid AND empresa_id = ${empresaId}::uuid
      RETURNING folio_actual`;
    return folio;
  }

  /**
   * RESERVA una factura SIN TICKET (F2-107): `origen = manual`, sin cheque ni código. En UNA
   * transacción: empresa con scope (404) → sucursal activa DE ESA empresa con scope (404) → perfil
   * que emite (503) → folio → INSERT en `timbrando` con la llave `solicitud_id`. La misma llave dos
   * veces (doble clic, reenvío) choca con el único `(empresa_id, solicitud_id)`: 409 con el CFDI que
   * ya existe, y no se toma folio.
   */
  async reservarCfdiManual(
    empresaId: string,
    pedido: PedidoManual,
    ahora: Date,
  ): Promise<ReservaCfdi> {
    try {
      return await this.#enTransaccion(async (tx) => {
        await this.#empresa(tx, empresaId);
        const sucursal = encontradoOr404(
          await tx.sucursal.findFirst({
            where: whereScoped(this.#scope, 'Sucursal', {
              id: exigir('sucursalId', pedido.sucursalId),
              empresaId,
            }),
            select: {
              activo: true,
              zonaHoraria: true,
              nombre: true,
              portalFacturacion: { select: { color: true } },
              empresa: { select: { activo: true } },
            },
          }),
        );
        if (!sucursal.activo || !sucursal.empresa.activo) encontradoOr404(null);
        // La llave ya usada: se contesta ANTES de tomar folio (el INSERT es la segunda red).
        const previa = await tx.cfdi.findFirst({
          where: whereScoped(this.#scope, 'Cfdi', {
            empresaId,
            solicitudId: exigir('solicitudId', pedido.solicitudId),
          }),
          select: { id: true, estado: true, serie: true, folio: true },
        });
        if (previa) throw conflictoDeSolicitud(previa);
        const perfil = await this.#perfilQueEmite(tx, empresaId, ahora);
        const importes = importesDeTotal(pedido.total);
        const folio = await this.#siguienteFolio(tx, perfil.id, empresaId);
        const { id } = await tx.cfdi.create({
          data: {
            empresaId,
            sucursalId: pedido.sucursalId,
            chequeId: null,
            codigoId: null,
            origen: 'manual',
            solicitudId: pedido.solicitudId,
            perfilFiscalId: perfil.id,
            serie: perfil.serie,
            folio,
            receptor: { ...pedido.receptor },
            formaPago: exigir('formaPago', pedido.formaPago),
            subtotal: importes.subtotal,
            iva: importes.iva,
            total: importes.total,
            estado: 'timbrando',
            updatedAt: ahora,
          },
          select: { id: true },
        });
        return {
          reservaId: id,
          origen: 'manual',
          serie: perfil.serie,
          folio,
          emisor: emisorDe(perfil),
          sucursal: {
            zonaHoraria: sucursal.zonaHoraria,
            nombre: sucursal.nombre,
            colorPortal: sucursal.portalFacturacion?.color ?? null,
          },
          cheque: null,
          formaPago: pedido.formaPago,
          importes,
        };
      });
    } catch (error) {
      if (esUnicoDe(error, 'solicitud_id')) {
        // Otra transacción con la misma llave ganó entre la lectura y el INSERT.
        const previa = await this.#enTransaccion((tx) =>
          tx.cfdi.findFirst({
            where: whereScoped(this.#scope, 'Cfdi', { empresaId, solicitudId: pedido.solicitudId }),
            select: { id: true, estado: true, serie: true, folio: true },
          }),
        );
        if (previa) throw conflictoDeSolicitud(previa);
      }
      throw error;
    }
  }

  /**
   * El CFDI que se quiere refacturar y su sustituto (si ya lo tiene), con el scope de quien pide.
   * 404 si no está en el alcance o si es una reserva (`timbrando`).
   */
  async cfdiParaRefacturar(cfdiId: string): Promise<CfdiParaRefacturar> {
    return this.#enTransaccion(async (tx) => {
      const cfdi = encontradoOr404(
        await tx.cfdi.findFirst({
          where: whereScoped(this.#scope, 'Cfdi', {
            id: exigir('cfdiId', cfdiId),
            estado: { not: 'timbrando' },
          }),
          select: {
            id: true,
            empresaId: true,
            estado: true,
            uuid: true,
            idPac: true,
            origen: true,
            sustituidoPor: {
              select: {
                id: true,
                estado: true,
                uuid: true,
                serie: true,
                folio: true,
                total: true,
              },
            },
          },
        }),
      );
      await this.#empresa(tx, cfdi.empresaId);
      if (cfdi.origen === 'global') throw new ConflictException(MENSAJE_GLOBAL_NO_SE_REFACTURA);
      return {
        id: cfdi.id,
        empresaId: cfdi.empresaId,
        estado: cfdi.estado as 'vigente' | 'cancelado',
        uuid: exigir('uuid', cfdi.uuid),
        idPac: exigir('idPac', cfdi.idPac),
        sustituto: cfdi.sustituidoPor
          ? {
              id: cfdi.sustituidoPor.id,
              estado: cfdi.sustituidoPor.estado,
              uuid: cfdi.sustituidoPor.uuid,
              serieFolio: `${cfdi.sustituidoPor.serie}-${cfdi.sustituidoPor.folio}`,
              total: cfdi.sustituidoPor.total,
            }
          : null,
      };
    });
  }

  /**
   * RESERVA el SUSTITUTO de un CFDI vigente (refacturación, F2-107): el candado es el CFDI viejo.
   * En UNA transacción: empresa con scope (404) → el viejo se BLOQUEA (`FOR UPDATE` por id Y
   * empresa) y se re-lee con scope → re-medido con el candado: `vigente` (409 si ya se canceló) y
   * sin sustituto (409) → perfil que emite (503) → folio → INSERT en `timbrando` con
   * `sustituye_a_id` + `tipo_relacion 04`, los MISMOS importes, forma de pago, sucursal, cheque y
   * origen que el viejo, y el receptor corregido. El código NO se mueve aquí: pasa al sustituto al
   * CONFIRMAR. El único de `sustituye_a_id` es la segunda red (409).
   *
   * DECISION PROVISIONAL (nocturno): la refacturación corrige SÓLO los datos del receptor; los
   * importes se copian (motivo 01 = "comprobante emitido con errores con relación").
   */
  async reservarSustituto(
    empresaId: string,
    cfdiId: string,
    receptor: DatosReceptor,
    ahora: Date,
  ): Promise<ReservaCfdi> {
    try {
      return await this.#enTransaccion(async (tx) => {
        await this.#empresa(tx, empresaId);
        const bloqueado = await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM cfdis
          WHERE id = ${exigir('cfdiId', cfdiId)}::uuid AND empresa_id = ${empresaId}::uuid
          FOR UPDATE`;
        encontradoOr404(bloqueado[0] ?? null);
        const viejo = encontradoOr404(
          await tx.cfdi.findFirst({
            where: whereScoped(this.#scope, 'Cfdi', {
              id: cfdiId,
              empresaId,
              estado: { not: 'timbrando' },
            }),
            select: {
              estado: true,
              uuid: true,
              origen: true,
              sucursalId: true,
              chequeId: true,
              formaPago: true,
              subtotal: true,
              iva: true,
              total: true,
              cheque: { select: { folio: true } },
              sustituidoPor: { select: { id: true } },
              sucursal: {
                select: {
                  activo: true,
                  zonaHoraria: true,
                  nombre: true,
                  portalFacturacion: { select: { color: true } },
                  empresa: { select: { activo: true } },
                },
              },
            },
          }),
        );
        if (!viejo.sucursal.activo || !viejo.sucursal.empresa.activo) encontradoOr404(null);
        if (viejo.origen === 'global') throw new ConflictException(MENSAJE_GLOBAL_NO_SE_REFACTURA);
        if (viejo.estado !== 'vigente') throw new ConflictException(MENSAJE_YA_CANCELADO);
        if (viejo.sustituidoPor) throw new ConflictException(MENSAJE_SUSTITUCION_EN_CURSO);
        const perfil = await this.#perfilQueEmite(tx, empresaId, ahora);
        const folio = await this.#siguienteFolio(tx, perfil.id, empresaId);
        const { id } = await tx.cfdi.create({
          data: {
            empresaId,
            sucursalId: viejo.sucursalId,
            chequeId: viejo.chequeId,
            codigoId: null,
            origen: viejo.origen,
            sustituyeAId: cfdiId,
            tipoRelacion: TIPO_RELACION_SUSTITUCION,
            perfilFiscalId: perfil.id,
            serie: perfil.serie,
            folio,
            receptor: { ...receptor },
            formaPago: viejo.formaPago,
            subtotal: viejo.subtotal,
            iva: viejo.iva,
            total: viejo.total,
            estado: 'timbrando',
            updatedAt: ahora,
          },
          select: { id: true },
        });
        return {
          reservaId: id,
          origen: viejo.origen,
          serie: perfil.serie,
          folio,
          emisor: emisorDe(perfil),
          sucursal: {
            zonaHoraria: viejo.sucursal.zonaHoraria,
            nombre: viejo.sucursal.nombre,
            colorPortal: viejo.sucursal.portalFacturacion?.color ?? null,
          },
          cheque: viejo.cheque ? { folio: viejo.cheque.folio } : null,
          formaPago: viejo.formaPago,
          importes: { subtotal: viejo.subtotal, iva: viejo.iva, total: viejo.total },
          relacionados: {
            tipoRelacion: TIPO_RELACION_SUSTITUCION,
            uuids: [exigir('uuid', viejo.uuid)],
          },
        };
      });
    } catch (error) {
      if (esUnicoDe(error, 'sustituye_a_id')) {
        throw new ConflictException(MENSAJE_SUSTITUCION_EN_CURSO);
      }
      throw error;
    }
  }

  /**
   * Anota la CANCELACIÓN de un CFDI que el PAC ya canceló (F2-107: motivo 01 con sustituto), sólo si
   * sigue `vigente` (repetirlo no mueve nada). 404 fuera del scope. Devuelve si lo cambió.
   */
  async marcarCancelado(
    empresaId: string,
    cfdiId: string,
    motivo: MotivoCancelacion,
    canceladoAt: Date,
    ahora: Date,
  ): Promise<boolean> {
    return this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      const { count } = await tx.cfdi.updateMany({
        where: whereScoped(this.#scope, 'Cfdi', {
          id: exigir('cfdiId', cfdiId),
          empresaId,
          estado: 'vigente',
        }),
        data: {
          estado: 'cancelado',
          motivoCancelacion: motivo,
          canceladoAt,
          updatedAt: ahora,
        },
      });
      return count === 1;
    });
  }

  /** El perfil que emite, con el 503 que el portal ya sabe pintar (F2-104). */
  async #perfilPortal(tx: Tx, empresaId: string, ahora: Date) {
    try {
      return await this.#perfilQueEmite(tx, empresaId, ahora);
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        throw new ServiceUnavailableException(MENSAJE_EMISION_NO_DISPONIBLE);
      }
      throw error;
    }
  }

  /**
   * LIBERA una reserva que el PAC rechazó sin timbrar (validación, o "no disponible" tras los
   * reintentos): se borra, y el código vuelve a poderse facturar. Su folio queda como hueco (el
   * CFDI 4.0 no exige folios consecutivos). Sólo borra reservas en `timbrando`.
   */
  async liberarReserva(empresaId: string, reservaId: string): Promise<void> {
    await this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      await tx.cfdi.deleteMany({
        where: whereScoped(this.#scope, 'Cfdi', {
          id: exigir('reservaId', reservaId),
          empresaId,
          estado: 'timbrando',
        }),
      });
    });
  }

  /**
   * Anota dónde quedaron el XML y el PDF de un CFDI vigente (F2-105). Sólo si todavía no tenía:
   * repetirlo no mueve nada. 404 si el CFDI no está en el scope.
   */
  async registrarArchivosCfdi(
    empresaId: string,
    cfdiId: string,
    archivos: ArchivosCfdi,
    ahora: Date,
  ): Promise<void> {
    await this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      const cfdi = encontradoOr404(
        await tx.cfdi.findFirst({
          where: whereScoped(this.#scope, 'Cfdi', {
            id: exigir('cfdiId', cfdiId),
            empresaId,
            estado: 'vigente',
          }),
          select: { id: true },
        }),
      );
      await tx.cfdi.updateMany({
        where: whereScoped(this.#scope, 'Cfdi', {
          id: cfdi.id,
          empresaId,
          xmlClave: null,
          pdfClave: null,
        }),
        data: {
          xmlClave: exigir('xmlClave', archivos.xmlClave),
          pdfClave: exigir('pdfClave', archivos.pdfClave),
          updatedAt: ahora,
        },
      });
    });
  }

  /**
   * RECLAMA el primer envío por correo de un CFDI (F2-105): la fila nace en `enviando` con el correo
   * DEL CFDI (el del receptor con que se timbró), nunca con uno que pase quien llama. Null si el
   * receptor no tiene correo o si el envío ya existía (no se manda dos veces). 404 fuera del scope.
   */
  async reclamarEnvioCfdi(
    empresaId: string,
    cfdiId: string,
    ahora: Date,
  ): Promise<EnvioReclamado | null> {
    try {
      return await this.#enTransaccion(async (tx) => {
        await this.#empresa(tx, empresaId);
        const cfdi = encontradoOr404(
          await tx.cfdi.findFirst({
            where: whereScoped(this.#scope, 'Cfdi', {
              id: exigir('cfdiId', cfdiId),
              empresaId,
              estado: 'vigente',
            }),
            select: { id: true, receptor: true },
          }),
        );
        const email = emailDelReceptor(cfdi.receptor);
        if (email === null) return null;
        const { id } = await tx.cfdiEnvio.create({
          data: {
            empresaId,
            cfdiId: cfdi.id,
            email,
            estado: 'enviando',
            intentos: 1,
            ultimoIntentoAt: ahora,
            updatedAt: ahora,
          },
          select: { id: true },
        });
        return { envioId: id, email, intentos: 1 };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return null;
      }
      throw error;
    }
  }

  /**
   * RECLAMA el reintento manual del envío de un CFDI (F2-105): uno `fallido`, o `enviando` vencido
   * (`ENVIO_VENCIDO_MS`), pasa a `enviando` con intentos + 1 en UN `updateMany` condicionado: si dos
   * administradores lo piden a la vez, sólo uno gana y el otro recibe 409. Primero el scope: un
   * CFDI de otra empresa es 404 antes de decir nada de sus envíos.
   */
  async reclamarReintentoEnvio(
    empresaId: string,
    cfdiId: string,
    ahora: Date,
  ): Promise<EnvioReclamado> {
    return this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      const cfdi = encontradoOr404(
        await tx.cfdi.findFirst({
          where: whereScoped(this.#scope, 'Cfdi', { id: exigir('cfdiId', cfdiId), empresaId }),
          select: { id: true },
        }),
      );
      const aReintentar = whereScoped(this.#scope, 'CfdiEnvio', {
        cfdiId: cfdi.id,
        empresaId,
        ...whereEnvioAReintentar(ahora),
      });
      const envio = await tx.cfdiEnvio.findFirst({
        where: aReintentar,
        select: { id: true, email: true, intentos: true },
        orderBy: { createdAt: 'asc' },
      });
      if (!envio) throw new ConflictException(MENSAJE_SIN_ENVIO_QUE_REINTENTAR);
      const { count } = await tx.cfdiEnvio.updateMany({
        where: { ...aReintentar, id: envio.id },
        data: {
          estado: 'enviando',
          intentos: { increment: 1 },
          ultimoIntentoAt: ahora,
          updatedAt: ahora,
        },
      });
      if (count !== 1) throw new ConflictException(MENSAJE_SIN_ENVIO_QUE_REINTENTAR);
      return { envioId: envio.id, email: envio.email, intentos: envio.intentos + 1 };
    });
  }

  /** Cierra un intento de envío: `enviado` con el id del correo, o `fallido` con el error recortado. */
  async cerrarEnvioCfdi(
    empresaId: string,
    envioId: string,
    resultado: ResultadoEnvio,
    ahora: Date,
  ): Promise<void> {
    await this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      const { count } = await tx.cfdiEnvio.updateMany({
        where: whereScoped(this.#scope, 'CfdiEnvio', {
          id: exigir('envioId', envioId),
          empresaId,
          estado: 'enviando',
        }),
        data: resultado.ok
          ? {
              estado: 'enviado',
              correoId: resultado.correoId,
              error: null,
              ultimoIntentoAt: ahora,
              updatedAt: ahora,
            }
          : {
              estado: 'fallido',
              error: resultado.error.slice(0, MAX_ERROR_ENVIO),
              ultimoIntentoAt: ahora,
              updatedAt: ahora,
            },
      });
      encontradoOr404(count === 1 ? true : null);
    });
  }

  // -------------------------------------------------------------------------
  // F2-108 · Factura global de los tickets que nadie facturó.
  // -------------------------------------------------------------------------

  /** La sucursal de ESA empresa, con el scope (404 si no, o si ella o su empresa están de baja). */
  async #sucursalDeEmpresa(tx: Tx, empresaId: string, sucursalId: string) {
    const sucursal = encontradoOr404(
      await tx.sucursal.findFirst({
        where: whereScoped(this.#scope, 'Sucursal', {
          id: exigir('sucursalId', sucursalId),
          empresaId,
        }),
        select: {
          id: true,
          activo: true,
          zonaHoraria: true,
          nombre: true,
          portalFacturacion: { select: { color: true } },
          empresa: { select: { activo: true } },
        },
      }),
    );
    if (!sucursal.activo || !sucursal.empresa.activo) encontradoOr404(null);
    return sucursal;
  }

  /** La configuración de la global de la empresa (sin fila = mensual y manual). 404 fuera de scope. */
  async configuracionGlobal(empresaId: string): Promise<ConfiguracionGlobal> {
    return this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      return this.#configuracionGlobalTx(tx, empresaId);
    });
  }

  async #configuracionGlobalTx(tx: Tx, empresaId: string): Promise<ConfiguracionGlobal> {
    const fila = await tx.configuracionFacturacion.findFirst({
      where: whereScoped(this.#scope, 'ConfiguracionFacturacion', { empresaId }),
      select: {
        globalPeriodicidad: true,
        globalAutomatica: true,
        globalAutomaticaDesde: true,
        vigenciaCodigos: true,
        vigenciaDias: true,
      },
    });
    return {
      periodicidad: fila?.globalPeriodicidad ?? 'mensual',
      automatica: fila?.globalAutomatica ?? false,
      automaticaDesde: fila?.globalAutomaticaDesde ?? null,
      vigencia:
        fila?.vigenciaCodigos === 'dias' && fila.vigenciaDias !== null
          ? { regla: 'dias', dias: fila.vigenciaDias }
          : { regla: 'fin_de_mes' },
    };
  }

  /**
   * Guarda la periodicidad de la global y si se emite sola. Al ENCENDER la automática se anota
   * desde cuándo (sólo emitirá periodos que terminen después); si ya estaba encendida, se conserva
   * la fecha; al apagarla se borra.
   */
  async guardarConfiguracionGlobal(
    empresaId: string,
    datos: { periodicidad: PeriodicidadGlobalEnum; automatica: boolean },
    actorId: string | null,
    ahora: Date,
  ): Promise<ConfiguracionGlobal> {
    return this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      const actual = await this.#configuracionGlobalTx(tx, empresaId);
      const desde = datos.automatica ? (actual.automaticaDesde ?? ahora) : null;
      const cambios = {
        globalPeriodicidad: datos.periodicidad,
        globalAutomatica: datos.automatica,
        globalAutomaticaDesde: desde,
        actualizadoPor: actorId,
        updatedAt: ahora,
      };
      const { count } = await tx.configuracionFacturacion.updateMany({
        where: whereScoped(this.#scope, 'ConfiguracionFacturacion', { empresaId }),
        data: cambios,
      });
      if (count !== 1) {
        try {
          await tx.configuracionFacturacion.create({
            data: { empresaId, ...cambios },
            select: { id: true },
          });
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
            throw new ConflictException(
              'Otro administrador acaba de guardar la configuración de esta empresa. Recarga.',
            );
          }
          throw error;
        }
      }
      return {
        ...actual,
        periodicidad: datos.periodicidad,
        automatica: datos.automatica,
        automaticaDesde: desde,
      };
    });
  }

  /**
   * Los tickets de la sucursal que quedan para una global, por DÍA LOCAL de cierre (en la zona de
   * la sucursal), desde el 1 de enero del año anterior (lo más viejo que el SAT acepta en una
   * global), más las globales ya emitidas (o en emisión) de la sucursal. Los días se enrollan en
   * periodos en `global.ts#enrollarPeriodos`.
   *
   * El SQL replica "incluible" = `estadoPublico(...) === 'expirado'` y sin global, y "todavía
   * autofacturable" = `estadoPublico(...) === 'pendiente'` (un e2e lo compara rama por rama):
   * código `pendiente`/`expirado` guardado, cuenta FACTURABLE (cerrada, no cancelada y con total > 0,
   * `codigo.ts#esFacturable`), SIN CFDI propio `vigente` o `timbrando` y SIN fila en
   * `cfdi_global_codigos`. Empresa Y sucursal en CADA tabla. Una cuenta que SR reprocesó a total 0
   * después de tener código no cuenta ni como lista ni como vigente (el portal tampoco la emite):
   * la misma regla que `#ticketsDelPeriodo`.
   */
  async periodosGlobal(
    empresaId: string,
    sucursalId: string,
    ahora: Date,
  ): Promise<{ sucursal: SucursalGlobal; dias: DiaGlobal[]; emitidas: GlobalEmitida[] }> {
    return this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      const suc = await this.#sucursalDeEmpresa(tx, empresaId, sucursalId);
      const anio = Number(diaLocal(ahora, suc.zonaHoraria).slice(0, 4));
      const ventana = instanteDesdeLocal(`${anio - 1}-01-01T00:00:00`, suc.zonaHoraria);
      if (ventana === null) throw new Error(`Zona inválida en la sucursal ${suc.id}`);
      const expirado = Prisma.sql`(cf.estado = 'expirado' OR cf.expira_at <= ${ahora})`;
      const filas = await tx.$queryRaw<
        {
          dia: string;
          n_listos: number;
          total_listos: string;
          n_vigentes: number;
          vigentes_hasta: Date | null;
        }[]
      >`
        SELECT to_char(ch.cerrado_at AT TIME ZONE ${suc.zonaHoraria}, 'YYYY-MM-DD') AS dia,
               (count(*) FILTER (WHERE ${expirado}))::int AS n_listos,
               COALESCE(sum(ch.total) FILTER (WHERE ${expirado}), 0)::text AS total_listos,
               (count(*) FILTER (WHERE NOT ${expirado}))::int AS n_vigentes,
               max(cf.expira_at) FILTER (WHERE NOT ${expirado}) AS vigentes_hasta
        FROM codigos_facturacion cf
        JOIN cheques ch
          ON ch.id = cf.cheque_id
         AND ch.empresa_id = ${empresaId}::uuid
         AND ch.sucursal_id = ${suc.id}::uuid
        WHERE cf.empresa_id = ${empresaId}::uuid
          AND cf.sucursal_id = ${suc.id}::uuid
          AND cf.estado IN ('pendiente', 'expirado')
          AND ch.cancelado = false
          AND ch.cerrado_at IS NOT NULL
          AND ch.total > 0
          AND ch.cerrado_at >= ${ventana}
          AND NOT EXISTS (
            SELECT 1 FROM cfdis c
            WHERE c.codigo_id = cf.id
              AND c.empresa_id = ${empresaId}::uuid
              AND c.sucursal_id = ${suc.id}::uuid
              AND c.estado IN ('vigente', 'timbrando'))
          AND NOT EXISTS (
            SELECT 1 FROM cfdi_global_codigos g
            WHERE g.codigo_id = cf.id
              AND g.empresa_id = ${empresaId}::uuid
              AND g.sucursal_id = ${suc.id}::uuid)
        GROUP BY 1
        ORDER BY 1`;
      const emitidas = await tx.cfdi.findMany({
        where: whereScoped(this.#scope, 'Cfdi', {
          empresaId,
          sucursalId: suc.id,
          origen: 'global',
        }),
        select: {
          id: true,
          uuid: true,
          serie: true,
          folio: true,
          estado: true,
          total: true,
          emitidoAt: true,
          globalPeriodicidad: true,
          globalDesde: true,
          xmlClave: true,
          _count: { select: { globalCodigos: true } },
        },
        orderBy: [{ globalDesde: 'desc' }, { folio: 'desc' }],
      });
      return {
        sucursal: { id: suc.id, nombre: suc.nombre, zonaHoraria: suc.zonaHoraria },
        dias: filas.map((f) => ({
          dia: f.dia,
          nListos: f.n_listos,
          totalListos: new Prisma.Decimal(f.total_listos),
          nVigentes: f.n_vigentes,
          vigentesHasta: f.vigentes_hasta,
        })),
        emitidas: emitidas.map((e) => ({
          id: e.id,
          uuid: e.uuid,
          serieFolio: `${e.serie}-${e.folio}`,
          estado: e.estado,
          total: e.total,
          emitidoAt: e.emitidoAt,
          globalPeriodicidad: e.globalPeriodicidad,
          globalDesde: e.globalDesde,
          tickets: e._count.globalCodigos,
          conArchivos: e.xmlClave !== null,
        })),
      };
    });
  }

  /**
   * Los tickets de UN periodo, ya clasificados con `estadoPublico` (el mismo juez que el portal):
   * `incluidos` = expirados y sin global; `vigentes` = los que el cliente todavía puede facturar.
   * UNA sola consulta (con pagos) para todo el periodo.
   */
  async #ticketsDelPeriodo(
    tx: Tx,
    empresaId: string,
    sucursalId: string,
    periodo: PeriodoGlobal,
    ahora: Date,
  ) {
    const codigos = await tx.codigoFacturacion.findMany({
      where: whereScoped(this.#scope, 'CodigoFacturacion', {
        empresaId,
        sucursalId,
        cheque: {
          empresaId,
          sucursalId,
          cerradoAt: { gte: periodo.desde, lt: periodo.hasta },
        },
      }),
      select: {
        id: true,
        estado: true,
        expiraAt: true,
        cfdi: { select: { estado: true } },
        global: { select: { cfdi: { select: { estado: true } } } },
        cheque: {
          select: {
            folio: true,
            cerradoAt: true,
            cancelado: true,
            total: true,
            pagos: { select: { formaRaw: true, monto: true }, orderBy: { id: 'asc' } },
          },
        },
      },
      orderBy: [{ cheque: { cerradoAt: 'asc' } }, { id: 'asc' }],
    });
    const incluidos: typeof codigos = [];
    const vigentes: typeof codigos = [];
    for (const c of codigos) {
      const estado = estadoPublico(c, c.cheque, ahora.getTime());
      // Sólo cuentas facturables (total > 0): una que SR reprocesó a 0 no entra ni detiene la
      // global (el portal tampoco la emitiría). Misma regla que el SQL de `periodosGlobal`.
      if (!esFacturable(c.cheque)) continue;
      if (estado === 'expirado' && c.global === null) incluidos.push(c);
      else if (estado === 'pendiente') vigentes.push(c);
    }
    return { incluidos, vigentes };
  }

  /** Cuántas globales VIGENTES (o en emisión) tiene ya ese periodo de la sucursal. */
  async #globalesDelPeriodo(tx: Tx, empresaId: string, sucursalId: string, p: PeriodoGlobal) {
    return tx.cfdi.count({
      where: whereScoped(this.#scope, 'Cfdi', {
        empresaId,
        sucursalId,
        origen: 'global',
        estado: { in: ['vigente', 'timbrando'] },
        globalPeriodicidad: p.informacion.periodicidad,
        globalDesde: p.desde,
      }),
    });
  }

  /** El periodo que empieza en `clave`, o 400 si la clave no es el inicio de uno. */
  #periodo(clave: string, zona: string, periodicidad: PeriodicidadGlobalEnum): PeriodoGlobal {
    const periodo = periodoDeClave(clave, zona, periodicidad);
    if (periodo === null) throw new BadRequestException([MENSAJE_CLAVE_PERIODO]);
    return periodo;
  }

  /** La vista previa de la global de un periodo: qué tickets entrarían y cuánto suma. */
  async vistaPreviaGlobal(
    empresaId: string,
    pedido: PedidoGlobal,
    ahora: Date,
  ): Promise<VistaPreviaGlobal> {
    return this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      const suc = await this.#sucursalDeEmpresa(tx, empresaId, pedido.sucursalId);
      const periodo = this.#periodo(pedido.clave, suc.zonaHoraria, pedido.periodicidad);
      const { incluidos, vigentes } = await this.#ticketsDelPeriodo(
        tx,
        empresaId,
        suc.id,
        periodo,
        ahora,
      );
      const catalogo = await this.#catalogoFormas(tx, empresaId);
      const formaPago = formaPagoGlobal(
        incluidos.flatMap((c) => c.cheque.pagos),
        catalogo,
      );
      const hasta = vigentes.reduce<Date | null>(
        (m, c) => (m === null || c.expiraAt > m ? c.expiraAt : m),
        null,
      );
      return {
        sucursal: { id: suc.id, nombre: suc.nombre, zonaHoraria: suc.zonaHoraria },
        periodo,
        estado: estadoPeriodo(
          periodo,
          { nListos: incluidos.length, nVigentes: vigentes.length },
          ahora,
          suc.zonaHoraria,
        ),
        tickets: incluidos.map((c) => ({
          folio: c.cheque.folio,
          cerradoAt: c.cheque.cerradoAt!,
          total: c.cheque.total,
        })),
        vigentes: { tickets: vigentes.length, hasta },
        formaPago,
        importes:
          incluidos.length > 0
            ? importesGlobal(
                incluidos.map((c) => ({ folio: c.cheque.folio, total: c.cheque.total })),
              )
            : null,
        globalesPrevias: await this.#globalesDelPeriodo(tx, empresaId, suc.id, periodo),
      };
    });
  }

  async #catalogoFormas(tx: Tx, empresaId: string): Promise<Map<string, FormaPagoEnum>> {
    const catalogo = await tx.formaPagoCatalogo.findMany({
      where: whereScoped(this.#scope, 'FormaPagoCatalogo', { empresaId }),
      select: { formaRaw: true, forma: true },
    });
    return new Map(catalogo.map((c) => [c.formaRaw, c.forma as FormaPagoEnum]));
  }

  /**
   * RESERVA la factura global de un periodo de una sucursal. En UNA transacción, en este orden:
   * 1. Empresa (404) → sucursal activa de ESA empresa (404) → la clave es inicio de periodo (400).
   * 2. El SAT acepta su año (422) y el periodo ya terminó (409).
   * 3. Se BLOQUEAN (`FOR UPDATE OF cf`, en orden de id: dos reservas del mismo periodo no se
   *    interbloquean) todos los códigos de la sucursal cuyo cheque cerró en el periodo, y con el
   *    candado se re-mide todo con `estadoPublico` en UNA consulta.
   * 4. Si algún ticket todavía se puede autofacturar → 409 (el periodo no está listo). Si no queda
   *    ninguno que incluir → 409 (otra global ya los tomó, o no hay).
   * 5. Perfil que emite (503) → forma de pago (422). ANTES de tomar folio: un rechazo no deja hueco.
   * 6. Folio → INSERT de la reserva `timbrando` (origen global, público en general, importes
   *    sumados, InformacionGlobal) + una fila por ticket en `cfdi_global_codigos`. El único de
   *    `codigo_id` es la segunda red (409).
   */
  async reservarGlobal(empresaId: string, pedido: PedidoGlobal, ahora: Date): Promise<ReservaCfdi> {
    try {
      return await this.#enTransaccion(async (tx) => {
        await this.#empresa(tx, empresaId);
        const suc = await this.#sucursalDeEmpresa(tx, empresaId, pedido.sucursalId);
        const periodo = this.#periodo(pedido.clave, suc.zonaHoraria, pedido.periodicidad);
        if (!anioPermitido(periodo, ahora, suc.zonaHoraria)) {
          throw new UnprocessableEntityException(MENSAJE_GLOBAL_FUERA_DE_PLAZO);
        }
        if (ahora.getTime() < periodo.hasta.getTime()) {
          throw new ConflictException(MENSAJE_GLOBAL_EN_CURSO);
        }
        await tx.$queryRaw`
          SELECT cf.id FROM codigos_facturacion cf
          JOIN cheques ch
            ON ch.id = cf.cheque_id
           AND ch.empresa_id = ${empresaId}::uuid
           AND ch.sucursal_id = ${suc.id}::uuid
          WHERE cf.empresa_id = ${empresaId}::uuid
            AND cf.sucursal_id = ${suc.id}::uuid
            AND ch.cerrado_at >= ${periodo.desde}
            AND ch.cerrado_at < ${periodo.hasta}
          ORDER BY cf.id
          FOR UPDATE OF cf`;
        const { incluidos, vigentes } = await this.#ticketsDelPeriodo(
          tx,
          empresaId,
          suc.id,
          periodo,
          ahora,
        );
        if (vigentes.length > 0) {
          throw new ConflictException(mensajeGlobalEsperando(vigentes.length));
        }
        if (incluidos.length === 0) throw new ConflictException(MENSAJE_GLOBAL_SIN_TICKETS);

        const perfil = await this.#perfilQueEmite(tx, empresaId, ahora);
        const formaPago = formaPagoGlobal(
          incluidos.flatMap((c) => c.cheque.pagos),
          await this.#catalogoFormas(tx, empresaId),
        );
        if (formaPago === null) throw new UnprocessableEntityException(MENSAJE_GLOBAL_SIN_FORMA);

        const tickets = incluidos.map((c) => ({ folio: c.cheque.folio, total: c.cheque.total }));
        const importes = importesGlobal(tickets);
        const folio = await this.#siguienteFolio(tx, perfil.id, empresaId);
        const { id } = await tx.cfdi.create({
          data: {
            empresaId,
            sucursalId: suc.id,
            chequeId: null,
            codigoId: null,
            origen: 'global',
            perfilFiscalId: perfil.id,
            serie: perfil.serie,
            folio,
            receptor: receptorPublicoGeneral(perfil.cp),
            formaPago,
            subtotal: importes.subtotal,
            iva: importes.iva,
            total: importes.total,
            estado: 'timbrando',
            globalPeriodicidad: periodo.informacion.periodicidad,
            globalMeses: periodo.informacion.meses,
            globalAnio: periodo.informacion.anio,
            globalDesde: periodo.desde,
            globalHasta: periodo.hasta,
            updatedAt: ahora,
          },
          select: { id: true },
        });
        await tx.cfdiGlobalCodigo.createMany({
          data: incluidos.map((c) => ({
            empresaId,
            sucursalId: suc.id,
            cfdiId: id,
            codigoId: c.id,
            total: c.cheque.total,
          })),
        });
        return {
          reservaId: id,
          origen: 'global',
          serie: perfil.serie,
          folio,
          emisor: emisorDe(perfil),
          sucursal: {
            zonaHoraria: suc.zonaHoraria,
            nombre: suc.nombre,
            colorPortal: suc.portalFacturacion?.color ?? null,
          },
          cheque: null,
          formaPago,
          importes,
          global: { informacion: periodo.informacion, etiqueta: periodo.etiqueta, tickets },
        };
      });
    } catch (error) {
      if (esUnicoDe(error, 'codigo_id')) {
        // Otra global tomó alguno de estos tickets entre la lectura y el INSERT.
        throw new ConflictException(MENSAJE_GLOBAL_SIN_TICKETS);
      }
      throw error;
    }
  }

  /**
   * Las empresas con la global AUTOMÁTICA encendida, con sus sucursales activas. Para el
   * programador, que corre con el scope del sistema y después va empresa por empresa.
   */
  async empresasConGlobalAutomatica(): Promise<
    { empresaId: string; periodicidad: PeriodicidadGlobalEnum; desde: Date; sucursales: string[] }[]
  > {
    return this.#enTransaccion(async (tx) => {
      const filas = await tx.configuracionFacturacion.findMany({
        where: whereScoped(this.#scope, 'ConfiguracionFacturacion', {
          globalAutomatica: true,
          empresa: { activo: true },
        }),
        select: {
          empresaId: true,
          globalPeriodicidad: true,
          globalAutomaticaDesde: true,
          empresa: {
            select: {
              sucursales: { where: { activo: true }, select: { id: true }, orderBy: { id: 'asc' } },
            },
          },
        },
        orderBy: { empresaId: 'asc' },
      });
      return filas
        .filter((f) => f.globalAutomaticaDesde !== null)
        .map((f) => ({
          empresaId: f.empresaId,
          periodicidad: f.globalPeriodicidad,
          desde: f.globalAutomaticaDesde!,
          sucursales: f.empresa.sucursales.map((s) => s.id),
        }));
    });
  }

  async #sucursal(tx: Tx, sucursalId: string) {
    return encontradoOr404(
      await tx.sucursal.findFirst({
        where: whereScoped(this.#scope, 'Sucursal', { id: exigir('sucursalId', sucursalId) }),
        select: { id: true, empresaId: true },
      }),
    );
  }

  /**
   * Crea o edita el portal de autofactura de una sucursal (F2-103). La sucursal se verifica con el
   * scope ANTES que nada (404); el slug es único GLOBAL (409 si otro portal, de cualquier empresa,
   * ya lo usa: los slugs son URLs públicas, así que el 409 no revela nada que no se vea en la web).
   */
  async guardarPortal(
    sucursalId: string,
    datos: DatosPortal,
    /** Null sólo desde el seed: así sabe después que nadie lo ha editado. */
    actorId: string | null,
    ahora: Date,
  ): Promise<{ creado: boolean }> {
    try {
      return await this.#enTransaccion(async (tx) => {
        const sucursal = await this.#sucursal(tx, sucursalId);
        const { count } = await tx.portalFacturacion.updateMany({
          where: { sucursalId: sucursal.id, empresaId: sucursal.empresaId },
          data: { ...datos, actualizadoPor: actorId, updatedAt: ahora },
        });
        if (count === 1) return { creado: false };
        await tx.portalFacturacion.create({
          data: {
            sucursalId: sucursal.id,
            empresaId: sucursal.empresaId,
            ...datos,
            actualizadoPor: actorId,
            updatedAt: ahora,
          },
          select: { sucursalId: true },
        });
        return { creado: true };
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const campos = (error.meta?.target ?? []) as string[] | string;
        if (String(campos).includes('slug')) throw new ConflictException(MENSAJE_SLUG_OCUPADO);
        throw new ConflictException(
          'Otro administrador acaba de guardar el portal de esta sucursal. Recarga.',
        );
      }
      throw error;
    }
  }

  /**
   * Pone (o quita, con `null`) el logo del portal de la sucursal. 404 si la sucursal no está en
   * el alcance; 409 si todavía no tiene portal (primero se guarda su enlace).
   */
  async guardarLogoPortal(
    sucursalId: string,
    logo: { bytes: Buffer; tipo: string } | null,
    actorId: string | null,
    ahora: Date,
  ): Promise<void> {
    await this.#enTransaccion(async (tx) => {
      const sucursal = await this.#sucursal(tx, sucursalId);
      const { count } = await tx.portalFacturacion.updateMany({
        where: { sucursalId: sucursal.id, empresaId: sucursal.empresaId },
        data: {
          logo: logo ? new Uint8Array(logo.bytes) : null,
          logoTipo: logo?.tipo ?? null,
          actualizadoPor: actorId,
          updatedAt: ahora,
        },
      });
      if (count !== 1) {
        throw new ConflictException(
          'Esta sucursal todavía no tiene portal: guarda primero su enlace y su color.',
        );
      }
    });
  }

  /**
   * La regla de vigencia de los códigos de facturación de la empresa (F2-101). Sólo afecta a los
   * códigos NUEVOS: cada código guarda su `expira_at` al nacer. `dias` fuera de 1..366 lo
   * rechaza también un CHECK de la base.
   */
  async guardarVigenciaCodigos(
    empresaId: string,
    vigencia: VigenciaCodigos,
    actorId: string | null,
    ahora: Date,
  ): Promise<void> {
    const datos = {
      vigenciaCodigos: vigencia.regla,
      vigenciaDias: vigencia.regla === 'dias' ? vigencia.dias : null,
      actualizadoPor: actorId,
      updatedAt: ahora,
    };
    await this.#enTransaccion(async (tx) => {
      await this.#empresa(tx, empresaId);
      const { count } = await tx.configuracionFacturacion.updateMany({
        where: whereScoped(this.#scope, 'ConfiguracionFacturacion', { empresaId }),
        data: datos,
      });
      if (count === 1) return;
      try {
        await tx.configuracionFacturacion.create({
          data: { empresaId, ...datos },
          select: { id: true },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException(
            'Otro administrador acaba de guardar la vigencia de esta empresa. Recarga.',
          );
        }
        throw error;
      }
    });
  }
}
