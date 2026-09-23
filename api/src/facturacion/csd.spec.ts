import { X509Certificate } from 'node:crypto';

import { csdSintetico, llavesRsa } from '../../test/fixtures-csd';
import {
  ErrorCsd,
  esLlaveCifradaPkcs8,
  leerCsd,
  numeroDeCertificado,
  rfcDelSujeto,
  type MotivoCsdInvalido,
} from './csd';
import { regimenAplica, tipoPersona } from './sat';

// F2-100: validación local del CSD, con CSD SINTÉTICOS armados en memoria (test/fixtures-csd.ts).
// Nada de un CSD real en el repo.

const AHORA = new Date('2026-09-22T18:00:00.000Z');
const LLAVES = llavesRsa();
const BUENO = csdSintetico({ llaves: LLAVES });

function motivo(fn: () => unknown): MotivoCsdInvalido | null {
  try {
    fn();
    return null;
  } catch (e) {
    if (e instanceof ErrorCsd) return e.motivo;
    throw e;
  }
}

function mensaje(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('no lanzó');
}

describe('leerCsd (F2-100)', () => {
  it('un CSD bueno: metadata exacta (número de 20 dígitos, RFC, vigencias en UTC)', () => {
    expect(leerCsd(BUENO, 'EKU9003173C9', AHORA)).toEqual({
      noCertificado: '30001000000500003416',
      rfc: 'EKU9003173C9',
      vigenteDesde: new Date('2025-01-01T06:00:00.000Z'),
      vigenteHasta: new Date('2029-01-01T06:00:00.000Z'),
    });
  });

  it('el RFC del perfil se compara normalizado (espacios, minúsculas)', () => {
    expect(leerCsd(BUENO, '  eku9003173c9 ', AHORA).rfc).toBe('EKU9003173C9');
  });

  it('acepta el .cer también en PEM', () => {
    const pem = Buffer.from(new X509Certificate(BUENO.certificado).toString());
    expect(leerCsd({ ...BUENO, certificado: pem }, 'EKU9003173C9', AHORA).rfc).toBe('EKU9003173C9');
  });

  it('.cer que no es certificado', () => {
    const f = () => leerCsd({ ...BUENO, certificado: Buffer.from('hola') }, 'EKU9003173C9', AHORA);
    expect(motivo(f)).toBe('CER_INVALIDO');
    expect(mensaje(f)).toMatch(/\.cer no es un certificado válido/);
  });

  it('.key que no es llave: basura, truncada, o PKCS#8 SIN cifrar', () => {
    const sinCifrar = LLAVES.privateKey.export({ type: 'pkcs8', format: 'der' });
    for (const llavePrivada of [
      Buffer.from('hola mundo'),
      BUENO.llavePrivada.subarray(0, 300),
      Buffer.concat([BUENO.llavePrivada, Buffer.from([0])]),
      sinCifrar,
      Buffer.alloc(0),
    ]) {
      expect(motivo(() => leerCsd({ ...BUENO, llavePrivada }, 'EKU9003173C9', AHORA))).toBe(
        'KEY_INVALIDA',
      );
    }
  });

  it('contraseña incorrecta o vacía: mensaje claro, sin repetir la contraseña', () => {
    for (const contrasena of ['otra-cosa-distinta-123', '', `${BUENO.contrasena}x`]) {
      const f = () => leerCsd({ ...BUENO, contrasena }, 'EKU9003173C9', AHORA);
      expect(motivo(f)).toBe('CONTRASENA_INCORRECTA');
      expect(mensaje(f)).toMatch(/contraseña de la llave privada no es correcta/);
      if (contrasena) expect(mensaje(f)).not.toContain(contrasena);
    }
  });

  it('la llave de OTRO certificado', () => {
    const otro = csdSintetico();
    expect(
      motivo(() => leerCsd({ ...BUENO, llavePrivada: otro.llavePrivada }, 'EKU9003173C9', AHORA)),
    ).toBe('NO_CORRESPONDEN');
  });

  it('RFC del certificado distinto al del perfil: dice los dos', () => {
    const f = () => leerCsd(BUENO, 'XIA190128J61', AHORA);
    expect(motivo(f)).toBe('RFC_DISTINTO');
    expect(mensaje(f)).toContain('EKU9003173C9');
    expect(mensaje(f)).toContain('XIA190128J61');
  });

  it('vencido (justo en el instante de vencer también) y aún no vigente', () => {
    const vencido = csdSintetico({
      llaves: LLAVES,
      desde: new Date('2021-01-01T06:00:00Z'),
      hasta: new Date('2025-01-01T06:00:00Z'),
    });
    const f = () => leerCsd(vencido, 'EKU9003173C9', AHORA);
    expect(motivo(f)).toBe('VENCIDO');
    // La fecha en la zona de presentación (CDMX): 1-ene-2025 00:00 local.
    expect(mensaje(f)).toContain('1 de enero de 2025');
    expect(motivo(() => leerCsd(BUENO, 'EKU9003173C9', new Date('2029-01-01T06:00:00Z')))).toBe(
      'VENCIDO',
    );
    expect(
      motivo(() => leerCsd(BUENO, 'EKU9003173C9', new Date('2029-01-01T05:59:59Z'))),
    ).toBeNull();
    expect(motivo(() => leerCsd(BUENO, 'EKU9003173C9', new Date('2024-12-31T00:00:00Z')))).toBe(
      'AUN_NO_VIGENTE',
    );
  });

  it('vigencia después de 2049 (GeneralizedTime) se lee igual', () => {
    const largo = csdSintetico({ llaves: LLAVES, hasta: new Date('2051-03-01T06:00:00Z') });
    expect(leerCsd(largo, 'EKU9003173C9', AHORA).vigenteHasta).toEqual(
      new Date('2051-03-01T06:00:00Z'),
    );
  });

  it('el orden de los chequeos: con .cer basura no importa la contraseña', () => {
    expect(
      motivo(() =>
        leerCsd(
          { certificado: Buffer.from('x'), llavePrivada: Buffer.from('y'), contrasena: '' },
          'EKU9003173C9',
          AHORA,
        ),
      ),
    ).toBe('CER_INVALIDO');
  });
});

describe('piezas del CSD', () => {
  it('número de certificado: 20 dígitos ASCII, o el hex tal cual', () => {
    expect(numeroDeCertificado(Buffer.from('30001000000500003416').toString('hex'))).toBe(
      '30001000000500003416',
    );
    expect(numeroDeCertificado('0a1b')).toBe('0A1B');
    expect(numeroDeCertificado(Buffer.from('123').toString('hex'))).toBe('313233');
  });

  it('RFC del sujeto: lo de antes de " / ", por nombre u OID', () => {
    expect(rfcDelSujeto('CN=X\nx500UniqueIdentifier=EKU9003173C9 / VADA800927HSRSRL05')).toBe(
      'EKU9003173C9',
    );
    expect(rfcDelSujeto('2.5.4.45=aaa010101aaa')).toBe('AAA010101AAA');
    expect(rfcDelSujeto('CN=Sin RFC\nC=MX')).toBeNull();
  });

  it('forma de PKCS#8 cifrado', () => {
    expect(esLlaveCifradaPkcs8(BUENO.llavePrivada)).toBe(true);
    expect(esLlaveCifradaPkcs8(Buffer.from([0x30, 0x00]))).toBe(false);
  });
});

describe('formatos del SAT', () => {
  it('RFC moral (12) y física (13); lo demás no', () => {
    expect(tipoPersona('EKU9003173C9')).toBe('moral');
    expect(tipoPersona('XOJI740919U48')).toBe('fisica');
    expect(tipoPersona('Ñ&A010101AAA')).toBe('moral');
    for (const malo of ['EKU9003173C', 'eku9003173c9', 'EKU900317 3C9', '1234567890123', '']) {
      expect(tipoPersona(malo)).toBeNull();
    }
  });

  it('régimen compatible con el tipo de persona', () => {
    expect(regimenAplica('601', 'moral')).toBe(true);
    expect(regimenAplica('601', 'fisica')).toBe(false);
    expect(regimenAplica('612', 'fisica')).toBe(true);
    expect(regimenAplica('612', 'moral')).toBe(false);
    expect(regimenAplica('626', 'moral')).toBe(true);
    expect(regimenAplica('626', 'fisica')).toBe(true);
    expect(regimenAplica('999', 'moral')).toBe(false);
  });
});
