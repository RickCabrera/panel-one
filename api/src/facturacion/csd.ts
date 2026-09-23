import { createPrivateKey, createPublicKey, X509Certificate, type KeyObject } from 'node:crypto';

import { normalizarRfc } from './sat';

/*
 * Validación LOCAL del CSD de un emisor (F2-100), antes de mandarlo al PAC. Puro: sin base, sin
 * red, sin log. Lo que entra (el `.cer`, el `.key` y la contraseña) sólo vive en memoria durante
 * la llamada; de aquí sale METADATA y nada más. Ningún error lleva el contenido de un archivo ni
 * la contraseña.
 *
 * SUPUESTOS NO VALIDADOS (se confirman con un CSD real del SAT en F2-190, Diurna):
 * - El `.key` del SAT es un PKCS#8 CIFRADO en DER (EncryptedPrivateKeyInfo), típicamente con
 *   3DES. Los tests usan una llave sintética cifrada con `des-ede3-cbc`.
 * - El RFC del titular viaja en el sujeto del `.cer`, en `x500UniqueIdentifier` (2.5.4.45), como
 *   "RFC / RFC del representante" en persona moral o "RFC / CURP" en física: se toma lo que va
 *   ANTES de " / ".
 * - El número de certificado (NoCertificado, 20 dígitos) es el serial del `.cer` leído como
 *   ASCII. Si el serial no son 20 dígitos ASCII, se guarda el serial en hex (no se inventa).
 * - Una contraseña incorrecta: OpenSSL no da un código estable entre cifrados y versiones, así
 *   que, una vez que la ESTRUCTURA del `.key` es válida, cualquier fallo al descifrar se trata
 *   como contraseña incorrecta.
 * - No se distingue un CSD de una e.firma (FIEL): las dos tienen la misma forma. Si alguien sube
 *   su e.firma, el PAC real la rechaza al registrarla (F2-190 lo confirma).
 */

export type MotivoCsdInvalido =
  | 'CER_INVALIDO'
  | 'KEY_INVALIDA'
  | 'CONTRASENA_INCORRECTA'
  | 'NO_CORRESPONDEN'
  | 'SIN_RFC'
  | 'RFC_DISTINTO'
  | 'VENCIDO'
  | 'AUN_NO_VIGENTE';

/** Un CSD que no pasa la validación local. El mensaje va tal cual al usuario. */
export class ErrorCsd extends Error {
  constructor(
    readonly motivo: MotivoCsdInvalido,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorCsd';
  }
}

export interface MetadataCsd {
  noCertificado: string;
  rfc: string;
  vigenteDesde: Date;
  vigenteHasta: Date;
}

export interface EntradaCsd {
  certificado: Buffer;
  llavePrivada: Buffer;
  contrasena: string;
}

const ZONA_PRESENTACION = 'America/Mexico_City';

function fechaLegible(d: Date): string {
  return new Intl.DateTimeFormat('es-MX', {
    timeZone: ZONA_PRESENTACION,
    dateStyle: 'long',
  }).format(d);
}

/** Largo DER en `pos` (el byte tras la etiqueta): `[largo, inicio del valor]`, o null. */
function largoDer(buf: Buffer, pos: number): [number, number] | null {
  if (pos >= buf.length) return null;
  const primero = buf[pos];
  if (primero < 0x80) return [primero, pos + 1];
  const bytes = primero & 0x7f;
  if (bytes === 0 || bytes > 4 || pos + 1 + bytes > buf.length) return null;
  let largo = 0;
  for (let i = 0; i < bytes; i++) largo = largo * 256 + buf[pos + 1 + i];
  return [largo, pos + 1 + bytes];
}

/** Un elemento DER en `pos`: su etiqueta y dónde termina; null si no cabe. */
function elemento(
  buf: Buffer,
  pos: number,
): { etiqueta: number; inicio: number; fin: number } | null {
  const l = largoDer(buf, pos + 1);
  if (!l) return null;
  const [largo, inicio] = l;
  const fin = inicio + largo;
  return fin <= buf.length ? { etiqueta: buf[pos], inicio, fin } : null;
}

/**
 * ¿Tiene la forma de un EncryptedPrivateKeyInfo? `SEQUENCE { SEQUENCE (algoritmo), OCTET STRING }`
 * que ocupa el archivo entero. Una llave SIN cifrar (PrivateKeyInfo empieza con un INTEGER) no es
 * un `.key` del SAT.
 */
export function esLlaveCifradaPkcs8(buf: Buffer): boolean {
  const exterior = elemento(buf, 0);
  if (!exterior || exterior.etiqueta !== 0x30 || exterior.fin !== buf.length) return false;
  const algoritmo = elemento(buf, exterior.inicio);
  if (!algoritmo || algoritmo.etiqueta !== 0x30) return false;
  const datos = elemento(buf, algoritmo.fin);
  return datos !== null && datos.etiqueta === 0x04 && datos.fin === exterior.fin;
}

/** El número de certificado: el serial como 20 dígitos ASCII (convención SAT) o, si no, en hex. */
export function numeroDeCertificado(serialHex: string): string {
  const bytes = Buffer.from(serialHex.length % 2 ? `0${serialHex}` : serialHex, 'hex');
  const texto = bytes.toString('latin1');
  return /^\d{20}$/.test(texto) ? texto : serialHex.toUpperCase();
}

/** El RFC del titular: lo que va antes de " / " en `x500UniqueIdentifier`; null si no viene. */
export function rfcDelSujeto(sujeto: string): string | null {
  for (const linea of sujeto.split('\n')) {
    const m = /^(?:x500UniqueIdentifier|2\.5\.4\.45)=(.*)$/.exec(linea.trim());
    if (m) {
      const rfc = normalizarRfc(m[1].split('/')[0]);
      return rfc.length > 0 ? rfc : null;
    }
  }
  return null;
}

function fechaDe(texto: string, fecha: Date | undefined): Date {
  // `validToDate` existe desde Node 22.10; en versiones previas se lee el texto (formato OpenSSL).
  return fecha instanceof Date ? fecha : new Date(texto);
}

const spki = (k: KeyObject) => k.export({ type: 'spki', format: 'der' });

/**
 * Valida el CSD contra el RFC del perfil y el instante `ahora`, y devuelve su metadata. Lanza
 * `ErrorCsd` con el primer problema encontrado, en este orden: .cer, .key, contraseña,
 * correspondencia llave-certificado, RFC, vigencia.
 */
export function leerCsd(entrada: EntradaCsd, rfcPerfil: string, ahora: Date): MetadataCsd {
  let cer: X509Certificate;
  try {
    cer = new X509Certificate(entrada.certificado);
  } catch {
    throw new ErrorCsd(
      'CER_INVALIDO',
      'El archivo .cer no es un certificado válido. Sube el .cer del CSD que te entregó el SAT.',
    );
  }

  if (!esLlaveCifradaPkcs8(entrada.llavePrivada)) {
    throw new ErrorCsd(
      'KEY_INVALIDA',
      'El archivo .key no es una llave privada del SAT. Sube el .key del mismo CSD que el .cer.',
    );
  }
  let llave: KeyObject;
  try {
    llave = createPrivateKey({
      key: entrada.llavePrivada,
      format: 'der',
      type: 'pkcs8',
      passphrase: entrada.contrasena,
    });
  } catch {
    // La estructura ya es válida: si no abre, es la contraseña (ver supuestos arriba).
    throw new ErrorCsd(
      'CONTRASENA_INCORRECTA',
      'La contraseña de la llave privada no es correcta. Es la contraseña del CSD, no la de la e.firma ni la del portal del SAT.',
    );
  }

  if (!spki(createPublicKey(llave)).equals(spki(cer.publicKey))) {
    throw new ErrorCsd(
      'NO_CORRESPONDEN',
      'La llave .key no corresponde al certificado .cer: sube los dos archivos del mismo CSD.',
    );
  }

  const rfc = rfcDelSujeto(cer.subject);
  if (!rfc) {
    throw new ErrorCsd(
      'SIN_RFC',
      'El certificado no trae el RFC de su titular: no parece un CSD del SAT.',
    );
  }
  const esperado = normalizarRfc(rfcPerfil);
  if (rfc !== esperado) {
    throw new ErrorCsd(
      'RFC_DISTINTO',
      `El certificado es del RFC ${rfc} y los datos fiscales son del RFC ${esperado}. Sube el CSD de ${esperado} o corrige el RFC.`,
    );
  }

  const vigenteDesde = fechaDe(cer.validFrom, (cer as { validFromDate?: Date }).validFromDate);
  const vigenteHasta = fechaDe(cer.validTo, (cer as { validToDate?: Date }).validToDate);
  if (vigenteHasta.getTime() <= ahora.getTime()) {
    throw new ErrorCsd(
      'VENCIDO',
      `El certificado venció el ${fechaLegible(vigenteHasta)}. Tramita un CSD nuevo en el portal del SAT.`,
    );
  }
  if (vigenteDesde.getTime() > ahora.getTime()) {
    throw new ErrorCsd(
      'AUN_NO_VIGENTE',
      `El certificado todavía no es vigente: empieza el ${fechaLegible(vigenteDesde)}.`,
    );
  }

  return {
    noCertificado: numeroDeCertificado(cer.serialNumber),
    rfc,
    vigenteDesde,
    vigenteHasta,
  };
}
