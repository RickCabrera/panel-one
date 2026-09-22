import type { INestApplication } from '@nestjs/common';
import { NotFoundException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  MotivoCierreAlerta,
  Prisma,
  PrismaClient,
  SeveridadAlerta,
  TipoAlerta,
} from '@prisma/client';
import request from 'supertest';

import { generarSnapshots, type MesaSeed } from '../../prisma/seed-mesas';
import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { AlertasService } from './alertas.service';

// E2E del centro de alertas (F2-224) sobre la app REAL contra Postgres REAL, con reloj fijo.
//
// Mesas: los snapshots SON los del seed (`generarSnapshots`): A1 "en vivo" (60 mesas, capturado
// y recibido = T0) y A2 "desconectada" (último snapshot hace 2 h). Las cuentas que deben alertar
// se sacan del propio payload con la regla del web escrita aquí a mano (minutos enteros desde
// `abiertoAt` hasta la captura), no con el código bajo prueba.
//
// Venta (A1, CDMX): T0 = martes 22-sep-2026 14:00 CDMX (20:00Z). Base = martes 15 a la misma
// altura: 5 cuentas de 100.00 cerradas a las 11:00 local (entran) + 1 de 100.00 a las 15:00
// (NO entra: después de las 14:00). Hoy: 1 cuenta de 100.00 a las 12:00. Caída = (500 − 100) /
// 500 = 80.00 % > 30 %.

const T0 = Date.parse('2026-09-22T20:00:00Z');

class RelojFijo extends Reloj {
  t = T0;
  override ahora(): number {
    return this.t;
  }
}

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

/** Minutos enteros de cada cuenta del seed al capturar (la regla del web, a mano). */
function minutosSeed(m: MesaSeed, capturadoMs: number): number {
  return Math.floor((capturadoMs - Date.parse(m.abiertoAt)) / 60_000);
}

describe('Centro de alertas (e2e, F2-224)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojFijo();
  let app: INestApplication;
  let servicio: AlertasService;
  let mesasVivas: MesaSeed[];

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const get = async (ruta: string, u: Usuario = USUARIOS.visorA) =>
    request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${await token(u)}`);
  const put = async (tipo: string, body: object, u: Usuario = USUARIOS.adminEmpresaA) =>
    request(app.getHttpServer())
      .put(`/alertas/reglas/${tipo}`)
      .set('Authorization', `Bearer ${await token(u)}`)
      .send(body);

  const abiertasDe = (tipo: TipoAlerta) =>
    prisma.alerta.findMany({
      where: { empresaId: FX.empresaA, tipo, cerradaAt: null },
      orderBy: { llave: 'asc' },
    });
  const esperadasMesa = (umbral: number, capturadoMs = T0) =>
    mesasVivas
      .filter((m) => minutosSeed(m, capturadoMs) > umbral)
      .map((m) => m.folio)
      .sort();

  async function evaluar(): Promise<void> {
    await servicio.evaluarEmpresa(FX.empresaA);
  }

  async function cheque(folio: string, cerrado: string, total = '100.00') {
    await prisma.cheque.create({
      data: {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        folio,
        folioSr: `ALR-${folio}`,
        abiertoAt: new Date(Date.parse(cerrado) - 30 * 60_000),
        cerradoAt: new Date(cerrado),
        subtotal: total,
        impuestos: '0',
        descuentos: '0',
        propina: '0',
        total,
      },
    });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.updateMany({
      where: { id: { in: [FX.sucursalA1, FX.sucursalA2] } },
      data: { zonaHoraria: 'America/Mexico_City' },
    });
    const snaps = generarSnapshots({
      empresaId: FX.empresaA,
      sucursales: [FX.sucursalA1, FX.sucursalA2],
      ahora: new Date(T0),
    });
    mesasVivas = snaps[0].payload.mesas;
    await prisma.mesaSnapshot.createMany({
      data: snaps.map((s) => ({ ...s, payload: s.payload as unknown as Prisma.InputJsonValue })),
    });
    for (let i = 0; i < 5; i++) await cheque(`B${i}`, '2026-09-15T17:00:00Z');
    await cheque('B-TARDE', '2026-09-15T21:00:00Z');
    await cheque('HOY', '2026-09-22T18:00:00Z');

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.init();
    servicio = app.get(AlertasService);
  });

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('el seed de mesas deja cuentas de más de 60 min en la sucursal en vivo', () => {
    expect(esperadasMesa(60).length).toBeGreaterThan(0);
  });

  it('evaluar abre lo que el seed amerita, y evaluarlo 3 veces deja las MISMAS filas', async () => {
    await evaluar();
    const primero = await prisma.alerta.findMany({
      where: { empresaId: FX.empresaA },
      orderBy: { id: 'asc' },
    });
    await evaluar();
    await evaluar();
    const despues = await prisma.alerta.findMany({
      where: { empresaId: FX.empresaA },
      orderBy: { id: 'asc' },
    });
    expect(despues).toEqual(primero);

    const mesa = await abiertasDe(TipoAlerta.mesa_abierta);
    expect(mesa.map((a) => a.llave)).toEqual(esperadasMesa(60));
    expect(mesa.every((a) => a.sucursalId === FX.sucursalA1 && a.umbral === 60)).toBe(true);

    const sinImprimir = await abiertasDe(TipoAlerta.cuenta_sin_imprimir);
    expect(sinImprimir.map((a) => a.llave)).toEqual(
      mesasVivas
        .filter((m) => !m.impreso && minutosSeed(m, T0) > 30)
        .map((m) => m.folio)
        .sort(),
    );

    const sinReporte = await abiertasDe(TipoAlerta.sucursal_sin_reporte);
    expect(sinReporte).toHaveLength(1);
    expect(sinReporte[0]).toMatchObject({
      sucursalId: FX.sucursalA2,
      severidad: SeveridadAlerta.critica,
      detalle: { nunca: false, edadSegundos: 7200 },
    });
  });

  it('caída de venta: base cortada a la misma altura, importes y % como TEXTO en Postgres', async () => {
    const [caida] = await abiertasDe(TipoAlerta.caida_venta);
    expect(caida).toMatchObject({
      sucursalId: FX.sucursalA1,
      llave: '2026-09-22',
      umbral: 30,
      detalle: {
        dia: '2026-09-22',
        ventaHoy: '100.00',
        ventaBase: '500.00',
        cuentasBase: 5,
        caidaPct: '80.00',
      },
    });
    const tipos = await prisma.$queryRaw<Array<{ hoy: string; base: string; pct: string }>>`
      SELECT jsonb_typeof(detalle->'ventaHoy') AS hoy, jsonb_typeof(detalle->'ventaBase') AS base,
             jsonb_typeof(detalle->'caidaPct') AS pct
      FROM alertas WHERE id = ${caida.id}::uuid`;
    expect(tipos).toEqual([{ hoy: 'string', base: 'string', pct: 'string' }]);
  });

  it('AC1: la cuenta sale del snapshot → la MISMA fila se cierra con sus dos marcas (no dos filas)', async () => {
    const [objetivo] = esperadasMesa(60);
    const antes = await prisma.alerta.findFirstOrThrow({
      where: { empresaId: FX.empresaA, tipo: TipoAlerta.mesa_abierta, llave: objetivo },
    });
    reloj.t = T0 + 30_000;
    const nuevo = new Date(reloj.t);
    await prisma.mesaSnapshot.create({
      data: {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        capturadoAt: nuevo,
        recibidoAt: nuevo,
        payload: {
          origen: 'e2e',
          mesas: mesasVivas.filter((m) => m.folio !== objetivo),
        } as unknown as Prisma.InputJsonValue,
      },
    });
    await evaluar();
    const filas = await prisma.alerta.findMany({
      where: { empresaId: FX.empresaA, tipo: TipoAlerta.mesa_abierta, llave: objetivo },
    });
    expect(filas).toHaveLength(1);
    expect(filas[0].id).toBe(antes.id);
    expect(filas[0].abiertaAt.getTime()).toBe(T0);
    expect(filas[0].cerradaAt?.getTime()).toBe(T0 + 30_000);
    expect(filas[0].motivoCierre).toBe(MotivoCierreAlerta.condicion);
    expect(filas[0].llaveAbierta).toBeNull();

    // El panel lo ve igual: fuera de las abiertas, en el historial con las dos marcas.
    const abiertas = await get(`/alertas/abiertas?empresaId=${FX.empresaA}`);
    expect(abiertas.status).toBe(200);
    expect(abiertas.body.map((a: { id: string }) => a.id)).not.toContain(antes.id);
    const hist = await get(`/alertas/historial?empresaId=${FX.empresaA}`);
    const enHist = hist.body.filas.filter((a: { id: string }) => a.id === antes.id);
    expect(enHist).toEqual([
      expect.objectContaining({
        abiertaAt: new Date(T0).toISOString(),
        cerradaAt: new Date(T0 + 30_000).toISOString(),
        motivoCierre: 'condicion',
      }),
    ]);
  });

  it('AC2: cambiar el umbral recalcula al responder el PUT (sin evaluar a mano)', async () => {
    const cap = T0 + 30_000;
    const conObjetivoFuera = esperadasMesa(60, cap).filter((f) => f !== esperadasMesa(60)[0]);
    const r = await put('mesa_abierta', { empresaId: FX.empresaA, activa: true, umbral: 200 });
    expect(r.status).toBe(200);
    expect(r.body.find((x: { tipo: string }) => x.tipo === 'mesa_abierta')).toMatchObject({
      activa: true,
      umbral: 200,
      porDefecto: false,
    });
    const tras200 = await abiertasDe(TipoAlerta.mesa_abierta);
    expect(tras200.map((a) => a.llave)).toEqual(
      mesasVivas
        .filter((m) => conObjetivoFuera.includes(m.folio) && minutosSeed(m, cap) > 200)
        .map((m) => m.folio)
        .sort(),
    );

    const cerradasAntes = await prisma.alerta.count({
      where: { empresaId: FX.empresaA, tipo: TipoAlerta.mesa_abierta, motivoCierre: 'condicion' },
    });
    const r2 = await put('mesa_abierta', { empresaId: FX.empresaA, activa: true, umbral: 60 });
    expect(r2.status).toBe(200);
    const tras60 = await abiertasDe(TipoAlerta.mesa_abierta);
    expect(tras60.map((a) => a.llave)).toEqual(conObjetivoFuera);
    // Las reabiertas son filas NUEVAS; las cerradas conservan sus marcas.
    expect(
      await prisma.alerta.count({
        where: { empresaId: FX.empresaA, tipo: TipoAlerta.mesa_abierta, motivoCierre: 'condicion' },
      }),
    ).toBe(cerradasAntes);
  });

  it('AC4: regla apagada cierra sus abiertas, deja de abrir y NO borra historial', async () => {
    const totalAntes = await prisma.alerta.count({ where: { empresaId: FX.empresaA } });
    const abiertasAntes = (await abiertasDe(TipoAlerta.mesa_abierta)).length;
    expect(abiertasAntes).toBeGreaterThan(0);

    const r = await put('mesa_abierta', { empresaId: FX.empresaA, activa: false, umbral: 60 });
    expect(r.status).toBe(200);
    expect(await abiertasDe(TipoAlerta.mesa_abierta)).toEqual([]);
    expect(
      await prisma.alerta.count({
        where: {
          empresaId: FX.empresaA,
          tipo: TipoAlerta.mesa_abierta,
          motivoCierre: 'regla_apagada',
        },
      }),
    ).toBe(abiertasAntes);

    await evaluar();
    await evaluar();
    expect(await abiertasDe(TipoAlerta.mesa_abierta)).toEqual([]);
    expect(await prisma.alerta.count({ where: { empresaId: FX.empresaA } })).toBe(totalAntes);

    expect(
      (await put('mesa_abierta', { empresaId: FX.empresaA, activa: true, umbral: 60 })).status,
    ).toBe(200);
    expect((await abiertasDe(TipoAlerta.mesa_abierta)).length).toBe(abiertasAntes);
  });

  it('B1: una observación tomada ANTES de apagar la regla no reabre nada al aplicarse', async () => {
    const ahora = reloj.ahora();
    const obs = await servicio.observar(FX.empresaA, ahora);
    expect(
      (await put('mesa_abierta', { empresaId: FX.empresaA, activa: false, umbral: 60 })).status,
    ).toBe(200);
    const total = await prisma.alerta.count({ where: { empresaId: FX.empresaA } });
    await servicio.aplicar(obs, ahora);
    expect(await abiertasDe(TipoAlerta.mesa_abierta)).toEqual([]);
    expect(await prisma.alerta.count({ where: { empresaId: FX.empresaA } })).toBe(total);
    expect(
      (await put('mesa_abierta', { empresaId: FX.empresaA, activa: true, umbral: 60 })).status,
    ).toBe(200);
  });

  it('B1: una observación tomada ANTES de subir el umbral se juzga con el umbral nuevo', async () => {
    const ahora = reloj.ahora();
    const obs = await servicio.observar(FX.empresaA, ahora);
    expect(
      (await put('mesa_abierta', { empresaId: FX.empresaA, activa: true, umbral: 200 })).status,
    ).toBe(200);
    const abiertas200 = (await abiertasDe(TipoAlerta.mesa_abierta)).map((a) => a.id);
    await servicio.aplicar(obs, ahora);
    expect((await abiertasDe(TipoAlerta.mesa_abierta)).map((a) => a.id)).toEqual(abiertas200);
    expect(
      (await put('mesa_abierta', { empresaId: FX.empresaA, activa: true, umbral: 60 })).status,
    ).toBe(200);
  });

  it('concurrencia real: dos aplicar y un PUT a la vez dejan UNA abierta por condición', async () => {
    const ahora = reloj.ahora();
    const obs = await servicio.observar(FX.empresaA, ahora);
    await Promise.all([
      servicio.aplicar(obs, ahora),
      servicio.aplicar(obs, ahora),
      put('cuenta_sin_imprimir', { empresaId: FX.empresaA, activa: true, umbral: 30 }),
      servicio.aplicar(obs, ahora),
    ]);
    const dobles = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM (
        SELECT sucursal_id, tipo, llave FROM alertas
        WHERE empresa_id = ${FX.empresaA}::uuid AND cerrada_at IS NULL
        GROUP BY 1, 2, 3 HAVING count(*) > 1) d`;
    expect(dobles).toEqual([{ n: 0 }]);
  });

  /** Un snapshot de A1 capturado y recibido en `t`, con las cuentas indicadas. */
  async function snapshotEn(t: number, mesas: MesaSeed[]) {
    await prisma.mesaSnapshot.create({
      data: {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        capturadoAt: new Date(t),
        recibidoAt: new Date(t),
        payload: { origen: 'e2e', mesas } as unknown as Prisma.InputJsonValue,
      },
    });
  }
  const todas = () =>
    prisma.alerta.findMany({ where: { empresaId: FX.empresaA }, orderBy: { id: 'asc' } });

  it('B1 (entregable): una observación vieja aplicada DESPUÉS de una nueva se descarta', async () => {
    const [x] = esperadasMesa(60);
    const sinX = mesasVivas.filter((m) => m.folio !== x);

    // Caso 2 del revisor: la vieja VE la cuenta X; la nueva ya no. Sin marca de agua, la vieja
    // abriría una fila fantasma de X con una hora anterior al último cierre.
    const t1 = T0 + 60_000;
    await snapshotEn(t1, mesasVivas);
    reloj.t = t1;
    const vieja = await servicio.observar(FX.empresaA, t1);
    const t2 = T0 + 90_000;
    await snapshotEn(t2, sinX);
    reloj.t = t2;
    const nueva = await servicio.observar(FX.empresaA, t2);
    expect(await servicio.aplicar(nueva, t2)).toBe(true);
    const tras = await todas();
    expect(await servicio.aplicar(vieja, t1)).toBe(false);
    expect(await todas()).toEqual(tras);

    // Caso 1 del revisor: la vieja NO ve X; la nueva la abre. Sin marca de agua, la vieja la
    // cerraría con una hora anterior a su apertura (CHECK violado → la transacción truena).
    const t3 = T0 + 120_000;
    await snapshotEn(t3, mesasVivas);
    reloj.t = t3;
    const nueva2 = await servicio.observar(FX.empresaA, t3);
    expect(await servicio.aplicar(nueva2, t3)).toBe(true);
    const abiertaX = await prisma.alerta.findFirstOrThrow({
      where: { empresaId: FX.empresaA, tipo: TipoAlerta.mesa_abierta, llave: x, cerradaAt: null },
    });
    expect(abiertaX.abiertaAt.getTime()).toBe(t3);
    const antes = await todas();
    await expect(servicio.aplicar(nueva, t2)).resolves.toBe(false);
    expect(await todas()).toEqual(antes);
  });

  it('B1 (entregable): el PUT observa con el candado tomado y nunca da 500 por el orden', async () => {
    const t4 = T0 + 150_000;
    reloj.t = t4;
    const vieja = await servicio.observar(FX.empresaA, t4);
    reloj.t = T0 + 180_000;
    await snapshotEn(reloj.t, mesasVivas);
    const r = await put('cuenta_sin_imprimir', {
      empresaId: FX.empresaA,
      activa: true,
      umbral: 30,
    });
    expect(r.status).toBe(200);
    expect(await servicio.aplicar(vieja, t4)).toBe(false);

    // Un reloj que retrocede (ajuste de hora del servidor) tampoco rompe: la hora que se
    // escribe nunca es anterior a la marca, así que ningún cierre queda antes de su apertura.
    reloj.t = T0;
    const r2 = await put('mesa_abierta', { empresaId: FX.empresaA, activa: true, umbral: 200 });
    expect(r2.status).toBe(200);
    const incoherentes = await prisma.alerta.count({
      where: { empresaId: FX.empresaA, cerradaAt: { not: null } },
    });
    expect(incoherentes).toBeGreaterThan(0);
    const [malas] = await prisma.$queryRaw<Array<{ n: number }>>`
      SELECT count(*)::int AS n FROM alertas
      WHERE empresa_id = ${FX.empresaA}::uuid AND cerrada_at < abierta_at`;
    expect(malas.n).toBe(0);
    reloj.t = T0 + 180_000;
    expect(
      (await put('mesa_abierta', { empresaId: FX.empresaA, activa: true, umbral: 60 })).status,
    ).toBe(200);
  });

  describe('AC3 y lectura', () => {
    it('abiertas: crítica primero, y es exactamente lo abierto en la base', async () => {
      const r = await get(`/alertas/abiertas?empresaId=${FX.empresaA}`);
      expect(r.status).toBe(200);
      const enBase = await prisma.alerta.count({
        where: { empresaId: FX.empresaA, cerradaAt: null },
      });
      expect(r.body).toHaveLength(enBase);
      expect(r.body[0]).toMatchObject({ severidad: 'critica', sucursal: 'A2', cerradaAt: null });
      const porSucursal = await get(
        `/alertas/abiertas?empresaId=${FX.empresaA}&sucursalId=${FX.sucursalA2}`,
      );
      expect(
        porSucursal.body.every((a: { sucursalId: string }) => a.sucursalId === FX.sucursalA2),
      ).toBe(true);
    });

    it('historial: paginado de 50, más reciente primero', async () => {
      const total = await prisma.alerta.count({ where: { empresaId: FX.empresaA } });
      expect(total).toBeGreaterThan(50);
      const p1 = await get(`/alertas/historial?empresaId=${FX.empresaA}`);
      const p2 = await get(`/alertas/historial?empresaId=${FX.empresaA}&pagina=2`);
      expect(p1.body).toMatchObject({ total, pagina: 1, porPagina: 50 });
      expect(p1.body.filas).toHaveLength(50);
      expect(p2.body.filas).toHaveLength(Math.min(50, total - 50));
      const fechas = [...p1.body.filas, ...p2.body.filas].map(
        (f: { abiertaAt: string }) => f.abiertaAt,
      );
      expect([...fechas].sort().reverse()).toEqual(fechas);
      expect((await get(`/alertas/historial?empresaId=${FX.empresaA}&pagina=0`)).status).toBe(400);
    });

    it('reglas: las cuatro, con unidad y rango', async () => {
      const r = await get(`/alertas/reglas?empresaId=${FX.empresaA}`);
      expect(r.status).toBe(200);
      expect(r.body.map((x: { tipo: string }) => x.tipo)).toEqual([
        'sucursal_sin_reporte',
        'mesa_abierta',
        'cuenta_sin_imprimir',
        'caida_venta',
      ]);
      expect(r.body[3]).toMatchObject({
        unidad: 'porcentaje',
        minimo: 1,
        maximo: 100,
        valorPorDefecto: 30,
      });
    });
  });

  describe('scope y validación', () => {
    it('empresa ajena = 404 en los cuatro endpoints', async () => {
      const q = `empresaId=${FX.empresaA}`;
      expect((await get(`/alertas/abiertas?${q}`, USUARIOS.visorB)).status).toBe(404);
      expect((await get(`/alertas/historial?${q}`, USUARIOS.visorB)).status).toBe(404);
      expect((await get(`/alertas/reglas?${q}`, USUARIOS.visorB)).status).toBe(404);
      expect(
        (await put('mesa_abierta', { empresaId: FX.empresaB, activa: false, umbral: 60 })).status,
      ).toBe(404);
      expect(await prisma.reglaAlerta.count({ where: { empresaId: FX.empresaB } })).toBe(0);
    });

    it('empresa propia con sucursal de otra empresa = 404', async () => {
      const q = `empresaId=${FX.empresaA}&sucursalId=${FX.sucursalB1}`;
      expect((await get(`/alertas/abiertas?${q}`)).status).toBe(404);
      expect((await get(`/alertas/historial?${q}`)).status).toBe(404);
    });

    it('visor no configura (403 de ruta); umbral fuera de rango o tipo desconocido = 400', async () => {
      expect(
        (
          await put(
            'mesa_abierta',
            { empresaId: FX.empresaA, activa: true, umbral: 60 },
            USUARIOS.visorA,
          )
        ).status,
      ).toBe(403);
      expect(
        (await put('mesa_abierta', { empresaId: FX.empresaA, activa: true, umbral: 0 })).status,
      ).toBe(400);
      expect(
        (await put('mesa_abierta', { empresaId: FX.empresaA, activa: true, umbral: 1441 })).status,
      ).toBe(400);
      expect(
        (await put('caida_venta', { empresaId: FX.empresaA, activa: true, umbral: 101 })).status,
      ).toBe(400);
      expect(
        (await put('mesa_abierta', { empresaId: FX.empresaA, activa: true, umbral: 1.5 })).status,
      ).toBe(400);
      expect((await put('otra', { empresaId: FX.empresaA, activa: true, umbral: 60 })).status).toBe(
        400,
      );
    });

    it('helper: una sucursal de otra empresa no abre fila; el scope ajeno es 404', async () => {
      const escritura = app.get(ScopedPrismaService);
      await expect(
        escritura.alertas({ tipo: 'global' }).bajoCandado(FX.empresaA, (tx) =>
          tx.abrir(
            [
              {
                sucursalId: FX.sucursalB1,
                tipo: TipoAlerta.sucursal_sin_reporte,
                severidad: SeveridadAlerta.critica,
                llave: 'intruso',
                umbral: 10,
                detalle: {},
              },
            ],
            new Date(reloj.ahora()),
          ),
        ),
      ).rejects.toThrow();
      expect(await prisma.alerta.count({ where: { llave: 'intruso' } })).toBe(0);
      await expect(
        escritura
          .alertas({ tipo: 'empresa', empresaId: FX.empresaB })
          .bajoCandado(FX.empresaA, () => Promise.resolve()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('helper: las lecturas bajo candado sólo ven la empresa del candado', async () => {
      const ajena = await prisma.alerta.create({
        data: {
          empresaId: FX.empresaB,
          sucursalId: FX.sucursalB1,
          tipo: TipoAlerta.sucursal_sin_reporte,
          severidad: SeveridadAlerta.critica,
          llave: '',
          llaveAbierta: '',
          umbral: 10,
          detalle: {},
          abiertaAt: new Date(T0),
        },
      });
      const vistas = await app
        .get(ScopedPrismaService)
        .alertas({ tipo: 'global' })
        .bajoCandado(FX.empresaA, (tx) => tx.abiertas());
      expect(vistas.map((a) => a.id)).not.toContain(ajena.id);
      expect(vistas.every((a) => a.sucursalId !== FX.sucursalB1)).toBe(true);
      await prisma.alerta.delete({ where: { id: ajena.id } });
    });
  });

  it('O2: empresa dada de baja se sigue evaluando mientras tenga abiertas, y las cierra', async () => {
    expect(
      await prisma.alerta.count({ where: { empresaId: FX.empresaA, cerradaAt: null } }),
    ).toBeGreaterThan(0);
    await prisma.empresa.update({ where: { id: FX.empresaA }, data: { activo: false } });
    try {
      expect(await servicio.empresasAEvaluar()).toContain(FX.empresaA);
      await evaluar();
      expect(
        await prisma.alerta.count({ where: { empresaId: FX.empresaA, cerradaAt: null } }),
      ).toBe(0);
      expect(
        await prisma.alerta.count({
          where: { empresaId: FX.empresaA, motivoCierre: 'empresa_inactiva' },
        }),
      ).toBeGreaterThan(0);
      expect(await servicio.empresasAEvaluar()).not.toContain(FX.empresaA);
    } finally {
      await prisma.empresa.update({ where: { id: FX.empresaA }, data: { activo: true } });
    }
  });
});
