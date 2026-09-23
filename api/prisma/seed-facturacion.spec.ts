import { PrismaClient } from '@prisma/client';

import {
  DIAS_VIGENCIA_SEED,
  NO_CERTIFICADO_SEED,
  RECEPTORES_SEED,
  RFC_SEED,
  sembrarFacturacion,
  vigenciaSeed,
} from './seed-facturacion';

// Seed de datos fiscales (F2-100) sobre una empresa SINTÉTICA propia de este spec (no la demo),
// que se crea y se borra aquí. Escribe por el helper del panel, que abre sus propias
// transacciones: por eso no corre dentro de una transacción revertida.

const EMPRESA = 'f2100000-0000-4000-8000-000000000501';
const HOY = '2026-09-22';
const AHORA = new Date('2026-09-22T18:00:00.000Z');

describe('seed de datos fiscales (F2-100)', () => {
  const prisma = new PrismaClient();

  const limpiar = async () => {
    await prisma.receptorFrecuente.deleteMany({ where: { empresaId: EMPRESA } });
    await prisma.perfilFiscal.deleteMany({ where: { empresaId: EMPRESA } });
    await prisma.empresa.deleteMany({ where: { id: EMPRESA } });
  };

  beforeAll(async () => {
    await limpiar();
    await prisma.empresa.create({ data: { id: EMPRESA, nombre: 'Seed fiscal F2-100' } });
  });
  afterAll(async () => {
    await limpiar();
    await prisma.$disconnect();
  });

  const foto = async () => ({
    perfil: await prisma.perfilFiscal.findFirstOrThrow({
      where: { empresaId: EMPRESA },
      omit: { createdAt: true },
    }),
    receptores: await prisma.receptorFrecuente.findMany({
      where: { empresaId: EMPRESA },
      orderBy: { rfc: 'asc' },
      omit: { createdAt: true },
    }),
  });

  it('la vigencia vence 20 días después del "hoy" del seed, a medianoche de CDMX', () => {
    expect(DIAS_VIGENCIA_SEED).toBe(20);
    expect(vigenciaSeed(HOY)).toEqual({
      desde: new Date('2022-10-12T06:00:00.000Z'),
      hasta: new Date('2026-10-12T06:00:00.000Z'),
    });
    // Fin de mes y de año se cruzan bien.
    expect(vigenciaSeed('2026-12-25').hasta).toEqual(new Date('2027-01-14T06:00:00.000Z'));
  });

  it('deja 1 perfil con metadata de CSD y 2 receptores; dos corridas = mismos datos', async () => {
    expect(
      await sembrarFacturacion(prisma, { empresaId: EMPRESA, hoy: HOY, ahora: AHORA }),
    ).toEqual({ perfil: 'creado', receptores: 2 });
    const primera = await foto();
    expect(primera.perfil).toMatchObject({
      rfc: RFC_SEED,
      regimenFiscal: '601',
      serie: 'A',
      folioActual: 0,
      facturamaOrgId: RFC_SEED,
      csdNoCertificado: NO_CERTIFICADO_SEED,
      csdRfc: RFC_SEED,
      csdVigenteHasta: new Date('2026-10-12T06:00:00.000Z'),
      csdCargadoPor: null,
    });
    expect(primera.receptores.map((r) => r.rfc)).toEqual(RECEPTORES_SEED.map((r) => r.rfc).sort());

    expect(
      await sembrarFacturacion(prisma, { empresaId: EMPRESA, hoy: HOY, ahora: AHORA }),
    ).toEqual({ perfil: 'actualizado', receptores: 2 });
    expect(await foto()).toEqual(primera);
    expect(await prisma.perfilFiscal.count({ where: { empresaId: EMPRESA } })).toBe(1);
  });

  it('el panel manda: un CSD cargado por una persona, u otro RFC, no se pisan', async () => {
    const persona = 'f2100000-0000-4000-8000-000000000999';
    await prisma.perfilFiscal.updateMany({
      where: { empresaId: EMPRESA },
      data: { csdCargadoPor: persona, csdNoCertificado: '00001000000999999999' },
    });
    expect(
      (await sembrarFacturacion(prisma, { empresaId: EMPRESA, hoy: '2026-11-01', ahora: AHORA }))
        .perfil,
    ).toBe('respetado');
    expect((await foto()).perfil).toMatchObject({
      csdCargadoPor: persona,
      csdNoCertificado: '00001000000999999999',
    });

    await prisma.perfilFiscal.updateMany({
      where: { empresaId: EMPRESA },
      data: { rfc: 'XIA190128J61', csdCargadoPor: null },
    });
    await sembrarFacturacion(prisma, { empresaId: EMPRESA, hoy: '2026-11-01', ahora: AHORA });
    expect((await foto()).perfil).toMatchObject({
      rfc: 'XIA190128J61',
      csdNoCertificado: '00001000000999999999',
    });
  });
});
