import { Prisma } from '@prisma/client';

import type { EmpresaScope } from './empresa-scope';
import { encontradoOr404, whereScoped } from './scope.helper';

/**
 * Las escrituras de las notificaciones push (F2-146), con scope. Es parte del helper
 * obligatorio: sólo `ScopedPrismaService.push(scope)` construye esta clase.
 *
 * - El dispositivo y la preferencia se guardan para el USUARIO que llama (su id, rol,
 *   empresa y versión de sesión salen del token y de la base, nunca del cuerpo).
 * - El resumen diario se RECLAMA antes de mandarlo: el único
 *   `(usuario_id, empresa_id, periodo)` hace que otra vuelta u otra réplica no lo repitan.
 */

/** Tope de navegadores por usuario: el más viejo sale cuando entra el onceavo. */
export const MAX_DISPOSITIVOS_POR_USUARIO = 10;

type Cliente = Pick<
  Prisma.TransactionClient,
  'empresa' | 'dispositivoPush' | 'preferenciaPush' | 'envioPushResumen'
> & {
  $transaction: <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) => Promise<T>;
};

/** Quien guarda: el usuario autenticado, con lo que la base dice de él. */
export interface DuenoDispositivo {
  id: string;
  empresaId: string | null;
  versionSesion: number;
}

export interface NuevoDispositivo {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/**
 * `guardado`: el dispositivo quedó del usuario que llama (nuevo, renovado o reasignado).
 * `llaves_distintas`: ese endpoint ya existe con OTRAS llaves; no se toca.
 */
export type ResultadoGuardarDispositivo =
  | {
      resultado: 'guardado';
      id: string;
      reasignadoDe: { usuarioId: string; empresaId: string | null } | null;
    }
  | { resultado: 'llaves_distintas' };

export interface PreferenciasPush {
  mesaAbierta: boolean;
  sucursalSinReporte: boolean;
  foliosBajo: boolean;
  cierreDia: boolean;
}

export class EscrituraPush {
  readonly #cliente: Cliente;
  readonly #scope: EmpresaScope;

  constructor(cliente: Cliente, scope: EmpresaScope) {
    this.#cliente = cliente;
    this.#scope = scope;
  }

  /**
   * Guarda (o renueva) el navegador del usuario que llama.
   *
   * Si el endpoint ya es de OTRO usuario —el mismo navegador, otra sesión—, se REASIGNA
   * sólo si llegan las MISMAS llaves `p256dh`/`auth`: el navegador siempre manda las suyas y
   * quien sólo conoce la URL no las tiene. Es la ÚNICA lectura de esta clase que no pasa por
   * el scope del que llama (la fila puede ser de otra empresa); por eso vive aquí, busca
   * sólo por el endpoint exacto, no devuelve nada de esa fila al caller salvo para
   * auditarla, y la respuesta HTTP es idéntica haya o no dueño anterior.
   */
  async guardarDispositivo(
    dueno: DuenoDispositivo,
    nuevo: NuevoDispositivo,
    ahora: Date,
  ): Promise<ResultadoGuardarDispositivo> {
    this.#verificarDueno(dueno);
    return this.#cliente.$transaction(async (tx) => {
      // Excepción documentada arriba: búsqueda global por el endpoint exacto.
      const previo = await tx.dispositivoPush.findUnique({
        where: { endpoint: nuevo.endpoint },
        select: { id: true, usuarioId: true, empresaId: true, p256dh: true, auth: true },
      });
      if (previo && (previo.p256dh !== nuevo.p256dh || previo.auth !== nuevo.auth)) {
        return { resultado: 'llaves_distintas' } as const;
      }
      const datos = {
        usuarioId: dueno.id,
        empresaId: dueno.empresaId,
        versionSesion: dueno.versionSesion,
        renovadoAt: ahora,
      };
      const fila = previo
        ? await tx.dispositivoPush.update({
            where: { id: previo.id },
            data: datos,
            select: { id: true },
          })
        : await tx.dispositivoPush.create({
            data: { ...datos, ...nuevo, creadoAt: ahora },
            select: { id: true },
          });
      // Tope por usuario: fuera los más viejos (por renovación) que pasen de MAX.
      const sobrantes = await tx.dispositivoPush.findMany({
        where: { usuarioId: dueno.id },
        orderBy: [{ renovadoAt: 'desc' }, { id: 'asc' }],
        skip: MAX_DISPOSITIVOS_POR_USUARIO,
        select: { id: true },
      });
      if (sobrantes.length > 0) {
        await tx.dispositivoPush.deleteMany({ where: { id: { in: sobrantes.map((s) => s.id) } } });
      }
      const reasignadoDe =
        previo && previo.usuarioId !== dueno.id
          ? { usuarioId: previo.usuarioId, empresaId: previo.empresaId }
          : null;
      return { resultado: 'guardado', id: fila.id, reasignadoDe } as const;
    });
  }

  /**
   * Quita un navegador DEL USUARIO que llama. Ajeno o inexistente: el mismo 404 (nunca 403,
   * y sin decir si el endpoint existe).
   */
  async borrarDispositivo(usuarioId: string, endpoint: string): Promise<void> {
    const { count } = await this.#cliente.dispositivoPush.deleteMany({
      where: whereScoped(this.#scope, 'DispositivoPush', { usuarioId, endpoint }),
    });
    encontradoOr404(count === 0 ? null : count);
  }

  /** Borra dispositivos que el envío descartó (caducados o de una sesión muerta). */
  async descartarDispositivos(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const { count } = await this.#cliente.dispositivoPush.deleteMany({
      where: whereScoped(this.#scope, 'DispositivoPush', { id: { in: [...ids] } }),
    });
    return count;
  }

  /** Guarda las preferencias del usuario que llama (una fila por usuario). */
  async guardarPreferencias(
    dueno: Pick<DuenoDispositivo, 'id' | 'empresaId'>,
    valores: PreferenciasPush,
  ): Promise<PreferenciasPush> {
    this.#verificarDueno(dueno);
    return this.#cliente.preferenciaPush.upsert({
      where: { usuarioId: dueno.id },
      create: { usuarioId: dueno.id, empresaId: dueno.empresaId, ...valores },
      update: valores,
      select: { mesaAbierta: true, sucursalSinReporte: true, foliosBajo: true, cierreDia: true },
    });
  }

  /**
   * Reclama el resumen `(usuario, empresa, periodo)`. `true` si ESTA llamada lo reclamó;
   * `false` si ya existía o si la empresa no está en el alcance.
   */
  async reclamarResumen(
    usuarioId: string,
    empresaId: string,
    periodo: string,
    ahora: Date,
  ): Promise<boolean> {
    const empresa = await this.#cliente.empresa.findFirst({
      where: whereScoped(this.#scope, 'Empresa', { id: empresaId }),
      select: { id: true },
    });
    if (!empresa) return false;
    const { count } = await this.#cliente.envioPushResumen.createMany({
      data: [{ usuarioId, empresaId: empresa.id, periodo, creadoAt: ahora }],
      skipDuplicates: true,
    });
    return count === 1;
  }

  /** El dueño tiene que estar en el scope de quien escribe (siempre lo está: es él mismo). */
  #verificarDueno(dueno: Pick<DuenoDispositivo, 'empresaId'>): void {
    if (this.#scope.tipo === 'global') return;
    if (dueno.empresaId !== this.#scope.empresaId) encontradoOr404(null);
  }
}
