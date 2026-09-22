import { BadRequestException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import { crearFixtures, FX, limpiarFixtures } from '../../test/fixtures-auth';
import type { PrismaService } from '../prisma/prisma.service';
import {
  ConsultaVentas,
  CTES_VENTAS,
  guardiaCuerpo,
  MAX_DIAS_RANGO,
  tablasReales,
  validarFiltro,
  type FiltroVentas,
} from './consulta-ventas';
import type { EmpresaScope } from './empresa-scope';
import { ScopedPrismaService } from './scoped-prisma.service';

// El SQL crudo de los agregados (F1-032) pasa por el helper de scope: el caller
// sólo lee de CTEs ya filtradas, y la guardia rechaza lo que intente salirse.

const sql = (texto: string) => Prisma.sql([texto]);

describe('guardiaCuerpo()', () => {
  it('conoce TODAS las tablas del datamodel, no una lista escrita a mano', () => {
    const modelos = Prisma.dmmf.datamodel.models.map((m) => m.dbName ?? m.name);
    expect(modelos.length).toBeGreaterThanOrEqual(9);
    expect(tablasReales()).toEqual(expect.arrayContaining([...modelos, '_prisma_migrations']));
  });

  it.each(tablasReales())('rechaza leer la tabla real %s', (tabla) => {
    expect(() => guardiaCuerpo(sql(`SELECT count(*) FROM ${tabla}`))).toThrow(/tabla real/);
    // También en mayúsculas y en cualquier posición, no sólo tras FROM.
    expect(() =>
      guardiaCuerpo(sql(`SELECT (SELECT 1 FROM ventas, ${tabla.toUpperCase()} x) FROM ventas`)),
    ).toThrow(/tabla real/);
  });

  it.each(CTES_VENTAS)('deja leer la CTE %s', (cte) => {
    expect(() => guardiaCuerpo(sql(`SELECT count(*) FROM ${cte} x`))).not.toThrow();
  });

  it('no confunde una CTE con la tabla cuyo nombre contiene (sucursales_alcance ≠ sucursales)', () => {
    expect(() =>
      guardiaCuerpo(
        sql('SELECT s.nombre FROM sucursales_alcance s LEFT JOIN ventas v ON v.sucursal_id = s.id'),
      ),
    ).not.toThrow();
  });

  it.each([
    ['comillas', 'SELECT * FROM "ventas"'],
    ['escape unicode', 'SELECT * FROM U&"\\0063heques"'],
    ['esquema public', 'SELECT * FROM ventas v WHERE v.id IN (SELECT id FROM public.otra)'],
    ['pg_catalog', 'SELECT * FROM pg_catalog.pg_tables'],
    ['information_schema', 'SELECT * FROM information_schema.tables'],
    ['catálogo pg_', 'SELECT * FROM pg_stat_activity'],
    ['dos sentencias', 'SELECT 1 FROM ventas; SELECT 2'],
    ['comentario de línea', 'SELECT 1 FROM ventas -- x'],
    ['comentario de bloque', 'SELECT 1 FROM ventas /* x */'],
    ['tabla desconocida tras FROM', 'SELECT * FROM tabla_nueva_de_f1_060'],
    ['tabla desconocida tras JOIN', 'SELECT * FROM ventas v JOIN otra_cosa o ON true'],
    ['función arbitraria tras FROM', "SELECT * FROM dblink('x', 'y')"],
  ])('rechaza %s', (_caso, texto) => {
    expect(() => guardiaCuerpo(sql(texto))).toThrow(/rechazada por el helper de scope/);
  });

  it('mira el texto, no los valores (que viajan como parámetros)', () => {
    expect(() =>
      guardiaCuerpo(Prisma.sql`SELECT count(*) FROM ventas WHERE sucursal_id::text = ${'cheques'}`),
    ).not.toThrow();
  });

  it('deja subconsultas y generate_series', () => {
    expect(() =>
      guardiaCuerpo(
        sql(
          'SELECT h, (SELECT count(*) FROM cancelados) FROM generate_series(0, 23) h LEFT JOIN (SELECT 1 FROM ventas) x ON true',
        ),
      ),
    ).not.toThrow();
  });
});

describe('validarFiltro()', () => {
  const ok: FiltroVentas = { empresaId: FX.empresaA, desde: '2026-11-01', hasta: '2026-11-30' };

  it('acepta un filtro bien formado', () => {
    expect(() => validarFiltro(ok)).not.toThrow();
    expect(() => validarFiltro({ ...ok, sucursalId: FX.sucursalA1 })).not.toThrow();
  });

  it.each([
    ['empresaId no UUID', { empresaId: '123' }],
    ['sucursalId no UUID', { sucursalId: 'x' }],
    ['desde con otro formato', { desde: '01/11/2026' }],
    ['día que no existe', { desde: '2026-02-30' }],
    ['mes 13', { hasta: '2026-13-01' }],
    ['desde posterior a hasta', { desde: '2026-12-01', hasta: '2026-11-30' }],
    ['rango mayor al máximo', { desde: '2025-01-01', hasta: '2026-01-02' }],
  ])('rechaza con 400: %s', (_caso, cambio) => {
    expect(() => validarFiltro({ ...ok, ...cambio } as FiltroVentas)).toThrow(BadRequestException);
  });

  it(`acepta exactamente ${MAX_DIAS_RANGO} días y un solo día`, () => {
    expect(() => validarFiltro({ ...ok, desde: '2024-01-01', hasta: '2024-12-31' })).not.toThrow();
    expect(() => validarFiltro({ ...ok, desde: '2026-11-05', hasta: '2026-11-05' })).not.toThrow();
  });
});

describe('alturaAl (F2-220)', () => {
  const ok: FiltroVentas = { empresaId: FX.empresaA, desde: '2026-11-01', hasta: '2026-11-30' };
  const A: EmpresaScope = { tipo: 'empresa', empresaId: FX.empresaA };

  /** El SQL completo que mandaría el helper, sin ejecutarlo. */
  async function sqlDe(filtro: FiltroVentas): Promise<Prisma.Sql> {
    let capturado: Prisma.Sql | undefined;
    const consulta = new ConsultaVentas(
      (armado) => {
        capturado = armado;
        return Promise.resolve([]);
      },
      A,
      filtro,
    );
    await consulta.consultar(sql('SELECT 1 FROM ventas'));
    return capturado!;
  }

  it.each([
    ['UTC con Z', '2026-11-15T20:30:00Z'],
    ['con milisegundos', '2026-11-15T20:30:00.000Z'],
    ['con offset', '2026-11-15T14:30:00-06:00'],
    ['offset +14', '2026-11-15T14:30:00+14:00'],
  ])('acepta un instante con zona: %s', (_caso, alturaAl) => {
    expect(() => validarFiltro({ ...ok, alturaAl })).not.toThrow();
  });

  it.each([
    ['sin zona', '2026-11-15T20:30:00'],
    ['sólo la hora', '14:30'],
    ['sólo el día', '2026-11-15'],
    ['día que no existe (la regex sí lo acepta)', '2026-02-30T12:00:00Z'],
    ['hora 24', '2026-11-15T24:00:00Z'],
    ['minuto 60', '2026-11-15T20:60:00Z'],
    ['offset imposible', '2026-11-15T20:30:00+15:00'],
    ['basura', 'ayer'],
    ['vacío', ''],
  ])('rechaza con 400: %s', (_caso, alturaAl) => {
    expect(() => validarFiltro({ ...ok, alturaAl })).toThrow(BadRequestException);
  });

  it('sin alturaAl, el SQL es byte a byte el de antes de F2-220', async () => {
    const armado = await sqlDe(ok);
    expect(armado.sql).toMatchSnapshot();
    expect(armado.values).toMatchSnapshot();
  });

  it('con alturaAl, el instante viaja como parámetro y sólo cambia el fin del último día', async () => {
    const alturaAl = '2026-11-15T20:30:00Z';
    const sin = await sqlDe(ok);
    const con = await sqlDe({ ...ok, alturaAl });
    expect(con.sql).not.toContain(alturaAl);
    expect(con.values).toContain(alturaAl);
    expect(con.sql).toContain('::timestamptz AT TIME ZONE s.zona_horaria)::time)::timestamp');
    expect(sin.sql).not.toContain('::timestamptz AT TIME ZONE s.zona_horaria)::time');
  });
});

describe('ScopedPrismaService.ventas() (contra Postgres)', () => {
  const prisma = new PrismaClient();
  const servicio = new ScopedPrismaService(prisma as unknown as PrismaService);
  const A: EmpresaScope = { tipo: 'empresa', empresaId: FX.empresaA };
  const GLOBAL: EmpresaScope = { tipo: 'global' };

  const cierre = new Date('2026-11-10T20:00:00Z');
  const base = {
    abiertoAt: cierre,
    cerradoAt: cierre,
    subtotal: '86.21',
    impuestos: '13.79',
    descuentos: '0',
    propina: '0',
    total: '100.00',
  };

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.cheque.createMany({
      data: [
        {
          ...base,
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          folio: '1',
          folioSr: 'CV-A1',
        },
        {
          ...base,
          sucursalId: FX.sucursalA2,
          empresaId: FX.empresaA,
          folio: '2',
          folioSr: 'CV-A2',
        },
        {
          ...base,
          sucursalId: FX.sucursalB1,
          empresaId: FX.empresaB,
          folio: '3',
          folioSr: 'CV-B1',
        },
        // Para la CTE `tickets` (F1-033): cancelados con y sin cierre, uno
        // cancelado que se abrió ese día pero se cerró otro, y uno abierto.
        {
          ...base,
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          folio: '4',
          folioSr: 'CV-A1-CANCELADO',
          cancelado: true,
        },
        {
          ...base,
          cerradoAt: null,
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          folio: '5',
          folioSr: 'CV-A1-CANCELADO-SIN-CIERRE',
          cancelado: true,
        },
        {
          ...base,
          cerradoAt: new Date('2026-11-12T20:00:00Z'),
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          folio: '6',
          folioSr: 'CV-A1-CANCELADO-OTRO-DIA',
          cancelado: true,
        },
        {
          ...base,
          cerradoAt: null,
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          folio: '7',
          folioSr: 'CV-A1-ABIERTO',
        },
      ],
    });
  });

  afterAll(async () => {
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  const dia = { desde: '2026-11-10', hasta: '2026-11-10' };
  const folios = async (scope: EmpresaScope, filtro: FiltroVentas) => {
    const filas = await servicio
      .ventas(scope, filtro)
      .consultar<{ id: string }>(Prisma.sql`SELECT id FROM ventas`);
    const ids = filas.map((f) => f.id);
    const guardados = await prisma.cheque.findMany({ where: { id: { in: ids } } });
    return guardados.map((c) => c.folioSr).sort();
  };

  it('el visor de A ve los cheques de su empresa', async () => {
    await expect(folios(A, { empresaId: FX.empresaA, ...dia })).resolves.toEqual([
      'CV-A1',
      'CV-A2',
    ]);
  });

  it('las CTEs filtran por tenant aunque se pida la empresa de otro: vacío, no datos ajenos', async () => {
    await expect(folios(A, { empresaId: FX.empresaB, ...dia })).resolves.toEqual([]);
    await expect(
      folios(A, { empresaId: FX.empresaA, sucursalId: FX.sucursalB1, ...dia }),
    ).resolves.toEqual([]);
    const sucursales = await servicio
      .ventas(A, { empresaId: FX.empresaB, ...dia })
      .consultar<{ id: string }>(Prisma.sql`SELECT id FROM sucursales_alcance`);
    expect(sucursales).toEqual([]);
  });

  it('admin_global ve la empresa que pide, y sólo ésa', async () => {
    await expect(folios(GLOBAL, { empresaId: FX.empresaB, ...dia })).resolves.toEqual(['CV-B1']);
    await expect(folios(GLOBAL, { empresaId: FX.empresaA, ...dia })).resolves.toEqual([
      'CV-A1',
      'CV-A2',
    ]);
  });

  it('sucursalId acota a esa sucursal', async () => {
    await expect(
      folios(A, { empresaId: FX.empresaA, sucursalId: FX.sucursalA2, ...dia }),
    ).resolves.toEqual(['CV-A2']);
  });

  it('tickets (F1-033) = ventas ∪ cancelados, con su momento y su flag; nada abierto ni ajeno', async () => {
    const q = () => servicio.ventas(A, { empresaId: FX.empresaA, ...dia });
    const tickets = await q().consultar<{ id: string; momento: Date; cancelado: boolean }>(
      Prisma.sql`SELECT id, momento, cancelado FROM tickets`,
    );
    const union = await q().consultar<{ id: string }>(
      Prisma.sql`SELECT id FROM ventas UNION ALL SELECT id FROM cancelados`,
    );
    expect(tickets.map((t) => t.id).sort()).toEqual(union.map((u) => u.id).sort());
    const guardados = await prisma.cheque.findMany({
      where: { id: { in: tickets.map((t) => t.id) } },
    });
    const porFolio = Object.fromEntries(
      tickets.map((t) => [guardados.find((g) => g.id === t.id)!.folioSr, t]),
    );
    expect(Object.keys(porFolio).sort()).toEqual([
      'CV-A1',
      'CV-A1-CANCELADO',
      'CV-A1-CANCELADO-SIN-CIERRE',
      'CV-A2',
    ]);
    expect(porFolio['CV-A1'].cancelado).toBe(false);
    expect(porFolio['CV-A1-CANCELADO'].cancelado).toBe(true);
    // Sin cierre, el cancelado se ubica por su apertura.
    expect(porFolio['CV-A1-CANCELADO-SIN-CIERRE'].momento).toEqual(cierre);
    // Para B, desde el scope de A: vacío.
    await expect(
      servicio
        .ventas(A, { empresaId: FX.empresaB, ...dia })
        .consultar(Prisma.sql`SELECT id FROM tickets`),
    ).resolves.toEqual([]);
  });

  it('recibido_at (F2-203) es created_at del cheque, en las dos ramas de tickets', async () => {
    const q = () => servicio.ventas(A, { empresaId: FX.empresaA, ...dia });
    const tickets = await q().consultar<{ id: string; cancelado: boolean; recibido_at: Date }>(
      Prisma.sql`SELECT id, cancelado, recibido_at FROM tickets`,
    );
    const guardados = await prisma.cheque.findMany({
      where: { id: { in: tickets.map((t) => t.id) } },
      select: { id: true, createdAt: true },
    });
    const creado = new Map(guardados.map((g) => [g.id, g.createdAt.getTime()]));
    // Una fila de cada rama del UNION: si la columna quedara en otra posición en
    // alguna, aquí saldría el `momento` o un booleano, no el created_at.
    expect(tickets.some((t) => t.cancelado)).toBe(true);
    expect(tickets.some((t) => !t.cancelado)).toBe(true);
    for (const t of tickets) {
      expect(t.recibido_at).toBeInstanceOf(Date);
      expect(t.recibido_at.getTime()).toBe(creado.get(t.id));
    }
    const [v] = await q().consultar<{ n: number }>(
      Prisma.sql`SELECT count(*)::int AS n FROM ventas WHERE recibido_at IS NULL`,
    );
    expect(v.n).toBe(0);
  });

  it('valida el filtro antes de consultar', () => {
    expect(() => servicio.ventas(A, { empresaId: 'no-uuid', ...dia })).toThrow(BadRequestException);
  });

  it('la guardia corre antes de mandar el SQL', async () => {
    await expect(
      servicio
        .ventas(A, { empresaId: FX.empresaA, ...dia })
        .consultar(sql('SELECT * FROM cheques')),
    ).rejects.toThrow(/tabla real/);
  });

  it('corre con statement_timeout corto', async () => {
    const [f] = await servicio
      .ventas(A, { empresaId: FX.empresaA, ...dia })
      .consultar<{ t: string }>(sql("SELECT current_setting('statement_timeout') AS t"));
    expect(f.t).toBe('5s');
    // Y no se queda pegado a la conexión: fuera de la transacción vuelve al default.
    const [fuera] = await prisma.$queryRaw<
      Array<{ t: string }>
    >`SELECT current_setting('statement_timeout') AS t`;
    expect(fuera.t).not.toBe('5s');
  });
});
