import { PrismaClient } from '@prisma/client';

import { estadoEfectivo, hoyPlataforma } from '../src/plataforma/membresia';
import { sembrar, SEED_IDS } from './seed';
import { SEED_PLATAFORMA, sembrarPlataforma } from './seed-plataforma';

// El seed del panel de plataforma contra Postgres real, DENTRO de una transacción que se
// revierte: los clientes de ejemplo no se quedan en la base compartida de los tests (moverían
// los conteos de quien recorre todas las empresas).

const AHORA = new Date('2026-11-03T18:00:00.000Z');

describe('seed de plataforma (membresías)', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it('3 planes, 3 clientes en activa / prueba / vencida, pagos de ejemplo; idempotente', async () => {
    const taqueriaAntes = await prisma.empresa.count({
      where: { id: SEED_PLATAFORMA.empresaTaqueria },
    });
    const revertir = new Error('revertir');
    let foto1: unknown;
    let foto2: unknown;
    let estados: string[] = [];
    const fotografia = async (tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0]) => {
      const omit = { createdAt: true, updatedAt: true } as const;
      return JSON.parse(
        JSON.stringify({
          planes: await tx.plan.findMany({
            where: {
              id: {
                in: [
                  SEED_PLATAFORMA.planEsencial,
                  SEED_PLATAFORMA.planCompleto,
                  SEED_PLATAFORMA.planCadena,
                ],
              },
            },
            orderBy: { id: 'asc' },
            omit,
          }),
          suscripciones: await tx.suscripcion.findMany({
            where: {
              id: {
                in: [
                  SEED_PLATAFORMA.suscripcionDemo,
                  SEED_PLATAFORMA.suscripcionCafeteria,
                  SEED_PLATAFORMA.suscripcionTaqueria,
                ],
              },
            },
            orderBy: { id: 'asc' },
            omit,
          }),
          pagos: await tx.pagoSuscripcion.findMany({
            where: { empresaId: SEED_IDS.empresaDemo },
            orderBy: { id: 'asc' },
            omit: { createdAt: true },
          }),
        }),
      );
    };

    await expect(
      prisma.$transaction(
        async (tx) => {
          await sembrar(tx, 'contrasena-sintetica-seed-plataforma');
          await sembrarPlataforma(tx, AHORA);
          foto1 = await fotografia(tx);
          await sembrarPlataforma(tx, AHORA);
          await sembrarPlataforma(tx, new Date('2027-01-15T18:00:00.000Z'));
          foto2 = await fotografia(tx);
          const hoy = hoyPlataforma(AHORA.getTime());
          const filas = await tx.suscripcion.findMany({
            where: {
              empresaId: {
                in: [
                  SEED_IDS.empresaDemo,
                  SEED_PLATAFORMA.empresaCafeteria,
                  SEED_PLATAFORMA.empresaTaqueria,
                ],
              },
            },
            orderBy: { empresaId: 'asc' },
          });
          estados = filas.map((s) => estadoEfectivo(s, hoy));
          throw revertir;
        },
        { timeout: 30_000 },
      ),
    ).rejects.toBe(revertir);

    expect(foto2).toEqual(foto1);
    const f = foto1 as {
      planes: { nombre: string; precioMensual: string }[];
      suscripciones: unknown[];
      pagos: { monto: string; anuladoAt: string | null }[];
    };
    expect(f.planes.map((p) => p.nombre).sort()).toEqual([
      'Cadena (anual)',
      'Completo',
      'Esencial',
    ]);
    expect(f.suscripciones).toHaveLength(3);
    expect(f.pagos).toHaveLength(2);
    expect(f.pagos.filter((p) => p.anuladoAt !== null)).toHaveLength(1);
    // Demo (…001) activa, Cafetería (…002) en prueba, Taquería (…003) vencida.
    expect(estados).toEqual(['activa', 'prueba', 'vencida']);
    // Nada quedó: la transacción se revirtió.
    expect(await prisma.empresa.count({ where: { id: SEED_PLATAFORMA.empresaTaqueria } })).toBe(
      taqueriaAntes,
    );
  });
});
