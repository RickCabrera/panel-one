import { hash } from '@node-rs/argon2';
import { Prisma, PrismaClient, RolUsuario } from '@prisma/client';

import { ARGON2_OPCIONES } from '../auth/argon2';
import { PASSWORD_MAX, PASSWORD_MIN } from '../auth/dto/password.dto';
import { cargarEnvLocal } from '../config/cargar-env';
import { esRelleno } from '../config/produccion.config';

/**
 * El PRIMER admin_global de una instalación nueva (deploy en Railway). Producción nunca
 * corre los seeds de demo (se niegan con NODE_ENV=production): sin esto no habría con
 * quién entrar al panel por primera vez.
 *
 * Corre en cada arranque del contenedor (`api/docker-entrypoint.sh`), después de
 * `prisma migrate deploy` y antes de la API, y es idempotente:
 *
 * - Sin `ADMIN_INICIAL_EMAIL` ni `ADMIN_INICIAL_PASSWORD` → no hace nada.
 * - Si YA hay un admin_global activo → no hace nada. NUNCA cambia una contraseña ni el
 *   rol de nadie: las variables olvidadas en Railway no son una puerta trasera para
 *   restablecer accesos, y redeployar no pisa lo que el admin cambió desde el panel.
 * - Si el email ya existe (con otro rol, o un admin desactivado) → truena sin tocarlo:
 *   ascender a alguien a admin_global es decisión de una persona en el panel.
 * - Si no → crea el admin_global (sin empresa) con la contraseña hasheada con argon2.
 *
 * Vive en `src/prisma/` porque usa el cliente crudo (allowlist de `eslint.config.mjs`): no
 * lee datos de negocio de ninguna empresa, sólo la tabla de usuarios por rol y email. Se
 * compila con la API (`dist/prisma/admin-inicial.js`), así existe en la imagen de
 * producción, que no trae ts-node.
 */

export interface DatosAdminInicial {
  email: string;
  password: string;
  nombre: string;
}

export type ResultadoAdminInicial = 'creado' | 'ya-hay-admin';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const NOMBRE_ADMIN_INICIAL = 'Administrador global';

/** Las variables, validadas. `null` si no se pidió nada (las dos vacías). */
export function leerAdminInicial(
  entorno: NodeJS.ProcessEnv = process.env,
): DatosAdminInicial | null {
  const email = entorno.ADMIN_INICIAL_EMAIL?.trim().toLowerCase() ?? '';
  const password = entorno.ADMIN_INICIAL_PASSWORD ?? '';
  if (email === '' && password === '') return null;
  if (email === '' || password === '') {
    throw new Error(
      'ADMIN_INICIAL_EMAIL y ADMIN_INICIAL_PASSWORD van juntas: define las dos o ninguna.',
    );
  }
  if (!EMAIL.test(email)) throw new Error('ADMIN_INICIAL_EMAIL no es un email válido.');
  if (password.length < PASSWORD_MIN || password.length > PASSWORD_MAX) {
    throw new Error(
      `ADMIN_INICIAL_PASSWORD debe tener entre ${PASSWORD_MIN} y ${PASSWORD_MAX} caracteres ` +
        '(la misma regla que el cambio de contraseña del panel).',
    );
  }
  if (esRelleno(password)) {
    throw new Error('ADMIN_INICIAL_PASSWORD es un valor de relleno de un .env.example.');
  }
  const nombre = entorno.ADMIN_INICIAL_NOMBRE?.trim() || NOMBRE_ADMIN_INICIAL;
  return { email, password, nombre };
}

type Cliente = PrismaClient | Prisma.TransactionClient;

export async function crearAdminInicial(
  prisma: Cliente,
  datos: DatosAdminInicial,
): Promise<ResultadoAdminInicial> {
  const activos = await prisma.usuario.count({
    where: { rol: RolUsuario.admin_global, activo: true },
  });
  if (activos > 0) return 'ya-hay-admin';

  const existente = await prisma.usuario.findUnique({
    where: { email: datos.email },
    select: { rol: true, activo: true },
  });
  if (existente) {
    throw new Error(
      `ADMIN_INICIAL_EMAIL ya pertenece a un usuario (${existente.rol}` +
        `${existente.activo ? '' : ', desactivado'}). No se modifica: usa otro email, o ` +
        'reactívalo o cambia su rol a mano.',
    );
  }

  try {
    await prisma.usuario.create({
      data: {
        email: datos.email,
        passwordHash: await hash(datos.password, ARGON2_OPCIONES),
        nombre: datos.nombre,
        rol: RolUsuario.admin_global,
        empresaId: null,
        activo: true,
      },
    });
  } catch (err) {
    // Dos réplicas arrancando a la vez: la otra lo creó entre el count y el create.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return 'ya-hay-admin';
    }
    throw err;
  }
  return 'creado';
}

async function main(): Promise<void> {
  cargarEnvLocal();
  const datos = leerAdminInicial();
  if (datos === null) {
    console.log('admin-inicial: sin ADMIN_INICIAL_EMAIL/ADMIN_INICIAL_PASSWORD, nada que hacer.');
    return;
  }
  const prisma = new PrismaClient();
  try {
    const resultado = await crearAdminInicial(prisma, datos);
    // El email sí (es quien entra); la contraseña, jamás.
    console.log(
      resultado === 'creado'
        ? `admin-inicial: admin_global ${datos.email} creado. Quita ADMIN_INICIAL_PASSWORD ` +
            'de las variables del servicio.'
        : 'admin-inicial: ya hay un admin_global activo, no se toca nada.',
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
