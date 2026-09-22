import { FormaPago, Prisma, PrismaClient } from '@prisma/client';

import { crearFixtures, FX, limpiarFixtures } from '../../test/fixtures-auth';
import type { PrismaService } from '../prisma/prisma.service';
import type { DatosCheque, DatosPartida } from './escritura-sucursal';
import { ScopedPrismaService } from './scoped-prisma.service';

// Las escrituras de sucursal de la ingesta (F1-031) contra un Postgres REAL.
// Lo que importa: cada operación queda clavada a la sucursal del agente, los
// filtros vacíos truenan en vez de ensancharse, y una falla revierte todo.

const D = (v: string) => new Prisma.Decimal(v);
const A1 = { sucursalId: FX.sucursalA1, empresaId: FX.empresaA };
const A2 = { sucursalId: FX.sucursalA2, empresaId: FX.empresaA };

function datosCheque(total = '100.00'): DatosCheque {
  return {
    folio: '1',
    abiertoAt: new Date('2026-09-20T19:00:00.000Z'),
    cerradoAt: new Date('2026-09-20T20:00:00.000Z'),
    mesa: '1',
    mesero: null,
    comensales: 2,
    clienteOrigenSrId: null,
    areaOrigenSrId: null,
    subtotal: D(total),
    impuestos: D('0'),
    descuentos: D('0'),
    propina: D('0'),
    total: D(total),
    cancelado: false,
  };
}

function partida(producto: string, total = '50.00'): DatosPartida {
  return {
    producto,
    categoria: null,
    cantidad: D('1'),
    precioUnit: D(total),
    total: D(total),
    modificadores: [],
  };
}

const pago = (monto: string) => ({ forma: FormaPago.otro, formaRaw: 'EFECTIVO', monto: D(monto) });

describe('ScopedPrismaService.deSucursal (contra Postgres, F1-031)', () => {
  const queries: string[] = [];
  const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
  prisma.$on('query', (e) => queries.push(e.query));
  const servicio = new ScopedPrismaService(prisma as unknown as PrismaService);

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
  });

  afterAll(async () => {
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('el cheque queda en la sucursal y empresa del AGENTE, y otra sucursal no lo ve', async () => {
    const id = await servicio
      .deSucursal(A1)
      .enTransaccion((ops) =>
        ops.guardarCheque('ES-1', datosCheque(), [partida('a'), partida('b')], [pago('100')]),
      );

    const fila = await prisma.cheque.findUniqueOrThrow({ where: { id } });
    expect(fila).toMatchObject({ sucursalId: FX.sucursalA1, empresaId: FX.empresaA });
    const partidas = await prisma.chequePartida.findMany({
      where: { chequeId: id },
      orderBy: { orden: 'asc' },
    });
    expect(partidas.map((p) => [p.orden, p.producto, p.empresaId])).toEqual([
      [0, 'a', FX.empresaA],
      [1, 'b', FX.empresaA],
    ]);

    await expect(
      servicio.deSucursal(A2).enTransaccion((ops) => ops.leerCheque('ES-1')),
    ).resolves.toBeNull();
    await expect(
      servicio.deSucursal(A1).enTransaccion((ops) => ops.leerCheque('ES-1')),
    ).resolves.toMatchObject({ id });
  });

  it('el upsert es el ON CONFLICT nativo de Postgres, no un select+insert', async () => {
    queries.length = 0;
    await servicio
      .deSucursal(A1)
      .enTransaccion((ops) => ops.guardarCheque('ES-NATIVO', datosCheque(), [], []));
    const upsert = queries.filter((q) => q.includes('"cheques"') && q.includes('INSERT'));
    expect(upsert).toHaveLength(1);
    expect(upsert[0]).toContain('ON CONFLICT');
  });

  it('guardar otra vez REEMPLAZA partidas y pagos, no los acumula, y conserva el id del cheque', async () => {
    const escritura = servicio.deSucursal(A1);
    const id1 = await escritura.enTransaccion((ops) =>
      ops.guardarCheque(
        'ES-2',
        datosCheque(),
        [partida('a'), partida('b')],
        [pago('60'), pago('40')],
      ),
    );
    const id2 = await escritura.enTransaccion((ops) =>
      ops.guardarCheque('ES-2', datosCheque('30.00'), [partida('c', '30.00')], [pago('30')]),
    );
    expect(id2).toBe(id1);
    const guardado = await escritura.enTransaccion((ops) => ops.leerCheque('ES-2'));
    expect(guardado?.total.toFixed(2)).toBe('30.00');
    expect(guardado?.partidas.map((p) => p.producto)).toEqual(['c']);
    expect(guardado?.pagos.map((p) => p.monto.toFixed(2))).toEqual(['30.00']);
  });

  it('si algo falla dentro de la transacción, no queda NADA: ni cheque nuevo ni partidas cambiadas', async () => {
    const escritura = servicio.deSucursal(A1);
    const desborda = partida('desborda', '1000000000000'); // no cabe en NUMERIC(12,2)

    await expect(
      escritura.enTransaccion((ops) =>
        ops.guardarCheque('ES-ROLLBACK', datosCheque(), [partida('ok'), desborda], []),
      ),
    ).rejects.toThrow();
    await expect(
      escritura.enTransaccion((ops) => ops.leerCheque('ES-ROLLBACK')),
    ).resolves.toBeNull();

    await escritura.enTransaccion((ops) =>
      ops.guardarCheque('ES-ROLLBACK', datosCheque(), [partida('original')], [pago('100')]),
    );
    await expect(
      escritura.enTransaccion((ops) =>
        ops.guardarCheque('ES-ROLLBACK', datosCheque('5.00'), [desborda], []),
      ),
    ).rejects.toThrow();
    const guardado = await escritura.enTransaccion((ops) => ops.leerCheque('ES-ROLLBACK'));
    expect(guardado?.total.toFixed(2)).toBe('100.00');
    expect(guardado?.partidas.map((p) => p.producto)).toEqual(['original']);
    expect(guardado?.pagos).toHaveLength(1);
  });

  it.each([
    ['sucursalId', { sucursalId: FX.sucursalB1 }],
    ['empresaId', { empresaId: FX.empresaB }],
    ['id', { id: FX.inexistente }],
  ])('datos del cheque con %s → Error, sin escribir', async (_c, extra) => {
    const datos = { ...datosCheque(), ...extra } as unknown as DatosCheque;
    await expect(
      servicio.deSucursal(A1).enTransaccion((ops) => ops.guardarCheque('ES-INT', datos, [], [])),
    ).rejects.toThrow(/no pueden traer/);
    expect(await prisma.cheque.count({ where: { folioSr: 'ES-INT' } })).toBe(0);
  });

  it('una partida con chequeId, o un estado con sucursalId → Error', async () => {
    const conCheque = { ...partida('x'), chequeId: FX.inexistente } as unknown as DatosPartida;
    await expect(
      servicio
        .deSucursal(A1)
        .enTransaccion((ops) => ops.guardarCheque('ES-INT2', datosCheque(), [conCheque], [])),
    ).rejects.toThrow(/chequeId/);
    await expect(
      servicio.deSucursal(A1).enTransaccion((ops) =>
        ops.guardarEstado({
          versionAgente: '1',
          versionSr: null,
          ultimaLecturaAt: null,
          ultimoError: null,
          sucursalId: FX.sucursalB1,
        } as never),
      ),
    ).rejects.toThrow(/sucursalId/);
    expect(await prisma.agenteEstado.count({ where: { sucursalId: FX.sucursalB1 } })).toBe(0);
  });

  it.each([undefined, ''])(
    'un filtro vacío (%p) truena en vez de ensancharse a toda la sucursal',
    async (vacio) => {
      const escritura = servicio.deSucursal(A1);
      await expect(
        escritura.enTransaccion((ops) => ops.leerCheque(vacio as unknown as string)),
      ).rejects.toThrow(/folioSr vacío/);
      await expect(
        escritura.enTransaccion((ops) =>
          ops.guardarCheque(vacio as unknown as string, datosCheque(), [], []),
        ),
      ).rejects.toThrow(/folioSr vacío/);
      expect(() =>
        servicio.deSucursal({ sucursalId: vacio as unknown as string, empresaId: FX.empresaA }),
      ).toThrow(/sucursalId vacío/);
      expect(() =>
        servicio.deSucursal({ sucursalId: FX.sucursalA1, empresaId: vacio as unknown as string }),
      ).toThrow(/empresaId vacío/);
    },
  );

  it('purgarSnapshots sólo borra los de SU sucursal, y conserva el último aunque sea viejo', async () => {
    const ahora = new Date('2026-09-20T12:00:00.000Z');
    const hace = (h: number) => new Date(ahora.getTime() - h * 3_600_000);
    await servicio.deSucursal(A2).enTransaccion(async (ops) => {
      await ops.guardarSnapshot(hace(72), { mesas: [] });
    });
    await servicio.deSucursal(A1).enTransaccion(async (ops) => {
      await ops.guardarSnapshot(hace(50), { mesas: [] });
      await ops.guardarSnapshot(hace(30), { mesas: [] });
      await ops.purgarSnapshots(ahora);
    });
    const deA1 = await prisma.mesaSnapshot.findMany({ where: { sucursalId: FX.sucursalA1 } });
    expect(deA1.map((s) => s.capturadoAt.toISOString())).toEqual([hace(30).toISOString()]);
    expect(await prisma.mesaSnapshot.count({ where: { sucursalId: FX.sucursalA2 } })).toBe(1);

    await servicio.deSucursal(A1).enTransaccion(async (ops) => {
      await ops.guardarSnapshot(hace(1), { mesas: [] });
      await ops.guardarSnapshot(hace(2), { mesas: [] });
      expect(await ops.purgarSnapshots(ahora)).toBe(1);
    });
    const quedan = await prisma.mesaSnapshot.findMany({
      where: { sucursalId: FX.sucursalA1 },
      orderBy: { capturadoAt: 'asc' },
    });
    expect(quedan.map((s) => s.capturadoAt.toISOString())).toEqual([
      hace(2).toISOString(),
      hace(1).toISOString(),
    ]);
  });
});
