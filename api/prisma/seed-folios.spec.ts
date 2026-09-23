import { PrismaClient, type ConfiguracionFolios, type PaqueteFolios } from '@prisma/client';

import { generarPaquetesSeed, IDS_PAQUETES_SEED, sembrarFolios } from './seed-folios';

// Los paquetes de folios del seed (F2-110): puros y deterministas, relativos al `ahora` del seed, y
// persistidos por `sembrarFolios` dos veces idénticos. El saldo es GLOBAL: la parte contra Postgres
// guarda las filas exactas de `paquetes_folios`/`configuracion_folios` y las restaura al terminar.

const AHORA = new Date('2026-11-15T20:00:00Z');

describe('generarPaquetesSeed (puro)', () => {
  it('vencido, por vencer (≤ 30 días) y vigente, con la compra al inicio del día en CDMX', () => {
    const [vencido, porVencer, actual] = generarPaquetesSeed(AHORA);
    // 15-nov-2026 − 395 días = 16-oct-2025; − 345 = 5-dic-2025; − 75 = 1-sep-2026.
    expect(vencido).toMatchObject({
      id: IDS_PAQUETES_SEED.vencido,
      cantidad: 300,
      compradoAt: new Date('2025-10-16T06:00:00.000Z'),
      venceAt: new Date('2026-10-16T06:00:00.000Z'),
    });
    expect(porVencer).toMatchObject({
      id: IDS_PAQUETES_SEED.porVencer,
      cantidad: 400,
      compradoAt: new Date('2025-12-05T06:00:00.000Z'),
      venceAt: new Date('2026-12-05T06:00:00.000Z'),
    });
    expect(actual).toMatchObject({
      id: IDS_PAQUETES_SEED.actual,
      cantidad: 5000,
      compradoAt: new Date('2026-09-01T06:00:00.000Z'),
      venceAt: new Date('2027-09-01T06:00:00.000Z'),
    });
    // Uno vencido, uno vigente a ≤ 30 días de vencer, uno vigente.
    expect(vencido.venceAt.getTime()).toBeLessThan(AHORA.getTime());
    const dias = (porVencer.venceAt.getTime() - AHORA.getTime()) / 86_400_000;
    expect(dias).toBeGreaterThan(0);
    expect(dias).toBeLessThanOrEqual(30);
    expect(actual.compradoAt.getTime()).toBeLessThan(AHORA.getTime());
  });

  it('determinista', () => {
    expect(generarPaquetesSeed(AHORA)).toEqual(generarPaquetesSeed(new Date(AHORA)));
  });
});

describe('sembrarFolios (contra Postgres)', () => {
  const prisma = new PrismaClient();
  let paquetes: PaqueteFolios[] = [];
  let config: ConfiguracionFolios | null = null;

  beforeAll(async () => {
    await prisma.$connect();
    paquetes = await prisma.paqueteFolios.findMany();
    config = await prisma.configuracionFolios.findUnique({ where: { id: 1 } });
  });

  afterAll(async () => {
    // Lo sembrado aquí fuera; lo que había, TAL CUAL.
    await prisma.paqueteFolios.deleteMany({
      where: { id: { in: Object.values(IDS_PAQUETES_SEED) } },
    });
    const deSeed = paquetes.filter((p) =>
      (Object.values(IDS_PAQUETES_SEED) as string[]).includes(p.id),
    );
    if (deSeed.length > 0) await prisma.paqueteFolios.createMany({ data: deSeed });
    if (config) {
      await prisma.configuracionFolios.update({
        where: { id: 1 },
        data: {
          umbralPct: config.umbralPct,
          controlActivo: config.controlActivo,
          avisoUmbralAt: config.avisoUmbralAt,
          updatedAt: config.updatedAt,
        },
      });
    }
    await prisma.$disconnect();
  });

  it('dos corridas dejan exactamente lo mismo y prenden el control sin tocar el umbral', async () => {
    const umbral = (await prisma.configuracionFolios.findUniqueOrThrow({ where: { id: 1 } }))
      .umbralPct;
    const leer = () =>
      prisma.paqueteFolios.findMany({
        where: { id: { in: Object.values(IDS_PAQUETES_SEED) } },
        orderBy: { id: 'asc' },
      });
    expect(await sembrarFolios(prisma, { ahora: AHORA })).toEqual({
      paquetes: 3,
      zona: 'America/Mexico_City',
    });
    const primera = await leer();
    await sembrarFolios(prisma, { ahora: AHORA });
    expect(await leer()).toEqual(primera);
    expect(primera.map((p) => p.cantidad)).toEqual([300, 400, 5000]);
    const cfg = await prisma.configuracionFolios.findUniqueOrThrow({ where: { id: 1 } });
    expect(cfg.controlActivo).toBe(true);
    expect(cfg.umbralPct).toBe(umbral);
  });
});
