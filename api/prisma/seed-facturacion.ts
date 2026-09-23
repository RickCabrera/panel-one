import { deflateSync } from 'node:zlib';

import type { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';

/**
 * Datos fiscales del seed (F2-100): el perfil fiscal de la empresa demo con METADATA de CSD, y
 * receptores frecuentes para dos de los tres RFC de prueba del SAT que llevan los clientes del
 * seed (el tercero queda sin receptor, para ver los dos casos en la ficha de Clientes).
 *
 * OJO: la metadata del CSD es SINTÉTICA. No hay ningún `.cer` ni `.key` detrás, ni un emisor dado
 * de alta en un PAC: es lo que dejaría el PAC falso (`idOrganizacion` = RFC). Su vigencia termina
 * 20 días después del "hoy" del seed para que la alerta de < 30 días se vea.
 *
 * - Escribe por el helper de escritura del panel (`ScopedPrismaService.facturacion(scope)`).
 * - El panel manda: si el perfil ya tiene OTRO RFC, o un CSD que cargó una persona
 *   (`csd_cargado_por` no nulo), el seed no lo toca.
 * - Idempotente y determinista con el mismo reloj: la vigencia sale del "hoy" del seed.
 */

export const RFC_SEED = 'EKU9003173C9';
export const NO_CERTIFICADO_SEED = '30001000000500003416';
export const DIAS_VIGENCIA_SEED = 20;

export const RECEPTORES_SEED = [
  {
    rfc: 'EKU9003173C9',
    razonSocial: 'ESCUELA KEMPER URGATE',
    regimenFiscal: '601',
    cp: '42501',
    usoCfdi: 'G03',
    email: 'facturas.kemper@ejemplo.test',
  },
  {
    rfc: 'XIA190128J61',
    razonSocial: 'XENON INDUSTRIAL ARTICLES',
    regimenFiscal: '601',
    cp: '76343',
    usoCfdi: 'G03',
    email: null,
  },
] as const;

/** Fin de la vigencia del CSD del seed: 00:00 de CDMX (UTC−6) de `hoy + 20` días. */
export function vigenciaSeed(hoy: string): { desde: Date; hasta: Date } {
  const [a, m, d] = hoy.split('-').map(Number);
  const hasta = new Date(Date.UTC(a, m - 1, d + DIAS_VIGENCIA_SEED, 6));
  const desde = new Date(Date.UTC(a - 4, m - 1, d + DIAS_VIGENCIA_SEED, 6));
  return { desde, hasta };
}

export interface ResultadoSembrarFacturacion {
  perfil: 'creado' | 'actualizado' | 'respetado';
  receptores: number;
}

export async function sembrarFacturacion(
  prisma: PrismaClient,
  op: { empresaId: string; hoy: string; ahora: Date },
): Promise<ResultadoSembrarFacturacion> {
  const scoped = new ScopedPrismaService(prisma as unknown as PrismaService);
  const scope = { tipo: 'empresa', empresaId: op.empresaId } as const;
  const escritura = scoped.facturacion(scope);
  const actual = await scoped.para(scope).perfilFiscal.findFirst({
    where: { empresaId: op.empresaId },
    select: { rfc: true, csdCargadoPor: true },
  });
  let perfil: ResultadoSembrarFacturacion['perfil'] = 'respetado';
  if (!actual) {
    await escritura.guardarPerfil(
      op.empresaId,
      {
        rfc: RFC_SEED,
        razonSocial: 'ESCUELA KEMPER URGATE',
        regimenFiscal: '601',
        cp: '06700',
        serie: 'A',
      },
      null,
      op.ahora,
    );
    perfil = 'creado';
  }
  if (!actual || (actual.rfc === RFC_SEED && actual.csdCargadoPor === null)) {
    const { desde, hasta } = vigenciaSeed(op.hoy);
    await escritura.guardarCsd(
      op.empresaId,
      {
        rfcValidado: RFC_SEED,
        noCertificado: NO_CERTIFICADO_SEED,
        rfc: RFC_SEED,
        vigenteDesde: desde,
        vigenteHasta: hasta,
        facturamaOrgId: RFC_SEED,
      },
      null,
      op.ahora,
    );
    if (actual) perfil = 'actualizado';
  }
  for (const r of RECEPTORES_SEED) {
    await escritura.guardarReceptor(op.empresaId, { ...r }, op.ahora);
  }
  return { perfil, receptores: RECEPTORES_SEED.length };
}

/**
 * Portales de autofactura del seed (F2-103): uno por sucursal demo, con su enlace y su color.
 * Centro lleva un logo PNG sintético (generado aquí, determinista); Norte va sin logo para ver
 * los dos casos en el portal. El panel manda: un portal que editó una persona
 * (`actualizado_por` no nulo) no se pisa.
 */
export interface PortalSeed {
  sucursalId: string;
  slug: string;
  color: string;
  conLogo: boolean;
}

export async function sembrarPortales(
  prisma: PrismaClient,
  op: { empresaId: string; portales: readonly PortalSeed[]; ahora: Date },
): Promise<{ sembrados: number; respetados: number }> {
  const scoped = new ScopedPrismaService(prisma as unknown as PrismaService);
  const scope = { tipo: 'empresa', empresaId: op.empresaId } as const;
  const escritura = scoped.facturacion(scope);
  let sembrados = 0;
  let respetados = 0;
  for (const p of op.portales) {
    const actual = await scoped.para(scope).portalFacturacion.findFirst({
      where: { sucursalId: p.sucursalId },
      select: { actualizadoPor: true },
    });
    if (actual && actual.actualizadoPor !== null) {
      respetados++;
      continue;
    }
    await escritura.guardarPortal(
      p.sucursalId,
      { slug: p.slug, color: p.color, activo: true },
      null,
      op.ahora,
    );
    await escritura.guardarLogoPortal(
      p.sucursalId,
      p.conLogo ? { bytes: logoSintetico(p.color), tipo: 'image/png' } : null,
      null,
      op.ahora,
    );
    sembrados++;
  }
  return { sembrados, respetados };
}

/**
 * Un PNG de 48×48 con un círculo del color de la marca sobre fondo blanco: un logo de mentira
 * que se ve como logo. Determinista (mismo color = mismos bytes). No es marca de nadie.
 */
export function logoSintetico(color: string): Buffer {
  const lado = 48;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(color.slice(i, i + 2), 16));
  const filas: Buffer[] = [];
  for (let y = 0; y < lado; y++) {
    const fila = Buffer.alloc(1 + lado * 3); // byte 0: filtro "None"
    for (let x = 0; x < lado; x++) {
      const dentro = (x - 23.5) ** 2 + (y - 23.5) ** 2 <= 21 ** 2;
      fila.set(dentro ? [r, g, b] : [255, 255, 255], 1 + x * 3);
    }
    filas.push(fila);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(lado, 0);
  ihdr.writeUInt32BE(lado, 4);
  ihdr.set([8, 2, 0, 0, 0], 8); // 8 bits, RGB, sin entrelazado
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    trozoPng('IHDR', ihdr),
    trozoPng('IDAT', deflateSync(Buffer.concat(filas), { level: 9 })),
    trozoPng('IEND', Buffer.alloc(0)),
  ]);
}

function trozoPng(tipo: string, datos: Buffer): Buffer {
  const largo = Buffer.alloc(4);
  largo.writeUInt32BE(datos.length, 0);
  const cuerpo = Buffer.concat([Buffer.from(tipo, 'latin1'), datos]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(cuerpo), 0);
  return Buffer.concat([largo, cuerpo, crc]);
}

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}
