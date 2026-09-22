import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { CatalogosService } from '../src/catalogos/catalogos.service';
import type { Auditoria } from '../src/comun/auditoria';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import type { AgregadosVentasService } from '../src/ventas/agregados-ventas.service';
import type { AnalisisService } from '../src/ventas/analisis.service';
import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import {
  ACTOR_SEED,
  registrosDe,
  sembrarCatalogos,
  sincronizacionDelSeed,
} from './seed-catalogos';
import { generarVentas, universoDe, type OpcionesVentas } from './seed-ventas';

// El seed de catálogos espejo (F2-230) contra Postgres real, en las sucursales de FIXTURES
// (empresa A), nunca en las del seed de desarrollo. Reloj FIJO: sin él, una segunda corrida
// movería `visto_at` (correcto, pero no sería la misma foto).

const OP: OpcionesVentas = {
  empresaId: FX.empresaA,
  sucursales: [
    { id: FX.sucursalA1, clave: 'A1', zonaHoraria: 'America/Mexico_City' },
    { id: FX.sucursalA2, clave: 'A2', zonaHoraria: 'America/Tijuana' },
  ],
  hoy: '2026-09-15',
};
const RELOJ = new Date('2026-09-15T20:00:00.000Z');
const universo = universoDe(OP, generarVentas(OP));

describe('sembrarCatalogos() (F2-230)', () => {
  const prisma = new PrismaClient();
  const sembrar = (capturadoAt: Date) =>
    sembrarCatalogos(prisma, {
      empresaId: FX.empresaA,
      sucursales: OP.sucursales,
      universo,
      capturadoAt,
    });

  async function foto() {
    const w = { where: { empresaId: FX.empresaA }, orderBy: { id: 'asc' as const } };
    return JSON.parse(
      JSON.stringify(
        await Promise.all([
          prisma.grupoProducto.findMany(w),
          prisma.producto.findMany(w),
          prisma.meseroCatalogo.findMany(w),
          prisma.clienteCatalogo.findMany(w),
          prisma.areaCatalogo.findMany(w),
          prisma.canalVentaCatalogo.findMany(w),
          prisma.areaCanal.findMany({ where: w.where, orderBy: { areaId: 'asc' } }),
          prisma.sincronizacionCatalogo.findMany({
            where: { empresaId: FX.empresaA },
            orderBy: [{ sucursalId: 'asc' }, { catalogo: 'asc' }],
          }),
        ]),
      ),
    );
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('persiste grupos, productos, meseros, clientes, áreas y canales del universo, por sucursal', async () => {
    const conteo = await sembrar(RELOJ);
    const n = OP.sucursales.length;
    expect(conteo).toEqual({
      grupos: universo.grupos.length * n,
      productos: universo.productos.length * n,
      meseros: universo.meseros.length,
      clientes: universo.clientes.length * n,
      // F2-233: las áreas de cada sucursal y los tres tipos de servicio en cada una.
      areas: universo.areas.length,
      canales: universo.canales.length * n,
    });
    for (const s of OP.sucursales) {
      const w = { where: { sucursalId: s.id } };
      expect(await prisma.grupoProducto.count(w)).toBe(universo.grupos.length);
      expect(await prisma.producto.count(w)).toBe(universo.productos.length);
      expect(await prisma.meseroCatalogo.count(w)).toBe(
        universo.meseros.filter((m) => m.sucursalId === s.id).length,
      );
      expect(await prisma.clienteCatalogo.count(w)).toBe(universo.clientes.length);
      // F2-233: áreas y canales.
      expect(await prisma.areaCatalogo.count(w)).toBe(
        universo.areas.filter((a) => a.sucursalId === s.id).length,
      );
      expect(await prisma.canalVentaCatalogo.count(w)).toBe(universo.canales.length);
    }
  });

  it('las bajas del universo quedan presentes con activoPos=false, y todo activo', async () => {
    const bajas = universo.productos.filter((p) => !p.activo).map((p) => p.clave);
    expect(bajas.length).toBeGreaterThan(0);
    const filas = await prisma.producto.findMany({
      where: { sucursalId: FX.sucursalA1 },
      select: { origenSrId: true, clave: true, activo: true, activoPos: true },
    });
    for (const f of filas) {
      expect(f.clave).toBe(f.origenSrId);
      expect(f.activo).toBe(true);
      expect(f.activoPos).toBe(!bajas.includes(f.origenSrId));
    }
    const meseroBaja = universo.meseros.find((m) => !m.activo)!;
    expect(
      await prisma.meseroCatalogo.findFirstOrThrow({
        where: { sucursalId: meseroBaja.sucursalId, origenSrId: meseroBaja.clave },
      }),
    ).toMatchObject({ activo: true, activoPos: false });
  });

  it('el grupo de cada producto existe en la misma sucursal', async () => {
    const grupos = new Set(
      (await prisma.grupoProducto.findMany({ where: { sucursalId: FX.sucursalA2 } })).map(
        (g) => g.origenSrId,
      ),
    );
    const productos = await prisma.producto.findMany({ where: { sucursalId: FX.sucursalA2 } });
    expect(
      productos.every((p) => p.grupoOrigenSrId !== null && grupos.has(p.grupoOrigenSrId)),
    ).toBe(true);
  });

  // F2-145. OJO: esto prueba que el seed PERSISTE los precios del universo (la misma fórmula
  // `precioEn` con que se generaron) y que el menú real los lee; la DETECCIÓN se prueba con
  // valores escritos a mano en `src/catalogos/menu.spec.ts` y `menu.e2e.spec.ts`.
  it('cada producto lleva el precio de SU sucursal, y el menú señala P009 y P021', async () => {
    for (const s of OP.sucursales) {
      const filas = await prisma.producto.findMany({ where: { sucursalId: s.id } });
      for (const f of filas) {
        const u = universo.productos.find((p) => p.clave === f.origenSrId)!;
        expect(f.precio?.toFixed(2)).toBe(u.precios.find((x) => x.sucursalId === s.id)!.precio);
      }
    }
    const servicio = new CatalogosService(
      new ScopedPrismaService(prisma as unknown as PrismaService),
      { ahora: () => RELOJ.getTime() },
      {} as Auditoria,
      {} as AgregadosVentasService,
      {} as AnalisisService,
    );
    const menu = await servicio.menu({ tipo: 'empresa', empresaId: FX.empresaA }, FX.empresaA);
    const senalados = menu.categorias
      .flatMap((c) => c.productos)
      .filter((p) => p.discrepancia)
      .map((p) => p.clave)
      .sort();
    expect(senalados).toEqual(['P009', 'P021']);
    expect(menu.discrepancias).toBe(2);
  });

  it('dos corridas con el mismo reloj dejan exactamente la misma foto', async () => {
    const antes = await foto();
    await sembrar(RELOJ);
    expect(await foto()).toEqual(antes);
  });

  it('una corrida posterior sólo mueve visto_at y la sincronización, nunca updated_at', async () => {
    const antes = await prisma.producto.findMany({
      where: { empresaId: FX.empresaA },
      orderBy: { id: 'asc' },
    });
    const manana = new Date(RELOJ.getTime() + 86_400_000);
    await sembrar(manana);
    const despues = await prisma.producto.findMany({
      where: { empresaId: FX.empresaA },
      orderBy: { id: 'asc' },
    });
    expect(despues.map((p) => p.id)).toEqual(antes.map((p) => p.id));
    for (const [i, p] of despues.entries()) {
      expect(p.updatedAt).toEqual(antes[i].updatedAt);
      expect(p.hash).toBe(antes[i].hash);
      expect(p.vistoAt).toEqual(manana);
      expect(p.sincronizacionId).toBe(sincronizacionDelSeed(p.sucursalId, 'productos', manana));
    }
  });

  it('F2-233: registrosDe() manda las áreas de SU sucursal (Terraza sólo en la par) y los canales', () => {
    const nombres = (id: string) => registrosDe(universo, id, 'areas').map((r) => r.nombre);
    expect(nombres(FX.sucursalA1)).toEqual(['Comedor', 'Terraza', 'Barra', 'Mostrador', 'Domicilio']);
    expect(nombres(FX.sucursalA2)).toEqual(['Comedor', 'Barra', 'Mostrador', 'Domicilio']);
    expect(registrosDe(universo, FX.sucursalA1, 'areas')[1]).toEqual({
      origenSrId: 'A02',
      clave: 'A02',
      nombre: 'Terraza',
    });
    expect(registrosDe(universo, FX.sucursalA2, 'canales').map((r) => r.nombre)).toEqual([
      'Comedor',
      'Mostrador',
      'Domicilio',
    ]);
  });

  it('F2-233: el mapeo demo lleva el canal del universo, con la empresa de la fila espejo', async () => {
    const filas = await prisma.areaCanal.findMany({
      where: { empresaId: FX.empresaA },
      include: { area: { select: { sucursalId: true, origenSrId: true, empresaId: true } } },
    });
    expect(filas).toHaveLength(universo.areas.length);
    for (const f of filas) {
      const u = universo.areas.find(
        (a) => a.sucursalId === f.area.sucursalId && a.clave === f.area.origenSrId,
      )!;
      expect(f.canal).toBe(u.canal);
      expect(f.empresaId).toBe(f.area.empresaId);
      expect(f.actualizadoPor).toBe(ACTOR_SEED);
    }
  });

  it('F2-233: re-sembrar no pisa un mapeo que alguien cambió en el panel', async () => {
    const terraza = await prisma.areaCatalogo.findFirstOrThrow({
      where: { sucursalId: FX.sucursalA1, origenSrId: 'A02' },
    });
    await prisma.areaCanal.update({
      where: { areaId: terraza.id },
      data: { canal: 'plataformas' },
    });
    await sembrar(RELOJ);
    await sembrar(RELOJ);
    expect(
      (await prisma.areaCanal.findUniqueOrThrow({ where: { areaId: terraza.id } })).canal,
    ).toBe('plataformas');
    expect(await prisma.areaCanal.count({ where: { empresaId: FX.empresaA } })).toBe(
      universo.areas.length,
    );
  });
});
