import { PrismaClient } from '@prisma/client';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import type { PrismaService } from '../prisma/prisma.service';
import type { EmpresaScope } from './empresa-scope';
import { ScopedPrismaService } from './scoped-prisma.service';

// El helper de scope contra un Postgres REAL (DATABASE_URL). Lo que importa es
// que el filtro de empresa vaya EN EL WHERE: se prueba con listas, conteos y
// búsquedas que intentan salirse de su empresa.
describe('ScopedPrismaService (contra Postgres)', () => {
  const prisma = new PrismaClient();
  const servicio = new ScopedPrismaService(prisma as unknown as PrismaService);
  const nuestras = { in: [FX.empresaA, FX.empresaB, FX.empresaC] };
  const A: EmpresaScope = { tipo: 'empresa', empresaId: FX.empresaA };
  const GLOBAL: EmpresaScope = { tipo: 'global' };

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
  });

  afterAll(async () => {
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('una lista sólo trae filas de la empresa del scope', async () => {
    const sucursales = await servicio
      .para(A)
      .sucursal.findMany({ where: { empresaId: nuestras }, orderBy: { nombre: 'asc' } });
    expect(sucursales.map((s) => s.id)).toEqual([FX.sucursalA1, FX.sucursalA2]);
  });

  it('un OR del caller no se sale del scope', async () => {
    const sucursales = await servicio
      .para(A)
      .sucursal.findMany({ where: { OR: [{ id: FX.sucursalB1 }, { id: FX.sucursalA1 }] } });
    expect(sucursales.map((s) => s.id)).toEqual([FX.sucursalA1]);
  });

  it('pedir por id una fila de otra empresa da null (el caller lo vuelve 404)', async () => {
    const datos = servicio.para(A);
    await expect(datos.sucursal.findFirst({ where: { id: FX.sucursalB1 } })).resolves.toBeNull();
    await expect(datos.empresa.findFirst({ where: { id: FX.empresaB } })).resolves.toBeNull();
    await expect(datos.empresa.findFirst({ where: { id: FX.empresaA } })).resolves.toMatchObject({
      id: FX.empresaA,
    });
  });

  it('count y aggregate también van filtrados', async () => {
    const datos = servicio.para(A);
    await expect(datos.usuario.count({ where: { empresaId: nuestras } })).resolves.toBe(
      Object.values(USUARIOS).filter((u) => u.empresaId === FX.empresaA).length,
    );
    await expect(datos.empresa.count({ where: { id: nuestras } })).resolves.toBe(1);
    const agg = await datos.sucursal.aggregate({
      where: { empresaId: nuestras },
      _count: { _all: true },
    });
    expect(agg._count._all).toBe(2);
  });

  it('admin_global ve todas las empresas', async () => {
    await expect(
      servicio.para(GLOBAL).sucursal.count({ where: { empresaId: nuestras } }),
    ).resolves.toBe(3);
  });

  it('no expone más escritura que updateMany, ni findUnique, SQL crudo ni transacciones', () => {
    const datos = servicio.para(A) as unknown as Record<string, Record<string, unknown>>;
    expect(Object.keys(datos).sort()).toEqual(['agenteEstado', 'empresa', 'sucursal', 'usuario']);
    expect(Object.keys(datos.sucursal).sort()).toEqual(
      [
        'aggregate',
        'count',
        'findFirst',
        'findFirstOrThrow',
        'findMany',
        'groupBy',
        'updateMany',
      ].sort(),
    );
    for (const prohibida of [
      'create',
      'createMany',
      'update',
      'upsert',
      'delete',
      'deleteMany',
      'findUnique',
    ]) {
      expect(datos.sucursal[prohibida]).toBeUndefined();
    }
    expect(datos.$queryRaw).toBeUndefined();
    expect(datos.$transaction).toBeUndefined();
    // Y el cliente crudo no está en ninguna propiedad del servicio.
    expect(Object.values(servicio)).toEqual([]);
  });

  describe('updateMany con scope (F1-012)', () => {
    const hashDe = async (id: string) =>
      (await prisma.sucursal.findUniqueOrThrow({ where: { id } })).apiKeyHash;

    it('sobre una fila de otra empresa no toca nada (count 0; el caller lo vuelve 404)', async () => {
      const antes = await hashDe(FX.sucursalB1);
      await expect(
        servicio.para(A).sucursal.updateMany({
          where: { id: FX.sucursalB1 },
          data: { apiKeyHash: 'f1012-hash-intruso' },
        }),
      ).resolves.toEqual({ count: 0 });
      expect(await hashDe(FX.sucursalB1)).toBe(antes);
    });

    it('sobre una fila propia actualiza sólo esa', async () => {
      await expect(
        servicio.para(A).sucursal.updateMany({
          where: { id: FX.sucursalA1 },
          data: { apiKeyHash: 'f1012-hash-a1' },
        }),
      ).resolves.toEqual({ count: 1 });
      expect(await hashDe(FX.sucursalA1)).toBe('f1012-hash-a1');
      expect(await hashDe(FX.sucursalA2)).not.toBe('f1012-hash-a1');
    });

    it('admin_global actualiza una fila de cualquier empresa', async () => {
      await expect(
        servicio.para(GLOBAL).sucursal.updateMany({
          where: { id: FX.sucursalB1 },
          data: { apiKeyHash: 'f1012-hash-b1' },
        }),
      ).resolves.toEqual({ count: 1 });
      expect(await hashDe(FX.sucursalB1)).toBe('f1012-hash-b1');
    });

    it.each([
      ['sin where', undefined],
      ['con where vacío', {}],
    ])(
      '%s se rechaza, también para admin_global (no actualiza la tabla entera)',
      async (_c, where) => {
        const antes = await prisma.sucursal.findMany({
          where: { empresaId: nuestras },
          orderBy: { id: 'asc' },
        });
        for (const scope of [A, GLOBAL]) {
          await expect(
            servicio
              .para(scope)
              .sucursal.updateMany({ where, data: { nombre: 'pisada' } } as never),
          ).rejects.toThrow('where no vacío');
        }
        await expect(
          prisma.sucursal.findMany({ where: { empresaId: nuestras }, orderBy: { id: 'asc' } }),
        ).resolves.toEqual(antes);
      },
    );

    it.each([
      ['empresaId', { empresaId: FX.empresaB }],
      ['id', { id: FX.inexistente }],
    ])('no puede escribir %s (identidad o pertenencia)', async (columna, data) => {
      await expect(
        servicio.para(A).sucursal.updateMany({ where: { id: FX.sucursalA2 }, data }),
      ).rejects.toThrow(`no puede escribir ${columna}`);
      await expect(
        prisma.sucursal.findUniqueOrThrow({ where: { id: FX.sucursalA2 } }),
      ).resolves.toMatchObject({ empresaId: FX.empresaA });
    });

    it('en Empresa la llave de tenant es id, y tampoco se escribe', async () => {
      await expect(
        servicio.para(GLOBAL).empresa.updateMany({
          where: { id: FX.empresaA },
          data: { id: FX.inexistente },
        }),
      ).rejects.toThrow('no puede escribir id');
    });
  });
});
