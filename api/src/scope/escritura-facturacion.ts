import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { VigenciaCodigos } from '../facturacion/codigo';
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
