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

// E2E de los desgloses de Análisis (F2-221) sobre la app REAL contra Postgres REAL. Las cuentas
// se insertan A MANO y cada cifra esperada está calculada a mano aquí abajo, no leída de otro
// endpoint: el total contra el que cuadra cada desglose (712.00) sale de la suma de los totales
// escritos en este archivo.
//
// A1 está en CDMX (UTC−6) y A2 en Tijuana (UTC−7 en septiembre). Rango: lunes 14 y martes 15 de
// septiembre de 2026 (isodow 1 y 2).
//
// | folio | suc | mesero | mesa | cierre local           | min | total  | desc  | prop | com  | partidas               | total − Σ partidas |
// |-------|-----|--------|------|------------------------|-----|--------|-------|------|------|------------------------|--------------------|
// | C1    | A1  | Ana    | 5    | lun 14 14:00 (20:00Z)  | 60  | 222.00 | 10.00 | 20   | 2    | Taco 150 ×3, Agua 80 ×2 | 222 − 230 = −8     |
// | C2    | A1  | Ana    | 5    | lun 14 21:30 (03:30Z)  | 90  | 100.00 | 0     | 0    | null | Taco 100 ×2             | 0                  |
// | C3    | A1  | null   | null | mar 15 09:15 (15:15Z)  | 0   | 50.00  | 0     | 0    | null | Café 45 ×1              | +5                 |
// | C6    | A1  | Luis   | 7    | mar 15 11:50 (17:50Z)  | <0  | 40.00  | 4.00  | 5    | 0    | Agua 44 ×1              | −4                 |
// | T1    | A2  | Ana    | 5    | mar 15 23:30 Tijuana   | 60  | 300.00 | 0     | 30   | 4    | Taco 280 ×4             | +20                |
// |       |     |        |      | (= 00:30 del MIÉRCOLES en CDMX: sólo entra si el día es el de Tijuana)                              |
// | C4    | A1  | Ana    | 9    | CANCELADO lun 14 15:00 | —   | 70.00  |       |      |      |                        |                    |
// | C5    | A1  | Luis   | 9    | CANCELADO sin cierre, abierto mar 15 10:00 | | 30.00 |    |      |      |                        |                    |
// | F1    | A1  | Ana    | 5    | mié 16 00:30 CDMX → FUERA del rango | | 999.00 |       |      |      | Taco 999                |                    |
// | B1    | B1  | Ana    | 5    | lun 14 14:00 (otra EMPRESA) | | 555.00 |          |      |      | Taco 555                |                    |
//
// Venta = 222 + 100 + 50 + 40 + 300 = 712.00 en 5 cuentas; 2 cancelados (C4, C5) que no suman.

const CDMX = 'America/Mexico_City';
const TIJUANA = 'America/Tijuana';
const RANGO = { desde: '2026-09-14', hasta: '2026-09-15' };

class RelojFijo extends Reloj {
  t = Date.parse('2026-09-21T20:30:00Z');
  override ahora(): number {
    return this.t;
  }
}

interface Cuenta {
  folio: string;
  empresa?: string;
  sucursal: string;
  mesero: string | null;
  mesa: string | null;
  abierto: string;
  cerrado: string | null;
  total: string;
  descuentos?: string;
  impuestos?: string;
  propina?: string;
  comensales?: number | null;
  cancelado?: boolean;
  partidas?: Array<[producto: string, total: string, cantidad: string]>;
}

const CUENTAS: Cuenta[] = [
  {
    folio: 'C1',
    sucursal: FX.sucursalA1,
    mesero: 'Ana',
    mesa: '5',
    abierto: '2026-09-14T19:00:00Z',
    cerrado: '2026-09-14T20:00:00Z',
    total: '222.00',
    descuentos: '10.00',
    impuestos: '30.62',
    propina: '20.00',
    comensales: 2,
    partidas: [
      ['Taco', '150.00', '3'],
      ['Agua', '80.00', '2'],
    ],
  },
  {
    folio: 'C2',
    sucursal: FX.sucursalA1,
    mesero: 'Ana',
    mesa: '5',
    abierto: '2026-09-15T02:00:00Z',
    cerrado: '2026-09-15T03:30:00Z',
    total: '100.00',
    impuestos: '13.79',
    comensales: null,
    partidas: [['Taco', '100.00', '2']],
  },
  {
    folio: 'C3',
    sucursal: FX.sucursalA1,
    mesero: null,
    mesa: null,
    abierto: '2026-09-15T15:15:00Z',
    cerrado: '2026-09-15T15:15:00Z',
    total: '50.00',
    impuestos: '6.90',
    comensales: null,
    partidas: [['Café', '45.00', '1']],
  },
  {
    folio: 'C6',
    sucursal: FX.sucursalA1,
    mesero: 'Luis',
    mesa: '7',
    // El POS lo trae al revés: cierre 10 minutos ANTES de la apertura.
    abierto: '2026-09-15T18:00:00Z',
    cerrado: '2026-09-15T17:50:00Z',
    total: '40.00',
    descuentos: '4.00',
    propina: '5.00',
    comensales: 0,
    partidas: [['Agua', '44.00', '1']],
  },
  {
    folio: 'T1',
    sucursal: FX.sucursalA2,
    mesero: 'Ana',
    mesa: '5',
    abierto: '2026-09-16T05:30:00Z',
    cerrado: '2026-09-16T06:30:00Z',
    total: '300.00',
    propina: '30.00',
    comensales: 4,
    partidas: [['Taco', '280.00', '4']],
  },
  {
    folio: 'C4',
    sucursal: FX.sucursalA1,
    mesero: 'Ana',
    mesa: '9',
    abierto: '2026-09-14T20:30:00Z',
    cerrado: '2026-09-14T21:00:00Z',
    total: '70.00',
    cancelado: true,
    partidas: [['Taco', '70.00', '1']],
  },
  {
    folio: 'C5',
    sucursal: FX.sucursalA1,
    mesero: 'Luis',
    mesa: '9',
    abierto: '2026-09-15T16:00:00Z',
    cerrado: null,
    total: '30.00',
    cancelado: true,
  },
  {
    folio: 'F1',
    sucursal: FX.sucursalA1,
    mesero: 'Ana',
    mesa: '5',
    abierto: '2026-09-16T06:00:00Z',
    cerrado: '2026-09-16T06:30:00Z',
    total: '999.00',
    partidas: [['Taco', '999.00', '1']],
  },
  {
    folio: 'B1',
    empresa: FX.empresaB,
    sucursal: FX.sucursalB1,
    mesero: 'Ana',
    mesa: '5',
    abierto: '2026-09-14T19:00:00Z',
    cerrado: '2026-09-14T20:00:00Z',
    total: '555.00',
    partidas: [['Taco', '555.00', '1']],
  },
];

const Q = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

const ENDPOINTS = ['por-mesero', 'por-producto', 'hora-dia', 'por-mesa'] as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

describe('Análisis: desgloses por mesero, producto, hora × día y mesa (e2e, F2-221)', () => {
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
    await prisma.sucursal.update({ where: { id: FX.sucursalA1 }, data: { zonaHoraria: CDMX } });
    await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { zonaHoraria: TIJUANA } });
    await prisma.sucursal.update({ where: { id: FX.sucursalB1 }, data: { zonaHoraria: CDMX } });
    for (const c of CUENTAS) {
      const empresaId = c.empresa ?? FX.empresaA;
      const cheque = await prisma.cheque.create({
        data: {
          empresaId,
          sucursalId: c.sucursal,
          folio: c.folio,
          folioSr: `ANA-${c.folio}`,
          mesa: c.mesa,
          mesero: c.mesero,
          abiertoAt: new Date(c.abierto),
          cerradoAt: c.cerrado === null ? null : new Date(c.cerrado),
          comensales: c.comensales ?? null,
          subtotal: c.total,
          impuestos: c.impuestos ?? '0',
          descuentos: c.descuentos ?? '0',
          propina: c.propina ?? '0',
          total: c.total,
          cancelado: c.cancelado ?? false,
        },
      });
      for (const [orden, [producto, total, cantidad]] of (c.partidas ?? []).entries()) {
        await prisma.chequePartida.create({
          data: {
            chequeId: cheque.id,
            empresaId,
            orden,
            producto,
            cantidad,
            precioUnit: total,
            total,
          },
        });
      }
    }
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

  beforeEach(() => {
    reloj.t += 60_000;
  });

  const filtro = { empresaId: FX.empresaA, ...RANGO };

  it('la referencia: /ventas/resumen da la venta calculada a mano', async () => {
    const r = await get(`/ventas/resumen?${Q(filtro)}`);
    expect(r.status).toBe(200);
    expect(r.body.venta).toBe('712.00');
    expect(r.body.cuentas).toBe(5);
    expect(r.body.cancelados.cuentas).toBe(2);
  });

  it('por mesero: una fila por (sucursal, mesero), cancelados aparte, Σ venta = 712.00', async () => {
    const r = await get(`/ventas/por-mesero?${Q(filtro)}`);
    expect(r.status).toBe(200);
    const sinMonto = { cuentas: 0, monto: '0.00' };
    expect(r.body).toEqual([
      {
        sucursalId: FX.sucursalA1,
        sucursal: 'A1',
        mesero: 'Ana',
        venta: '322.00',
        cuentas: 2,
        ticketPromedio: '161.00',
        comensales: 2,
        cuentasConComensales: 1,
        propina: '20.00',
        descuentos: { monto: '10.00', cuentas: 1 },
        cancelados: { cuentas: 1, monto: '70.00' },
      },
      {
        // La misma "Ana" en otra sucursal es OTRA fila: no se sabe si es la misma persona.
        sucursalId: FX.sucursalA2,
        sucursal: 'A2',
        mesero: 'Ana',
        venta: '300.00',
        cuentas: 1,
        ticketPromedio: '300.00',
        comensales: 4,
        cuentasConComensales: 1,
        propina: '30.00',
        descuentos: { monto: '0.00', cuentas: 0 },
        cancelados: sinMonto,
      },
      {
        sucursalId: FX.sucursalA1,
        sucursal: 'A1',
        mesero: null,
        venta: '50.00',
        cuentas: 1,
        ticketPromedio: '50.00',
        comensales: 0,
        cuentasConComensales: 0,
        propina: '0.00',
        descuentos: { monto: '0.00', cuentas: 0 },
        cancelados: sinMonto,
      },
      {
        sucursalId: FX.sucursalA1,
        sucursal: 'A1',
        mesero: 'Luis',
        venta: '40.00',
        cuentas: 1,
        ticketPromedio: '40.00',
        comensales: 0,
        cuentasConComensales: 1,
        propina: '5.00',
        descuentos: { monto: '4.00', cuentas: 1 },
        // C5 no tiene cierre: se ubica por su apertura y cuenta igual.
        cancelados: { cuentas: 1, monto: '30.00' },
      },
    ]);
  });

  it('por mesero: un mesero con sólo cancelados aparece con venta 0.00 y cuentas 0', async () => {
    // Martes 15 en A1: C3 (sin mesero) y C6 + el cancelado C5 (Luis).
    const r = await get(
      `/ventas/por-mesero?${Q({ empresaId: FX.empresaA, sucursalId: FX.sucursalA1, desde: '2026-09-15', hasta: '2026-09-15' })}`,
    );
    expect(r.status).toBe(200);
    expect(
      r.body.map((f: { mesero: string | null; venta: string }) => [f.mesero, f.venta]),
    ).toEqual([
      [null, '50.00'],
      ['Luis', '40.00'],
    ]);
    // Pedro sólo tiene un cancelado ese día: aparece con venta 0, no desaparece.
    await prisma.cheque.create({
      data: {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        folio: 'C7',
        folioSr: 'ANA-C7',
        mesero: 'Pedro',
        abiertoAt: new Date('2026-09-15T19:00:00Z'),
        cerradoAt: new Date('2026-09-15T19:30:00Z'),
        subtotal: '12.00',
        impuestos: '0',
        descuentos: '0',
        propina: '0',
        total: '12.00',
        cancelado: true,
      },
    });
    reloj.t += 60_000;
    const r2 = await get(
      `/ventas/por-mesero?${Q({ empresaId: FX.empresaA, sucursalId: FX.sucursalA1, desde: '2026-09-15', hasta: '2026-09-15' })}`,
    );
    const pedro = r2.body.find((f: { mesero: string | null }) => f.mesero === 'Pedro');
    expect(pedro).toMatchObject({
      venta: '0.00',
      cuentas: 0,
      ticketPromedio: null,
      cancelados: { cuentas: 1, monto: '12.00' },
    });
    await prisma.cheque.delete({
      where: { sucursalId_folioSr: { sucursalId: FX.sucursalA1, folioSr: 'ANA-C7' } },
    });
  });

  it('por producto: cada importe a mano, y Σ importe + diferencia = 712.00', async () => {
    const r = await get(`/ventas/por-producto?${Q(filtro)}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      venta: '712.00',
      cuentas: 5,
      // Taco = 150 + 100 + 280 (C1, C2, T1; ni el cancelado C4, ni F1 fuera, ni B1 de otra
      // empresa). Agua = 80 + 44. Café = 45.
      productos: [
        { producto: 'Taco', importe: '530.00', cantidad: '9.000' },
        { producto: 'Agua', importe: '124.00', cantidad: '3.000' },
        { producto: 'Café', importe: '45.00', cantidad: '1.000' },
      ],
      // −8 (C1) + 0 (C2) + 5 (C3) − 4 (C6) + 20 (T1) = 13. No es −Σ descuentos (−14): el
      // total del POS no siempre es Σ partidas − descuento.
      diferenciaCuentas: '13.00',
    });
  });

  it('hora × día: 168 celdas, día y hora locales de CADA sucursal, Σ = 712.00', async () => {
    const r = await get(`/ventas/hora-dia?${Q(filtro)}`);
    expect(r.status).toBe(200);
    expect(r.body.celdas).toHaveLength(168);
    const conVenta = r.body.celdas.filter((c: { cuentas: number }) => c.cuentas > 0);
    expect(conVenta).toEqual([
      { diaSemana: 1, hora: 14, venta: '222.00', cuentas: 1 }, // C1
      { diaSemana: 1, hora: 21, venta: '100.00', cuentas: 1 }, // C2
      { diaSemana: 2, hora: 9, venta: '50.00', cuentas: 1 }, // C3
      { diaSemana: 2, hora: 11, venta: '40.00', cuentas: 1 }, // C6
      // T1: martes 23:xx en Tijuana. Con la zona de CDMX sería miércoles 0:xx y quedaría fuera.
      { diaSemana: 2, hora: 23, venta: '300.00', cuentas: 1 },
    ]);
    expect(r.body.celdas[0]).toEqual({ diaSemana: 1, hora: 0, venta: '0.00', cuentas: 0 });
    expect(r.body.diasEnRango).toEqual([
      { diaSemana: 1, dias: 1 },
      { diaSemana: 2, dias: 1 },
      { diaSemana: 3, dias: 0 },
      { diaSemana: 4, dias: 0 },
      { diaSemana: 5, dias: 0 },
      { diaSemana: 6, dias: 0 },
      { diaSemana: 7, dias: 0 },
    ]);
  });

  it('hora × día: dos semanas cuentan cada día de la semana dos veces', async () => {
    const r = await get(
      `/ventas/hora-dia?${Q({ empresaId: FX.empresaA, desde: '2026-09-14', hasta: '2026-09-27' })}`,
    );
    expect(r.body.diasEnRango.map((d: { dias: number }) => d.dias)).toEqual([2, 2, 2, 2, 2, 2, 2]);
  });

  it('por mesa: (sucursal, mesa), sin mesa aparte, duración inválida fuera del promedio', async () => {
    const r = await get(`/ventas/por-mesa?${Q(filtro)}`);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      filas: [
        {
          sucursalId: FX.sucursalA1,
          sucursal: 'A1',
          mesa: '5',
          cuentas: 2,
          venta: '322.00',
          minutosPromedio: '75.0', // (60 + 90) / 2
          cuentasConDuracion: 2,
        },
        {
          sucursalId: FX.sucursalA1,
          sucursal: 'A1',
          mesa: '7',
          cuentas: 1,
          venta: '40.00',
          minutosPromedio: null, // C6 cierra antes de abrir
          cuentasConDuracion: 0,
        },
        {
          // La "5" de A2 no es la "5" de A1. El cancelado C4 (mesa 9) no aparece.
          sucursalId: FX.sucursalA2,
          sucursal: 'A2',
          mesa: '5',
          cuentas: 1,
          venta: '300.00',
          minutosPromedio: '60.0',
          cuentasConDuracion: 1,
        },
      ],
      sinMesa: { cuentas: 1, venta: '50.00' },
      global: {
        venta: '712.00',
        cuentas: 5,
        minutosPromedio: '52.5', // (60 + 90 + 0 + 60) / 4
        cuentasConDuracion: 4,
        duracionesInvalidas: 1,
        mesas: 3,
        cuentasConMesa: 4,
        rotacion: '1.33', // 4 / 3
      },
    });
  });

  it('con sucursalId sólo entra esa sucursal', async () => {
    const f = { ...filtro, sucursalId: FX.sucursalA2 };
    const [mesero, producto, mapa, mesa] = await Promise.all(
      ENDPOINTS.map((e) => get(`/ventas/${e}?${Q(f)}`)),
    );
    expect(mesero.body.map((m: { mesero: string; venta: string }) => [m.mesero, m.venta])).toEqual([
      ['Ana', '300.00'],
    ]);
    expect(producto.body.venta).toBe('300.00');
    expect(producto.body.productos).toEqual([
      { producto: 'Taco', importe: '280.00', cantidad: '4.000' },
    ]);
    expect(producto.body.diferenciaCuentas).toBe('20.00');
    expect(mapa.body.celdas.filter((c: { cuentas: number }) => c.cuentas > 0)).toEqual([
      { diaSemana: 2, hora: 23, venta: '300.00', cuentas: 1 },
    ]);
    expect(mesa.body.global.venta).toBe('300.00');
  });

  it.each(ENDPOINTS)('%s: empresa ajena = 404 (nunca 403)', async (e) => {
    const r = await get(`/ventas/${e}?${Q({ ...RANGO, empresaId: FX.empresaB })}`, USUARIOS.visorA);
    expect(r.status).toBe(404);
  });

  it.each(ENDPOINTS)('%s: admin_global con sucursal de OTRA empresa = 404', async (e) => {
    const r = await get(
      `/ventas/${e}?${Q({ ...filtro, sucursalId: FX.sucursalB1 })}`,
      USUARIOS.adminGlobal,
    );
    expect(r.status).toBe(404);
  });

  it.each(ENDPOINTS)('%s: la empresa B sólo ve lo suyo', async (e) => {
    const r = await get(`/ventas/${e}?${Q({ ...RANGO, empresaId: FX.empresaB })}`, USUARIOS.visorB);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.body)).not.toContain('322.00');
    expect(JSON.stringify(r.body)).toContain('555.00');
  });

  it.each(ENDPOINTS)('%s: filtro inválido = 400', async (e) => {
    const r = await get(`/ventas/${e}?${Q({ ...filtro, desde: '2026-09-16' })}`);
    expect(r.status).toBe(400);
  });
});
