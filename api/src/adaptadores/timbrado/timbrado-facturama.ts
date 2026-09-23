import type { Reloj } from '../../comun/reloj';
import { numeroJson, type ClienteHttp, type PeticionHttp, type RespuestaHttp } from '../http';
import { fechaLocalCfdi, instanteDesdeLocal } from './cfdi-comun';
import { errorSatConocido, MENSAJE_RECHAZO_GENERICO } from './errores-sat';
import {
  ErrorTimbrado,
  type ArchivosPac,
  type CfdiEncontrado,
  type CfdiTimbrado,
  type ConsultaFolio,
  type CsdRegistrado,
  type EstadoCfdi,
  type EstadoTrasCancelar,
  type PuertoTimbrado,
  type ReferenciaCfdi,
  type ResultadoCancelacion,
  type SolicitudCancelacion,
  type SolicitudCfdi,
  type SolicitudCsd,
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
 *
 * También supuestos, con la opción conservadora elegida:
 * - `Complement.TaxStamp.Date` (fecha de timbrado): no se sabe si trae zona.
 *   DECISION PROVISIONAL (nocturno): si no la trae, se lee como hora LOCAL de la
 *   sucursal (así viene la del CFDI, Anexo 20), nunca como hora del servidor; si la
 *   trae, se respeta. Si falta o no se puede leer, se usa el reloj (como el falso), y
 *   F2-190 confirma el formato real.
 * - `Status`: se conocen `active` y `canceled`. F2-109, DECISION PROVISIONAL (nocturno):
 *   `pending` = una cancelación que espera la respuesta del receptor (`en_cancelacion`). Cualquier
 *   otro valor NO se da por vigente ni por cancelado: es `ESTADO_DESCONOCIDO`, reintentable
 *   (consultar más tarde). Tras un DELETE, un `active` tampoco se da por bueno (el PAC no dijo
 *   qué pasó con la solicitud): `ESTADO_DESCONOCIDO`.
 * - Un timeout, un corte a medio camino o un 5xx que no sea 503 es `PAC_SIN_RESPUESTA`.
 *   OJO en `emitir`: el PAC pudo haber timbrado; reintentar a ciegas puede duplicar un
 *   CFDI. La emisión (F2-104) NO lo reintenta: deja la reserva colgada (F2-110b la resuelve
 *   consultando). Una falla ANTES de conectar es `PAC_SIN_CONEXION`, y ésa sí se reintenta.
 */

/*
 * Alta del CSD (F2-100). SUPUESTO NO VALIDADO (F2-190): `POST /api-lite/csds` da de alta el CSD
 * de un RFC y `PUT /api-lite/csds/{rfc}` lo reemplaza, con el cuerpo `{ Rfc, Certificate,
 * PrivateKey, PrivateKeyPassword }` (archivos en base64), y en multiemisor el emisor se identifica
 * por su RFC (`idOrganizacion` = RFC). Sale de la documentación pública, no de una llamada real.
 *
 * La contraseña y la llave VIAJAN en este cuerpo (así lo pide la API): por eso esta petición no se
 * loguea en ningún lado, y el error que vuelve se LIMPIA (`errorCsdDe`) antes de subir.
 */
export function peticionRegistrarCsd(base: string, s: SolicitudCsd): PeticionHttp {
  return {
    metodo: s.reemplazar ? 'PUT' : 'POST',
    url: s.reemplazar
      ? `${base}/api-lite/csds/${encodeURIComponent(s.rfc)}`
      : `${base}/api-lite/csds`,
    cuerpo: {
      Rfc: s.rfc,
      Certificate: s.certificado.toString('base64'),
      PrivateKey: s.llavePrivada.toString('base64'),
      PrivateKeyPassword: s.contrasena,
    },
  };
}

/** Lo que se tapa en un error del PAC: una tira larga que parezca base64 (un pedazo de archivo). */
const TIRA_BASE64 = /[A-Za-z0-9+/=_-]{24,}/g;
export const OMITIDO = '[omitido]';

/**
 * Un error del alta de CSD SIN secretos. Los errores de validación de ASP.NET suelen repetir el
 * valor recibido ("The value 'xxx' is not valid for PrivateKeyPassword"): del texto del PAC se
 * quitan la contraseña (cada vez que aparezca), el base64 del `.key` y del `.cer`, y cualquier tira
 * larga con pinta de base64. Lo que queda puede ir al usuario.
 */
export function errorCsdDe(r: RespuestaHttp, s: SolicitudCsd): ErrorTimbrado {
  const e = errorDe(r, false);
  if (e.reintentable) return e;
  if (r.status === 404) {
    return new ErrorTimbrado(
      'CSD_RECHAZADO',
      'El PAC no tiene un CSD previo de ese RFC para reemplazar.',
    );
  }
  let texto = e.message;
  for (const secreto of [
    s.contrasena,
    s.llavePrivada.toString('base64'),
    s.certificado.toString('base64'),
  ]) {
    if (secreto.length > 0) texto = texto.split(secreto).join(OMITIDO);
  }
  texto = texto.replace(TIRA_BASE64, OMITIDO);
  return new ErrorTimbrado('CSD_RECHAZADO', `El PAC rechazó el CSD. ${texto}`.trim());
}

/*
 * CFDI relacionados (F2-107). SUPUESTO NO VALIDADO (F2-190): Facturama recibe la relación como
 * `Relations: { Type: '04', Cfdis: [{ Uuid }] }` (documentación pública, no una llamada real). Sólo
 * va en el cuerpo cuando hay relacionados: el CFDI de un ticket sale igual que antes.
 */
export function peticionEmitir(base: string, s: SolicitudCfdi): PeticionHttp {
  return {
    metodo: 'POST',
    url: `${base}/api-lite/3/cfdis`,
    cuerpo: {
      ...(s.relacionados
        ? {
            Relations: {
              Type: s.relacionados.tipoRelacion,
              Cfdis: s.relacionados.uuids.map((uuid) => ({ Uuid: uuid })),
            },
          }
        : {}),
      // F2-108. SUPUESTO NO VALIDADO (F2-190): Facturama recibe el nodo InformacionGlobal como
      // `GlobalInformation: { Periodicity, Months, Year }` (documentación pública). Sólo va en una
      // global: los demás CFDI salen igual que antes.
      ...(s.informacionGlobal
        ? {
            GlobalInformation: {
              Periodicity: s.informacionGlobal.periodicidad,
              Months: s.informacionGlobal.meses,
              Year: String(s.informacionGlobal.anio),
            },
          }
        : {}),
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

/*
 * F2-110b. SUPUESTO NO VALIDADO (F2-190): la lista de CFDI emitidos del multiemisor se consulta con
 * `GET /api-lite/cfdis?type=issuedLite&rfcIssuer=<rfc>&serie=<serie>&folioStart=<f>&folioEnd=<f>&status=all`
 * y contesta un ARREGLO `[{ Id, Serie, Folio, Uuid, Status, Date, ... }]` (documentación pública,
 * no una llamada real).
 *
 * De esta respuesta depende LIBERAR una reserva (y con ella volver a facturar el ticket): si el PAC
 * ignorara un filtro o paginara, "no vino nuestro folio" no probaría nada. Por eso SÓLO una lista
 * VACÍA (o un 404) es "no lo tiene"; cualquier fila ajena (otra serie, otro folio, otro emisor si la
 * fila lo trae) o más de una fila nuestra es `ESTADO_DESCONOCIDO` (reintentable) y nadie decide.
 */
export function peticionBuscarPorFolio(base: string, c: ConsultaFolio): PeticionHttp {
  const query = new URLSearchParams({
    type: 'issuedLite',
    rfcIssuer: c.rfcEmisor,
    serie: c.serie,
    folioStart: c.folio,
    folioEnd: c.folio,
    status: 'all',
  });
  return { metodo: 'GET', url: `${base}/api-lite/cfdis?${query}` };
}

export const MENSAJE_LISTA_AMBIGUA_PAC =
  'La búsqueda por folio en el PAC trajo resultados que no son exactamente ese CFDI: no se ' +
  'concluye nada (se vuelve a consultar).';

interface FilaListaCfdi {
  Id?: string;
  Serie?: string;
  Folio?: string | number;
  Uuid?: string;
  Status?: string;
  Date?: string;
  RfcIssuer?: string;
  Issuer?: { Rfc?: string };
}

function esNuestra(f: FilaListaCfdi, c: ConsultaFolio): boolean {
  const rfc = f.RfcIssuer ?? f.Issuer?.Rfc;
  return (
    String(f.Serie ?? '') === c.serie &&
    String(f.Folio ?? '') === c.folio &&
    (rfc === undefined || rfc.toUpperCase() === c.rfcEmisor.toUpperCase())
  );
}

/** Nuestro CFDI en la respuesta de la lista, null si la lista vino VACÍA, o desconocido. */
export function cfdiDeLista(cuerpo: unknown, c: ConsultaFolio): CfdiEncontrado | null {
  if (!Array.isArray(cuerpo)) {
    throw new ErrorTimbrado('ESTADO_DESCONOCIDO', MENSAJE_LISTA_AMBIGUA_PAC, true);
  }
  const filas = cuerpo as FilaListaCfdi[];
  if (filas.length === 0) return null;
  if (filas.length > 1 || !esNuestra(filas[0], c)) {
    throw new ErrorTimbrado('ESTADO_DESCONOCIDO', MENSAJE_LISTA_AMBIGUA_PAC, true);
  }
  const [f] = filas;
  if (!f.Id || !f.Uuid) {
    throw new ErrorTimbrado('ESTADO_DESCONOCIDO', MENSAJE_LISTA_AMBIGUA_PAC, true);
  }
  const estado = estadoDeFacturama(f.Status);
  if (estado === 'no_encontrado') {
    throw new ErrorTimbrado('ESTADO_DESCONOCIDO', MENSAJE_LISTA_AMBIGUA_PAC, true);
  }
  return {
    uuid: f.Uuid.toUpperCase(),
    idPac: f.Id,
    estado,
    // DECISION PROVISIONAL (nocturno): `Date` de la lista se lee como hora LOCAL de la sucursal
    // (como `TaxStamp.Date`); si no se puede leer, null y quien confirma busca otra (el XML).
    fechaTimbrado: instanteDesdeLocal(f.Date ?? '', c.zonaHoraria),
  };
}

export const MENSAJE_PAC_NO_DISPONIBLE =
  'El servicio de timbrado no está disponible. Intenta de nuevo en unos minutos.';
export const MENSAJE_PAC_SIN_RESPUESTA =
  'No hubo respuesta del servicio de timbrado. Revisa el estado antes de reintentar.';

/**
 * Facturama contesta errores de validación como `{ Message, ModelState: { campo: [msg] } }`.
 *
 * F2-104: el texto de un rechazo pasa por la tabla de errores del SAT (`errores-sat.ts`). Si se
 * reconoce, el error lleva su código y un mensaje en español listo para el cliente; si no, queda
 * `RECHAZADO_POR_PAC` con el texto del PAC (que la emisión NO le muestra al cliente: lo loguea).
 *
 * DECISION PROVISIONAL (nocturno): sólo 429 y 503 son "no disponible" (el PAC dice que NO procesó
 * la solicitud). Cualquier otro 5xx (500, 502, 504…) es AMBIGUO (`PAC_SIN_RESPUESTA`): un gateway
 * puede contestar 502/504 después de que el PAC timbró. Se valida en F2-190.
 */
/** `traducir = false`: sin la tabla del SAT (el alta del CSD no habla del receptor). */
function errorDe(r: RespuestaHttp, traducir = true): ErrorTimbrado {
  if (r.status === 429 || r.status === 503) {
    return new ErrorTimbrado('PAC_NO_DISPONIBLE', MENSAJE_PAC_NO_DISPONIBLE, true);
  }
  if (r.status >= 500) {
    return new ErrorTimbrado('PAC_SIN_RESPUESTA', MENSAJE_PAC_SIN_RESPUESTA, false);
  }
  if (r.status === 404) {
    return new ErrorTimbrado('CFDI_NO_ENCONTRADO', 'El PAC no encontró ese CFDI.');
  }
  const cuerpo = (r.cuerpo ?? {}) as { Message?: string; ModelState?: Record<string, string[]> };
  const detalle = Object.values(cuerpo.ModelState ?? {}).flat();
  const texto =
    typeof r.cuerpo === 'string'
      ? r.cuerpo
      : [cuerpo.Message, ...detalle].filter(Boolean).join(' ');
  const conocido = traducir ? errorSatConocido(texto) : null;
  if (conocido) return new ErrorTimbrado(conocido.codigo, conocido.mensaje);
  return new ErrorTimbrado(
    'RECHAZADO_POR_PAC',
    texto || `El PAC rechazó la solicitud (HTTP ${r.status}). ${MENSAJE_RECHAZO_GENERICO}`,
  );
}

/** Códigos de Node/undici de un intento que NUNCA llegó a conectar: la solicitud no salió. */
const SIN_CONEXION = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'UND_ERR_CONNECT_TIMEOUT',
]);

/** ¿La falla de `fetch` fue ANTES de conectar? (Todo lo demás, timeout incluido, es ambiguo.) */
export function esFallaDeConexion(error: unknown): boolean {
  let actual: unknown = error;
  for (let i = 0; i < 4 && actual && typeof actual === 'object'; i++) {
    const codigo = (actual as { code?: unknown }).code;
    if (typeof codigo === 'string' && SIN_CONEXION.has(codigo)) return true;
    actual = (actual as { cause?: unknown }).cause;
  }
  return false;
}

function ok(r: RespuestaHttp): boolean {
  return r.status >= 200 && r.status < 300;
}

interface CuerpoCfdi {
  Id?: string;
  Status?: string;
  Complement?: { TaxStamp?: { Uuid?: string; Date?: string } };
}

const MENSAJE_ESTADO_DESCONOCIDO =
  'El PAC reportó un estado que no reconocemos. Consulta de nuevo en unos minutos.';

export function estadoDeFacturama(status: string | undefined): EstadoCfdi {
  const normal = status?.toLowerCase();
  if (normal === 'active') return 'vigente';
  if (normal === 'canceled') return 'cancelado';
  // F2-109. SUPUESTO NO VALIDADO (F2-190): así reporta Facturama una cancelación "en proceso".
  if (normal === 'pending') return 'en_cancelacion';
  throw new ErrorTimbrado('ESTADO_DESCONOCIDO', MENSAJE_ESTADO_DESCONOCIDO, true);
}

/** Lo que contesta el DELETE: sólo `cancelado` o `en_cancelacion` cuentan como respuesta. */
export function estadoTrasCancelarDeFacturama(status: string | undefined): EstadoTrasCancelar {
  const estado = estadoDeFacturama(status);
  if (estado === 'cancelado' || estado === 'en_cancelacion') return estado;
  throw new ErrorTimbrado('ESTADO_DESCONOCIDO', MENSAJE_ESTADO_DESCONOCIDO, true);
}

export class TimbradoFacturama implements PuertoTimbrado {
  constructor(
    private readonly base: string,
    private readonly http: ClienteHttp,
    private readonly reloj: Pick<Reloj, 'ahora'>,
  ) {}

  /**
   * Red caída → `PAC_SIN_CONEXION` (la solicitud no salió: reintentar es seguro). Timeout o corte
   * a medio camino → `PAC_SIN_RESPUESTA` (ambiguo; ver la nota de `emitir` arriba).
   */
  private async enviar(peticion: PeticionHttp): Promise<RespuestaHttp> {
    try {
      return await this.http.enviar(peticion);
    } catch (error) {
      if (esFallaDeConexion(error)) {
        throw new ErrorTimbrado('PAC_SIN_CONEXION', MENSAJE_PAC_NO_DISPONIBLE, true);
      }
      throw new ErrorTimbrado('PAC_SIN_RESPUESTA', MENSAJE_PAC_SIN_RESPUESTA, false);
    }
  }

  async registrarCsd(solicitud: SolicitudCsd): Promise<CsdRegistrado> {
    const r = await this.enviar(peticionRegistrarCsd(this.base, solicitud));
    if (!ok(r)) throw errorCsdDe(r, solicitud);
    return { idOrganizacion: solicitud.rfc };
  }

  async emitir(solicitud: SolicitudCfdi): Promise<CfdiTimbrado> {
    const r = await this.enviar(peticionEmitir(this.base, solicitud));
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
      fechaTimbrado:
        instanteDesdeLocal(cuerpo.Complement?.TaxStamp?.Date ?? '', solicitud.zonaHoraria) ??
        new Date(this.reloj.ahora()),
    };
  }

  async cancelar(solicitud: SolicitudCancelacion): Promise<ResultadoCancelacion> {
    if (solicitud.motivo === '01' && !solicitud.folioSustitucion) {
      throw new ErrorTimbrado(
        'MOTIVO_REQUIERE_SUSTITUTO',
        'La cancelación con motivo 01 requiere el folio fiscal que sustituye al cancelado.',
      );
    }
    const r = await this.enviar(peticionCancelar(this.base, solicitud));
    if (!ok(r)) throw errorDe(r);
    const cuerpo = (r.cuerpo ?? {}) as CuerpoCfdi;
    return {
      uuid: solicitud.uuid,
      estado: estadoTrasCancelarDeFacturama(cuerpo.Status),
      fecha: new Date(this.reloj.ahora()),
    };
  }

  async consultarEstado(cfdi: ReferenciaCfdi): Promise<{ uuid: string; estado: EstadoCfdi }> {
    const r = await this.enviar(peticionConsultar(this.base, cfdi));
    if (r.status === 404) return { uuid: cfdi.uuid, estado: 'no_encontrado' };
    if (!ok(r)) throw errorDe(r);
    return { uuid: cfdi.uuid, estado: estadoDeFacturama((r.cuerpo as CuerpoCfdi).Status) };
  }

  async buscarPorFolio(consulta: ConsultaFolio): Promise<CfdiEncontrado | null> {
    const r = await this.enviar(peticionBuscarPorFolio(this.base, consulta));
    if (r.status === 404) return null;
    if (!ok(r)) throw errorDe(r);
    return cfdiDeLista(r.cuerpo, consulta);
  }

  async descargarArchivos(cfdi: ReferenciaCfdi): Promise<ArchivosPac> {
    const [xml, pdf] = await Promise.all([
      this.descargar('xml', cfdi.idPac),
      this.descargar('pdf', cfdi.idPac),
    ]);
    return { xml: xml.toString('utf8'), pdf };
  }

  /** Facturama devuelve el archivo como `{ Content: <base64> }`. */
  private async descargar(formato: 'xml' | 'pdf', idPac: string): Promise<Buffer> {
    const r = await this.enviar(peticionDescarga(this.base, formato, idPac));
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
