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
  | 'area_canal.asignar'
  | 'sucursal.forzar_sincronizacion'
  | 'existencia_limites.editar'
  | 'conteo.crear'
  | 'conteo.cerrar'
  | 'conteo.cancelar'
  | 'traspaso.enviar'
  | 'traspaso.recibir'
  | 'traspaso.cancelar'
  | 'perfil_fiscal.editar'
  | 'perfil_fiscal.cargar_csd'
  | 'vigencia_codigos.editar'
  // F2-103: el portal de autofactura de una sucursal.
  | 'portal_facturacion.crear'
  | 'portal_facturacion.editar'
  | 'portal_facturacion.logo'
  | 'portal_facturacion.quitar_logo'
  // F2-105: reintento manual del correo de una factura.
  | 'cfdi.reenvio'
  // F2-107: factura sin ticket y refacturación (sustituto 04 + cancelación 01).
  | 'cfdi.manual'
  | 'cfdi.refacturacion'
  // F2-108: la factura global (emisión manual) y su configuración.
  | 'cfdi.global'
  | 'factura_global.configurar'
  // F2-109: cancelación de CFDI (solicitud, consulta a mano, y la que el PAC no registró).
  | 'cfdi.cancelacion'
  | 'cfdi.cancelacion_consulta'
  | 'cfdi.cancelacion_no_procedio'
  // F2-110: el control de folios del PAC (sólo admin_global; recurso de plataforma).
  | 'folios.paquete_alta'
  | 'folios.paquete_baja'
  | 'folios.configurar'
  // F2-110b: una vuelta de conciliación con el PAC pedida desde el tablero.
  | 'facturacion.conciliacion'
  // F2-146: preferencias de notificaciones push y un navegador que cambia de usuario.
  | 'preferencia_push.editar'
  | 'dispositivo_push.reasignar';

export interface EventoAuditoria {
  accion: AccionAuditada;
  recurso:
    | 'empresa'
    | 'sucursal'
    | 'usuario'
    | 'regla_alerta'
    | 'suscripcion_reporte'
    | 'producto'
    | 'area'
    | 'existencia'
    | 'conteo'
    | 'traspaso'
    | 'perfil_fiscal'
    | 'configuracion_facturacion'
    | 'portal_facturacion'
    | 'cfdi'
    | 'paquete_folios'
    | 'configuracion_folios'
    // F2-110b: una vuelta de conciliación con el PAC pedida desde el tablero.
    | 'conciliacion_pac'
    // F2-146: notificaciones push.
    | 'preferencia_push'
    | 'dispositivo_push';
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
