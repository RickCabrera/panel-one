import { createHash } from 'node:crypto';

import { Prisma } from '@prisma/client';

import type { Reloj } from '../../comun/reloj';
import { dinero, fechaLocalCfdi, seis } from './cfdi-comun';
import { MENSAJES_SAT } from './errores-sat';
import { pdfMinimo } from './pdf-minimo';
import {
  ErrorTimbrado,
  type CfdiRelacionados,
  type CfdiTimbrado,
  type CodigoErrorTimbrado,
  type CsdRegistrado,
  type EstadoCfdi,
  type MotivoCancelacion,
  type PuertoTimbrado,
  type ReferenciaCfdi,
  type ResultadoCancelacion,
  type SolicitudCancelacion,
  type SolicitudCfdi,
  type SolicitudCsd,
} from './puerto';

/**
 * RFCs de receptor reservados: el PAC falso contesta con el error de la tabla en vez
 * de timbrar, para probar el manejo de errores sin PAC.
 *
 * OJO: en el SAT real `XEXX010101000` es el RFC GENÉRICO DE EXTRANJEROS y timbra bien.
 * El falso lo reserva como "no inscrito" porque así lo pide el backlog (F2-202). El
 * falso NO modela facturas a extranjeros: quien las construya (F2-107/F2-109) que no
 * lo dé por probado aquí.
 */
export const RFC_CON_ERROR: Readonly<
  Record<string, { codigo: CodigoErrorTimbrado; mensaje: string; reintentable: boolean }>
> = {
  XEXX010101000: {
    codigo: 'RFC_NO_INSCRITO',
    mensaje: 'El RFC del receptor no está inscrito en el padrón del SAT.',
    reintentable: false,
  },
  XFAL010101CP0: {
    codigo: 'CODIGO_POSTAL_NO_COINCIDE',
    mensaje: 'El código postal no coincide con el domicilio fiscal registrado para ese RFC.',
    reintentable: false,
  },
  XFAL010101RF0: {
    codigo: 'REGIMEN_NO_CORRESPONDE',
    mensaje: 'El régimen fiscal del receptor no corresponde al registrado para ese RFC.',
    reintentable: false,
  },
  XFAL010101PAC: {
    codigo: 'PAC_NO_DISPONIBLE',
    mensaje: 'El servicio de timbrado no está disponible. Intenta de nuevo en unos minutos.',
    reintentable: true,
  },
  // F2-104: dos RFC que SÍ pasan la validación del portal (forma del SAT, no genéricos), para
  // probar el mensaje amable de punta a punta. `XEXX010101000` no sirve para eso: es el genérico
  // de extranjeros y el portal lo corta antes de llegar al PAC.
  XFAL010101NI0: {
    codigo: 'RFC_NO_INSCRITO',
    mensaje: MENSAJES_SAT.RFC_NO_INSCRITO,
    reintentable: false,
  },
  XFAL010101NO0: {
    codigo: 'NOMBRE_NO_COINCIDE',
    mensaje: MENSAJES_SAT.NOMBRE_NO_COINCIDE,
    reintentable: false,
  },
};

/**
 * RFC de EMISOR reservado (F2-100): el PAC falso rechaza su CSD, para probar que un rechazo del
 * PAC no guarda nada. Formato de persona FÍSICA válido (4 letras); no es de nadie.
 */
export const RFC_EMISOR_CSD_RECHAZADO = 'XFAL010101CSD';
export const MENSAJE_CSD_RECHAZADO =
  'El PAC rechazó el CSD: no corresponde a un certificado vigente del SAT para ese RFC.';

/** UUID v4 bien formado (versión 4, variante RFC 4122) derivado de `semilla`: determinista. */
export function uuidDeterminista(semilla: string): string {
  const b = createHash('sha256').update(`cfdi-falso:${semilla}`).digest().subarray(0, 16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`.toUpperCase();
}

function escaparXml(valor: string): string {
  return valor
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function atributos(pares: Record<string, string | undefined>): string {
  return Object.entries(pares)
    .filter((par): par is [string, string] => par[1] !== undefined)
    .map(([k, v]) => ` ${k}="${escaparXml(v)}"`)
    .join('');
}

/** Marca de los sellos del falso: no pasa por un sello real, y se ve a simple vista. */
export const SELLO_FALSO = 'SIN-VALIDEZ-FISCAL';

export function xmlCfdiFalso(s: SolicitudCfdi, uuid: string, fechaTimbrado: Date): string {
  const conceptos = s.conceptos
    .map((c) => {
      const impuestos = c.iva
        ? `<cfdi:Impuestos><cfdi:Traslados><cfdi:Traslado${atributos({
            Base: dinero(c.iva.base),
            Impuesto: '002',
            TipoFactor: 'Tasa',
            TasaOCuota: seis(c.iva.tasa),
            Importe: dinero(c.iva.importe),
          })}/></cfdi:Traslados></cfdi:Impuestos>`
        : '';
      return `<cfdi:Concepto${atributos({
        ClaveProdServ: c.claveProdServ,
        NoIdentificacion: c.noIdentificacion,
        Cantidad: seis(c.cantidad),
        ClaveUnidad: c.claveUnidad,
        Unidad: c.unidad,
        Descripcion: c.descripcion,
        ValorUnitario: dinero(c.valorUnitario),
        Importe: dinero(c.importe),
        ObjetoImp: c.objetoImp,
      })}>${impuestos}</cfdi:Concepto>`;
    })
    .join('');

  const traslados = s.conceptos.filter((c) => c.iva);
  const resumenImpuestos =
    traslados.length > 0
      ? `<cfdi:Impuestos${atributos({
          TotalImpuestosTrasladados: dinero(s.totalImpuestosTrasladados),
        })}><cfdi:Traslados><cfdi:Traslado${atributos({
          Base: dinero(traslados.reduce((a, c) => a.add(c.iva!.base), new Prisma.Decimal(0))),
          Impuesto: '002',
          TipoFactor: 'Tasa',
          TasaOCuota: seis(traslados[0].iva!.tasa),
          Importe: dinero(s.totalImpuestosTrasladados),
        })}/></cfdi:Traslados></cfdi:Impuestos>`
      : '';

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!-- NO FISCAL: generado por el PAC falso del monitor (F2-202). Sin validez ante el SAT. -->\n' +
    `<cfdi:Comprobante xmlns:cfdi="http://www.sat.gob.mx/cfd/4" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"${atributos(
      {
        Version: '4.0',
        Serie: s.serie,
        Folio: s.folio,
        Fecha: fechaLocalCfdi(s.fecha, s.zonaHoraria),
        Sello: SELLO_FALSO,
        FormaPago: s.formaPago,
        NoCertificado: '00000000000000000000',
        Certificado: SELLO_FALSO,
        SubTotal: dinero(s.subtotal),
        Moneda: s.moneda,
        Total: dinero(s.total),
        TipoDeComprobante: 'I',
        Exportacion: '01',
        MetodoPago: s.metodoPago,
        LugarExpedicion: s.lugarExpedicion,
      },
    )}>` +
    // F2-107: los relacionados van ANTES del Emisor (orden del Anexo 20).
    (s.relacionados
      ? `<cfdi:CfdiRelacionados${atributos({ TipoRelacion: s.relacionados.tipoRelacion })}>` +
        s.relacionados.uuids
          .map((u) => `<cfdi:CfdiRelacionado${atributos({ UUID: u })}/>`)
          .join('') +
        '</cfdi:CfdiRelacionados>'
      : '') +
    `<cfdi:Emisor${atributos({ Rfc: s.emisor.rfc, Nombre: s.emisor.nombre, RegimenFiscal: s.emisor.regimenFiscal })}/>` +
    `<cfdi:Receptor${atributos({
      Rfc: s.receptor.rfc,
      Nombre: s.receptor.nombre,
      DomicilioFiscalReceptor: s.receptor.domicilioFiscal,
      RegimenFiscalReceptor: s.receptor.regimenFiscal,
      UsoCFDI: s.receptor.usoCfdi,
    })}/>` +
    `<cfdi:Conceptos>${conceptos}</cfdi:Conceptos>` +
    resumenImpuestos +
    `<cfdi:Complemento><tfd:TimbreFiscalDigital${atributos({
      Version: '1.1',
      UUID: uuid,
      FechaTimbrado: fechaLocalCfdi(fechaTimbrado, s.zonaHoraria),
      RfcProvCertif: 'FALSO',
      SelloCFD: SELLO_FALSO,
      NoCertificadoSAT: '00000000000000000000',
      SelloSAT: SELLO_FALSO,
    })}/></cfdi:Complemento>` +
    '</cfdi:Comprobante>\n'
  );
}

export const LEYENDA_NO_FISCAL = 'DOCUMENTO NO FISCAL - SIN VALIDEZ ANTE EL SAT';

export function pdfCfdiFalso(s: SolicitudCfdi, uuid: string): Buffer {
  return pdfMinimo([
    { texto: LEYENDA_NO_FISCAL, tamano: 16 },
    { texto: 'Generado por el PAC de prueba del monitor. No es una factura.' },
    { texto: `Folio fiscal (de prueba): ${uuid}` },
    { texto: `Serie y folio: ${s.serie}-${s.folio}` },
    { texto: `Emisor: ${s.emisor.nombre} (${s.emisor.rfc})` },
    { texto: `Receptor: ${s.receptor.nombre} (${s.receptor.rfc})` },
    { texto: `Subtotal: $${dinero(s.subtotal)}  IVA: $${dinero(s.totalImpuestosTrasladados)}` },
    { texto: `Total: $${dinero(s.total)} ${s.moneda}` },
    { texto: LEYENDA_NO_FISCAL, tamano: 16 },
  ]);
}

export const MENSAJE_SUSTITUTO_NO_RELACIONADO =
  'El CFDI sustituto no existe, no está vigente o no declara la relación 04 con el CFDI que se ' +
  'quiere cancelar.';

/** Cómo quedó cancelado un CFDI en el PAC falso (para que los tests lo verifiquen). */
export interface CancelacionFalsa {
  motivo: MotivoCancelacion;
  folioSustitucion?: string;
}

/**
 * PAC falso determinista (F2-202). Mismo cheque → mismo UUID, mismo XML y mismo PDF
 * (con el mismo reloj). El estado de las cancelaciones vive EN MEMORIA del proceso:
 * el estado fiscal que importa lo guarda nuestra base (F2-109), y el del PAC falso no
 * necesita sobrevivir un reinicio. `consultarEstado` de un UUID que este proceso no
 * emitió contesta `no_encontrado` (así que en modo demo un CFDI del SEED no se puede cancelar
 * ni refacturar: el falso no lo emitió).
 *
 * F2-107: guarda los CFDI relacionados de cada emisión y, como el SAT, una cancelación con motivo
 * 01 sólo procede si el sustituto existe, está vigente y declara la relación 04 con el cancelado.
 */
export class TimbradoFalso implements PuertoTimbrado {
  private readonly estados = new Map<string, EstadoCfdi>();
  private readonly relaciones = new Map<string, CfdiRelacionados>();
  private readonly cancelaciones = new Map<string, CancelacionFalsa>();

  constructor(private readonly reloj: Pick<Reloj, 'ahora'>) {}

  /**
   * Alta del CSD (F2-100). El falso NO guarda nada del CSD (ni en memoria): contesta con el RFC
   * como id del emisor, que es como identifica al emisor el multiemisor de Facturama. La
   * validación de la llave, la contraseña y la vigencia la hace el servicio ANTES de llamar aquí
   * (`facturacion/csd.ts`), así que vale igual con el PAC real.
   */
  registrarCsd(solicitud: SolicitudCsd): Promise<CsdRegistrado> {
    if (solicitud.rfc === RFC_EMISOR_CSD_RECHAZADO) {
      return Promise.reject(new ErrorTimbrado('CSD_RECHAZADO', MENSAJE_CSD_RECHAZADO));
    }
    return Promise.resolve({ idOrganizacion: solicitud.rfc });
  }

  emitir(solicitud: SolicitudCfdi): Promise<CfdiTimbrado> {
    const error = RFC_CON_ERROR[solicitud.receptor.rfc];
    if (error) {
      return Promise.reject(new ErrorTimbrado(error.codigo, error.mensaje, error.reintentable));
    }
    const uuid = uuidDeterminista(solicitud.referencia);
    const fechaTimbrado = new Date(this.reloj.ahora());
    if (!this.estados.has(uuid)) this.estados.set(uuid, 'vigente');
    if (solicitud.relacionados) {
      this.relaciones.set(uuid, {
        tipoRelacion: solicitud.relacionados.tipoRelacion,
        uuids: [...solicitud.relacionados.uuids],
      });
    }
    return Promise.resolve({
      uuid,
      // El falso no tiene id propio: usa el UUID.
      idPac: uuid,
      xml: xmlCfdiFalso(solicitud, uuid, fechaTimbrado),
      pdf: pdfCfdiFalso(solicitud, uuid),
      fechaTimbrado,
    });
  }

  cancelar(solicitud: SolicitudCancelacion): Promise<ResultadoCancelacion> {
    if (solicitud.motivo === '01' && !solicitud.folioSustitucion) {
      return Promise.reject(
        new ErrorTimbrado(
          'MOTIVO_REQUIERE_SUSTITUTO',
          'La cancelación con motivo 01 requiere el folio fiscal que sustituye al cancelado.',
        ),
      );
    }
    if (!this.estados.has(solicitud.uuid)) {
      return Promise.reject(
        new ErrorTimbrado('CFDI_NO_ENCONTRADO', 'No existe un CFDI emitido con ese folio fiscal.'),
      );
    }
    if (solicitud.motivo === '01') {
      const sustituto = solicitud.folioSustitucion!;
      const relacion = this.relaciones.get(sustituto);
      if (
        this.estados.get(sustituto) !== 'vigente' ||
        relacion?.tipoRelacion !== '04' ||
        !relacion.uuids.includes(solicitud.uuid)
      ) {
        return Promise.reject(
          new ErrorTimbrado('RECHAZADO_POR_PAC', MENSAJE_SUSTITUTO_NO_RELACIONADO),
        );
      }
    }
    this.estados.set(solicitud.uuid, 'cancelado');
    this.cancelaciones.set(solicitud.uuid, {
      motivo: solicitud.motivo,
      ...(solicitud.folioSustitucion ? { folioSustitucion: solicitud.folioSustitucion } : {}),
    });
    return Promise.resolve({
      uuid: solicitud.uuid,
      estado: 'cancelado',
      fecha: new Date(this.reloj.ahora()),
    });
  }

  /** Los relacionados con que se emitió un UUID (sólo para verificar en tests). */
  relacionadosDe(uuid: string): CfdiRelacionados | undefined {
    return this.relaciones.get(uuid);
  }

  /** Motivo y sustituto con que se canceló un UUID (sólo para verificar en tests). */
  cancelacionDe(uuid: string): CancelacionFalsa | undefined {
    return this.cancelaciones.get(uuid);
  }

  consultarEstado({ uuid }: ReferenciaCfdi): Promise<{ uuid: string; estado: EstadoCfdi }> {
    return Promise.resolve({ uuid, estado: this.estados.get(uuid) ?? 'no_encontrado' });
  }
}
