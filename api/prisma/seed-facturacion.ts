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
