import { randomUUID } from 'node:crypto';

import { verify } from '@node-rs/argon2';
import { Prisma, PrismaClient, RolUsuario } from '@prisma/client';

import { SEED_ADMIN_EMAIL, SEED_IDS, sembrar } from './seed';

// Tests del esquema núcleo (F1-010) contra un Postgres REAL: el de DATABASE_URL
// (en local, la base de desarrollo; en CI, desde F1-011, `monitor_test`). Sin
// base, fallan en el beforeAll: no se saltan.
//
// Qué escriben: sólo el seed (idempotente por definición) y un AgenteEstado
// temporal que se borra en `finally`. Cada intento de violar una constraint es
// UNA operación fuera de transacción: falla, no persiste nada, y la
// comprobación posterior es otra consulta independiente.

const PASSWORD = 'password-de-prueba-sintetica';

/** Espera un error conocido de Prisma con ese código exacto, no "algo lanzó". */
async function esperarCodigo(
  op: Promise<unknown>,
  codigo: string,
): Promise<Prisma.PrismaClientKnownRequestError> {
  const err = await op.then(
    () => {
      throw new Error(`Se esperaba un error ${codigo} y la operación pasó.`);
    },
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
  const conocido = err as Prisma.PrismaClientKnownRequestError;
  expect(conocido.code).toBe(codigo);
  return conocido;
}

/**
 * Prisma 6 no expone en `meta` el nombre de la FK violada en Postgres
 * (`constraint: null`). Para saber que falló LA constraint esperada y no otra,
 * se repite la operación en SQL crudo: ahí el error (P2010) trae el mensaje de
 * Postgres con el SQLSTATE y el nombre de la constraint.
 */
async function esperarConstraintSql(
  op: Promise<unknown>,
  sqlstate: string,
  constraint: string,
): Promise<void> {
  const err = await esperarCodigo(op, 'P2010');
  expect(err.message).toContain(sqlstate);
  expect(err.message).toContain(constraint);
}

/** Espera la violación del CHECK `usuarios_rol_empresa_chk`, por nombre. */
async function esperarCheckRolEmpresa(op: Promise<unknown>): Promise<void> {
  const err = await op.then(
    () => {
      throw new Error('Se esperaba la violación de usuarios_rol_empresa_chk y la operación pasó.');
    },
    (e: unknown) => e,
  );
  // Prisma 6 no tiene código P-xxxx para un CHECK: llega como error desconocido
  // con el mensaje de Postgres (SQLSTATE 23514), que nombra la constraint.
  expect(err).toBeInstanceOf(Prisma.PrismaClientUnknownRequestError);
  const mensaje = (err as Error).message;
  expect(mensaje).toContain('usuarios_rol_empresa_chk');
  expect(mensaje).toContain('23514');
}

describe('Esquema núcleo (F1-010)', () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await prisma.$connect();
    await sembrar(prisma, PASSWORD);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function fotografia() {
    // `updated_at` se excluye a propósito: `@updatedAt` lo refresca en cada
    // upsert aunque los datos no cambien. Todo lo demás tiene que ser idéntico.
    const [empresas, sucursales, usuarios] = await Promise.all([
      prisma.empresa.findMany({ orderBy: { id: 'asc' }, omit: { updatedAt: true } }),
      prisma.sucursal.findMany({ orderBy: { id: 'asc' }, omit: { updatedAt: true } }),
      prisma.usuario.findMany({ orderBy: { id: 'asc' }, omit: { updatedAt: true } }),
    ]);
    return { empresas, sucursales, usuarios };
  }

  describe('seed', () => {
    it('es idempotente: tres corridas dejan exactamente los mismos datos', async () => {
      const antes = await fotografia();

      await sembrar(prisma, PASSWORD);
      await sembrar(prisma, PASSWORD);
      await sembrar(prisma, 'otra-password-que-no-debe-aplicarse');

      expect(await fotografia()).toEqual(antes);
    });

    it('crea 1 admin global sin empresa y 1 empresa demo con 2 sucursales', async () => {
      const empresa = await prisma.empresa.findUniqueOrThrow({
        where: { id: SEED_IDS.empresaDemo },
        include: { sucursales: { orderBy: { nombre: 'asc' } } },
      });
      expect(empresa.sucursales.map((s) => s.id)).toEqual([
        SEED_IDS.sucursalCentro,
        SEED_IDS.sucursalNorte,
      ]);
      expect(empresa.sucursales.every((s) => s.zonaHoraria === 'America/Mexico_City')).toBe(true);

      const admin = await prisma.usuario.findUniqueOrThrow({ where: { email: SEED_ADMIN_EMAIL } });
      expect(admin.rol).toBe(RolUsuario.admin_global);
      expect(admin.empresaId).toBeNull();
    });

    it('al crear el admin guarda su contraseña como argon2id verificable', async () => {
      // El admin ya existe (lo creó el beforeAll o un `db seed` local), así que la
      // rama de creación se prueba dentro de una transacción que se revierte.
      // En una base local con `npm run seed` completo, `seed:reportes` (F2-141) deja
      // al admin suscrito, y esa FK es Restrict: se borran sus envíos y suscripciones
      // primero, dentro de la misma transacción, así que también se revierten.
      const delAdmin = { suscripcion: { usuario: { email: SEED_ADMIN_EMAIL } } };
      const suscripcionesAntes = await prisma.suscripcionReporte.count({
        where: delAdmin.suscripcion,
      });
      const revertir = new Error('revertir');
      let hash = '';
      await expect(
        prisma.$transaction(async (tx) => {
          await tx.envioReporte.deleteMany({ where: delAdmin });
          await tx.suscripcionReporte.deleteMany({ where: delAdmin.suscripcion });
          await tx.usuario.delete({ where: { email: SEED_ADMIN_EMAIL } });
          await sembrar(tx, PASSWORD);
          hash = (await tx.usuario.findUniqueOrThrow({ where: { email: SEED_ADMIN_EMAIL } }))
            .passwordHash;
          throw revertir;
        }),
      ).rejects.toBe(revertir);

      expect(hash.startsWith('$argon2id$')).toBe(true);
      expect(hash).not.toContain(PASSWORD);
      expect(await verify(hash, PASSWORD)).toBe(true);
      expect(await verify(hash, 'no-es-la-contrasena')).toBe(false);
      await expect(prisma.usuario.count({ where: { email: SEED_ADMIN_EMAIL } })).resolves.toBe(1);
      await expect(prisma.suscripcionReporte.count({ where: delAdmin.suscripcion })).resolves.toBe(
        suscripcionesAntes,
      );
    });
  });

  describe('FK con onDelete: Restrict', () => {
    it('no deja borrar una empresa que tiene sucursales', async () => {
      const err = await esperarCodigo(
        prisma.empresa.delete({ where: { id: SEED_IDS.empresaDemo } }),
        'P2003',
      );
      expect(err.meta?.modelName).toBe('Empresa');
      await esperarConstraintSql(
        prisma.$executeRaw`DELETE FROM empresas WHERE id = ${SEED_IDS.empresaDemo}::uuid`,
        '23503',
        'sucursales_empresa_id_fkey',
      );

      await expect(prisma.empresa.count({ where: { id: SEED_IDS.empresaDemo } })).resolves.toBe(1);
    });

    it('no deja borrar una sucursal que tiene estado de agente', async () => {
      await prisma.agenteEstado.upsert({
        where: { sucursalId: SEED_IDS.sucursalNorte },
        create: { sucursalId: SEED_IDS.sucursalNorte, empresaId: SEED_IDS.empresaDemo },
        update: {},
      });
      try {
        const err = await esperarCodigo(
          prisma.sucursal.delete({ where: { id: SEED_IDS.sucursalNorte } }),
          'P2003',
        );
        expect(err.meta?.modelName).toBe('Sucursal');
        await esperarConstraintSql(
          prisma.$executeRaw`DELETE FROM sucursales WHERE id = ${SEED_IDS.sucursalNorte}::uuid`,
          '23503',
          'agente_estado_sucursal_empresa_fkey',
        );

        await expect(
          prisma.sucursal.count({ where: { id: SEED_IDS.sucursalNorte } }),
        ).resolves.toBe(1);
      } finally {
        await prisma.agenteEstado.deleteMany({ where: { sucursalId: SEED_IDS.sucursalNorte } });
      }
    });
  });

  describe('AgenteEstado.empresa_id', () => {
    it('no puede apuntar a una empresa que no es la de su sucursal', async () => {
      const err = await esperarCodigo(
        prisma.agenteEstado.create({
          data: { sucursalId: SEED_IDS.sucursalCentro, empresaId: randomUUID() },
        }),
        'P2003',
      );
      expect(err.meta?.modelName).toBe('AgenteEstado');
      await esperarConstraintSql(
        prisma.$executeRaw`INSERT INTO agente_estado (sucursal_id, empresa_id, updated_at)
          VALUES (${SEED_IDS.sucursalCentro}::uuid, ${randomUUID()}::uuid, now())`,
        '23503',
        'agente_estado_sucursal_empresa_fkey',
      );

      await expect(
        prisma.agenteEstado.count({ where: { sucursalId: SEED_IDS.sucursalCentro } }),
      ).resolves.toBe(0);
    });
  });

  describe('SesionUsuario (F1-093)', () => {
    const expiraEn = new Date(Date.now() + 60_000);

    /** Un usuario de la empresa demo sólo para este bloque; se borra en `finally`. */
    async function conUsuarioTemporal(prueba: (usuarioId: string) => Promise<void>) {
      const usuario = await prisma.usuario.create({
        data: {
          email: `sesion-${randomUUID()}@prueba.local`,
          passwordHash: 'x',
          nombre: 'Usuario sintético',
          rol: RolUsuario.visor,
          empresaId: SEED_IDS.empresaDemo,
        },
      });
      try {
        await prueba(usuario.id);
      } finally {
        await prisma.usuario.deleteMany({ where: { id: usuario.id } });
      }
    }

    it('empresa_id no puede ser distinta de la del usuario (FK compuesta)', async () => {
      await conUsuarioTemporal(async (usuarioId) => {
        const otraEmpresa = randomUUID();
        await esperarCodigo(
          prisma.sesionUsuario.create({
            data: { id: randomUUID(), usuarioId, empresaId: otraEmpresa, expiraEn },
          }),
          'P2003',
        );
        await esperarConstraintSql(
          prisma.$executeRaw`INSERT INTO sesiones_usuario (id, usuario_id, empresa_id, expira_en)
            VALUES (${randomUUID()}::uuid, ${usuarioId}::uuid, ${otraEmpresa}::uuid, now())`,
          '23503',
          'sesiones_usuario_usuario_empresa_fkey',
        );
        await expect(prisma.sesionUsuario.count({ where: { usuarioId } })).resolves.toBe(0);

        // Con la empresa del usuario, sí.
        await prisma.sesionUsuario.create({
          data: { id: randomUUID(), usuarioId, empresaId: SEED_IDS.empresaDemo, expiraEn },
        });
        await expect(prisma.sesionUsuario.count({ where: { usuarioId } })).resolves.toBe(1);
      });
    });

    it('no puede apuntar a un usuario que no existe', async () => {
      await esperarConstraintSql(
        prisma.$executeRaw`INSERT INTO sesiones_usuario (id, usuario_id, expira_en)
          VALUES (${randomUUID()}::uuid, ${randomUUID()}::uuid, now())`,
        '23503',
        'sesiones_usuario_usuario_id_fkey',
      );
    });

    it('borrar al usuario borra sus sesiones (cascada)', async () => {
      let usuarioBorrado = '';
      await conUsuarioTemporal(async (usuarioId) => {
        usuarioBorrado = usuarioId;
        await prisma.sesionUsuario.createMany({
          data: [
            { id: randomUUID(), usuarioId, empresaId: SEED_IDS.empresaDemo, expiraEn },
            { id: randomUUID(), usuarioId, empresaId: SEED_IDS.empresaDemo, expiraEn },
          ],
        });
        await expect(prisma.sesionUsuario.count({ where: { usuarioId } })).resolves.toBe(2);
      });
      await expect(
        prisma.sesionUsuario.count({ where: { usuarioId: usuarioBorrado } }),
      ).resolves.toBe(0);
    });
  });

  describe('CHECK usuarios_rol_empresa_chk', () => {
    const base = { passwordHash: 'x', nombre: 'Usuario sintético' };

    it.each([
      ['visor sin empresa', RolUsuario.visor, null],
      ['admin_empresa sin empresa', RolUsuario.admin_empresa, null],
      ['admin_global con empresa', RolUsuario.admin_global, SEED_IDS.empresaDemo],
    ])('rechaza %s', async (_caso, rol, empresaId) => {
      const email = `chk-${randomUUID()}@prueba.local`;

      await esperarCheckRolEmpresa(
        prisma.usuario.create({ data: { ...base, email, rol, empresaId } }),
      );

      await expect(prisma.usuario.count({ where: { email } })).resolves.toBe(0);
    });
  });

  describe('Usuario.email', () => {
    it('es único', async () => {
      const err = await esperarCodigo(
        prisma.usuario.create({
          data: {
            email: SEED_ADMIN_EMAIL,
            passwordHash: 'x',
            nombre: 'Duplicado',
            rol: RolUsuario.visor,
            empresaId: SEED_IDS.empresaDemo,
          },
        }),
        'P2002',
      );
      expect(err.meta?.target).toEqual(['email']);

      await expect(prisma.usuario.count({ where: { email: SEED_ADMIN_EMAIL } })).resolves.toBe(1);
    });
  });
});
