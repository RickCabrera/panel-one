import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

import type { Auditoria } from '../src/comun/auditoria';
import { TraspasosService } from '../src/inventario/traspasos.service';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import { sembrarCatalogos } from './seed-catalogos';
import { sembrarExistencias } from './seed-existencias';
import { sembrarMovimientos } from './seed-movimientos';
import { ACTOR_SEED_TRASPASOS, NOTA_SEED_TRASPASOS, sembrarTraspasos } from './seed-traspasos';
import { generarVentas, universoDe, type OpcionesVentas } from './seed-ventas';

// El seed de traspasos (F2-124) contra Postgres real, en las sucursales de FIXTURES (empresa A),
// nunca en las del seed de desarrollo. Reloj FIJO. Lo esperado de cada traspaso (qué concilia y
// qué no) está escrito a mano a partir del universo, no leído del conciliador.

const SUCURSALES = [
  { id: FX.sucursalA1, clave: 'A1', zonaHoraria: 'America/Mexico_City' },
  { id: FX.sucursalA2, clave: 'A2', zonaHoraria: 'America/Tijuana' },
];
const opDe = (hoy: string, ahora: Date): OpcionesVentas => ({
  empresaId: FX.empresaA,
  sucursales: SUCURSALES,
  hoy,
  ahora,
});
const RELOJ = new Date('2026-09-15T20:00:00.000Z');
const OTRO_DIA = new Date('2026-09-16T20:00:00.000Z');
const H = 3_600_000;
const universo = universoDe(opDe('2026-09-15', RELOJ), generarVentas(opDe('2026-09-15', RELOJ)));
const universo2 = universoDe(
  opDe('2026-09-16', OTRO_DIA),
  generarVentas(opDe('2026-09-16', OTRO_DIA)),
);
/** Sembrar la ventana completa de pólizas (~1000) tarda. */
const LENTO_MS = 180_000;

describe('sembrarTraspasos() (F2-124)', () => {
  const prisma = new PrismaClient();
  const servicio = (ahora: Date) =>
    new TraspasosService(
      new ScopedPrismaService(prisma as unknown as PrismaService),
      { ahora: () => ahora.getTime() },
      { registrar: () => undefined } as unknown as Auditoria,
    );
  const base = (ahora: Date, u = universo) => ({
    empresaId: FX.empresaA,
    sucursales: SUCURSALES,
    universo: u,
    ahora,
  });
  const todo = async () =>
    JSON.parse(
      JSON.stringify(
        await Promise.all([
          prisma.traspaso.findMany({ where: { empresaId: FX.empresaA }, orderBy: { id: 'asc' } }),
          prisma.partidaTraspaso.findMany({
            where: { empresaId: FX.empresaA },
            orderBy: { id: 'asc' },
          }),
        ]),
      ),
    );
  const lista = async (ahora: Date) =>
    (await servicio(ahora).listar({ tipo: 'global' }, { empresaId: FX.empresaA })).traspasos;

  // El último traspaso de SR del universo (A1-GEN → A2-GEN): lo que el espejo tiene que copiar.
  const ultimoTr = universo.polizas
    .filter((p) => p.sucursalId === FX.sucursalA1 && p.tipo === 'traspaso_salida')
    .sort((a, b) => b.dia.localeCompare(a.dia))[0];

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await sembrarCatalogos(prisma, {
      empresaId: FX.empresaA,
      sucursales: SUCURSALES,
      universo,
      capturadoAt: RELOJ,
    });
    await sembrarMovimientos(prisma, base(RELOJ));
    await sembrarExistencias(prisma, {
      empresaId: FX.empresaA,
      sucursales: SUCURSALES,
      universo,
      capturadoAt: RELOJ,
    });
  }, LENTO_MS);

  afterAll(async () => {
    jest.restoreAllMocks();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('el universo trae al menos un traspaso de SR de A1 a A2 (si no, el espejo no tiene qué copiar)', () => {
    expect(ultimoTr).toBeDefined();
    expect(ultimoTr.movimientos.length).toBe(1);
  });

  it('cuatro traspasos: uno conciliado, dos pendientes y uno en alerta', async () => {
    expect(await sembrarTraspasos(prisma, base(RELOJ))).toEqual({
      creados: 4,
      conservados: 0,
      borrados: 0,
      conciliados: 1,
    });
    const t = await lista(RELOJ);
    const porEnvio = [...t].sort((a, b) => a.enviadoAt.localeCompare(b.enviadoAt));
    // El espejo es el más viejo (el traspaso de SR es de días atrás); luego alerta (−72 h),
    // interno (−5 h) y pendiente (−3 h).
    expect(
      porEnvio.map((x) => [
        x.sucursalId,
        x.almacenOrigenSrId,
        x.sucursalDestinoId,
        x.almacenDestinoSrId,
        x.estado,
        x.conciliacion,
      ]),
    ).toEqual([
      [FX.sucursalA1, 'A1-GEN', FX.sucursalA2, 'A2-GEN', 'recibido', 'conciliado'],
      [FX.sucursalA1, 'A1-GEN', FX.sucursalA2, 'A2-GEN', 'enviado', 'en_alerta'],
      [FX.sucursalA1, 'A1-GEN', FX.sucursalA1, 'A1-BAR', 'recibido', 'pendiente_sr'],
      [FX.sucursalA1, 'A1-GEN', FX.sucursalA2, 'A2-GEN', 'enviado', 'pendiente_sr'],
    ]);
    expect(porEnvio.map((x) => x.enviadoAt).slice(1)).toEqual([
      new Date(RELOJ.getTime() - 72 * H).toISOString(),
      new Date(RELOJ.getTime() - 5 * H).toISOString(),
      new Date(RELOJ.getTime() - 3 * H).toISOString(),
    ]);
    const filas = await prisma.traspaso.findMany({ where: { empresaId: FX.empresaA } });
    expect(filas.every((f) => f.nota === NOTA_SEED_TRASPASOS)).toBe(true);
    expect(filas.every((f) => f.enviadoPor === ACTOR_SEED_TRASPASOS)).toBe(true);
  });

  it('el espejo copia el último traspaso de SR del universo y queda ligado a sus dos pólizas', async () => {
    const t = (await lista(RELOJ)).find((x) => x.conciliacion === 'conciliado')!;
    const d = await servicio(RELOJ).detalle({ tipo: 'global' }, t.id, FX.empresaA);
    const m = ultimoTr.movimientos[0];
    expect(d.partidas).toHaveLength(1);
    expect(d.partidas[0]).toMatchObject({
      insumoOrigenSrId: m.insumo,
      cantidad: m.cantidad.negated().toFixed(3),
    });
    expect(d.partidas[0].salida).toMatchObject({
      folio: ultimoTr.folio,
      referencia: ultimoTr.referencia,
    });
    const entrada = universo.polizas.find(
      (p) => p.tipo === 'traspaso_entrada' && p.referencia === ultimoTr.referencia,
    )!;
    expect(d.partidas[0].entrada).toMatchObject({ folio: entrada.folio });
  });

  it('los demás llevan 1.5 del primer insumo con existencia, al costo de la foto de A1-GEN', async () => {
    const pendiente = (await lista(RELOJ)).find(
      (x) => x.conciliacion === 'pendiente_sr' && x.almacenDestinoSrId === 'A2-GEN',
    )!;
    const d = await servicio(RELOJ).detalle({ tipo: 'global' }, pendiente.id, FX.empresaA);
    const insumo = universo.existencias
      .filter((e) => e.almacen === 'A1-GEN' && e.cantidad.greaterThan(2))
      .sort((a, b) => a.insumo.localeCompare(b.insumo))[0];
    expect(d.partidas[0]).toMatchObject({
      insumoOrigenSrId: insumo.insumo,
      cantidad: '1.500',
      costoUnitario: insumo.costoPromedio.toFixed(2),
      salida: null,
      entrada: null,
    });
  });

  it('idempotente: con el mismo reloj, otra corrida no mueve nada', async () => {
    const antes = await todo();
    expect(await sembrarTraspasos(prisma, base(RELOJ))).toEqual({
      creados: 0,
      conservados: 4,
      borrados: 0,
      conciliados: 0,
    });
    expect(await todo()).toEqual(antes);
  });

  it(
    'otro día: movimientos se re-siembran (sueltan los espejos) y los traspasos se rehacen',
    async () => {
      // La ventana se mueve: pólizas que apuntaba un espejo pueden salir y borrarse (RESTRICT).
      await sembrarMovimientos(prisma, base(OTRO_DIA, universo2));
      await sembrarExistencias(prisma, {
        empresaId: FX.empresaA,
        sucursales: SUCURSALES,
        universo: universo2,
        capturadoAt: OTRO_DIA,
      });
      const r = await sembrarTraspasos(prisma, base(OTRO_DIA, universo2));
      expect(r).toMatchObject({ creados: 4, borrados: 4, conservados: 0 });
      expect((await lista(OTRO_DIA)).map((x) => x.conciliacion).sort()).toEqual([
        'conciliado',
        'en_alerta',
        'pendiente_sr',
        'pendiente_sr',
      ]);
    },
    LENTO_MS,
  );

  it('un traspaso de un usuario (misma nota, otro autor) no se toca', async () => {
    const escritura = new ScopedPrismaService(prisma as unknown as PrismaService).traspasos({
      tipo: 'global',
    });
    const ajeno = await escritura.enviar(
      {
        empresaId: FX.empresaA,
        sucursalOrigenId: FX.sucursalA1,
        almacenOrigenSrId: 'A1-GEN',
        sucursalDestinoId: FX.sucursalA1,
        almacenDestinoSrId: 'A1-BAR',
        nota: NOTA_SEED_TRASPASOS,
        partidas: [
          {
            insumoOrigenSrId: universo2.existencias.find((e) => e.almacen === 'A1-GEN')!.insumo,
            cantidad: new Prisma.Decimal('1'),
          },
        ],
      },
      '00000000-0000-4000-8000-0000000000aa',
      RELOJ,
    );
    await sembrarTraspasos(prisma, base(new Date(OTRO_DIA.getTime() + H), universo2));
    expect(await prisma.traspaso.findUnique({ where: { id: ajeno } })).not.toBeNull();
  });
});
