import type { Reloj } from '../../comun/reloj';
import { numeroJson, type ClienteHttp, type PeticionHttp, type RespuestaHttp } from '../http';
import { fechaLocalCfdi } from './cfdi-comun';
import {
  ErrorTimbrado,
  type CfdiTimbrado,
  type EstadoCfdi,
  type PuertoTimbrado,
  type ReferenciaCfdi,
  type ResultadoCancelacion,
  type SolicitudCancelacion,
  type SolicitudCfdi,
} from './puerto';

/*
 * PAC real: Facturama, API multiemisor ("api-lite"), CFDI 4.0 (F2-202).
 *
 * SUPUESTO NO VALIDADO (se confirma en F2-190, Diurna, contra apisandbox.facturama.mx):
 * las rutas (`/api-lite/3/cfdis`, `/api-lite/cfdis/{id}`, `/cfdi/{xml|pdf}/issuedLite/{id}`),
 * los nombres de campo del cuerpo (`Issuer`, `Receiver`, `Items`, `Taxes`, `TaxZipCode`,
 * `motive`, `uuidReplacement`) y el mapeo de la respuesta (`Id` → idPac,
 * `Complement.TaxStamp.Uuid` → uuid, `Status` → estado) salen de la documentación
 * pública de Facturama, no de una llamada real. El test de contrato fija la forma que
 * NOSOTROS mandamos; que Facturama la acepte se prueba en F2-190, y cada diferencia se
 * corrige aquí y en su snapshot.
 */

export function peticionEmitir(base: string, s: SolicitudCfdi): PeticionHttp {
  return {
    metodo: 'POST',
    url: `${base}/api-lite/3/cfdis`,
    cuerpo: {
      Serie: s.serie,
      Folio: s.folio,
      Date: fechaLocalCfdi(s.fecha, s.zonaHoraria),
      Currency: s.moneda,
      CfdiType: 'I',
      PaymentForm: s.formaPago,
      PaymentMethod: s.metodoPago,
      ExpeditionPlace: s.lugarExpedicion,
      Exportation: '01',
      Issuer: { Rfc: s.emisor.rfc, Name: s.emisor.nombre, FiscalRegime: s.emisor.regimenFiscal },
      Receiver: {
        Rfc: s.receptor.rfc,
        Name: s.receptor.nombre,
        CfdiUse: s.receptor.usoCfdi,
        FiscalRegime: s.receptor.regimenFiscal,
        TaxZipCode: s.receptor.domicilioFiscal,
      },
      Items: s.conceptos.map((c) => ({
        ProductCode: c.claveProdServ,
        IdentificationNumber: c.noIdentificacion,
        Description: c.descripcion,
        Unit: c.unidad,
        UnitCode: c.claveUnidad,
        // Dinero y cantidades: decimal hasta aquí; número JSON sólo en el borde.
        UnitPrice: numeroJson(c.valorUnitario, 2),
        Quantity: numeroJson(c.cantidad, 6),
        Subtotal: numeroJson(c.importe, 2),
        TaxObject: c.objetoImp,
        Taxes: c.iva
          ? [
              {
                Name: 'IVA',
                Base: numeroJson(c.iva.base, 2),
                Rate: numeroJson(c.iva.tasa, 6),
                Total: numeroJson(c.iva.importe, 2),
                IsRetention: false,
              },
            ]
          : [],
        Total: numeroJson(c.iva ? c.importe.add(c.iva.importe) : c.importe, 2),
      })),
    },
  };
}

export function peticionCancelar(base: string, s: SolicitudCancelacion): PeticionHttp {
  const query = new URLSearchParams({ type: 'issuedLite', motive: s.motivo });
  if (s.folioSustitucion) query.set('uuidReplacement', s.folioSustitucion);
  return {
    metodo: 'DELETE',
    url: `${base}/api-lite/cfdis/${encodeURIComponent(s.idPac)}?${query}`,
  };
}

export function peticionConsultar(base: string, cfdi: ReferenciaCfdi): PeticionHttp {
  return { metodo: 'GET', url: `${base}/api-lite/cfdis/${encodeURIComponent(cfdi.idPac)}` };
}

export function peticionDescarga(
  base: string,
  formato: 'xml' | 'pdf',
  idPac: string,
): PeticionHttp {
  return { metodo: 'GET', url: `${base}/cfdi/${formato}/issuedLite/${encodeURIComponent(idPac)}` };
}

/** Facturama contesta errores de validación como `{ Message, ModelState: { campo: [msg] } }`. */
function errorDe(r: RespuestaHttp): ErrorTimbrado {
  if (r.status >= 500 || r.status === 429) {
    return new ErrorTimbrado(
      'PAC_NO_DISPONIBLE',
      'El servicio de timbrado no está disponible. Intenta de nuevo en unos minutos.',
      true,
    );
  }
  if (r.status === 404) {
    return new ErrorTimbrado('CFDI_NO_ENCONTRADO', 'El PAC no encontró ese CFDI.');
  }
  const cuerpo = (r.cuerpo ?? {}) as { Message?: string; ModelState?: Record<string, string[]> };
  const detalle = Object.values(cuerpo.ModelState ?? {}).flat();
  const texto = [cuerpo.Message, ...detalle].filter(Boolean).join(' ');
  return new ErrorTimbrado(
    'RECHAZADO_POR_PAC',
    texto || `El PAC rechazó la solicitud (HTTP ${r.status}).`,
  );
}

function ok(r: RespuestaHttp): boolean {
  return r.status >= 200 && r.status < 300;
}

interface CuerpoCfdi {
  Id?: string;
  Status?: string;
  Complement?: { TaxStamp?: { Uuid?: string; Date?: string } };
}

export function estadoDeFacturama(status: string | undefined): EstadoCfdi {
  return status?.toLowerCase() === 'canceled' ? 'cancelado' : 'vigente';
}

export class TimbradoFacturama implements PuertoTimbrado {
  constructor(
    private readonly base: string,
    private readonly http: ClienteHttp,
    private readonly reloj: Pick<Reloj, 'ahora'>,
  ) {}

  async emitir(solicitud: SolicitudCfdi): Promise<CfdiTimbrado> {
    const r = await this.http.enviar(peticionEmitir(this.base, solicitud));
    if (!ok(r)) throw errorDe(r);
    const cuerpo = r.cuerpo as CuerpoCfdi;
    const idPac = cuerpo.Id;
    const uuid = cuerpo.Complement?.TaxStamp?.Uuid;
    if (!idPac || !uuid) {
      throw new ErrorTimbrado('RECHAZADO_POR_PAC', 'El PAC respondió sin folio fiscal.');
    }
    const [xml, pdf] = await Promise.all([
      this.descargar('xml', idPac),
      this.descargar('pdf', idPac),
    ]);
    return {
      uuid: uuid.toUpperCase(),
      idPac,
      xml: xml.toString('utf8'),
      pdf,
      fechaTimbrado: new Date(cuerpo.Complement?.TaxStamp?.Date ?? this.reloj.ahora()),
    };
  }

  async cancelar(solicitud: SolicitudCancelacion): Promise<ResultadoCancelacion> {
    if (solicitud.motivo === '01' && !solicitud.folioSustitucion) {
      throw new ErrorTimbrado(
        'MOTIVO_REQUIERE_SUSTITUTO',
        'La cancelación con motivo 01 requiere el folio fiscal que sustituye al cancelado.',
      );
    }
    const r = await this.http.enviar(peticionCancelar(this.base, solicitud));
    if (!ok(r)) throw errorDe(r);
    const cuerpo = (r.cuerpo ?? {}) as CuerpoCfdi;
    return {
      uuid: solicitud.uuid,
      estado: estadoDeFacturama(cuerpo.Status ?? 'canceled'),
      fecha: new Date(this.reloj.ahora()),
    };
  }

  async consultarEstado(cfdi: ReferenciaCfdi): Promise<{ uuid: string; estado: EstadoCfdi }> {
    const r = await this.http.enviar(peticionConsultar(this.base, cfdi));
    if (r.status === 404) return { uuid: cfdi.uuid, estado: 'no_encontrado' };
    if (!ok(r)) throw errorDe(r);
    return { uuid: cfdi.uuid, estado: estadoDeFacturama((r.cuerpo as CuerpoCfdi).Status) };
  }

  /** Facturama devuelve el archivo como `{ Content: <base64> }`. */
  private async descargar(formato: 'xml' | 'pdf', idPac: string): Promise<Buffer> {
    const r = await this.http.enviar(peticionDescarga(this.base, formato, idPac));
    if (!ok(r)) throw errorDe(r);
    const contenido = (r.cuerpo as { Content?: string } | null)?.Content;
    if (!contenido)
      throw new ErrorTimbrado(
        'RECHAZADO_POR_PAC',
        `El PAC no entregó el ${formato.toUpperCase()}.`,
      );
    return Buffer.from(contenido, 'base64');
  }
}
