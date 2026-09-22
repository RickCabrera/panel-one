import { Prisma, PrismaClient } from '@prisma/client';

import { cargarEnvLocal } from '../src/config/cargar-env';
import { SEED_ADMIN_EMAIL, SEED_IDS } from './seed';

/**
 * Seed de los reportes programados (F2-141), de DESARROLLO: suscribe al admin global del
 * seed base a "Restaurante Demo", diario y semanal. Así "Mi cuenta" muestra la sección con
 * datos y, con el API corriendo y `CORREO_IMPL=falso`, el programador deja el correo de cada
 * mañana en la bandeja falsa (`CORREO_DIR_FALSO`).
 *
 * - NO siembra envíos: los genera el programador a las 07:00 de la zona de la empresa (o se
 *   ven al momento con "Ver ejemplo", que es la vista previa).
 * - Idempotente: upsert por (usuario, empresa). N corridas dejan la misma fila, y NO pisa lo
 *   que el usuario haya cambiado después desde Mi cuenta (sólo crea si no existe).
 */
export async function sembrarReportes(prisma: Prisma.TransactionClient): Promise<string> {
  const admin = await prisma.usuario.findUnique({
    where: { email: SEED_ADMIN_EMAIL.toLowerCase() },
    select: { id: true },
  });
  if (!admin) {
    throw new Error('Falta el admin global del seed: corre primero `npx prisma db seed`.');
  }
  const fila = await prisma.suscripcionReporte.upsert({
    where: { usuarioId_empresaId: { usuarioId: admin.id, empresaId: SEED_IDS.empresaDemo } },
    create: { usuarioId: admin.id, empresaId: SEED_IDS.empresaDemo, diario: true, semanal: true },
    update: {},
    select: { id: true },
  });
  return fila.id;
}

async function main(): Promise<void> {
  cargarEnvLocal();
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'El seed de reportes es de desarrollo y se niega a correr con NODE_ENV=production.',
    );
  }
  const prisma = new PrismaClient();
  try {
    await sembrarReportes(prisma);
    console.log(
      `Seed de reportes aplicado: ${SEED_ADMIN_EMAIL} recibe el diario y el semanal de ` +
        'Restaurante Demo (bandeja del correo falso).',
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
