import { hash } from '@node-rs/argon2';
import { Prisma, PrismaClient, RolUsuario } from '@prisma/client';

import { ARGON2_OPCIONES } from '../src/auth/argon2';
import { cargarEnvLocal } from '../src/config/cargar-env';

/**
 * Seed de DESARROLLO: 1 admin global, 1 empresa demo con 2 sucursales. Datos
 * sintéticos, ninguno de un restaurante real.
 *
 * Idempotente: cada registro se hace con `upsert` sobre una llave fija (UUID
 * constante o email), así que correrlo N veces deja exactamente los mismos
 * datos. La contraseña del admin sólo se hashea al CREAR el usuario: argon2 usa
 * sal aleatoria, y re-hashearla en cada corrida cambiaría la fila cada vez.
 */

export const SEED_IDS = {
  empresaDemo: '00000000-0000-4000-8000-000000000001',
  sucursalCentro: '00000000-0000-4000-8000-000000000101',
  sucursalNorte: '00000000-0000-4000-8000-000000000102',
} as const;

export const SEED_ADMIN_EMAIL = 'admin@monitor.local';

/** Valor obvio de desarrollo. Nunca se usa en producción: `main` se niega. */
export const SEED_ADMIN_PASSWORD_DEFAULT = 'cambiar-en-local';

// Las opciones de argon2 viven en `src/auth/argon2.ts`: el login verifica con
// las mismas. Se re-exportan para no romper a quien las importaba de aquí.
export { ARGON2_OPCIONES };

// Acepta también un cliente de transacción: los tests lo corren dentro de una
// transacción que se revierte para probar la rama de creación.
export async function sembrar(
  prisma: Prisma.TransactionClient,
  adminPassword: string,
): Promise<void> {
  const zona = 'America/Mexico_City';

  await prisma.empresa.upsert({
    where: { id: SEED_IDS.empresaDemo },
    create: { id: SEED_IDS.empresaDemo, nombre: 'Restaurante Demo', activo: true },
    update: { nombre: 'Restaurante Demo', activo: true },
  });

  const sucursales = [
    { id: SEED_IDS.sucursalCentro, nombre: 'Sucursal Centro' },
    { id: SEED_IDS.sucursalNorte, nombre: 'Sucursal Norte' },
  ];
  for (const s of sucursales) {
    const datos = {
      empresaId: SEED_IDS.empresaDemo,
      nombre: s.nombre,
      zonaHoraria: zona,
      activo: true,
    };
    await prisma.sucursal.upsert({
      where: { id: s.id },
      create: { id: s.id, ...datos },
      update: datos,
    });
  }

  const email = SEED_ADMIN_EMAIL.toLowerCase();
  const datosAdmin = {
    nombre: 'Administrador global',
    rol: RolUsuario.admin_global,
    empresaId: null,
    activo: true,
  };
  // El hash sólo entra en `create`: en una corrida repetida se calcula y se
  // descarta, y el password_hash guardado no cambia.
  await prisma.usuario.upsert({
    where: { email },
    create: { email, passwordHash: await hash(adminPassword, ARGON2_OPCIONES), ...datosAdmin },
    update: datosAdmin,
  });
}

async function main(): Promise<void> {
  // api/.env: `npm run seed:*` corre fuera de la CLI de Prisma y nadie más lo carga
  // (F2-200). Antes del chequeo de producción, para que un NODE_ENV del .env cuente.
  cargarEnvLocal();
  if (process.env.NODE_ENV === 'production') {
    throw new Error('El seed es de desarrollo y se niega a correr con NODE_ENV=production.');
  }

  let password = process.env.SEED_ADMIN_PASSWORD;
  if (!password) {
    password = SEED_ADMIN_PASSWORD_DEFAULT;
    console.warn(
      `AVISO: SEED_ADMIN_PASSWORD no está definida. Si hay que crear el admin global (${SEED_ADMIN_EMAIL}), ` +
        `se crea con la contraseña de desarrollo por defecto "${SEED_ADMIN_PASSWORD_DEFAULT}".`,
    );
  }

  const prisma = new PrismaClient();
  try {
    await sembrar(prisma, password);
    console.log('Seed aplicado: 1 admin global, 1 empresa demo, 2 sucursales.');
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
