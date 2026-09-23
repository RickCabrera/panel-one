import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto';

/**
 * CSD SINTÉTICO para los tests de F2-100: un certificado X.509 autofirmado y su llave privada
 * PKCS#8 cifrada, armados EN MEMORIA en cada corrida. Imitan la forma de un CSD del SAT (DER, el
 * RFC en `x500UniqueIdentifier` como "RFC / CURP", número de certificado de 20 dígitos en el
 * serial como ASCII), pero no los emitió nadie y no sirven para timbrar. Ningún `.cer` ni `.key`
 * vive en el repo.
 *
 * Node no trae cómo CREAR un X.509; esto es el codificador DER mínimo para uno.
 */

function largo(n: number): Buffer {
  if (n < 0x80) return Buffer.from([n]);
  const bytes: number[] = [];
  for (let v = n; v > 0; v >>= 8) bytes.unshift(v & 0xff);
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}

const tlv = (etiqueta: number, ...partes: Buffer[]): Buffer => {
  const valor = Buffer.concat(partes);
  return Buffer.concat([Buffer.from([etiqueta]), largo(valor.length), valor]);
};
const secuencia = (...p: Buffer[]) => tlv(0x30, ...p);
const conjunto = (...p: Buffer[]) => tlv(0x31, ...p);

function oid(texto: string): Buffer {
  const n = texto.split('.').map(Number);
  const bytes = [40 * n[0] + n[1]];
  for (const x of n.slice(2)) {
    const grupo = [x & 0x7f];
    for (let v = x >> 7; v > 0; v >>= 7) grupo.unshift((v & 0x7f) | 0x80);
    bytes.push(...grupo);
  }
  return tlv(0x06, Buffer.from(bytes));
}

const utf8 = (s: string) => tlv(0x0c, Buffer.from(s, 'utf8'));
const imprimible = (s: string) => tlv(0x13, Buffer.from(s, 'ascii'));
const entero = (b: Buffer) => tlv(0x02, b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b);

/** UTCTime hasta 2049 y GeneralizedTime desde 2050, como pide RFC 5280. */
function tiempo(d: Date): Buffer {
  const s = d.toISOString();
  const resto = `${s.slice(5, 7)}${s.slice(8, 10)}${s.slice(11, 13)}${s.slice(14, 16)}${s.slice(17, 19)}Z`;
  const anio = d.getUTCFullYear();
  return anio < 2050
    ? tlv(0x17, Buffer.from(`${s.slice(2, 4)}${resto}`, 'ascii'))
    : tlv(0x18, Buffer.from(`${s.slice(0, 4)}${resto}`, 'ascii'));
}

function nombre(rfc: string, razonSocial: string): Buffer {
  return secuencia(
    conjunto(secuencia(oid('2.5.4.3'), utf8(razonSocial))),
    conjunto(secuencia(oid('2.5.4.45'), utf8(`${rfc} / XXXX000101HDFXXX09`))),
    conjunto(secuencia(oid('2.5.4.6'), imprimible('MX'))),
  );
}

export interface OpcionesCsd {
  rfc?: string;
  razonSocial?: string;
  /** 20 dígitos, como el número de certificado del SAT. */
  noCertificado?: string;
  desde?: Date;
  hasta?: Date;
  contrasena?: string;
  /** Firmar con esta llave en vez de una nueva (para armar "la llave de otro certificado"). */
  llaves?: { publicKey: KeyObject; privateKey: KeyObject };
}

export interface CsdSintetico {
  certificado: Buffer;
  llavePrivada: Buffer;
  contrasena: string;
  noCertificado: string;
  desde: Date;
  hasta: Date;
  rfc: string;
}

/** Larga y única a propósito: el test de secretos la busca en TODA la base y en el log. */
export const CONTRASENA_CSD_PRUEBA = 'Csd-Sintetica-F2-100-7c1e94b2d05a-nunca-en-base';

/** Un par de llaves RSA 2048 reutilizable (generarlas cuesta ~100 ms). */
export function llavesRsa(): { publicKey: KeyObject; privateKey: KeyObject } {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

export function csdSintetico(o: OpcionesCsd = {}): CsdSintetico {
  const rfc = o.rfc ?? 'EKU9003173C9';
  const noCertificado = o.noCertificado ?? '30001000000500003416';
  const desde = o.desde ?? new Date('2025-01-01T06:00:00.000Z');
  const hasta = o.hasta ?? new Date('2029-01-01T06:00:00.000Z');
  const contrasena = o.contrasena ?? CONTRASENA_CSD_PRUEBA;
  const { publicKey, privateKey } = o.llaves ?? llavesRsa();
  const algoritmo = secuencia(oid('1.2.840.113549.1.1.11'), tlv(0x05));
  const sujeto = nombre(rfc, o.razonSocial ?? 'ESCUELA KEMPER URGATE');
  const tbs = secuencia(
    tlv(0xa0, entero(Buffer.from([2]))),
    entero(Buffer.from(noCertificado, 'ascii')),
    algoritmo,
    sujeto,
    secuencia(tiempo(desde), tiempo(hasta)),
    sujeto,
    publicKey.export({ type: 'spki', format: 'der' }),
  );
  const firma = sign('sha256', tbs, privateKey);
  return {
    certificado: secuencia(tbs, algoritmo, tlv(0x03, Buffer.from([0]), firma)),
    // 3DES: el cifrado típico de las llaves del SAT (no uno moderno que el código lea "de más").
    llavePrivada: privateKey.export({
      type: 'pkcs8',
      format: 'der',
      cipher: 'des-ede3-cbc',
      passphrase: contrasena,
    }),
    contrasena,
    noCertificado,
    desde,
    hasta,
    rfc,
  };
}
