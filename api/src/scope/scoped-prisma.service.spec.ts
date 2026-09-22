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
    expect(Object.keys(datos).sort()).toEqual([
      'agenteContacto',
      'agenteEstado',
      // F2-224: centro de alertas; sus escrituras van por `alertas(scope)`, no por aquí.
      'alerta',
      'alertaEvaluacion',
      // F2-230: catálogos espejo; sus escrituras van por `catalogosDeSucursal(agente)` y
      // `catalogos(scope)`, no por aquí. F2-233: el mapeo área → canal, por `catalogos(scope)`.
      'areaCanal',
      'areaCatalogo',
      'canalVentaCatalogo',
      'cheque',
      'chequePago',
      'chequePartida',
      'clienteCatalogo',
      // F2-202: bandeja del correo falso, filtrada por empresa_id como las demás.
      'correoEnviado',
      'empresa',
      // F2-141: reportes programados; sus escrituras van por `reportes(scope)`.
      'envioReporte',
      'formaPagoCatalogo',
      'grupoProducto',
      'mesaSnapshot',
      'meseroCatalogo',
      'producto',
      'productoMetadata',
      'reglaAlerta',
      'sesionUsuario',
      'sincronizacionCatalogo',
      'solicitudSincronizacion',
      'sucursal',
      'suscripcionReporte',
      'usuario',
    ]);
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

    // F1-060: un where de puros `undefined` Prisma lo ignora y sería "todas las
    // filas". Se rechaza igual que uno vacío (riesgo del log de F1-012).
    it.each([
      ['sin where', undefined],
      ['con where vacío', {}],
      ['con { id: undefined }', { id: undefined }],
      ['con varias llaves undefined', { id: undefined, nombre: undefined }],
      ['con { id: { equals: undefined } }', { id: { equals: undefined } }],
      ['con { id: { in: undefined } }', { id: { in: undefined } }],
      ['con AND de undefined', { AND: [{ id: undefined }] }],
      ['con AND vacío', { AND: {} }],
      ['con OR vacío', { OR: [] }],
      ['con una rama vacía en el OR', { OR: [{ id: FX.sucursalA1 }, {}] }],
      ['con sólo NOT', { NOT: { id: FX.sucursalA1 } }],
      ['con sólo { not }', { id: { not: FX.sucursalA1 } }],
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
      ['{ id: { equals } }', { id: { equals: FX.sucursalA1 } }],
      ['AND con una rama que acota', { AND: [{ id: FX.sucursalA1 }, { nombre: undefined }] }],
      ['OR con todas las ramas que acotan', { OR: [{ id: FX.sucursalA1 }] }],
    ])('un where que sí acota pasa: %s', async (_c, where) => {
      await expect(
        servicio.para(A).sucursal.updateMany({ where, data: { nombre: 'A1' } }),
      ).resolves.toEqual({ count: 1 });
    });

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

  describe('modelos de ventas (F1-030)', () => {
    // Un cheque por empresa (A1 y B1), cada uno con una partida, un pago y un
    // snapshot de su sucursal. Los ids son fijos para poder pedir "el de B"
    // desde el scope de A. `limpiarFixtures` los borra junto con lo demás.
    const V = {
      chequeA: 'f1030000-0000-4000-8000-0000000c00a1',
      chequeB: 'f1030000-0000-4000-8000-0000000c00b1',
      partidaA: 'f1030000-0000-4000-8000-0000000d00a1',
      partidaB: 'f1030000-0000-4000-8000-0000000d00b1',
      pagoA: 'f1030000-0000-4000-8000-0000000e00a1',
      pagoB: 'f1030000-0000-4000-8000-0000000e00b1',
      snapshotA: 'f1030000-0000-4000-8000-0000000f00a1',
      snapshotB: 'f1030000-0000-4000-8000-0000000f00b1',
    } as const;

    const importes = (total: string) => ({
      subtotal: total,
      impuestos: '0.00',
      descuentos: '0.00',
      propina: '0.00',
      total,
    });

    beforeAll(async () => {
      await prisma.cheque.createMany({
        data: [
          {
            id: V.chequeA,
            sucursalId: FX.sucursalA1,
            empresaId: FX.empresaA,
            folio: 'A-1',
            folioSr: 'f1030-scope-1',
            abiertoAt: new Date('2026-03-01T18:00:00Z'),
            cerradoAt: new Date('2026-03-01T19:00:00Z'),
            ...importes('100.10'),
          },
          {
            id: V.chequeB,
            sucursalId: FX.sucursalB1,
            empresaId: FX.empresaB,
            folio: 'B-1',
            folioSr: 'f1030-scope-1',
            abiertoAt: new Date('2026-03-01T18:00:00Z'),
            cerradoAt: new Date('2026-03-01T19:00:00Z'),
            ...importes('900.90'),
          },
        ],
      });
      await prisma.chequePartida.createMany({
        data: [
          { id: V.partidaA, chequeId: V.chequeA, empresaId: FX.empresaA, orden: 0 },
          { id: V.partidaB, chequeId: V.chequeB, empresaId: FX.empresaB, orden: 0 },
        ].map((p) => ({
          ...p,
          producto: 'Café',
          cantidad: '1',
          precioUnit: '1.00',
          total: '1.00',
        })),
      });
      await prisma.chequePago.createMany({
        data: [
          { id: V.pagoA, chequeId: V.chequeA, empresaId: FX.empresaA, monto: '100.10' },
          { id: V.pagoB, chequeId: V.chequeB, empresaId: FX.empresaB, monto: '900.90' },
        ].map((p) => ({ ...p, forma: 'efectivo' as const, formaRaw: 'EFECTIVO' })),
      });
      await prisma.mesaSnapshot.createMany({
        data: [
          { id: V.snapshotA, sucursalId: FX.sucursalA1, empresaId: FX.empresaA },
          { id: V.snapshotB, sucursalId: FX.sucursalB1, empresaId: FX.empresaB },
        ].map((s) => ({ ...s, capturadoAt: new Date('2026-03-01T19:00:00Z'), payload: [] })),
      });
    });

    const nuestrosCheques = { id: { in: [V.chequeA, V.chequeB] } };

    it('cheques: la lista y el conteo sólo traen los de la empresa del scope', async () => {
      const datos = servicio.para(A);
      const cheques = await datos.cheque.findMany({ where: nuestrosCheques });
      expect(cheques.map((c) => c.id)).toEqual([V.chequeA]);
      await expect(datos.cheque.count({ where: nuestrosCheques })).resolves.toBe(1);
      // El mismo folio_sr existe en B1; filtrar por él no lo destapa.
      await expect(
        datos.cheque.findMany({ where: { folioSr: 'f1030-scope-1' } }),
      ).resolves.toHaveLength(1);
    });

    it('cheques: el aggregate de importes sólo suma lo de la empresa del scope', async () => {
      const agg = await servicio
        .para(A)
        .cheque.aggregate({ where: nuestrosCheques, _sum: { total: true } });
      expect(agg._sum.total?.toString()).toBe('100.1');
      const global = await servicio
        .para(GLOBAL)
        .cheque.aggregate({ where: nuestrosCheques, _sum: { total: true } });
      expect(global._sum.total?.toString()).toBe('1001');
    });

    it.each([
      ['cheque', V.chequeB],
      ['chequePartida', V.partidaB],
      ['chequePago', V.pagoB],
      ['mesaSnapshot', V.snapshotB],
    ] as const)('%s de otra empresa pedido por id da null', async (modelo, idDeB) => {
      const datos = servicio.para(A) as unknown as Record<
        string,
        { findFirst: (a: unknown) => Promise<unknown> }
      >;
      await expect(datos[modelo].findFirst({ where: { id: idDeB } })).resolves.toBeNull();
    });

    it('partidas y pagos: pedirlos por el cheque de otra empresa no trae nada', async () => {
      const datos = servicio.para(A);
      await expect(
        datos.chequePartida.findMany({ where: { chequeId: V.chequeB } }),
      ).resolves.toEqual([]);
      await expect(datos.chequePago.count({ where: { chequeId: V.chequeB } })).resolves.toBe(0);
      await expect(
        datos.chequePago.findMany({ where: { chequeId: { in: [V.chequeA, V.chequeB] } } }),
      ).resolves.toMatchObject([{ id: V.pagoA }]);
    });

    it('updateMany no puede mover una partida a otro cheque (chequeId es pertenencia)', async () => {
      await expect(
        servicio.para(A).chequePartida.updateMany({
          where: { id: V.partidaA },
          data: { chequeId: V.chequeB },
        }),
      ).rejects.toThrow('no puede escribir chequeId');
      await expect(
        prisma.chequePartida.findUniqueOrThrow({ where: { id: V.partidaA } }),
      ).resolves.toMatchObject({ chequeId: V.chequeA });
    });
  });
});
