import { ConflictException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import type { EmpresaScope } from './empresa-scope';
import { encontradoOr404, whereScoped } from './scope.helper';

/**
 * Los códigos de enlace del instalador de un clic, parte del helper obligatorio de scope. Esta
 * pieza es la ÚNICA que escribe `codigos_enlace` y la única, fuera de `ApiKeyService.rotar`, que
 * cambia `sucursales.api_key_hash` por un canje.
 *
 * - `EscrituraEnlaces` (con el scope del usuario): emitir el código de una sucursal del alcance.
 *   Fuera de él, 404 igual que una que no existe. Emitir otro BORRA el pendiente anterior: hay a
 *   lo más uno vigente por sucursal (candado por sucursal: dos emisiones a la vez no dejan dos).
 * - `CanjeEnlace` (SIN usuario ni tenant: el código ES la credencial, como la API key en
 *   `AgentesAuthService`): quema el código y rota la key en UNA transacción. El quemado es un
 *   `updateMany` condicionado a "sin usar y vigente", así que dos canjes simultáneos del mismo
 *   código no pueden ganar los dos.
 *
 * Ni el código ni la key en claro llegan aquí: sólo sus hashes.
 */

/** Cuántas veces se intenta un código que no choque con el hash de otro ya guardado. */
export const INTENTOS_CODIGO_ENLACE = 5;

type Cliente = Pick<Prisma.TransactionClient, 'sucursal' | 'codigoEnlace'> & {
  $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
};

export interface CodigoCandidato {
  /** El código (sin guión). Sólo viaja de regreso al caller, nunca a la base. */
  codigo: string;
  hash: string;
}

export interface EnlaceEmitido {
  sucursalId: string;
  empresaId: string;
  codigo: string;
  expiraAt: Date;
}

export interface EnlaceCanjeado {
  sucursalId: string;
  empresaId: string;
  sucursalNombre: string;
}

function exigir(nombre: string, valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new Error(`Código de enlace: ${nombre} vacío o ausente.`);
  }
  return valor;
}

function exigirFecha(nombre: string, valor: unknown): Date {
  if (!(valor instanceof Date) || Number.isNaN(valor.getTime())) {
    throw new Error(`Código de enlace: ${nombre} no es una fecha válida.`);
  }
  return valor;
}

export class EscrituraEnlaces {
  readonly #cliente: Cliente;
  readonly #scope: EmpresaScope;

  constructor(cliente: Cliente, scope: EmpresaScope) {
    this.#cliente = cliente;
    this.#scope = scope;
  }

  async emitir(datos: {
    sucursalId: string;
    creadoPor: string;
    ahora: Date;
    expiraAt: Date;
    generar: () => CodigoCandidato;
  }): Promise<EnlaceEmitido> {
    const sucursalId = exigir('sucursalId', datos.sucursalId);
    const creadoPor = exigir('creadoPor', datos.creadoPor);
    const ahora = exigirFecha('ahora', datos.ahora);
    const expiraAt = exigirFecha('expiraAt', datos.expiraAt);
    if (expiraAt <= ahora)
      throw new Error('Código de enlace: expiraAt debe ser posterior a ahora.');

    return this.#cliente.$transaction(async (tx) => {
      const sucursal = encontradoOr404(
        await tx.sucursal.findFirst({
          where: whereScoped(this.#scope, 'Sucursal', { id: sucursalId }),
          select: {
            id: true,
            empresaId: true,
            activo: true,
            empresa: { select: { activo: true } },
          },
        }),
      );
      if (!sucursal.activo || !sucursal.empresa.activo) {
        // Ya se sabe que está en el alcance: decirlo no filtra nada.
        throw new ConflictException(
          'La sucursal (o su empresa) está dada de baja: reactívala antes de conectarla.',
        );
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`enlace:${sucursal.id}`}))`;
      // A lo más UNO pendiente por sucursal: el anterior sin usar deja de servir aquí mismo.
      await tx.codigoEnlace.deleteMany({
        where: { sucursalId: sucursal.id, empresaId: sucursal.empresaId, usadoAt: null },
      });

      let candidato: CodigoCandidato | null = null;
      for (let i = 0; i < INTENTOS_CODIGO_ENLACE && candidato === null; i++) {
        const posible = datos.generar();
        const choca = await tx.codigoEnlace.findFirst({
          where: { codigoHash: exigir('hash', posible.hash) },
          select: { id: true },
        });
        if (!choca) candidato = posible;
      }
      if (candidato === null) {
        throw new Error(
          `No se encontró un código de enlace libre en ${INTENTOS_CODIGO_ENLACE} intentos.`,
        );
      }

      await tx.codigoEnlace.create({
        data: {
          empresaId: sucursal.empresaId,
          sucursalId: sucursal.id,
          codigoHash: candidato.hash,
          expiraAt,
          creadoPor,
          createdAt: ahora,
        },
      });
      return {
        sucursalId: sucursal.id,
        empresaId: sucursal.empresaId,
        codigo: exigir('codigo', candidato.codigo),
        expiraAt,
      };
    });
  }
}

export class CanjeEnlace {
  readonly #cliente: Cliente;

  constructor(cliente: Cliente) {
    this.#cliente = cliente;
  }

  /**
   * Quema el código y le pone a su sucursal la key nueva (`apiKeyHash`). Null —sin distinguir
   * por qué— si no existe, ya se usó, venció, o la sucursal o su empresa están dadas de baja. En
   * ese caso no cambia NADA: ni el código ni la key vigente.
   */
  canjear(codigoHash: string, apiKeyHash: string, ahora: Date): Promise<EnlaceCanjeado | null> {
    const hash = exigir('codigoHash', codigoHash);
    const keyHash = exigir('apiKeyHash', apiKeyHash);
    const cuando = exigirFecha('ahora', ahora);

    return this.#cliente.$transaction(async (tx) => {
      const vigente = {
        codigoHash: hash,
        usadoAt: null,
        expiraAt: { gt: cuando },
        sucursal: { activo: true, empresa: { activo: true } },
      } satisfies Prisma.CodigoEnlaceWhereInput;
      const fila = await tx.codigoEnlace.findFirst({
        where: vigente,
        select: {
          id: true,
          sucursalId: true,
          empresaId: true,
          sucursal: { select: { nombre: true } },
        },
      });
      if (!fila) return null;
      // El quemado: condicionado a "sigue sin usar". Si otro canje ganó, count 0 y no se rota.
      const { count } = await tx.codigoEnlace.updateMany({
        where: { id: fila.id, usadoAt: null },
        data: { usadoAt: cuando },
      });
      if (count !== 1) return null;
      const rotada = await tx.sucursal.updateMany({
        where: { id: fila.sucursalId, empresaId: fila.empresaId },
        data: { apiKeyHash: keyHash },
      });
      if (rotada.count !== 1) {
        throw new Error('Canje de enlace: la sucursal del código no se pudo actualizar.');
      }
      return {
        sucursalId: fila.sucursalId,
        empresaId: fila.empresaId,
        sucursalNombre: fila.sucursal.nombre,
      };
    });
  }
}
