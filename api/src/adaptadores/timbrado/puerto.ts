import type { Prisma } from '@prisma/client';

/**
 * Puerto de timbrado de CFDI 4.0 (F2-202). Lo consumen las tareas del bloque F
 * (F2-100…F2-110) inyectando `PUERTO_TIMBRADO`; ninguna sabe si detrás está el PAC
 * falso o Facturama. Dinero y cantidades en decimal, nunca en `number`.
 */

export interface EmisorCfdi {
  rfc: string;
  nombre: string;
  /** Clave del catálogo c_RegimenFiscal del SAT (p. ej. "601"). */
  regimenFiscal: string;
}

export interface ReceptorCfdi {
  rfc: string;
  nombre: string;
  /** c_UsoCFDI (p. ej. "G03"). */
  usoCfdi: string;
  regimenFiscal: string;
  /** Código postal del domicilio fiscal del receptor. */
  domicilioFiscal: string;
}

export interface ConceptoCfdi {
  /** c_ClaveProdServ (p. ej. "90101500", servicios de restaurante). */
  claveProdServ: string;
  /**
   * Lo que identifica al concepto (el folio del ticket). Opcional en el CFDI: una factura sin
   * ticket (F2-107) no tiene qué citar.
   */
  noIdentificacion?: string;
  cantidad: Prisma.Decimal;
  /** c_ClaveUnidad (p. ej. "E48" unidad de servicio, "H87" pieza). */
  claveUnidad: string;
  unidad: string;
  descripcion: string;
  valorUnitario: Prisma.Decimal;
  importe: Prisma.Decimal;
  /** c_ObjetoImp: "02" = sí objeto de impuesto. */
  objetoImp: string;
  /** Traslado de IVA del concepto. Ausente si `objetoImp` no es "02". */
  iva?: { base: Prisma.Decimal; tasa: Prisma.Decimal; importe: Prisma.Decimal };
}

export interface SolicitudCfdi {
  /**
   * Identificador NUESTRO del origen (el id del cheque, o del lote de una global).
   * El PAC falso deriva de aquí el UUID: mismo cheque, mismo UUID.
   */
  referencia: string;
  serie: string;
  folio: string;
  /** Fecha de emisión, instante UTC. */
  fecha: Date;
  /**
   * Zona IANA de la sucursal que expide. El CFDI lleva la fecha en hora LOCAL del
   * lugar de expedición, sin offset: se convierte al armar el XML/payload, nunca antes.
   */
  zonaHoraria: string;
  /** c_FormaPago (p. ej. "01" efectivo, "04" tarjeta de crédito). */
  formaPago: string;
  /** "PUE" o "PPD". */
  metodoPago: 'PUE' | 'PPD';
  moneda: 'MXN';
  /** CP del lugar de expedición (la sucursal). */
  lugarExpedicion: string;
  emisor: EmisorCfdi;
  receptor: ReceptorCfdi;
  conceptos: ConceptoCfdi[];
  subtotal: Prisma.Decimal;
  totalImpuestosTrasladados: Prisma.Decimal;
  total: Prisma.Decimal;
  /**
   * CFDI relacionados (F2-107). Hoy sólo la sustitución: `TipoRelacion` 04 con el UUID del CFDI
   * que éste sustituye (el que después se cancela con motivo 01).
   */
  relacionados?: CfdiRelacionados;
  /**
   * Sólo en una FACTURA GLOBAL a público en general (F2-108): el periodo que ampara, como lo pide el
   * nodo `InformacionGlobal` del Anexo 20.
   */
  informacionGlobal?: InformacionGlobal;
}

/** Nodo `InformacionGlobal` del CFDI 4.0 (F2-108). */
export interface InformacionGlobal {
  /** c_Periodicidad: 01 diario, 02 semanal, 04 mensual. */
  periodicidad: '01' | '02' | '04';
  /** c_Meses: '01'..'12', el mes del periodo. */
  meses: string;
  /** El año del periodo (el SAT acepta el año en curso o el anterior). */
  anio: number;
}

/** c_TipoRelacion 04: sustitución de los CFDI previos. */
export interface CfdiRelacionados {
  tipoRelacion: '04';
  uuids: string[];
}

/**
 * Cómo se vuelve a encontrar un CFDI en el PAC. El UUID es el folio fiscal del SAT;
 * `idPac` es el identificador interno del proveedor (Facturama cancela y consulta por
 * su `Id`, no por UUID). Quien emite guarda los dos.
 */
export interface ReferenciaCfdi {
  uuid: string;
  idPac: string;
}

export interface CfdiTimbrado extends ReferenciaCfdi {
  xml: string;
  pdf: Buffer;
  fechaTimbrado: Date;
}

/** c_MotivoCancelacion: 01 con relación, 02 sin relación, 03 no se llevó a cabo, 04 global. */
export type MotivoCancelacion = '01' | '02' | '03' | '04';

export interface SolicitudCancelacion extends ReferenciaCfdi {
  motivo: MotivoCancelacion;
  /** Obligatorio con motivo 01: el UUID que sustituye al cancelado. */
  folioSustitucion?: string;
}

/**
 * El estado de un CFDI en el PAC. `en_cancelacion` (F2-109) = VIGENTE ante el SAT con una solicitud
 * de cancelación que espera la respuesta del receptor (acepta, rechaza, o a las 72 h se da por
 * aceptada). "Rechazada" no es un estado del PAC: lo deriva quien pidió la cancelación cuando el
 * PAC vuelve a decir `vigente`.
 */
export type EstadoCfdi = 'vigente' | 'en_cancelacion' | 'cancelado' | 'no_encontrado';

/** Cómo queda un CFDI justo después de pedir su cancelación (F2-109). */
export type EstadoTrasCancelar = 'cancelado' | 'en_cancelacion';

export interface ResultadoCancelacion {
  uuid: string;
  estado: EstadoTrasCancelar;
  fecha: Date;
}

export type CodigoErrorTimbrado =
  | 'RFC_NO_INSCRITO'
  | 'NOMBRE_NO_COINCIDE'
  | 'CODIGO_POSTAL_NO_COINCIDE'
  | 'REGIMEN_NO_CORRESPONDE'
  | 'USO_CFDI_NO_APLICA'
  /** El PAC contestó que no puede atender (429/503): NO procesó la solicitud. */
  | 'PAC_NO_DISPONIBLE'
  /** No se llegó a conectar con el PAC (la solicitud nunca salió). */
  | 'PAC_SIN_CONEXION'
  /**
   * AMBIGUO: timeout, corte a medio camino, o un 5xx que no sea 503. El PAC pudo haber timbrado
   * (o cancelado): reintentar a ciegas puede duplicar un CFDI ante el SAT. Por eso va con
   * `reintentable = false`: quien lo reciba CONSULTA el estado antes de volver a intentar.
   */
  | 'PAC_SIN_RESPUESTA'
  | 'ESTADO_DESCONOCIDO'
  | 'MOTIVO_REQUIERE_SUSTITUTO'
  | 'CFDI_NO_ENCONTRADO'
  | 'RECHAZADO_POR_PAC'
  | 'CSD_RECHAZADO';

/** Error del timbrado con mensaje en español, listo para mostrar. */
export class ErrorTimbrado extends Error {
  constructor(
    readonly codigo: CodigoErrorTimbrado,
    mensaje: string,
    /** `true` = vale la pena reintentar más tarde (el PAC no contestó). */
    readonly reintentable = false,
  ) {
    super(mensaje);
    this.name = 'ErrorTimbrado';
  }
}

/**
 * El CSD de un emisor (F2-100), tal como lo sube el administrador. Viaja SÓLO en memoria, de la
 * petición al PAC: ni el `.key` ni la contraseña se guardan, se loguean o se copian a un error.
 */
export interface SolicitudCsd {
  /** RFC del emisor (el del perfil fiscal, ya validado contra el certificado). */
  rfc: string;
  /** El `.cer` tal cual (DER). */
  certificado: Buffer;
  /** El `.key` tal cual (PKCS#8 cifrado, DER). */
  llavePrivada: Buffer;
  contrasena: string;
  /** `true` = el emisor ya tenía un CSD en el PAC y éste lo reemplaza (renovación). */
  reemplazar: boolean;
}

/** Lo que se guarda del alta: cómo encontrar al emisor en el PAC. */
export interface CsdRegistrado {
  idOrganizacion: string;
}

/**
 * F2-110b: cómo se busca en el PAC un CFDI del que NO tenemos `uuid` ni `idPac` (una reserva que se
 * quedó en `timbrando` porque la respuesta del PAC fue ambigua). La llave es la del emisor: su RFC,
 * la serie y el folio (en nuestra base, `(empresa, serie, folio)` es único).
 */
export interface ConsultaFolio {
  rfcEmisor: string;
  serie: string;
  folio: string;
  /** Zona IANA de la sucursal: la fecha que devuelva el PAC viene en hora LOCAL, sin offset. */
  zonaHoraria: string;
}

/** Un CFDI que el PAC SÍ tiene (F2-110b). */
export interface CfdiEncontrado extends ReferenciaCfdi {
  estado: Exclude<EstadoCfdi, 'no_encontrado'>;
  /** Null si el PAC no la da (o no se pudo leer): quien confirma usa la de la reserva. */
  fechaTimbrado: Date | null;
}

/** El XML y el PDF de un CFDI, tal como los guarda el PAC (F2-110b). */
export interface ArchivosPac {
  xml: string;
  pdf: Buffer;
}

export interface PuertoTimbrado {
  /** Da de alta (o reemplaza) el CSD de un emisor en el PAC multiemisor (F2-100). */
  registrarCsd(solicitud: SolicitudCsd): Promise<CsdRegistrado>;
  emitir(solicitud: SolicitudCfdi): Promise<CfdiTimbrado>;
  cancelar(solicitud: SolicitudCancelacion): Promise<ResultadoCancelacion>;
  consultarEstado(cfdi: ReferenciaCfdi): Promise<{ uuid: string; estado: EstadoCfdi }>;
  /**
   * F2-110b: el CFDI de ese emisor con esa serie y folio, o null si el PAC no tiene ninguno. Más de
   * uno es `ESTADO_DESCONOCIDO` (reintentable): nadie decide a ciegas cuál es el nuestro.
   */
  buscarPorFolio(consulta: ConsultaFolio): Promise<CfdiEncontrado | null>;
  /** F2-110b: el XML y el PDF de un CFDI que el PAC tiene (`CFDI_NO_ENCONTRADO` si no). */
  descargarArchivos(cfdi: ReferenciaCfdi): Promise<ArchivosPac>;
}
