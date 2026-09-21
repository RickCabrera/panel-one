import { NotFoundException } from '@nestjs/common';
import { PrismaClient, RolUsuario } from '@prisma/client';

import { crearFixtures, DOMINIO, FX, limpiarFixtures } from '../../test/fixtures-auth';
import type { PrismaService } from '../prisma/prisma.service';
import type { EmpresaScope } from './empresa-scope';
import { ScopedPrismaService } from './scoped-prisma.service';

// Las altas con scope de la administración (F1-060), contra Postgres REAL. Lo
// que importa: la empresa de lo creado sale de un id verificado con scope (404
// fuera de alcance) y lo que exige scope global truena con uno de empresa.
describe('EscrituraAdmin (contra Postgres, F1-060)', () => {
  const prisma = new PrismaClient();
  const servicio = new ScopedPrismaService(prisma as unknown as PrismaService);
  const A: EmpresaScope = { tipo: 'empresa', empresaId: FX.empresaA };
  const GLOBAL: EmpresaScope = { tipo: 'global' };
  const SUFIJO = '(F1-060 helper)';
  const usuarioNuevo = (clave: string, rol: RolUsuario = RolUsuario.visor) => ({
    email: `helper.${clave}${DOMINIO}`,
    nombre: `Helper ${clave}`,
    rol,
    passwordHash: 'hash-sintetico-no-es-argon2',
  });

  async function limpiar(): Promise<void> {
    const empresas = await prisma.empresa.findMany({
      where: { nombre: { endsWith: SUFIJO } },
      select: { id: true },
    });
    const ids = empresas.map((e) => e.id);
    await prisma.usuario.deleteMany({ where: { email: { startsWith: 'helper.' } } });
    await prisma.sucursal.deleteMany({
      where: { OR: [{ empresaId: { in: ids } }, { nombre: { endsWith: SUFIJO } }] },
    });
    await prisma.empresa.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await limpiar();
  });

  afterAll(async () => {
    await limpiar();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('crearEmpresa', () => {
    it('con scope global crea la empresa', async () => {
      const empresa = await servicio.admin(GLOBAL).crearEmpresa(`Nueva ${SUFIJO}`);
      expect(empresa).toEqual({ id: expect.any(String), nombre: `Nueva ${SUFIJO}`, activo: true });
    });

    it('con scope de empresa truena y no crea nada', async () => {
      await expect(servicio.admin(A).crearEmpresa(`Intrusa ${SUFIJO}`)).rejects.toThrow(
        'exige scope global',
      );
      await expect(prisma.empresa.count({ where: { nombre: `Intrusa ${SUFIJO}` } })).resolves.toBe(
        0,
      );
    });
  });

  describe('crearSucursal', () => {
    const datos = { nombre: `S ${SUFIJO}`, zonaHoraria: 'America/Mexico_City' };

    it('en una empresa del alcance, con la empresa pedida', async () => {
      const s = await servicio.admin(A).crearSucursal(FX.empresaA, datos);
      expect(s).toMatchObject({ empresaId: FX.empresaA, nombre: datos.nombre, activo: true });
      await expect(
        prisma.sucursal.findUniqueOrThrow({ where: { id: s.id } }),
      ).resolves.toMatchObject({ apiKeyHash: null });
    });

    it('en otra empresa es 404, idéntico a una inexistente, y no crea nada', async () => {
      const antes = await prisma.sucursal.count({ where: { empresaId: FX.empresaB } });
      for (const empresaId of [FX.empresaB, FX.inexistente]) {
        await expect(servicio.admin(A).crearSucursal(empresaId, datos)).rejects.toBeInstanceOf(
          NotFoundException,
        );
      }
      await expect(prisma.sucursal.count({ where: { empresaId: FX.empresaB } })).resolves.toBe(
        antes,
      );
    });

    it('con scope global, en cualquier empresa', async () => {
      const s = await servicio.admin(GLOBAL).crearSucursal(FX.empresaB, datos);
      expect(s.empresaId).toBe(FX.empresaB);
    });

    it('un empresaId vacío truena antes de consultar', async () => {
      await expect(servicio.admin(GLOBAL).crearSucursal('', datos)).rejects.toThrow(
        'empresaId vacío',
      );
    });
  });

  describe('crearUsuario', () => {
    it('en la empresa del alcance, sin devolver el hash', async () => {
      const u = await servicio.admin(A).crearUsuario(FX.empresaA, usuarioNuevo('a'));
      expect(u).toEqual({
        id: expect.any(String),
        email: `helper.a${DOMINIO}`,
        nombre: 'Helper a',
        rol: RolUsuario.visor,
        empresaId: FX.empresaA,
        activo: true,
      });
    });

    it('en otra empresa, o sin empresa, es 404 / truena y no crea nada', async () => {
      await expect(
        servicio.admin(A).crearUsuario(FX.empresaB, usuarioNuevo('b')),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(servicio.admin(A).crearUsuario(null, usuarioNuevo('c'))).rejects.toThrow(
        'empresaId vacío',
      );
      await expect(
        prisma.usuario.count({
          where: { email: { in: [`helper.b${DOMINIO}`, `helper.c${DOMINIO}`] } },
        }),
      ).resolves.toBe(0);
    });

    it('un admin_global con scope de empresa truena (defensa en profundidad)', async () => {
      await expect(
        servicio.admin(A).crearUsuario(null, usuarioNuevo('g1', RolUsuario.admin_global)),
      ).rejects.toThrow('exige scope global');
      await expect(prisma.usuario.count({ where: { email: `helper.g1${DOMINIO}` } })).resolves.toBe(
        0,
      );
    });

    it('un admin_global con empresa truena; sin empresa y scope global, se crea', async () => {
      await expect(
        servicio
          .admin(GLOBAL)
          .crearUsuario(FX.empresaA, usuarioNuevo('g2', RolUsuario.admin_global)),
      ).rejects.toThrow('no lleva empresa');
      const g = await servicio
        .admin(GLOBAL)
        .crearUsuario(null, usuarioNuevo('g3', RolUsuario.admin_global));
      expect(g).toMatchObject({ rol: RolUsuario.admin_global, empresaId: null });
    });
  });
});
