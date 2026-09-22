import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { FormaPago, PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';

// E2E del corte "a la misma altura" (`alturaAl`, F2-220) sobre la app REAL contra Postgres
// REAL. Las cuentas se insertan A MANO con la hora exacta de cierre (no con el generador del
// seed) y cada cifra esperada está calculada a mano en el comentario de su cheque: el corte
// no se compara consigo mismo por otro endpoint que lee de las mismas CTEs.
//
// A1 está en CDMX (UTC−6 todo el año) y A2 en Tijuana (UTC−7 en septiembre, con horario de
// verano). El instante de corte es el mismo para las dos: 2026-09-21T20:30:00Z, que son las
// 14:30 en CDMX y las 13:30 en Tijuana.

const CDMX = 'America/Mexico_City';
const TIJUANA = 'America/Tijuana';
const ALTURA = '2026-09-21T20:30:00Z';
const RANGO = { desde: '2026-09-13', hasta: '2026-09-14' };

class RelojFijo extends Reloj {
  t = Date.parse('2026-09-21T20:30:00Z');
  override ahora(): number {
    return this.t;
  }
}

interface Cuenta {
  folio: string;
  sucursal: string;
  cerrado: string | null;
  abierto?: string;
  total: string;
  cancelado?: boolean;
  producto?: string;
  formaRaw?: string;
}

const CUENTAS: Cuenta[] = [
  // A1, CDMX. Último día del rango: 14-sep.
  // 14:29:59 local → DENTRO (antes de las 14:30).
  {
    folio: 'X1',
    sucursal: FX.sucursalA1,
    cerrado: '2026-09-14T20:29:59Z',
    total: '100.00',
    producto: 'Taco',
    formaRaw: 'EFECTIVO',
  },
  // 14:30:00 local en punto → FUERA (el corte es exclusivo).
  {
    folio: 'X2',
    sucursal: FX.sucursalA1,
    cerrado: '2026-09-14T20:30:00Z',
    total: '200.00',
    producto: 'Pozole',
    formaRaw: 'TARJETA',
  },
  // 13-sep 23:00 local: día ANTERIOR al último, más tarde que la hora de corte → DENTRO.
  { folio: 'X3', sucursal: FX.sucursalA1, cerrado: '2026-09-14T05:00:00Z', total: '50.00' },
  // Cancelado sin cierre, abierto 14:00 local → cancelado DENTRO del corte.
  {
    folio: 'X4',
    sucursal: FX.sucursalA1,
    cerrado: null,
    abierto: '2026-09-14T20:00:00Z',
    total: '70.00',
    cancelado: true,
  },
  // Cancelado sin cierre, abierto 15:00 local → FUERA.
  {
    folio: 'X5',
    sucursal: FX.sucursalA1,
    cerrado: null,
    abierto: '2026-09-14T21:00:00Z',
    total: '80.00',
    cancelado: true,
  },
  // A2, Tijuana (UTC−7). El mismo instante es 13:30 local.
  // 13:29:59 local → DENTRO.
  { folio: 'Y1', sucursal: FX.sucursalA2, cerrado: '2026-09-14T20:29:59Z', total: '10.00' },
  // 13:30:00 local → FUERA. Si el corte usara la hora de CDMX (14:30) para Tijuana, entraría.
  { folio: 'Y2', sucursal: FX.sucursalA2, cerrado: '2026-09-14T20:30:00Z', total: '20.00' },
  // 14:10 local Tijuana → FUERA (con la hora de CDMX también entraría).
  { folio: 'Y3', sucursal: FX.sucursalA2, cerrado: '2026-09-14T21:10:00Z', total: '40.00' },

  // Cambio de horario de Tijuana, 14-mar-2027: a las 02:00 PST (UTC−8) el reloj salta a 03:00
  // PDT (UTC−7). Las 02:30 locales NO EXISTEN ese día.
  { folio: 'P1', sucursal: FX.sucursalA2, cerrado: '2027-03-14T09:59:00Z', total: '1.00' }, // 01:59 PST
  { folio: 'P2', sucursal: FX.sucursalA2, cerrado: '2027-03-14T10:15:00Z', total: '2.00' }, // 03:15 PDT
  { folio: 'P3', sucursal: FX.sucursalA2, cerrado: '2027-03-14T10:45:00Z', total: '4.00' }, // 03:45 PDT
  // 7-nov-2027: a las 02:00 PDT el reloj regresa a 01:00 PST. Las 01:30 locales pasan DOS veces.
  { folio: 'O1', sucursal: FX.sucursalA2, cerrado: '2027-11-07T08:45:00Z', total: '1.00' }, // 01:45 PDT
  { folio: 'O2', sucursal: FX.sucursalA2, cerrado: '2027-11-07T09:15:00Z', total: '2.00' }, // 01:15 PST
  { folio: 'O3', sucursal: FX.sucursalA2, cerrado: '2027-11-07T09:45:00Z', total: '4.00' }, // 01:45 PST
];

const Q = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

describe('Corte a la misma altura: alturaAl (e2e, F2-220)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojFijo();
  let app: INestApplication;

  const token = (u: (typeof USUARIOS)[keyof typeof USUARIOS]) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  async function get(ruta: string, u: (typeof USUARIOS)[keyof typeof USUARIOS] = USUARIOS.visorA) {
    return request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${await token(u)}`);
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({ where: { id: FX.sucursalA1 }, data: { zonaHoraria: CDMX } });
    await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { zonaHoraria: TIJUANA } });
    for (const c of CUENTAS) {
      const cheque = await prisma.cheque.create({
        data: {
          empresaId: FX.empresaA,
          sucursalId: c.sucursal,
          folio: c.folio,
          folioSr: `ALT-${c.folio}`,
          abiertoAt: new Date(c.abierto ?? c.cerrado!),
          cerradoAt: c.cerrado === null ? null : new Date(c.cerrado),
          subtotal: c.total,
          impuestos: '0',
          descuentos: '0',
          propina: '0',
          total: c.total,
          cancelado: c.cancelado ?? false,
        },
      });
      if (c.producto) {
        await prisma.chequePartida.create({
          data: {
            chequeId: cheque.id,
            empresaId: FX.empresaA,
            orden: 0,
            producto: c.producto,
            cantidad: '1',
            precioUnit: c.total,
            total: c.total,
          },
        });
      }
      if (c.formaRaw) {
        await prisma.chequePago.create({
          data: {
            chequeId: cheque.id,
            empresaId: FX.empresaA,
            forma: FormaPago.otro,
            formaRaw: c.formaRaw,
            monto: c.total,
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

  // Cada prueba avanza el reloj más allá del TTL: nada sale del cache de otra prueba.
  beforeEach(() => {
    reloj.t += 60_000;
  });

  const filtro = { empresaId: FX.empresaA, ...RANGO };

  it('sin alturaAl el último día va completo (la referencia)', async () => {
    const r = await get(`/ventas/resumen?${Q(filtro)}`);
    expect(r.status).toBe(200);
    // X1 + X2 + X3 + Y1 + Y2 + Y3 = 100 + 200 + 50 + 10 + 20 + 40.
    expect(r.body.venta).toBe('420.00');
    expect(r.body.cuentas).toBe(6);
    expect(r.body.cancelados.cuentas).toBe(2);
  });

  it('corta el último día en la hora local de CADA sucursal, exclusivo, con los días previos completos', async () => {
    const r = await get(`/ventas/resumen?${Q({ ...filtro, alturaAl: ALTURA })}`);
    expect(r.status).toBe(200);
    // Entran X1 (14:29:59 CDMX), X3 (día previo) y Y1 (13:29:59 Tijuana): 100 + 50 + 10.
    expect(r.body.venta).toBe('160.00');
    expect(r.body.cuentas).toBe(3);
    // Sólo X4 (abierto 14:00 CDMX, sin cierre).
    expect(r.body.cancelados.cuentas).toBe(1);
  });

  it('el mismo instante corta Tijuana a las 13:30 locales, no a las 14:30 de CDMX', async () => {
    const r = await get(
      `/ventas/resumen?${Q({ ...filtro, sucursalId: FX.sucursalA2, alturaAl: ALTURA })}`,
    );
    expect(r.body.venta).toBe('10.00');
    expect(r.body.cuentas).toBe(1);
  });

  it('un offset en vez de Z es el mismo instante', async () => {
    const r = await get(
      `/ventas/resumen?${Q({ ...filtro, alturaAl: '2026-09-21T14:30:00-06:00' })}`,
    );
    expect(r.body.venta).toBe('160.00');
  });

  it('comparativo, por hora, por día y tickets respetan el mismo corte', async () => {
    const qs = Q({ ...filtro, alturaAl: ALTURA });
    const suc = (await get(`/ventas/comparativo-sucursales?${qs}`)).body as Array<{
      sucursalId: string;
      venta: string;
      cuentas: number;
    }>;
    expect(suc.map((s) => [s.sucursalId, s.venta, s.cuentas])).toEqual([
      [FX.sucursalA1, '150.00', 2],
      [FX.sucursalA2, '10.00', 1],
    ]);
    const horas = (await get(`/ventas/por-hora?${qs}`)).body as Array<{
      hora: number;
      venta: string;
    }>;
    expect(horas.filter((h) => h.venta !== '0.00')).toEqual([
      { hora: 13, venta: '10.00', cuentas: 1 },
      { hora: 14, venta: '100.00', cuentas: 1 },
      { hora: 23, venta: '50.00', cuentas: 1 },
    ]);
    const dias = (await get(`/ventas/por-dia?${qs}`)).body;
    expect(dias).toEqual([
      { dia: '2026-09-13', venta: '50.00', cuentas: 1 },
      { dia: '2026-09-14', venta: '110.00', cuentas: 2 },
    ]);
    const t = (await get(`/ventas/tickets?${qs}`)).body as {
      total: number;
      items: Array<{ folio: string }>;
    };
    expect(t.total).toBe(4);
    expect(t.items.map((i) => i.folio).sort()).toEqual(['X1', 'X3', 'X4', 'Y1']);
  });

  it('las partidas y los pagos de una cuenta fuera del corte no aparecen', async () => {
    const qs = Q({ ...filtro, alturaAl: ALTURA });
    const top = (await get(`/ventas/top-productos?${qs}&limite=50`)).body as Array<{
      producto: string;
    }>;
    expect(top.map((p) => p.producto)).toEqual(['Taco']);
    const formas = (await get(`/ventas/formas-pago?${qs}`)).body as {
      sinCatalogo: Array<{ formaRaw: string; monto: string }>;
    };
    expect(formas.sinCatalogo).toEqual([{ formaRaw: 'EFECTIVO', monto: '100.00' }]);
  });

  describe('día de cambio de horario en Tijuana (cálculo a mano primero)', () => {
    const a2 = { empresaId: FX.empresaA, sucursalId: FX.sucursalA2 };

    it('hora que no existe (02:30 del 14-mar-2027): se lee con el offset de ANTES del salto', async () => {
      // 2027-03-01T10:30Z son las 02:30 PST en Tijuana. El 14-mar las 02:30 no existen; con el
      // offset previo (UTC−8) el corte es 10:30Z = 03:30 PDT: entran P1 (01:59 PST) y P2
      // (03:15 PDT); P3 (03:45 PDT) queda fuera.
      const r = await get(
        `/ventas/resumen?${Q({ ...a2, desde: '2027-03-14', hasta: '2027-03-14', alturaAl: '2027-03-01T10:30:00Z' })}`,
      );
      expect(r.body.venta).toBe('3.00');
      expect(r.body.cuentas).toBe(2);
    });

    it('hora repetida (01:30 del 7-nov-2027): se lee con el offset de DESPUÉS del regreso', async () => {
      // 2027-11-01T08:30Z son las 01:30 PDT. El 7-nov las 01:30 pasan dos veces; con el offset
      // posterior (PST, UTC−8) el corte es 09:30Z: entran O1 (01:45 PDT) y O2 (01:15 PST);
      // O3 (01:45 PST) queda fuera.
      const r = await get(
        `/ventas/resumen?${Q({ ...a2, desde: '2027-11-07', hasta: '2027-11-07', alturaAl: '2027-11-01T08:30:00Z' })}`,
      );
      expect(r.body.venta).toBe('3.00');
      expect(r.body.cuentas).toBe(2);
    });
  });

  it.each([
    ['sin zona', '2026-09-21T20:30:00'],
    ['sólo la hora', '14:30'],
    ['día que no existe', '2026-02-30T12:00:00Z'],
    ['basura', 'ahora'],
  ])('400 con alturaAl inválida: %s', async (_caso, alturaAl) => {
    const r = await get(`/ventas/resumen?${Q({ ...filtro, alturaAl })}`);
    expect(r.status).toBe(400);
  });

  it('empresa ajena con alturaAl sigue siendo 404', async () => {
    const r = await get(`/ventas/resumen?${Q({ ...filtro, alturaAl: ALTURA })}`, USUARIOS.visorB);
    expect(r.status).toBe(404);
  });

  it('el cache no mezcla: sin corte, con corte y con dos instantes distintos', async () => {
    const pedir = async (alturaAl?: string) =>
      (await get(`/ventas/resumen?${Q({ ...filtro, alturaAl })}`)).body.venta as string;
    // Las cuatro dentro del mismo TTL: si compartieran llave, repetirían la primera.
    expect(await pedir()).toBe('420.00');
    expect(await pedir(ALTURA)).toBe('160.00');
    // 20:00Z = 14:00 CDMX y 13:00 Tijuana: X1 y Y1 también quedan fuera → sólo X3.
    expect(await pedir('2026-09-21T20:00:00Z')).toBe('50.00');
    expect(await pedir(ALTURA)).toBe('160.00');
  });
});
