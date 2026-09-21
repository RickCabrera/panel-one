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

  it('no expone escrituras, findUnique, SQL crudo ni transacciones', () => {
    const datos = servicio.para(A) as unknown as Record<string, Record<string, unknown>>;
    expect(Object.keys(datos).sort()).toEqual(['agenteEstado', 'empresa', 'sucursal', 'usuario']);
    expect(Object.keys(datos.sucursal).sort()).toEqual(
      ['aggregate', 'count', 'findFirst', 'findFirstOrThrow', 'findMany', 'groupBy'].sort(),
    );
    for (const prohibida of ['create', 'update', 'upsert', 'delete', 'deleteMany', 'findUnique']) {
      expect(datos.sucursal[prohibida]).toBeUndefined();
    }
    expect(datos.$queryRaw).toBeUndefined();
    expect(datos.$transaction).toBeUndefined();
    // Y el cliente crudo no está en ninguna propiedad del servicio.
    expect(Object.values(servicio)).toEqual([]);
  });
});
