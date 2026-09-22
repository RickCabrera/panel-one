import { PrismaClient } from '@prisma/client';

import { sembrar, SEED_ADMIN_EMAIL, SEED_IDS } from './seed';
import { sembrarReportes } from './seed-reportes';

// Corre dentro de una transacción que se revierte: no deja nada en la base de desarrollo.
class Revertir extends Error {}

describe('seed de reportes (F2-141)', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  it('suscribe al admin global a la empresa demo, diario y semanal, idempotente', async () => {
    await expect(
      prisma.$transaction(async (tx) => {
        await sembrar(tx, 'contrasena-de-prueba-seed');
        const id = await sembrarReportes(tx);
        expect(await sembrarReportes(tx)).toBe(id);
        const filas = await tx.suscripcionReporte.findMany({
          where: { usuario: { email: SEED_ADMIN_EMAIL }, empresaId: SEED_IDS.empresaDemo },
        });
        expect(filas).toHaveLength(1);
        expect(filas[0]).toMatchObject({ diario: true, semanal: true });
        // Lo que el usuario cambió después no se pisa al volver a sembrar.
        await tx.suscripcionReporte.update({ where: { id }, data: { diario: false } });
        await sembrarReportes(tx);
        expect((await tx.suscripcionReporte.findUniqueOrThrow({ where: { id } })).diario).toBe(
          false,
        );
        throw new Revertir();
      }),
    ).rejects.toBeInstanceOf(Revertir);
  });
});
