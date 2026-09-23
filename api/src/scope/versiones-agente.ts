import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma, type VersionAgente } from '@prisma/client';

import type { EmpresaScope } from './empresa-scope';

/**
 * El canal de versiones del agente (F2-143), parte del helper obligatorio de scope. Es dato de
 * PLATAFORMA (`LLAVE_EMPRESA.VersionAgente = null`, como el control de folios de F2-110): el
 * binario es el mismo para todas las empresas y lo publica el admin_global. Esta pieza es la ÚNICA
 * que lee y escribe `versiones_agente`.
 *
 * - `LecturaVersionesAgente` contesta a cualquiera (el agente de una sucursal, el estado de agentes
 *   de un admin_empresa, el evaluador de alertas): sólo la versión VIGENTE o un binario publicado,
 *   nunca nada de un tenant, porque la tabla no tiene tenant.
 * - Listar, publicar y retirar exigen scope `global` y LANZAN con otro: es un error de
 *   programación (la ruta ya exige el rol), no un 404.
 *
 * VIGENTE = la publicada más reciente (`publicada_at`, desempate por `version`) que no esté
 * retirada. Retirar la vigente hace vigente a la anterior: es el rollback.
 */

/** X.Y.Z, cada parte de 1 a 4 dígitos. El mismo CHECK que la migración y que el agente. */
export const REGEX_VERSION_AGENTE = /^\d{1,4}\.\d{1,4}\.\d{1,4}$/;

/** Lo que un agente necesita saber de la vigente. */
export interface VersionVigente {
  version: string;
  sha256: string;
  tamanoBytes: number;
  claveArchivo: string;
}

export interface NuevaVersionAgente {
  version: string;
  sha256: string;
  tamanoBytes: number;
  claveArchivo: string;
  notas: string | null;
  publicadaPor: string;
  publicadaAt: Date;
}

/** La clave del binario de una versión en `PuertoArchivos`. */
export function claveBinario(version: string): string {
  if (!REGEX_VERSION_AGENTE.test(version)) {
    throw new Error(`Versión del agente inválida: "${version}".`);
  }
  return `agente/${version}/agente.exe`;
}

const ORDEN_VIGENTE: Prisma.VersionAgenteOrderByWithRelationInput[] = [
  { publicadaAt: 'desc' },
  { version: 'desc' },
];

interface ClienteVersiones {
  versionAgente: Pick<
    Prisma.TransactionClient['versionAgente'],
    'findFirst' | 'findMany' | 'create' | 'updateMany'
  >;
}

function exigirGlobal(scope: EmpresaScope, que: string): void {
  if (scope.tipo !== 'global') {
    throw new Error(
      `${que}: el canal de versiones del agente es de la plataforma y exige scope global.`,
    );
  }
}

/** Lecturas del canal, con cualquier scope o desde el agente. */
export class LecturaVersionesAgente {
  readonly #prisma: ClienteVersiones;

  constructor(prisma: ClienteVersiones) {
    this.#prisma = prisma;
  }

  /** La vigente, o null si no hay ninguna publicada sin retirar. */
  async vigente(): Promise<VersionVigente | null> {
    return this.#prisma.versionAgente.findFirst({
      where: { retiradaAt: null },
      orderBy: ORDEN_VIGENTE,
      select: { version: true, sha256: true, tamanoBytes: true, claveArchivo: true },
    });
  }

  /** Un binario publicado y NO retirado, para la descarga firmada. Null = no se sirve. */
  async publicada(version: string): Promise<VersionVigente | null> {
    if (!REGEX_VERSION_AGENTE.test(version)) return null;
    return this.#prisma.versionAgente.findFirst({
      where: { version, retiradaAt: null },
      select: { version: true, sha256: true, tamanoBytes: true, claveArchivo: true },
    });
  }
}

/** Lo que sólo el admin_global puede hacer con el canal. */
export class EscrituraVersionesAgente {
  readonly #prisma: ClienteVersiones;

  constructor(prisma: ClienteVersiones, scope: EmpresaScope) {
    exigirGlobal(scope, 'EscrituraVersionesAgente');
    this.#prisma = prisma;
  }

  /** Todas, de la más reciente a la más vieja. */
  listar(): Promise<VersionAgente[]> {
    return this.#prisma.versionAgente.findMany({ orderBy: ORDEN_VIGENTE });
  }

  /** ¿Ya existe esa versión (retirada o no)? Se pregunta ANTES de guardar el binario. */
  async existe(version: string): Promise<boolean> {
    const fila = await this.#prisma.versionAgente.findFirst({
      where: { version },
      select: { id: true },
    });
    return fila !== null;
  }

  /** Registra una versión ya guardada en `PuertoArchivos`. Repetida = 409 (el único lo decide). */
  async publicar(datos: NuevaVersionAgente): Promise<VersionAgente> {
    try {
      return await this.#prisma.versionAgente.create({ data: { ...datos } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException(`La versión ${datos.version} ya está publicada.`);
      }
      throw error;
    }
  }

  /** Retira una versión (idempotente: una ya retirada conserva su fecha). No existe = 404. */
  async retirar(version: string, ahora: Date): Promise<VersionAgente> {
    const fila = REGEX_VERSION_AGENTE.test(version)
      ? await this.#prisma.versionAgente.findFirst({ where: { version } })
      : null;
    if (!fila) throw new NotFoundException('Recurso no encontrado');
    if (fila.retiradaAt) return fila;
    await this.#prisma.versionAgente.updateMany({
      where: { id: fila.id, retiradaAt: null },
      data: { retiradaAt: ahora },
    });
    return { ...fila, retiradaAt: ahora };
  }
}
