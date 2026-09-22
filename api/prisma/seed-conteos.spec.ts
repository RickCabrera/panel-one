import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import type { Auditoria } from '../src/comun/auditoria';
import { ConteosService } from '../src/inventario/conteos.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../test/fixtures-auth';
import { sembrarCatalogos } from './seed-catalogos';
import { ACTOR_SEED_CONTEOS, NOTA_SEED_CONTEOS, sembrarConteos } from './seed-conteos';
import { sembrarExistencias } from './seed-existencias';
import { generarVentas, universoDe, type OpcionesVentas } from './seed-ventas';

// El seed de conteos físicos (F2-123) contra Postgres real, en las sucursales de FIXTURES
// (empresa A), nunca en las del seed de desarrollo. Reloj FIJO.

const OP: OpcionesVentas = {
  empresaId: FX.empresaA,
  sucursales: [
    { id: FX.sucursalA1, clave: 'A1', zonaHoraria: 'America/Mexico_City' },
    { id: FX.sucursalA2, clave: 'A2', zonaHoraria: 'America/Tijuana' },
  ],
  hoy: '2026-09-15',
};
const RELOJ = new Date('2026-09-15T20:00:00.000Z');
const OTRO_DIA = new Date('2026-09-16T20:00:00.000Z');
const universo = universoDe(OP, generarVentas(OP));

/** "12.345" → 12345 milésimas, sin pasar por float ni por Decimal. */
function milesimas(v: string): bigint {
  const negativo = v.startsWith('-');
  const [ent, dec = ''] = v.replace('-', '').split('.');
  const n = BigInt(ent) * 1000n + BigInt((dec + '000').slice(0, 3));
  return negativo ? -n : n;
}
function centavos(v: string): bigint {
  return milesimas(v) / 10n;
}
/** round(unidades(milésimas) × costo(centavos) / 1000, en centavos), mitad lejos de cero. */
function importeEnCentavos(unidades: bigint, costo: bigint): bigint {
  const bruto = unidades * costo; // en centavos × 1000
  const abs = bruto < 0n ? -bruto : bruto;
  const redondeado = (abs + 500n) / 1000n;
  return bruto < 0n ? -redondeado : redondeado;
}
const aTexto = (c: bigint) => {
  const abs = c < 0n ? -c : c;
  return `${c < 0n ? '-' : ''}${abs / 100n}.${String(abs % 100n).padStart(2, '0')}`;
};

describe('sembrarConteos() (F2-123)', () => {
  const prisma = new PrismaClient();
  const servicio = () =>
    new ConteosService(
      new ScopedPrismaService(prisma as unknown as PrismaService),
      { ahora: () => RELOJ.getTime() },
      { registrar: () => undefined } as unknown as Auditoria,
    );
  const existencias = (capturadoAt: Date) =>
    sembrarExistencias(prisma, {
      empresaId: FX.empresaA,
      sucursales: OP.sucursales,
      universo,
      capturadoAt,
    });
  const sembrar = (ahora: Date) =>
    sembrarConteos(prisma, { empresaId: FX.empresaA, sucursales: OP.sucursales, universo, ahora });
  const todo = async () =>
    JSON.parse(
      JSON.stringify(
        await Promise.all([
          prisma.conteoFisico.findMany({
            where: { empresaId: FX.empresaA },
            orderBy: { id: 'asc' },
          }),
          prisma.partidaConteo.findMany({
            where: { empresaId: FX.empresaA },
            orderBy: { id: 'asc' },
          }),
        ]),
      ),
    );

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await sembrarCatalogos(prisma, {
      empresaId: FX.empresaA,
      sucursales: OP.sucursales,
      universo,
      capturadoAt: RELOJ,
    });
    await existencias(RELOJ);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('por sucursal: uno cerrado en el general y uno en captura en la barra', async () => {
    expect(await sembrar(RELOJ)).toEqual({ creados: 4, conservados: 0, borrados: 0 });
    const conteos = await prisma.conteoFisico.findMany({
      where: { empresaId: FX.empresaA },
      orderBy: [{ sucursalId: 'asc' }, { folio: 'asc' }],
    });
    expect(
      conteos.map((c) => [c.sucursalId, c.folio, c.almacenOrigenSrId, c.estado, c.nota]),
    ).toEqual([
      [FX.sucursalA1, 1, 'A1-GEN', 'cerrado', NOTA_SEED_CONTEOS],
      [FX.sucursalA1, 2, 'A1-BAR', 'en_captura', NOTA_SEED_CONTEOS],
      [FX.sucursalA2, 1, 'A2-GEN', 'cerrado', NOTA_SEED_CONTEOS],
      [FX.sucursalA2, 2, 'A2-BAR', 'en_captura', NOTA_SEED_CONTEOS],
    ]);
    expect(conteos.every((c) => c.creadoPor === ACTOR_SEED_CONTEOS)).toBe(true);
    expect(conteos.every((c) => c.teoricoCapturadoAt.getTime() === RELOJ.getTime())).toBe(true);
  });

  it('el teórico de cada renglón es la existencia sembrada, fila por fila', async () => {
    const conteos = await prisma.conteoFisico.findMany({
      where: { empresaId: FX.empresaA },
      include: { partidas: true },
    });
    let conFoto = 0;
    for (const c of conteos) {
      const delAlmacen = universo.existencias.filter((e) => e.almacen === c.almacenOrigenSrId);
      for (const e of delAlmacen) {
        const p = c.partidas.find((x) => x.insumoOrigenSrId === e.insumo);
        expect([e.insumo, p?.teorico?.toFixed(3)]).toEqual([e.insumo, e.cantidad.toFixed(3)]);
        expect(p!.costoPromedio!.toFixed(2)).toBe(e.costoPromedio.toFixed(2));
        conFoto++;
      }
      // Lo que no viene en la foto de ESE almacén va sin teórico, nunca 0.
      for (const p of c.partidas.filter(
        (x) => !delAlmacen.some((e) => e.insumo === x.insumoOrigenSrId),
      )) {
        expect(p.teorico).toBeNull();
      }
    }
    expect(conFoto).toBe(universo.existencias.length);
  });

  it('el reporte cuadra: cada renglón y los totales, recalculados aparte con enteros', async () => {
    const conteos = await prisma.conteoFisico.findMany({ where: { empresaId: FX.empresaA } });
    for (const c of conteos) {
      const d = await servicio().detalle({ tipo: 'global' }, c.id, FX.empresaA);
      let faltante = 0n;
      let sobrante = 0n;
      for (const p of d.partidas) {
        if (p.contado === null || p.teorico === null) {
          expect(p.importe).toBeNull();
          continue;
        }
        const unidades = milesimas(p.contado) - milesimas(p.teorico);
        const importe = importeEnCentavos(unidades, centavos(p.costoPromedio!));
        expect([p.insumoOrigenSrId, p.importe]).toEqual([p.insumoOrigenSrId, aTexto(importe)]);
        if (importe < 0n) faltante += importe;
        else sobrante += importe;
      }
      expect(d.totales.faltante).toBe(aTexto(faltante));
      expect(d.totales.sobrante).toBe(aTexto(sobrante));
      expect(d.totales.neto).toBe(aTexto(faltante + sobrante));
      // No es una pantalla de ejemplo vacía: hay diferencias y renglones sin contar.
      expect(d.totales.conDiferencia).toBeGreaterThan(0);
      expect(d.totales.sinContar).toBeGreaterThan(0);
      expect(d.totales.contados).toBeGreaterThan(0);
    }
  });

  it('idempotente: con la misma foto, N corridas no mueven nada (ni ids)', async () => {
    const antes = await todo();
    expect(await sembrar(RELOJ)).toEqual({ creados: 0, conservados: 4, borrados: 0 });
    await sembrar(RELOJ);
    expect(await todo()).toEqual(antes);
  });

  it('otro día (otra foto): rehace SÓLO los del seed; el conteo de un usuario no se toca', async () => {
    const delUsuario = await new ScopedPrismaService(prisma as unknown as PrismaService)
      .conteos({ tipo: 'global' })
      .crear(
        {
          empresaId: FX.empresaA,
          sucursalId: FX.sucursalA1,
          almacenOrigenSrId: 'A1-GEN',
          grupoOrigenSrId: null,
          nota: 'Conteo de un usuario',
        },
        USUARIOS.adminEmpresaA.id,
        RELOJ,
      );
    const antes = await prisma.conteoFisico.findUniqueOrThrow({
      where: { id: delUsuario },
      include: { partidas: { orderBy: { id: 'asc' } } },
    });
    await existencias(OTRO_DIA);
    expect(await sembrar(OTRO_DIA)).toEqual({ creados: 4, conservados: 0, borrados: 4 });
    const seed = await prisma.conteoFisico.findMany({
      where: { empresaId: FX.empresaA, nota: NOTA_SEED_CONTEOS },
    });
    expect(seed).toHaveLength(4);
    expect(seed.every((c) => c.teoricoCapturadoAt.getTime() === OTRO_DIA.getTime())).toBe(true);
    expect(
      await prisma.conteoFisico.findUniqueOrThrow({
        where: { id: delUsuario },
        include: { partidas: { orderBy: { id: 'asc' } } },
      }),
    ).toEqual(antes);
    // Los folios del seed no chocan con el del usuario: siguen la misma regla máximo + 1.
    const folios = await prisma.conteoFisico.findMany({
      where: { sucursalId: FX.sucursalA1 },
      select: { folio: true },
    });
    expect(new Set(folios.map((f) => f.folio)).size).toBe(folios.length);
  });
});
