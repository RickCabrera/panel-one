import type { ReceptorPortal } from './portal';

/**
 * El puerto por el que el portal de autofactura (F2-103) pide EMITIR la factura de un código. El
 * portal hace todo lo suyo antes de llamarlo (slug, código de la empresa, estado `pendiente`,
 * datos del receptor válidos) y no sabe qué hay detrás.
 *
 * Desde F2-104 la implementación es `CfdiService` (`cfdi.service.ts`): reserva con candado por
 * código, timbra por `PUERTO_TIMBRADO` y confirma; F2-105 guarda los archivos y manda el correo.
 */
export const EMISION_PORTAL = Symbol('EMISION_PORTAL');

/** Lo que el portal manda a emitir. Los ids NO vienen del público: salen de la base. */
export interface SolicitudFacturaPortal {
  /** Id de la fila del código: F2-104 pone su candado aquí (doble clic no emite dos veces). */
  codigoId: string;
  codigo: string;
  chequeId: string;
  sucursalId: string;
  empresaId: string;
  /** Ya validado y con el RFC normalizado (mayúsculas, sin espacios alrededor). */
  receptor: ReceptorPortal;
}

/** La factura emitida, como la muestra la pantalla de éxito del portal. */
export interface FacturaPortal {
  uuid: string;
  serieFolio: string;
  /** Dinero como texto con 2 decimales. */
  total: string;
  /** El correo al que se envía (F2-105). */
  email: string;
  /** Enlaces firmados y temporales (F2-105); null si no se pudieron guardar: "te llegará por correo". */
  descargas: { xml: string | null; pdf: string | null };
}

export interface EmisionPortal {
  /** ¿Se puede emitir para esta empresa? El portal lo dice ANTES de pedir datos al cliente. */
  disponible(empresaId: string): Promise<boolean>;
  emitir(solicitud: SolicitudFacturaPortal): Promise<FacturaPortal>;
}

/** Lo que se dice cuando la empresa todavía no puede emitir (sin perfil fiscal o sin CSD vigente). */
export const MENSAJE_EMISION_NO_DISPONIBLE =
  'Este restaurante todavía no emite facturas en línea. Tus datos no se guardaron: intenta más ' +
  'tarde o pide tu factura en el restaurante.';
