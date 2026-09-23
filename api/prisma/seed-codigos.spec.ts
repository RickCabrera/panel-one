import { PrismaClient } from '@prisma/client';

import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import {
  CODIGO_EJEMPLO,
  esCodigoValido,
  esFacturable,
  estadoPublico,
  VIGENCIA_DEFAULT,
} from '../src/facturacion/codigo';
import { generarCodigosSeed, type OpcionesCodigos } from './seed-codigos';
import { generarVentas, sembrarVentas, type OpcionesVentas } from './seed-ventas';

// Los códigos de facturación del seed (F2-101): puros y deterministas, y persistidos por
// `sembrarVentas` en las sucursales de FIXTURES (nunca en las de la base de desarrollo).

const VENTAS: OpcionesVentas = {
  empresaId: FX.empresaA,
  sucursales: [
    { id: FX.sucursalA1, clave: 'A1', zonaHoraria: 'America/Mexico_City' },
    { id: FX.sucursalA2, clave: 'A2', zonaHoraria: 'America/Tijuana' },
  ],
  hoy: '2026-11-15',
  ahora: new Date('2026-11-15T20:00:00Z'),
};
const AHORA = VENTAS.ahora!;
const cheques = generarVentas(VENTAS);
const OPCIONES: OpcionesCodigos = {
  zonas: new Map(VENTAS.sucursales.map((s) => [s.id, s.zonaHoraria])),
  vigencia: VIGENCIA_DEFAULT,
  ahora: AHORA,
  ejemplo: { sucursalId: FX.sucursalA1, codigo: CODIGO_EJEMPLO },
};

describe('generarCodigosSeed()', () => {
  const codigos = generarCodigosSeed(cheques, OPCIONES);

  it('un código por cheque facturable (cerrado, no cancelado, total > 0) y ninguno más', () => {
    const facturables = cheques.filter((c) => esFacturable(c));
    expect(facturables.length).toBeGreaterThan(1000);
    expect(facturables.length).toBeLessThan(cheques.length); // hay cancelados en el seed
    expect(codigos.map((c) => c.chequeId).sort()).toEqual(facturables.map((c) => c.id).sort());
  });

  it('todos tienen el formato y son únicos', () => {
    for (const c of codigos) expect(esCodigoValido(c.codigo)).toBe(true);
    expect(new Set(codigos.map((c) => c.codigo)).size).toBe(codigos.length);
    expect(new Set(codigos.map((c) => c.id)).size).toBe(codigos.length);
  });

  it('deterministas: la misma entrada da exactamente lo mismo', () => {
    expect(generarCodigosSeed(cheques, OPCIONES)).toEqual(codigos);
  });

  it(`${CODIGO_EJEMPLO} lo lleva el último cheque facturable VIGENTE de la sucursal pedida, pendiente`, () => {
    const ejemplo = codigos.filter((c) => c.codigo === CODIGO_EJEMPLO);
    expect(ejemplo).toHaveLength(1);
    const [e] = ejemplo;
    expect(e.sucursalId).toBe(FX.sucursalA1);
    const cheque = cheques.find((c) => c.id === e.chequeId)!;
    expect(estadoPublico(e, cheque, AHORA.getTime())).toBe('pendiente');
    const posteriores = codigos.filter(
      (c) =>
        c.sucursalId === FX.sucursalA1 &&
        c.createdAt.getTime() > e.createdAt.getTime() &&
        c.expiraAt.getTime() > AHORA.getTime(),
    );
    expect(posteriores).toEqual([]);
  });

  it('medido con estadoPublico: hay pendientes, facturados y expirados (y ningún en_global)', () => {
    const porEstado = new Map<string, number>();
    for (const c of codigos) {
      const cheque = cheques.find((x) => x.id === c.chequeId)!;
      const e = estadoPublico(c, cheque, AHORA.getTime());
      porEstado.set(e, (porEstado.get(e) ?? 0) + 1);
    }
    expect(porEstado.get('pendiente')).toBeGreaterThan(0);
    expect(porEstado.get('facturado')).toBeGreaterThan(0);
    expect(porEstado.get('expirado')).toBeGreaterThan(0);
    expect(porEstado.get('en_global')).toBeUndefined();
    expect(porEstado.get('cancelado')).toBeUndefined();
    // ~15 % facturados.
    const facturados = (porEstado.get('facturado') ?? 0) / codigos.length;
    expect(facturados).toBeGreaterThan(0.1);
    expect(facturados).toBeLessThan(0.22);
  });

  it('vencen al fin del mes de su cierre en la zona de SU sucursal', () => {
    const tijuana = codigos.find(
      (c) => c.sucursalId === FX.sucursalA2 && c.createdAt.toISOString().startsWith('2026-10-1'),
    )!;
    expect(tijuana.expiraAt.toISOString()).toBe('2026-11-01T07:00:00.000Z');
    const cdmx = codigos.find(
      (c) => c.sucursalId === FX.sucursalA1 && c.createdAt.toISOString().startsWith('2026-10-1'),
    )!;
    expect(cdmx.expiraAt.toISOString()).toBe('2026-11-01T06:00:00.000Z');
  });

  it('si ningún cheque de la sucursal está vigente, TRUENA en vez de sembrar el ejemplo expirado', () => {
    expect(() =>
      generarCodigosSeed(cheques, { ...OPCIONES, ahora: new Date('2027-06-01T00:00:00Z') }),
    ).toThrow(/ningún cheque facturable/);
  });

  it('sin ejemplo, nadie lleva el código de ejemplo', () => {
    const sin = generarCodigosSeed(cheques, { ...OPCIONES, ejemplo: undefined });
    expect(sin.some((c) => c.codigo === CODIGO_EJEMPLO)).toBe(false);
  });
});

describe('sembrarVentas() con códigos (contra Postgres)', () => {
  const prisma = new PrismaClient();
  // Un ejemplo PROPIO de los tests: la unique es global y la base de desarrollo ya puede tener el
  // 7JQRECP3U en la sucursal demo.
  const EJEMPLO_TEST = 'PRUEBAXYZ';
  const OP: OpcionesVentas = {
    ...VENTAS,
    ejemploFacturacion: { sucursalId: FX.sucursalA1, codigo: EJEMPLO_TEST },
  };

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
  });

  afterAll(async () => {
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('persiste un código por cheque facturable; re-sembrar deja las filas IDÉNTICAS', async () => {
    const r = await sembrarVentas(prisma, OP);
    const esperados = generarCodigosSeed(cheques, {
      ...OPCIONES,
      ejemplo: OP.ejemploFacturacion,
    });
    expect(r.codigos).toBe(esperados.length);
    const leer = () =>
      prisma.codigoFacturacion.findMany({
        where: { empresaId: FX.empresaA },
        orderBy: { id: 'asc' },
      });
    const primera = await leer();
    expect(primera).toHaveLength(esperados.length);
    expect(primera.filter((c) => c.codigo === EJEMPLO_TEST)).toHaveLength(1);

    await sembrarVentas(prisma, OP);
    expect(await leer()).toEqual(primera);
  }, 120_000); // 1 500 cheques del seed de 90 días, dos veces
});
