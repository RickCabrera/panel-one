import { PrismaClient, TipoAlerta } from '@prisma/client';

import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import {
  DIAS_HISTORIA,
  generarAlertasSeed,
  sembrarAlertas,
  uuidDe,
  type OpcionesAlertas,
} from './seed-alertas';

// El seed del historial de alertas (F2-224) contra Postgres real, en las sucursales de
// FIXTURES (empresa A), nunca en las de `SEED_IDS`. Idempotencia con un `ahora` FIJO.

const OPCIONES: OpcionesAlertas = {
  empresaId: FX.empresaA,
  sucursales: [FX.sucursalA1, FX.sucursalA2],
  ahora: new Date('2026-11-15T20:00:00.000Z'),
};

describe('generarAlertasSeed()', () => {
  const filas = generarAlertasSeed(OPCIONES);

  it('es pura: el mismo ahora da exactamente lo mismo', () => {
    expect(generarAlertasSeed(OPCIONES)).toEqual(filas);
  });

  it('14 días, las dos sucursales y los cuatro tipos; todo CERRADO y antes de hoy', () => {
    const dias = new Set(filas.map((f) => f.abiertaAt.toISOString().slice(0, 10)));
    expect(dias.size).toBe(DIAS_HISTORIA);
    expect(new Set(filas.map((f) => f.sucursalId))).toEqual(new Set(OPCIONES.sucursales));
    // Los cuatro tipos de F2-224. `bajo_minimo` (F2-121) NO tiene historial sintético: lo abre la
    // evaluación con las existencias del seed, no se inventa. Tampoco `traspaso_sin_conciliar`
    // (F2-124): la abre la evaluación con los traspasos del seed.
    const sinHistorial: TipoAlerta[] = [TipoAlerta.bajo_minimo, TipoAlerta.traspaso_sin_conciliar];
    expect(new Set(filas.map((f) => f.tipo))).toEqual(
      new Set(Object.values(TipoAlerta).filter((t) => !sinHistorial.includes(t))),
    );
    for (const f of filas) {
      expect(f.cerradaAt.getTime()).toBeGreaterThan(f.abiertaAt.getTime());
      expect(f.cerradaAt.getTime()).toBeLessThan(Date.parse('2026-11-15T00:00:00Z'));
    }
    expect(new Set(filas.map((f) => f.id)).size).toBe(filas.length);
  });

  it('la caída de venta lleva importes y % como texto decimal', () => {
    const caidas = filas.filter((f) => f.tipo === TipoAlerta.caida_venta);
    expect(caidas.length).toBeGreaterThan(0);
    for (const c of caidas) {
      for (const k of ['ventaHoy', 'ventaBase', 'caidaPct']) {
        expect(c.detalle[k]).toMatch(/^\d+\.\d{2}$/);
      }
      expect(c.llave).toBe(c.detalle.dia);
    }
  });

  it('uuidDe tiene forma de UUID v4 y es determinista', () => {
    expect(uuidDe('x')).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(uuidDe('x')).toBe(uuidDe('x'));
  });
});

describe('sembrarAlertas() contra Postgres', () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
  });

  afterAll(async () => {
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('dos corridas con el mismo ahora dejan exactamente las mismas filas', async () => {
    const n = await sembrarAlertas(prisma, OPCIONES);
    const leer = () =>
      prisma.alerta.findMany({ where: { empresaId: FX.empresaA }, orderBy: { id: 'asc' } });
    const primera = await leer();
    expect(primera).toHaveLength(n);
    await sembrarAlertas(prisma, OPCIONES);
    expect(await leer()).toEqual(primera);
    expect(primera.every((f) => f.cerradaAt !== null && f.llaveAbierta === null)).toBe(true);
  });
});
