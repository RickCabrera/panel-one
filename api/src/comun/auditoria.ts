import { Global, Injectable, Logger, Module } from '@nestjs/common';
import type { RolUsuario } from '@prisma/client';

/** Lo que se audita (F1-060): quién creó, editó o rotó qué. */
export type AccionAuditada =
  | 'empresa.crear'
  | 'empresa.editar'
  | 'sucursal.crear'
  | 'sucursal.editar'
  | 'sucursal.rotar_api_key'
  | 'usuario.crear'
  | 'usuario.editar'
  | 'usuario.reset_password'
  | 'usuario.cambiar_password'
  | 'regla_alerta.editar'
  | 'suscripcion_reporte.editar'
  | 'producto_metadata.editar'
  | 'sucursal.forzar_sincronizacion';

export interface EventoAuditoria {
  accion: AccionAuditada;
  recurso:
    | 'empresa'
    | 'sucursal'
    | 'usuario'
    | 'regla_alerta'
    | 'suscripcion_reporte'
    | 'producto';
  recursoId: string;
  empresaId: string | null;
  /** NOMBRES de los campos que cambiaron, nunca sus valores. */
  campos?: readonly string[];
}

/** Quien hace el cambio: el usuario del access token. */
export interface Actor {
  id: string;
  rol: RolUsuario;
}

/**
 * Auditoría mínima en el log de la API (F1-060): una línea JSON por cambio
 * administrativo, con el actor y el recurso. Sólo se llama DESPUÉS de que el
 * cambio se escribió.
 *
 * Nunca lleva valores: ni contraseñas, ni hashes, ni API keys, ni siquiera el
 * nombre nuevo de algo. Por eso `campos` es una lista de nombres de columna y el
 * evento se arma aquí campo por campo, no esparciendo lo que mande el caller.
 */
@Injectable()
export class Auditoria {
  private readonly logger = new Logger('Auditoria');

  registrar(actor: Actor, evento: EventoAuditoria): void {
    this.logger.log(
      JSON.stringify({
        accion: evento.accion,
        actorId: actor.id,
        actorRol: actor.rol,
        recurso: evento.recurso,
        recursoId: evento.recursoId,
        empresaId: evento.empresaId,
        campos: evento.campos ?? [],
      }),
    );
  }
}

@Global()
@Module({ providers: [Auditoria], exports: [Auditoria] })
export class AuditoriaModule {}
