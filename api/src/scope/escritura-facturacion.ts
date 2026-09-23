import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import {
  esFacturable,
  estadoPublico,
  MENSAJE_ESTADO,
  type EstadoPublico,
  type VigenciaCodigos,
} from '../facturacion/codigo';
import { formaPagoSat, importesDeTotal, type FormaPagoEnum } from '../facturacion/cfdi';
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
  serie: string;
  folio: number;
  emisor: { rfc: string; razonSocial: string; regimenFiscal: string; cp: string };
  sucursal: { zonaHoraria: string };
  cheque: { folio: string; total: Prisma.Decimal };
  formaPago: string;
  importes: { subtotal: Prisma.Decimal; iva: Prisma.Decimal; total: Prisma.Decimal };
}

/** El timbre que devolvió el PAC. */
export interface TimbreCfdi {
  uuid: string;
  idPac: string;
  fechaTimbrado: Date;
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

/** El 409 que el portal ya sabe pintar: el estado público actual del código. */
export function conflictoDeEstado(estado: EstadoPublico): ConflictException {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    message: MENSAJE_ESTADO[estado],
    estado,
  });
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
                select: { activo: true, zonaHoraria: true, empresa: { select: { activo: true } } },
              },
            },
          }),
        );
        if (!codigo.sucursal.activo || !codigo.sucursal.empresa.activo) encontradoOr404(null);
        const estado = estadoPublico(codigo, codigo.cheque, ahora.getTime());
        if (estado !== 'pendiente') throw conflictoDeEstado(estado);
        if (!esFacturable(codigo.cheque)) {
          throw new UnprocessableEntityException(MENSAJE_NO_FACTURABLE);
        }

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
          throw new ServiceUnavailableException(MENSAJE_EMISION_NO_DISPONIBLE);
        }

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
        const [{ folio_actual: folio }] = await tx.$queryRaw<{ folio_actual: number }[]>`
          UPDATE perfiles_fiscales SET folio_actual = folio_actual + 1
          WHERE id = ${perfil.id}::uuid AND empresa_id = ${empresaId}::uuid
          RETURNING folio_actual`;
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
          serie: perfil.serie,
          folio,
          emisor: {
            rfc: perfil.rfc,
            razonSocial: perfil.razonSocial,
            regimenFiscal: perfil.regimenFiscal,
            cp: perfil.cp,
          },
          sucursal: { zonaHoraria: codigo.sucursal.zonaHoraria },
          cheque: { folio: codigo.cheque.folio, total: codigo.cheque.total },
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
          select: { id: true, codigoId: true },
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
