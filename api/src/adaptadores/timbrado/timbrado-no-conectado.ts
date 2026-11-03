import {
  ErrorTimbrado,
  type ArchivosPac,
  type CfdiEncontrado,
  type CfdiTimbrado,
  type CsdRegistrado,
  type EstadoCfdi,
  type PuertoTimbrado,
  type ResultadoCancelacion,
} from './puerto';

/**
 * Lo que se le dice a quien intenta timbrar, cancelar o dar de alta un CSD en PRODUCCIÓN sin
 * PAC conectado (`PAC_IMPL=falso` permitido por `PERMITIR_FALSOS_EN_PRODUCCION`).
 */
export const MENSAJE_FACTURACION_NO_CONECTADA =
  'La facturación no está conectada todavía: no se emitió, canceló ni registró nada ante el ' +
  'SAT. Avisa a soporte.';

/**
 * El PAC de producción mientras no hay uno contratado (deploy en Railway). NUNCA simula: el
 * `TimbradoFalso` inventa UUIDs y XML, y en producción eso serían facturas que el cliente cree
 * timbradas y no existen ante el SAT. Cada operación truena con `PAC_SIN_CONEXION` ("la
 * solicitud nunca salió"), así quien la llame libera su reserva como en una caída del PAC, sin
 * dejar nada en `timbrando`. No reintentable: no se arregla esperando.
 *
 * Las rutas HTTP que timbran se cortan ANTES con `PacConectadoGuard` (mensaje claro, 503); esto
 * cubre lo demás (los programadores de la factura global, la conciliación y las cancelaciones).
 */
export class TimbradoNoConectado implements PuertoTimbrado {
  #falla(): Promise<never> {
    return Promise.reject(
      new ErrorTimbrado('PAC_SIN_CONEXION', MENSAJE_FACTURACION_NO_CONECTADA, false),
    );
  }

  registrarCsd(): Promise<CsdRegistrado> {
    return this.#falla();
  }
  emitir(): Promise<CfdiTimbrado> {
    return this.#falla();
  }
  cancelar(): Promise<ResultadoCancelacion> {
    return this.#falla();
  }
  consultarEstado(): Promise<{ uuid: string; estado: EstadoCfdi }> {
    return this.#falla();
  }
  buscarPorFolio(): Promise<CfdiEncontrado | null> {
    return this.#falla();
  }
  descargarArchivos(): Promise<ArchivosPac> {
    return this.#falla();
  }
}
