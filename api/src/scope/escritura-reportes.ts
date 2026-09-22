import { EstadoEnvioReporte, Prisma, type TipoReporte } from '@prisma/client';

import type { EmpresaScope } from './empresa-scope';
import { encontradoOr404, whereScoped } from './scope.helper';

/**
 * Las escrituras de los reportes programados (F2-141), con scope. Es parte del helper
 * obligatorio: sólo `ScopedPrismaService.reportes(scope)` construye esta clase.
 *
 * - La suscripción se guarda para el USUARIO que la pide (su id sale del token, nunca del
 *   cuerpo) y para una empresa que se verifica con SU scope: fuera de alcance = 404.
 * - El envío se RECLAMA antes de mandar el correo: el único
 *   `(suscripcion_id, tipo, periodo)` hace que otra vuelta u otra réplica no manden el mismo
 *   reporte dos veces. La empresa del envío se lee de la suscripción, no se le cree al caller.
 */

/** Intentos de un envío antes de darlo por perdido. */
export const MAX_INTENTOS_ENVIO = 3;

type Cliente = Pick<Prisma.TransactionClient, 'empresa' | 'suscripcionReporte' | 'envioReporte'>;

export interface SuscripcionGuardada {
  id: string;
  diario: boolean;
  semanal: boolean;
}

export class EscrituraReportes {
  readonly #cliente: Cliente;
  readonly #scope: EmpresaScope;

  constructor(cliente: Cliente, scope: EmpresaScope) {
    this.#cliente = cliente;
    this.#scope = scope;
  }

  async guardarSuscripcion(
    usuarioId: string,
    empresaId: string,
    valores: { diario: boolean; semanal: boolean },
  ): Promise<SuscripcionGuardada> {
    const empresa = encontradoOr404(
      await this.#cliente.empresa.findFirst({
        where: whereScoped(this.#scope, 'Empresa', { id: empresaId }),
        select: { id: true },
      }),
    );
    return this.#cliente.suscripcionReporte.upsert({
      where: { usuarioId_empresaId: { usuarioId, empresaId: empresa.id } },
      create: { usuarioId, empresaId: empresa.id, ...valores },
      update: valores,
      select: { id: true, diario: true, semanal: true },
    });
  }

  /**
   * Reclama el envío `(suscripción, tipo, periodo)`. Devuelve su id si ESTA llamada lo
   * reclamó; null si ya existía (lo mandó o lo está mandando otra vuelta) o si la
   * suscripción no está en el alcance.
   */
  async reclamarEnvio(
    suscripcionId: string,
    tipo: TipoReporte,
    periodo: string,
    ahora: Date,
  ): Promise<string | null> {
    const suscripcion = await this.#cliente.suscripcionReporte.findFirst({
      where: whereScoped(this.#scope, 'SuscripcionReporte', { id: suscripcionId }),
      select: { id: true, empresaId: true },
    });
    if (!suscripcion) return null;
    const { count } = await this.#cliente.envioReporte.createMany({
      data: [
        {
          suscripcionId: suscripcion.id,
          empresaId: suscripcion.empresaId,
          tipo,
          periodo,
          estado: EstadoEnvioReporte.enviando,
          intentos: 1,
          creadoAt: ahora,
        },
      ],
      skipDuplicates: true,
    });
    if (count === 0) return null;
    const envio = await this.#cliente.envioReporte.findFirst({
      where: { suscripcionId: suscripcion.id, tipo, periodo },
      select: { id: true },
    });
    return envio?.id ?? null;
  }

  /**
   * Reclama de nuevo un envío FALLIDO que todavía tiene intentos. `true` si esta llamada lo
   * reclamó (pasa a `enviando` con un intento más); `false` si otra vuelta ganó o ya no
   * quedan intentos.
   */
  async reintentar(envioId: string): Promise<boolean> {
    const { count } = await this.#cliente.envioReporte.updateMany({
      where: whereScoped(this.#scope, 'EnvioReporte', {
        id: envioId,
        estado: EstadoEnvioReporte.fallido,
        intentos: { lt: MAX_INTENTOS_ENVIO },
      }),
      data: { estado: EstadoEnvioReporte.enviando, intentos: { increment: 1 } },
    });
    return count === 1;
  }

  async marcarEnviado(envioId: string, correoId: string, ahora: Date): Promise<void> {
    await this.#cliente.envioReporte.updateMany({
      where: whereScoped(this.#scope, 'EnvioReporte', {
        id: envioId,
        estado: EstadoEnvioReporte.enviando,
      }),
      data: { estado: EstadoEnvioReporte.enviado, correoId, enviadoAt: ahora, error: null },
    });
  }

  /**
   * Falló el envío. `definitivo` (el destinatario ya no ve la empresa) o sin intentos
   * restantes → `descartado`, que ninguna vuelta vuelve a tomar; si no, `fallido`.
   */
  async marcarFallido(envioId: string, error: string, definitivo: boolean): Promise<void> {
    const where = whereScoped(this.#scope, 'EnvioReporte', {
      id: envioId,
      estado: EstadoEnvioReporte.enviando,
    });
    const texto = error.slice(0, 500);
    if (definitivo) {
      await this.#cliente.envioReporte.updateMany({
        where,
        data: { estado: EstadoEnvioReporte.descartado, error: texto },
      });
      return;
    }
    // Dos sentencias con la condición de intentos en el WHERE: no hay que leer primero.
    await this.#cliente.envioReporte.updateMany({
      where: { AND: [where, { intentos: { gte: MAX_INTENTOS_ENVIO } }] },
      data: { estado: EstadoEnvioReporte.descartado, error: texto },
    });
    await this.#cliente.envioReporte.updateMany({
      where: { AND: [where, { intentos: { lt: MAX_INTENTOS_ENVIO } }] },
      data: { estado: EstadoEnvioReporte.fallido, error: texto },
    });
  }
}
