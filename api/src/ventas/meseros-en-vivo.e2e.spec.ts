import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';

// E2E de Meseros en vivo (MVP) sobre la app REAL contra Postgres REAL. Las cuentas y los
// snapshots se insertan A MANO y cada cifra esperada está calculada a mano aquí:
//
// Día: jueves 22-oct-2026, A1 y A2 en CDMX (UTC−6).
// Cobrado (cheques cerrados ese día local):
//   A1 Ana  120.00 (2 com) + 80.00 (1 com)  = 200.00 en 2 cuentas
//   A1 Luis  50.00                          =  50.00 en 1
//   A1 —     30.00 (sin mesero)             =  30.00 en 1
//   A1 Ana   70.00 CANCELADA                 (no suma)
//   A1 Ana  500.00 cerrada el 21 23:30 local (otro día: no suma)
//   B1 Ana  555.00 (OTRA empresa)
//   → Σ cobrado de la empresa A = 280.00 en 4 cuentas (= /ventas/resumen del día).
// En curso (último snapshot de cada sucursal):
//   A1: Ana 150.50 (3 com) · " Luis " 40 · Pedro "x" (sin total) · sin mesero 10.00
//       (un snapshot ANTERIOR de A1 con Ana 9999 no cuenta: sólo el último)
//   A2: Ana 300.00
//   B1: Ana 999.00 (otra empresa)
// Filas: A1 Ana 350.50 · A2 Ana 300.00 · A1 Luis 90.00 · A1 — 40.00 · A1 Pedro 0.00.

const DIA = '2026-10-22';

class RelojFijo extends Reloj {
  t = Date.parse('2026-10-22T22:00:00Z');
  override ahora(): number {
    return this.t;
  }
}

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

const Q = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

describe('GET /ventas/meseros-en-vivo (e2e, MVP)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojFijo();
  let app: INestApplication;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  async function get(ruta: string, u: Usuario = USUARIOS.visorA) {
    return request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${await token(u)}`);
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    for (const id of [FX.sucursalA1, FX.sucursalA2, FX.sucursalB1]) {
      await prisma.sucursal.update({ where: { id }, data: { zonaHoraria: 'America/Mexico_City' } });
    }
    const cuentas: Array<{
      folio: string;
      empresaId?: string;
      sucursalId: string;
      mesero: string | null;
      cerrado: string;
      total: string;
      comensales?: number;
      cancelado?: boolean;
    }> = [
      {
        folio: 'V1',
        sucursalId: FX.sucursalA1,
        mesero: 'Ana',
        cerrado: '2026-10-22T15:00:00Z',
        total: '120.00',
        comensales: 2,
      },
      {
        folio: 'V2',
        sucursalId: FX.sucursalA1,
        mesero: 'Ana',
        cerrado: '2026-10-22T18:00:00Z',
        total: '80.00',
        comensales: 1,
      },
      {
        folio: 'V3',
        sucursalId: FX.sucursalA1,
        mesero: 'Luis',
        cerrado: '2026-10-22T19:00:00Z',
        total: '50.00',
      },
      {
        folio: 'V4',
        sucursalId: FX.sucursalA1,
        mesero: null,
        cerrado: '2026-10-22T20:00:00Z',
        total: '30.00',
      },
      {
        folio: 'V5',
        sucursalId: FX.sucursalA1,
        mesero: 'Ana',
        cerrado: '2026-10-22T20:30:00Z',
        total: '70.00',
        cancelado: true,
      },
      {
        folio: 'V6',
        sucursalId: FX.sucursalA1,
        mesero: 'Ana',
        cerrado: '2026-10-22T05:30:00Z',
        total: '500.00',
      },
      {
        folio: 'V7',
        empresaId: FX.empresaB,
        sucursalId: FX.sucursalB1,
        mesero: 'Ana',
        cerrado: '2026-10-22T15:00:00Z',
        total: '555.00',
      },
    ];
    for (const c of cuentas) {
      await prisma.cheque.create({
        data: {
          empresaId: c.empresaId ?? FX.empresaA,
          sucursalId: c.sucursalId,
          folio: c.folio,
          folioSr: `MEV-${c.folio}`,
          mesero: c.mesero,
          abiertoAt: new Date(Date.parse(c.cerrado) - 3_600_000),
          cerradoAt: new Date(c.cerrado),
          comensales: c.comensales ?? null,
          subtotal: c.total,
          impuestos: '0',
          descuentos: '0',
          propina: '0',
          total: c.total,
          cancelado: c.cancelado ?? false,
        },
      });
    }
    const snapshot = (
      empresaId: string,
      sucursalId: string,
      capturadoAt: string,
      mesas: object[],
    ) =>
      prisma.mesaSnapshot.create({
        data: { empresaId, sucursalId, capturadoAt: new Date(capturadoAt), payload: { mesas } },
      });
    await snapshot(FX.empresaA, FX.sucursalA1, '2026-10-22T21:58:00Z', [
      { mesero: 'Ana', total: '9999.00' },
    ]);
    await snapshot(FX.empresaA, FX.sucursalA1, '2026-10-22T21:59:30Z', [
      { mesa: '1', mesero: 'Ana', total: '150.50', comensales: 3 },
      { mesa: '2', mesero: ' Luis ', total: 40 },
      { mesa: '3', mesero: 'Pedro', total: 'x' },
      { mesa: '4', mesero: null, total: '10.00' },
    ]);
    await snapshot(FX.empresaA, FX.sucursalA2, '2026-10-22T21:59:40Z', [
      { mesa: '9', mesero: 'Ana', total: '300.00' },
    ]);
    await snapshot(FX.empresaB, FX.sucursalB1, '2026-10-22T21:59:40Z', [
      { mesa: '9', mesero: 'Ana', total: '999.00' },
    ]);

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  const filtro = { empresaId: FX.empresaA, dia: DIA };

  it('la referencia: /ventas/resumen del día da el cobrado calculado a mano', async () => {
    const r = await get(`/ventas/resumen?${Q({ empresaId: FX.empresaA, desde: DIA, hasta: DIA })}`);
    expect(r.body.venta).toBe('280.00');
    expect(r.body.cuentas).toBe(4);
  });

  it('cobrado + en curso por mesero, ranking por sucursal y totales', async () => {
    const r = await get(`/ventas/meseros-en-vivo?${Q(filtro)}`);
    expect(r.status).toBe(200);
    const fila = (
      posicion: number | null,
      sucursalId: string,
      sucursal: string,
      mesero: string | null,
      c: Partial<Record<string, unknown>>,
    ) => ({
      posicion,
      sucursalId,
      sucursal,
      mesero,
      cobrado: '0.00',
      cuentas: 0,
      comensales: 0,
      ticketPromedio: null,
      mesasAbiertas: 0,
      enCurso: '0.00',
      mesasSinTotal: 0,
      comensalesEnMesa: 0,
      ...c,
    });
    expect(r.body.dia).toBe(DIA);
    expect(r.body.meseros).toEqual([
      fila(1, FX.sucursalA1, 'A1', 'Ana', {
        cobrado: '200.00',
        cuentas: 2,
        comensales: 3,
        ticketPromedio: '100.00',
        mesasAbiertas: 1,
        enCurso: '150.50',
        comensalesEnMesa: 3,
        total: '350.50',
      }),
      fila(1, FX.sucursalA2, 'A2', 'Ana', { mesasAbiertas: 1, enCurso: '300.00', total: '300.00' }),
      fila(2, FX.sucursalA1, 'A1', 'Luis', {
        cobrado: '50.00',
        cuentas: 1,
        ticketPromedio: '50.00',
        mesasAbiertas: 1,
        enCurso: '40.00',
        total: '90.00',
      }),
      fila(null, FX.sucursalA1, 'A1', null, {
        cobrado: '30.00',
        cuentas: 1,
        ticketPromedio: '30.00',
        mesasAbiertas: 1,
        enCurso: '10.00',
        total: '40.00',
      }),
      fila(3, FX.sucursalA1, 'A1', 'Pedro', { mesasAbiertas: 1, mesasSinTotal: 1, total: '0.00' }),
    ]);
    expect(r.body.totales).toEqual({
      cobrado: '280.00',
      cuentas: 4,
      enCurso: '500.50',
      mesasAbiertas: 5,
      mesasSinTotal: 1,
      total: '780.50',
    });
    expect(
      r.body.sucursales.map((s: { sucursalId: string; snapshot: { capturadoAt: string } }) => [
        s.sucursalId,
        s.snapshot.capturadoAt,
      ]),
    ).toEqual([
      [FX.sucursalA1, '2026-10-22T21:59:30.000Z'],
      [FX.sucursalA2, '2026-10-22T21:59:40.000Z'],
    ]);
  });

  it('con sucursalId sólo esa sucursal', async () => {
    const r = await get(`/ventas/meseros-en-vivo?${Q({ ...filtro, sucursalId: FX.sucursalA2 })}`);
    expect(r.status).toBe(200);
    expect(
      r.body.meseros.map((m: { mesero: string; total: string }) => [m.mesero, m.total]),
    ).toEqual([['Ana', '300.00']]);
    expect(r.body.totales.cobrado).toBe('0.00');
  });

  it('scoping: visor de B → 404 (igual que inexistente); sucursal de B bajo A → 404', async () => {
    const ajena = await get(`/ventas/meseros-en-vivo?${Q(filtro)}`, USUARIOS.visorB);
    const inexistente = await get(
      `/ventas/meseros-en-vivo?${Q({ ...filtro, empresaId: FX.inexistente })}`,
      USUARIOS.visorB,
    );
    expect(ajena.status).toBe(404);
    expect(ajena.body).toEqual(inexistente.body);
    expect(
      (
        await get(
          `/ventas/meseros-en-vivo?${Q({ ...filtro, sucursalId: FX.sucursalB1 })}`,
          USUARIOS.adminGlobal,
        )
      ).status,
    ).toBe(404);
    const b = await get(
      `/ventas/meseros-en-vivo?${Q({ empresaId: FX.empresaB, dia: DIA })}`,
      USUARIOS.visorB,
    );
    expect(b.body.totales).toMatchObject({ cobrado: '555.00', enCurso: '999.00' });
  });

  it('400 con un día inválido; 401 sin token', async () => {
    expect(
      (await get(`/ventas/meseros-en-vivo?${Q({ ...filtro, dia: '2026-02-30' })}`)).status,
    ).toBe(400);
    expect((await get(`/ventas/meseros-en-vivo?${Q({ empresaId: FX.empresaA })}`)).status).toBe(
      400,
    );
    expect(
      (await request(app.getHttpServer()).get(`/ventas/meseros-en-vivo?${Q(filtro)}`)).status,
    ).toBe(401);
  });
});
