import { randomUUID } from 'node:crypto';

import { Prisma, PrismaClient } from '@prisma/client';

// Tests del esquema de ventas (F1-030) contra un Postgres REAL (DATABASE_URL).
// Sin base, fallan en el beforeAll: no se saltan.
//
// Fixtures propios con UUID `f1030000-…`, independientes del seed: dos empresas
// (X con sucursales X1 y X2, Y con Y1 e Y2). Se borran por esos ids, de las hojas a
// los padres, antes y después. Nada de TRUNCATE ni deleteMany sin where: la
// misma base la usan el seed y los otros tests.

const F = {
  empresaX: 'f1030000-0000-4000-8000-00000000000a',
  empresaY: 'f1030000-0000-4000-8000-00000000000b',
  sucursalX1: 'f1030000-0000-4000-8000-0000000000a1',
  sucursalX2: 'f1030000-0000-4000-8000-0000000000a2',
  sucursalY1: 'f1030000-0000-4000-8000-0000000000b1',
  /** Sin cheques: para probar que un snapshot solo también frena el borrado. */
  sucursalY2: 'f1030000-0000-4000-8000-0000000000b2',
} as const;
const EMPRESAS = [F.empresaX, F.empresaY];

const IMPORTES_CERO = {
  subtotal: '0.00',
  impuestos: '0.00',
  descuentos: '0.00',
  propina: '0.00',
  total: '0.00',
};

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
 * En SQL crudo el error (P2010) trae el mensaje de Postgres con el SQLSTATE y
 * el nombre de la constraint: así se sabe que falló LA esperada y no otra
 * (Prisma 6 no da el nombre de la FK en `meta`; ver esquema.spec.ts).
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

describe('Esquema de ventas (F1-030)', () => {
  const prisma = new PrismaClient();

  async function limpiar(): Promise<void> {
    const deEstas = { where: { empresaId: { in: EMPRESAS } } };
    await prisma.chequePartida.deleteMany(deEstas);
    await prisma.chequePago.deleteMany(deEstas);
    await prisma.cheque.deleteMany(deEstas);
    await prisma.mesaSnapshot.deleteMany(deEstas);
    await prisma.sucursal.deleteMany(deEstas);
    await prisma.empresa.deleteMany({ where: { id: { in: EMPRESAS } } });
  }

  /** Un cheque mínimo válido; `datos` pisa lo que haga falta. */
  function cheque(datos: Partial<Prisma.ChequeUncheckedCreateInput> = {}) {
    return prisma.cheque.create({
      data: {
        sucursalId: F.sucursalX1,
        empresaId: F.empresaX,
        folio: '1',
        folioSr: `sr-${randomUUID()}`,
        abiertoAt: new Date('2026-03-01T18:00:00Z'),
        cerradoAt: new Date('2026-03-01T19:00:00Z'),
        ...IMPORTES_CERO,
        ...datos,
      },
    });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await limpiar();
    await prisma.empresa.createMany({
      data: [
        { id: F.empresaX, nombre: 'Empresa Prueba X (F1-030)' },
        { id: F.empresaY, nombre: 'Empresa Prueba Y (F1-030)' },
      ],
    });
    await prisma.sucursal.createMany({
      data: [
        { id: F.sucursalX1, empresaId: F.empresaX, nombre: 'X1' },
        { id: F.sucursalX2, empresaId: F.empresaX, nombre: 'X2' },
        { id: F.sucursalY1, empresaId: F.empresaY, nombre: 'Y1' },
        { id: F.sucursalY2, empresaId: F.empresaY, nombre: 'Y2' },
      ],
    });
  });

  afterAll(async () => {
    await limpiar();
    await prisma.$disconnect();
  });

  describe('índices', () => {
    async function indice(nombre: string): Promise<string | undefined> {
      const filas = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ${nombre}`;
      return filas[0]?.indexdef;
    }

    it('(sucursal_id, folio_sr) es un índice ÚNICO en cheques', async () => {
      expect(await indice('cheques_sucursal_id_folio_sr_key')).toBe(
        'CREATE UNIQUE INDEX cheques_sucursal_id_folio_sr_key ON public.cheques USING btree (sucursal_id, folio_sr)',
      );
    });

    it('(empresa_id, cerrado_at) existe para los agregados', async () => {
      expect(await indice('cheques_empresa_id_cerrado_at_idx')).toBe(
        'CREATE INDEX cheques_empresa_id_cerrado_at_idx ON public.cheques USING btree (empresa_id, cerrado_at)',
      );
    });

    it.each(['cheques', 'cheque_partidas', 'cheque_pagos', 'mesa_snapshots'])(
      '%s tiene un índice que empieza por empresa_id (helper de scope)',
      async (tabla) => {
        const filas = await prisma.$queryRaw<{ indexdef: string }[]>`
          SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = ${tabla}`;
        expect(filas.some((f) => /USING btree \(empresa_id[,)]/.test(f.indexdef))).toBe(true);
      },
    );
  });

  describe('cheques.(sucursal_id, folio_sr)', () => {
    it('rechaza el mismo folio_sr dos veces en la misma sucursal', async () => {
      await cheque({ folioSr: 'f1030-dup' });
      const err = await esperarCodigo(cheque({ folioSr: 'f1030-dup' }), 'P2002');
      expect(err.meta?.target).toEqual(['sucursal_id', 'folio_sr']);
      await expect(
        prisma.cheque.count({ where: { sucursalId: F.sucursalX1, folioSr: 'f1030-dup' } }),
      ).resolves.toBe(1);
    });

    it('permite el mismo folio_sr en otra sucursal, de la misma empresa o de otra', async () => {
      await cheque({ folioSr: 'f1030-compartido' });
      await cheque({ folioSr: 'f1030-compartido', sucursalId: F.sucursalX2 });
      await cheque({
        folioSr: 'f1030-compartido',
        sucursalId: F.sucursalY1,
        empresaId: F.empresaY,
      });
      await expect(prisma.cheque.count({ where: { folioSr: 'f1030-compartido' } })).resolves.toBe(
        3,
      );
    });
  });

  describe('importes en NUMERIC(12,2)', () => {
    const IMPORTES: [string, string][] = [
      ['cheques', 'subtotal'],
      ['cheques', 'impuestos'],
      ['cheques', 'descuentos'],
      ['cheques', 'propina'],
      ['cheques', 'total'],
      ['cheque_partidas', 'precio_unit'],
      ['cheque_partidas', 'total'],
      ['cheque_pagos', 'monto'],
    ];

    it.each(IMPORTES)('%s.%s es numeric(12,2)', async (tabla, columna) => {
      const filas = await prisma.$queryRaw<
        { data_type: string; numeric_precision: number; numeric_scale: number }[]
      >`SELECT data_type, numeric_precision, numeric_scale FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tabla} AND column_name = ${columna}`;
      expect(filas).toEqual([{ data_type: 'numeric', numeric_precision: 12, numeric_scale: 2 }]);
    });

    it('cheque_partidas.cantidad es numeric(12,3): no es dinero y admite fracciones', async () => {
      const filas = await prisma.$queryRaw<{ numeric_precision: number; numeric_scale: number }[]>`
        SELECT numeric_precision, numeric_scale FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'cheque_partidas'
          AND column_name = 'cantidad'`;
      expect(filas).toEqual([{ numeric_precision: 12, numeric_scale: 3 }]);
    });

    it('un importe hace round-trip exacto como Decimal, sin pasar por float', async () => {
      const c = await cheque({
        subtotal: '9999999999.99',
        impuestos: new Prisma.Decimal('0.1').plus('0.2'),
        total: '1234567890.12',
      });
      const leido = await prisma.cheque.findUniqueOrThrow({ where: { id: c.id } });
      expect(leido.subtotal).toBeInstanceOf(Prisma.Decimal);
      expect(leido.subtotal.toFixed(2)).toBe('9999999999.99');
      // En float, 0.1 + 0.2 = 0.30000000000000004.
      expect(leido.impuestos.toFixed(2)).toBe('0.30');
      expect(leido.impuestos.equals('0.3')).toBe(true);
      expect(leido.total.toFixed(2)).toBe('1234567890.12');
    });

    it('Postgres REDONDEA en silencio a 2 decimales (0.125 → 0.13): fijado a propósito', async () => {
      // SR podría guardar importes con 4 decimales (esquema-sr.md §3). El
      // redondeo por partida puede no sumar lo mismo que el total del cheque:
      // por eso el total se guarda tal como lo reporta SR y nunca se recalcula.
      const c = await cheque({ total: '0.125', descuentos: '0.124' });
      const leido = await prisma.cheque.findUniqueOrThrow({ where: { id: c.id } });
      expect(leido.total.toFixed(2)).toBe('0.13');
      expect(leido.descuentos.toFixed(2)).toBe('0.12');
    });

    it('un importe que no cabe en 12,2 se rechaza, no se trunca', async () => {
      // 22003 = numeric_value_out_of_range. Sólo el SQLSTATE: el texto del
      // mensaje sale en el idioma del servidor (en local, español).
      const err = await esperarCodigo(
        prisma.$executeRaw`INSERT INTO cheques (id, sucursal_id, empresa_id, folio, folio_sr,
            abierto_at, subtotal, impuestos, descuentos, propina, total, updated_at)
          VALUES (${randomUUID()}::uuid, ${F.sucursalX1}::uuid, ${F.empresaX}::uuid, '1',
            'f1030-overflow', now(), 10000000000, 0, 0, 0, 0, now())`,
        'P2010',
      );
      expect(err.message).toContain('22003');
      await expect(prisma.cheque.count({ where: { folioSr: 'f1030-overflow' } })).resolves.toBe(0);
    });
  });

  describe('timestamps en UTC', () => {
    it.each([
      ['cheques', 'abierto_at'],
      ['cheques', 'cerrado_at'],
      ['cheques', 'created_at'],
      ['cheques', 'updated_at'],
      ['mesa_snapshots', 'capturado_at'],
      ['mesa_snapshots', 'recibido_at'],
    ])('%s.%s es timestamptz', async (tabla, columna) => {
      const filas = await prisma.$queryRaw<{ data_type: string }[]>`
        SELECT data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tabla} AND column_name = ${columna}`;
      expect(filas).toEqual([{ data_type: 'timestamp with time zone' }]);
    });

    it('una hora con offset de CDMX se guarda y se lee como el mismo instante en UTC', async () => {
      const folioSr = 'f1030-utc';
      // Por SQL crudo, con el offset explícito: no depende de cómo serialice
      // el cliente, ni de la zona de la sesión.
      await prisma.$executeRaw`INSERT INTO cheques (id, sucursal_id, empresa_id, folio, folio_sr,
          abierto_at, cerrado_at, subtotal, impuestos, descuentos, propina, total, updated_at)
        VALUES (${randomUUID()}::uuid, ${F.sucursalX1}::uuid, ${F.empresaX}::uuid, '1',
          ${folioSr}, '2026-03-01T23:30:00-06:00', '2026-03-02T00:15:00-06:00',
          0, 0, 0, 0, 0, now())`;
      const leido = await prisma.cheque.findFirstOrThrow({ where: { folioSr } });
      expect(leido.abiertoAt.toISOString()).toBe('2026-03-02T05:30:00.000Z');
      expect(leido.cerradoAt?.toISOString()).toBe('2026-03-02T06:15:00.000Z');
    });
  });

  describe('empresa_id atado al padre por FK compuesta', () => {
    it('un cheque no puede decir una empresa que no es la de su sucursal', async () => {
      await esperarCodigo(cheque({ folioSr: 'f1030-cruzado', empresaId: F.empresaY }), 'P2003');
      await esperarConstraintSql(
        prisma.$executeRaw`INSERT INTO cheques (id, sucursal_id, empresa_id, folio, folio_sr,
            abierto_at, subtotal, impuestos, descuentos, propina, total, updated_at)
          VALUES (${randomUUID()}::uuid, ${F.sucursalX1}::uuid, ${F.empresaY}::uuid, '1',
            'f1030-cruzado', now(), 0, 0, 0, 0, 0, now())`,
        '23503',
        'cheques_sucursal_empresa_fkey',
      );
      await expect(prisma.cheque.count({ where: { folioSr: 'f1030-cruzado' } })).resolves.toBe(0);
    });

    it('una partida no puede decir una empresa que no es la de su cheque', async () => {
      const c = await cheque();
      await esperarConstraintSql(
        prisma.$executeRaw`INSERT INTO cheque_partidas (id, cheque_id, empresa_id, orden,
            producto, cantidad, precio_unit, total)
          VALUES (${randomUUID()}::uuid, ${c.id}::uuid, ${F.empresaY}::uuid, 0, 'Café', 1, 1, 1)`,
        '23503',
        'cheque_partidas_cheque_empresa_fkey',
      );
      await expect(prisma.chequePartida.count({ where: { chequeId: c.id } })).resolves.toBe(0);
    });

    it('un pago no puede decir una empresa que no es la de su cheque', async () => {
      const c = await cheque();
      await esperarConstraintSql(
        prisma.$executeRaw`INSERT INTO cheque_pagos (id, cheque_id, empresa_id, forma,
            forma_raw, monto)
          VALUES (${randomUUID()}::uuid, ${c.id}::uuid, ${F.empresaY}::uuid, 'efectivo',
            'EFECTIVO', 1)`,
        '23503',
        'cheque_pagos_cheque_empresa_fkey',
      );
      await expect(prisma.chequePago.count({ where: { chequeId: c.id } })).resolves.toBe(0);
    });

    it('un snapshot no puede decir una empresa que no es la de su sucursal', async () => {
      await esperarConstraintSql(
        prisma.$executeRaw`INSERT INTO mesa_snapshots (id, sucursal_id, empresa_id,
            capturado_at, payload)
          VALUES (${randomUUID()}::uuid, ${F.sucursalX1}::uuid, ${F.empresaY}::uuid, now(),
            '[]'::jsonb)`,
        '23503',
        'mesa_snapshots_sucursal_empresa_fkey',
      );
      await expect(
        prisma.mesaSnapshot.count({ where: { sucursalId: F.sucursalX1, empresaId: F.empresaY } }),
      ).resolves.toBe(0);
    });
  });

  describe('onDelete: Restrict', () => {
    it('no deja borrar un cheque que tiene partidas o pagos', async () => {
      const conPartida = await cheque();
      await prisma.chequePartida.create({
        data: {
          chequeId: conPartida.id,
          empresaId: F.empresaX,
          orden: 0,
          producto: 'Café',
          cantidad: '1',
          precioUnit: '1.00',
          total: '1.00',
        },
      });
      await esperarConstraintSql(
        prisma.$executeRaw`DELETE FROM cheques WHERE id = ${conPartida.id}::uuid`,
        '23503',
        'cheque_partidas_cheque_empresa_fkey',
      );

      const conPago = await cheque();
      await prisma.chequePago.create({
        data: {
          chequeId: conPago.id,
          empresaId: F.empresaX,
          forma: 'efectivo',
          formaRaw: 'EFECTIVO',
          monto: '1.00',
        },
      });
      await esperarConstraintSql(
        prisma.$executeRaw`DELETE FROM cheques WHERE id = ${conPago.id}::uuid`,
        '23503',
        'cheque_pagos_cheque_empresa_fkey',
      );

      await expect(
        prisma.cheque.count({ where: { id: { in: [conPartida.id, conPago.id] } } }),
      ).resolves.toBe(2);
    });

    it('no deja borrar una sucursal que tiene cheques, ni una que sólo tiene snapshots', async () => {
      await cheque({ sucursalId: F.sucursalX2 });
      await esperarConstraintSql(
        prisma.$executeRaw`DELETE FROM sucursales WHERE id = ${F.sucursalX2}::uuid`,
        '23503',
        'cheques_sucursal_empresa_fkey',
      );

      await prisma.mesaSnapshot.create({
        data: {
          sucursalId: F.sucursalY2,
          empresaId: F.empresaY,
          capturadoAt: new Date(),
          payload: [],
        },
      });
      await esperarConstraintSql(
        prisma.$executeRaw`DELETE FROM sucursales WHERE id = ${F.sucursalY2}::uuid`,
        '23503',
        'mesa_snapshots_sucursal_empresa_fkey',
      );

      await expect(
        prisma.sucursal.count({ where: { id: { in: [F.sucursalX2, F.sucursalY2] } } }),
      ).resolves.toBe(2);
    });
  });

  describe('partidas y pagos', () => {
    it('forma de pago sólo acepta efectivo/tarjeta/transferencia/otro', async () => {
      const c = await cheque();
      const err = await esperarCodigo(
        prisma.$executeRaw`INSERT INTO cheque_pagos (id, cheque_id, empresa_id, forma,
            forma_raw, monto)
          VALUES (${randomUUID()}::uuid, ${c.id}::uuid, ${F.empresaX}::uuid, 'cheque_viajero',
            'CHEQUE VIAJERO', 1)`,
        'P2010',
      );
      expect(err.message).toContain('22P02');
      expect(err.message).toContain('forma_pago');
      await expect(prisma.chequePago.count({ where: { chequeId: c.id } })).resolves.toBe(0);
    });

    it('el orden de las partidas es único dentro de un cheque', async () => {
      const c = await cheque();
      const partida = {
        chequeId: c.id,
        empresaId: F.empresaX,
        orden: 0,
        producto: 'Café',
        cantidad: '0.5',
        precioUnit: '10.00',
        total: '5.00',
      };
      const creada = await prisma.chequePartida.create({ data: partida });
      expect(creada.cantidad.toString()).toBe('0.5');
      // Sin modificadores explícitos, la columna queda en lista vacía.
      expect(creada.modificadores).toEqual([]);
      const err = await esperarCodigo(prisma.chequePartida.create({ data: partida }), 'P2002');
      expect(err.meta?.target).toEqual(['cheque_id', 'orden']);
    });

    it('comensales es nulo cuando SR no lo reporta (no se confunde con cero)', async () => {
      const c = await cheque();
      expect(c.comensales).toBeNull();
      expect(c.cancelado).toBe(false);
    });
  });

  describe('mesa_snapshots', () => {
    it('reenviar el mismo (sucursal, capturado_at) no duplica; uno más nuevo convive', async () => {
      const capturadoAt = new Date('2026-03-01T20:00:00Z');
      const base = { sucursalId: F.sucursalX1, empresaId: F.empresaX, payload: [{ mesa: '1' }] };
      await prisma.mesaSnapshot.create({ data: { ...base, capturadoAt } });
      const err = await esperarCodigo(
        prisma.mesaSnapshot.create({ data: { ...base, capturadoAt } }),
        'P2002',
      );
      expect(err.meta?.target).toEqual(['sucursal_id', 'capturado_at']);

      await prisma.mesaSnapshot.create({
        data: { ...base, capturadoAt: new Date('2026-03-01T20:00:20Z') },
      });
      const ultimo = await prisma.mesaSnapshot.findFirstOrThrow({
        where: { sucursalId: F.sucursalX1 },
        orderBy: { capturadoAt: 'desc' },
      });
      expect(ultimo.capturadoAt.toISOString()).toBe('2026-03-01T20:00:20.000Z');
      expect(ultimo.payload).toEqual([{ mesa: '1' }]);
    });
  });
});
