import { Prisma, PrismaClient } from '@prisma/client';

import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import {
  CATALOGO_SEED,
  CHEQUES_POR_SUCURSAL,
  DIAS,
  FORMA_SIN_CATALOGO,
  generarVentas,
  hoyEn,
  instanteLocal,
  sembrarVentas,
  type OpcionesVentas,
} from './seed-ventas';

// El seed de ventas de F1-032 contra Postgres real. Siembra en las sucursales
// de FIXTURES (empresa A), nunca en las de `SEED_IDS`: no pisa la base de
// desarrollo de nadie.

const OPCIONES: OpcionesVentas = {
  empresaId: FX.empresaA,
  sucursales: [
    { id: FX.sucursalA1, clave: 'A1', zonaHoraria: 'America/Mexico_City' },
    { id: FX.sucursalA2, clave: 'A2', zonaHoraria: 'America/Tijuana' },
  ],
  hoy: '2026-11-15',
};

const cero = () => new Prisma.Decimal(0);
const diaLocal = (t: Date, zona: string) => hoyEn(zona, t);

describe('generarVentas()', () => {
  const cheques = generarVentas(OPCIONES);

  it(`son ${2 * CHEQUES_POR_SUCURSAL} cheques: ${CHEQUES_POR_SUCURSAL} por sucursal`, () => {
    expect(cheques).toHaveLength(500);
    for (const s of OPCIONES.sucursales) {
      expect(cheques.filter((c) => c.sucursalId === s.id)).toHaveLength(CHEQUES_POR_SUCURSAL);
    }
  });

  it(`cubren exactamente ${DIAS} días LOCALES de cada sucursal, terminando en "hoy"`, () => {
    for (const s of OPCIONES.sucursales) {
      const dias = new Set(
        cheques
          .filter((c) => c.sucursalId === s.id && c.cerradoAt)
          .map((c) => diaLocal(c.cerradoAt!, s.zonaHoraria)),
      );
      expect(dias.size).toBe(DIAS);
      expect([...dias].sort()[0]).toBe('2026-10-17');
      expect([...dias].sort()[DIAS - 1]).toBe('2026-11-15');
    }
  });

  it('es determinista: misma entrada, mismos cheques; otra semilla, otros', () => {
    expect(generarVentas(OPCIONES)).toEqual(cheques);
    expect(generarVentas({ ...OPCIONES, semilla: 7 })).not.toEqual(cheques);
  });

  it('los ids y folios son únicos', () => {
    const ids = cheques.flatMap((c) => [
      c.id,
      ...c.partidas.map((p) => p.id),
      ...c.pagos.map((p) => p.id),
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(cheques.map((c) => c.folioSr)).size).toBe(cheques.length);
  });

  it('cada cheque cuadra por dentro', () => {
    for (const c of cheques) {
      const bruto = c.partidas.reduce((s, p) => s.plus(p.total), cero());
      expect(bruto.minus(c.descuentos).equals(c.total)).toBe(true);
      expect(c.subtotal.plus(c.impuestos).equals(c.total)).toBe(true);
      for (const v of [c.subtotal, c.impuestos, c.descuentos, c.propina, c.total]) {
        expect(v.decimalPlaces()).toBeLessThanOrEqual(2);
      }
      if (c.cancelado) {
        expect(c.pagos).toEqual([]);
      } else {
        const pagado = c.pagos.reduce((s, p) => s.plus(p.monto), cero());
        expect(pagado.equals(c.total.plus(c.propina))).toBe(true);
        expect(c.cerradoAt).not.toBeNull();
      }
    }
  });

  it('trae la variedad que el panel necesita', () => {
    const vivos = cheques.filter((c) => !c.cancelado);
    const cancelados = cheques.filter((c) => c.cancelado);
    expect(cancelados.length).toBeGreaterThan(0);
    expect(cancelados.some((c) => c.cerradoAt === null)).toBe(true);
    expect(vivos.some((c) => c.descuentos.greaterThan(0))).toBe(true);
    expect(vivos.some((c) => c.comensales === null)).toBe(true);
    expect(vivos.some((c) => c.pagos.length > 1)).toBe(true);
    expect(vivos.some((c) => c.pagos.some((p) => p.formaRaw === FORMA_SIN_CATALOGO))).toBe(true);
    expect(cheques.some((c) => c.partidas.some((p) => !p.cantidad.isInteger()))).toBe(true);
    expect(
      cheques.some((c) => c.partidas.some((p) => p.modificadores.some((m) => m.precio === '0.00'))),
    ).toBe(true);
    const horas = new Set(
      vivos.map((c) =>
        Number(
          new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Mexico_City',
            hour: 'numeric',
            hourCycle: 'h23',
          }).format(c.cerradoAt!),
        ),
      ),
    );
    expect(horas.has(0)).toBe(true); // cierres pasada la medianoche
    expect(horas.size).toBeGreaterThanOrEqual(12);
  });
});

describe('instanteLocal()', () => {
  it('convierte hora de pared a UTC con el desfase de ESE día (horario de Tijuana)', () => {
    // Tijuana: PDT (-7) hasta el 1 de noviembre de 2026, PST (-8) después.
    expect(instanteLocal('2026-10-31', 12 * 3600, 'America/Tijuana').toISOString()).toBe(
      '2026-10-31T19:00:00.000Z',
    );
    expect(instanteLocal('2026-11-02', 12 * 3600, 'America/Tijuana').toISOString()).toBe(
      '2026-11-02T20:00:00.000Z',
    );
    expect(instanteLocal('2026-11-02', 0, 'America/Mexico_City').toISOString()).toBe(
      '2026-11-02T06:00:00.000Z',
    );
  });
});

describe('sembrarVentas() (contra Postgres)', () => {
  const prisma = new PrismaClient();
  const sucursales = { in: [FX.sucursalA1, FX.sucursalA2] };

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
  });

  afterAll(async () => {
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  async function fotografia() {
    const sinFechas = { createdAt: true, updatedAt: true } as const;
    return Promise.all([
      prisma.cheque.findMany({
        where: { sucursalId: sucursales },
        orderBy: { id: 'asc' },
        omit: sinFechas,
      }),
      prisma.chequePartida.findMany({
        where: { cheque: { sucursalId: sucursales } },
        orderBy: { id: 'asc' },
      }),
      prisma.chequePago.findMany({
        where: { cheque: { sucursalId: sucursales } },
        orderBy: { id: 'asc' },
      }),
      prisma.formaPagoCatalogo.findMany({
        where: { empresaId: FX.empresaA },
        orderBy: { formaRaw: 'asc' },
        omit: { ...sinFechas, id: true },
      }),
    ]);
  }

  it('siembra 500 cheques y el catálogo', async () => {
    const r = await sembrarVentas(prisma, OPCIONES);
    expect(r.cheques).toBe(500);
    await expect(prisma.cheque.count({ where: { sucursalId: sucursales } })).resolves.toBe(500);
    await expect(
      prisma.chequePartida.count({ where: { cheque: { sucursalId: sucursales } } }),
    ).resolves.toBe(r.partidas);
    await expect(
      prisma.formaPagoCatalogo.count({ where: { empresaId: FX.empresaA } }),
    ).resolves.toBe(CATALOGO_SEED.length);
  });

  it('es idempotente: tres corridas dejan exactamente los mismos datos, ids incluidos', async () => {
    const antes = await fotografia();
    await sembrarVentas(prisma, OPCIONES);
    await sembrarVentas(prisma, OPCIONES);
    await sembrarVentas(prisma, OPCIONES);
    expect(await fotografia()).toEqual(antes);
  });

  it('lo guardado es lo generado, peso a peso', async () => {
    const generados = generarVentas(OPCIONES);
    const guardados = await prisma.cheque.findMany({
      where: { sucursalId: sucursales },
      include: { partidas: { orderBy: { orden: 'asc' } }, pagos: { orderBy: { id: 'asc' } } },
    });
    const porId = new Map(guardados.map((c) => [c.id, c]));
    for (const g of generados) {
      const c = porId.get(g.id)!;
      expect(c.total.toFixed(2)).toBe(g.total.toFixed(2));
      expect(c.cerradoAt?.toISOString()).toBe(g.cerradoAt?.toISOString());
      expect(c.partidas.map((p) => p.total.toFixed(2))).toEqual(
        g.partidas.map((p) => p.total.toFixed(2)),
      );
      expect(c.pagos.map((p) => p.monto.toFixed(2))).toEqual(
        [...g.pagos].sort((a, b) => (a.id < b.id ? -1 : 1)).map((p) => p.monto.toFixed(2)),
      );
    }
  });

  it('no toca cheques que no sembró', async () => {
    const ajeno = await prisma.cheque.create({
      data: {
        sucursalId: FX.sucursalA1,
        empresaId: FX.empresaA,
        folio: '9',
        folioSr: 'NO-ES-SEED-1',
        abiertoAt: new Date('2026-11-01T18:00:00Z'),
        cerradoAt: new Date('2026-11-01T19:00:00Z'),
        subtotal: '1',
        impuestos: '0',
        descuentos: '0',
        propina: '0',
        total: '1',
      },
    });
    await sembrarVentas(prisma, OPCIONES);
    await expect(prisma.cheque.count({ where: { id: ajeno.id } })).resolves.toBe(1);
    await prisma.cheque.delete({ where: { id: ajeno.id } });
  });
});
