import { verify } from '@node-rs/argon2';
import { PrismaClient, RolUsuario } from '@prisma/client';

import {
  crearAdminInicial,
  leerAdminInicial,
  NOMBRE_ADMIN_INICIAL,
  type DatosAdminInicial,
} from './admin-inicial';

// El primer admin_global de producción (deploy en Railway). La lectura de variables es pura;
// la creación corre contra el Postgres real DENTRO de una transacción que se revierte, así
// no deja nada en la base de pruebas.
class Revertir extends Error {}

const PASSWORD = 'Hx7Lq2Mz9Vb4Nc8K';

describe('leerAdminInicial', () => {
  it('sin ninguna de las dos variables no pide nada', () => {
    expect(leerAdminInicial({})).toBeNull();
    expect(leerAdminInicial({ ADMIN_INICIAL_EMAIL: '', ADMIN_INICIAL_PASSWORD: '' })).toBeNull();
  });

  it('normaliza el email a minúsculas y pone el nombre por defecto', () => {
    expect(
      leerAdminInicial({
        ADMIN_INICIAL_EMAIL: ' Ricardo@Ejemplo.Test ',
        ADMIN_INICIAL_PASSWORD: PASSWORD,
      }),
    ).toEqual({ email: 'ricardo@ejemplo.test', password: PASSWORD, nombre: NOMBRE_ADMIN_INICIAL });
    expect(
      leerAdminInicial({
        ADMIN_INICIAL_EMAIL: 'a@b.test',
        ADMIN_INICIAL_PASSWORD: PASSWORD,
        ADMIN_INICIAL_NOMBRE: 'Ricardo',
      })?.nombre,
    ).toBe('Ricardo');
  });

  it.each([
    ['sólo el email', { ADMIN_INICIAL_EMAIL: 'a@b.test' }, /van juntas/],
    ['sólo la contraseña', { ADMIN_INICIAL_PASSWORD: PASSWORD }, /van juntas/],
    [
      'un email inválido',
      { ADMIN_INICIAL_EMAIL: 'no-es-email', ADMIN_INICIAL_PASSWORD: PASSWORD },
      /email válido/,
    ],
    [
      'una contraseña corta',
      { ADMIN_INICIAL_EMAIL: 'a@b.test', ADMIN_INICIAL_PASSWORD: 'corta' },
      /entre 12 y 128/,
    ],
    [
      'una contraseña de relleno',
      { ADMIN_INICIAL_EMAIL: 'a@b.test', ADMIN_INICIAL_PASSWORD: '<GENERAR-con-openssl>' },
      /relleno/,
    ],
  ])('truena con %s', (_caso, entorno, error) => {
    expect(() => leerAdminInicial(entorno)).toThrow(error);
  });
});

describe('crearAdminInicial (contra la base, revertido)', () => {
  const prisma = new PrismaClient();
  afterAll(() => prisma.$disconnect());

  const datos = (email: string): DatosAdminInicial => ({
    email,
    password: PASSWORD,
    nombre: NOMBRE_ADMIN_INICIAL,
  });

  /** Corre `cuerpo` en una base "recién instalada": ningún admin_global activo. */
  async function enInstalacionNueva(
    cuerpo: (tx: Parameters<Parameters<PrismaClient['$transaction']>[0]>[0]) => Promise<void>,
  ): Promise<void> {
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.usuario.updateMany({
          where: { rol: RolUsuario.admin_global },
          data: { activo: false },
        });
        await cuerpo(tx);
        throw new Revertir();
      }),
    ).rejects.toBeInstanceOf(Revertir);
  }

  it('sin admin activo lo crea (admin_global, sin empresa, argon2), y la 2.ª vez no toca nada', async () => {
    await enInstalacionNueva(async (tx) => {
      const email = 'admin-inicial-1@monitor.test';
      expect(await crearAdminInicial(tx, datos(email))).toEqual({ resultado: 'creado' });
      const fila = await tx.usuario.findUniqueOrThrow({ where: { email } });
      expect(fila).toMatchObject({ rol: 'admin_global', empresaId: null, activo: true });
      expect(fila.passwordHash).not.toContain(PASSWORD);
      expect(await verify(fila.passwordHash, PASSWORD)).toBe(true);

      // Redeploy con las variables todavía puestas, y hasta con OTRA contraseña: nada cambia.
      expect(
        await crearAdminInicial(tx, { ...datos(email), password: 'Otra-Contrasena-9876' }),
      ).toEqual({ resultado: 'ya-hay-admin' });
      const despues = await tx.usuario.findUniqueOrThrow({ where: { email } });
      expect(despues.passwordHash).toBe(fila.passwordHash);
      expect(despues.updatedAt).toEqual(fila.updatedAt);
      expect(await tx.usuario.count({ where: { email } })).toBe(1);
    });
  });

  it('con un admin_global activo ya existente no crea otro', async () => {
    await enInstalacionNueva(async (tx) => {
      await crearAdminInicial(tx, datos('admin-inicial-2@monitor.test'));
      expect(await crearAdminInicial(tx, datos('admin-inicial-3@monitor.test'))).toEqual({
        resultado: 'ya-hay-admin',
      });
      expect(
        await tx.usuario.findUnique({ where: { email: 'admin-inicial-3@monitor.test' } }),
      ).toBeNull();
    });
  });

  it('si el email ya es de otro usuario: error claro SIN tronar, y NO lo asciende ni crea nada', async () => {
    await enInstalacionNueva(async (tx) => {
      const empresa = await tx.empresa.create({ data: { nombre: 'Empresa admin-inicial' } });
      const email = 'visor-admin-inicial@monitor.test';
      const visor = await tx.usuario.create({
        data: {
          email,
          passwordHash: 'hash-sintetico',
          nombre: 'Visor',
          rol: RolUsuario.visor,
          empresaId: empresa.id,
        },
      });
      const r = await crearAdminInicial(tx, datos(email));
      expect(r.resultado).toBe('email-ocupado');
      expect(r.resultado === 'email-ocupado' && r.mensaje).toMatch(/ya pertenece.*visor/);
      expect(
        await tx.usuario.count({ where: { rol: RolUsuario.admin_global, activo: true } }),
      ).toBe(0);
      expect(await tx.usuario.findUniqueOrThrow({ where: { id: visor.id } })).toMatchObject({
        rol: 'visor',
        passwordHash: 'hash-sintetico',
      });
    });
  });

  it('último admin DESACTIVADO + variables con su mismo email: no lo reactiva ni le cambia nada', async () => {
    await enInstalacionNueva(async (tx) => {
      // `enInstalacionNueva` desactivó a todos los admin_global: el que tenga ese email es justo
      // el caso de "el último admin se desactivó y las variables siguen puestas".
      const email = 'admin-desactivado@monitor.test';
      await tx.usuario.create({
        data: {
          email,
          passwordHash: 'hash-viejo',
          nombre: 'Admin viejo',
          rol: RolUsuario.admin_global,
          activo: false,
        },
      });
      const r = await crearAdminInicial(tx, datos(email));
      expect(r).toMatchObject({ resultado: 'email-ocupado' });
      expect(r.resultado === 'email-ocupado' && r.mensaje).toMatch(/desactivado/);
      expect(await tx.usuario.findUniqueOrThrow({ where: { email } })).toMatchObject({
        activo: false,
        passwordHash: 'hash-viejo',
      });
    });
  });
});
