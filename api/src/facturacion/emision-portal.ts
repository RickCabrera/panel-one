import { Injectable, ServiceUnavailableException } from '@nestjs/common';

import type { ReceptorPortal } from './portal';

/**
 * El puerto por el que el portal de autofactura (F2-103) pide EMITIR la factura de un código. El
 * portal hace todo lo suyo antes de llamarlo (slug, código de la empresa, estado `pendiente`,
 * datos del receptor válidos) y no sabe qué hay detrás.
 *
 * En F2-103 la única implementación es `EmisionNoDisponible`: la emisión real (CFDI con el PAC,
 * modelo `Cfdi`, candado por código) es de F2-104, que cambia el provider de `EMISION_PORTAL` por
 * uno sobre `CfdiService.emitir`. Los archivos (XML/PDF) y el correo son de F2-105.
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
  /** El correo al que se enviará (F2-105). */
  email: string;
  /** Enlaces temporales de descarga; null mientras no existan (F2-105): "te llegará por correo". */
  descargas: { xml: string | null; pdf: string | null };
}

export interface EmisionPortal {
  /** ¿Se puede emitir para esta empresa? El portal lo dice ANTES de pedir datos al cliente. */
  disponible(empresaId: string): Promise<boolean>;
  emitir(solicitud: SolicitudFacturaPortal): Promise<FacturaPortal>;
}

export const MENSAJE_EMISION_NO_DISPONIBLE =
  'Este restaurante todavía no emite facturas en línea. Tus datos no se guardaron: intenta más ' +
  'tarde o pide tu factura en el restaurante.';

/**
 * La implementación de F2-103: todavía no hay emisión. Nunca escribe nada ni llama al PAC; el
 * endpoint responde 503 con un mensaje que dice la verdad.
 */
@Injectable()
export class EmisionNoDisponible implements EmisionPortal {
  disponible(): Promise<boolean> {
    return Promise.resolve(false);
  }

  emitir(): Promise<FacturaPortal> {
    return Promise.reject(new ServiceUnavailableException(MENSAJE_EMISION_NO_DISPONIBLE));
  }
}
