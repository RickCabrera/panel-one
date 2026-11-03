import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { FormaPago, PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';

// E2E de los cortes (MVP de cortes) sobre la app REAL contra Postgres REAL: los turnos y los
// cheques entran por la INGESTA (como los mandaría el agente) y cada cifra esperada está
// calculada a mano aquí abajo, no leída de otro endpoint.
//
// A1 y A2 en CDMX (UTC−6 en octubre de 2026). Las keys son sintéticas.
//
// Turnos de A1 (como `dbo.turnos` de SR):
// | turnoSr | apertura (local)   | cierre (local)     | fondo  | declarado ef / tar / vales / créd |
// |---------|--------------------|--------------------|--------|-----------------------------------|
// | 7       | lun 19-oct 09:00   | jue 22-oct 14:05   | 500.00 | 1000.00 / 228.00 / 0 / 0           |
// | 8       | jue 22-oct 14:06   | — (abierto)        | 300.00 | 0 / 0 / 0 / 0                     |
//
// Cuentas (cheques), con el `turnoSr` del cobro:
// | folio | suc | turno | total  | prop  | desc  | com  | pagos                               | partidas                    |
// |-------|-----|-------|--------|-------|-------|------|-------------------------------------|-----------------------------|
// | K1    | A1  | 7     | 315.50 | 25.50 | 0     | 3    | EFECTIVO 200 + TARJETA VISA 115.50  | Agua 175 ×1.5, Taco 75 ×3   |
// | K2    | A1  | 7     | 100.00 | 0     | 10.00 | null | EFECTIVO 60 + CORTESIA RARA 40      | Taco 100 ×4                 |
// | K3    | A1  | 7     | 50.00 CANCELADA (no suma)                                                                    |
// | K4    | A1  | 8     | 108.00 | 0     | 0     | 2    | TARJETA VISA 108                    | Café 108 ×1                 |
// | K5    | A1  | —     | 999.00 (sin turno: no entra a ningún corte)                                                  |
// | X1    | A2  | 7     | 777.00 (MISMO idturno en OTRA sucursal: no se mezcla con el 7 de A1)                         |
//
// Catálogo de formas de la empresa A: EFECTIVO → efectivo, TARJETA VISA → tarjeta.
//
// Turno 7: venta 315.50 + 100.00 = 415.50 en 2 cuentas → ticket 207.75. Cobrado por forma:
// efectivo 200 + 60 = 260.00; tarjeta 115.50; otro 40.00 (CORTESIA RARA, sin catálogo).
// Cuadre: efectivo 1000.00 − 260.00 = 740.00; tarjeta 228.00 − 115.50 = 112.50; total
// 1228.00 − 415.50 = 812.50.

const KEYS = {
  a1: 'msr_sintetica-cortes-mvp-sucursal-a1-0000000000000001',
  a2: 'msr_sintetica-cortes-mvp-sucursal-a2-0000000000000002',
  b1: 'msr_sintetica-cortes-mvp-sucursal-b1-0000000000000003',
} as const;

type Evento = Record<string, unknown>;
type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

function turno(id: string, turnoSr: string, cambios: Record<string, unknown> = {}): Evento {
  return {
    id,
    tipo: 'turno',
    datos: {
      turnoSr,
      aperturaAt: '2026-10-19T09:00:00.000-06:00',
      cierreAt: '2026-10-22T14:05:00.000-06:00',
      estacion: 'CAJA1',
      fondo: '500.00',
      declaradoEfectivo: '1000.00',
      declaradoTarjeta: '228',
      declaradoVales: '0',
      declaradoCredito: '0',
      ...cambios,
    },
  };
}

function cheque(
  id: string,
  folioSr: string,
  turnoSr: string | null | undefined,
  cambios: Record<string, unknown> = {},
): Evento {
  return {
    id,
    tipo: 'cheque',
    datos: {
      folioSr,
      folio: folioSr,
      abiertoAt: '2026-10-21T19:00:00.000-06:00',
      cerradoAt: '2026-10-21T20:00:00.000-06:00',
      mesa: '12',
      mesero: 'MESERO SINTETICO',
      comensales: null,
      subtotal: '0',
      impuestos: '0',
      descuentos: '0',
      propina: '0',
      total: '0',
      cancelado: false,
      partidas: [],
      pagos: [],
      ...(turnoSr === undefined ? {} : { turnoSr }),
      ...cambios,
    },
  };
}

const partida = (producto: string, cantidad: string, total: string) => ({
  producto,
  cantidad,
  precioUnit: total,
  total,
});

const Q = (o: Record<string, string | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

describe('Cortes (turnos de SR): ingesta y lectura (e2e, MVP)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  async function get(ruta: string, u: Usuario = USUARIOS.visorA) {
    return request(app.getHttpServer())
      .get(ruta)
      .set('Authorization', `Bearer ${await token(u)}`);
  }
  async function lote(key: string, eventos: Evento[]) {
    const res = await request(app.getHttpServer())
      .post('/ingesta/eventos')
      .set('X-Api-Key', key)
      .send({ eventos });
    expect(res.status).toBe(200);
    return res.body as {
      procesados: string[];
      rechazados: { id: string | null; indice: number; motivo: string; reintentable: boolean }[];
    };
  }
  const turnoDe = (sucursalId: string, turnoSr: string) =>
    prisma.turno.findFirstOrThrow({ where: { sucursalId, turnoSr } });

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    for (const [id, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalA2, KEYS.a2],
      [FX.sucursalB1, KEYS.b1],
    ] as const) {
      await prisma.sucursal.update({
        where: { id },
        data: { apiKeyHash: hashApiKey(key), zonaHoraria: 'America/Mexico_City' },
      });
    }
    await prisma.formaPagoCatalogo.createMany({
      data: [
        { empresaId: FX.empresaA, formaRaw: 'EFECTIVO', forma: FormaPago.efectivo },
        { empresaId: FX.empresaA, formaRaw: 'TARJETA VISA', forma: FormaPago.tarjeta },
      ],
    });
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.init();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app?.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('ingesta del evento turno', () => {
    it('upsert por (sucursal, turnoSr): abierto y luego cerrado deja UNA fila con lo último', async () => {
      const abierto = turno('t1', '7', {
        cierreAt: null,
        declaradoEfectivo: '0',
        declaradoTarjeta: '0',
      });
      expect(await lote(KEYS.a1, [abierto])).toEqual({ procesados: ['t1'], rechazados: [] });
      expect((await turnoDe(FX.sucursalA1, '7')).cierreAt).toBeNull();

      expect(await lote(KEYS.a1, [turno('t2', '7')])).toEqual({
        procesados: ['t2'],
        rechazados: [],
      });
      const t = await turnoDe(FX.sucursalA1, '7');
      expect(await prisma.turno.count({ where: { sucursalId: FX.sucursalA1, turnoSr: '7' } })).toBe(
        1,
      );
      expect(t).toMatchObject({ empresaId: FX.empresaA, estacion: 'CAJA1' });
      expect(t.aperturaAt.toISOString()).toBe('2026-10-19T15:00:00.000Z');
      expect(t.cierreAt?.toISOString()).toBe('2026-10-22T20:05:00.000Z');
      expect(
        [
          t.fondo,
          t.declaradoEfectivo,
          t.declaradoTarjeta,
          t.declaradoVales,
          t.declaradoCredito,
        ].map((d) => d.toFixed(2)),
      ).toEqual(['500.00', '1000.00', '228.00', '0.00', '0.00']);
    });

    it('reenviar el MISMO turno tres veces deja la fila exactamente igual (ni updated_at)', async () => {
      const antes = await turnoDe(FX.sucursalA1, '7');
      for (const id of ['r1', 'r2', 'r3']) {
        expect((await lote(KEYS.a1, [turno(id, '7')])).procesados).toEqual([id]);
      }
      expect(await turnoDe(FX.sucursalA1, '7')).toEqual(antes);
    });

    it('un turno inválido se rechaza solo (no reintentable) y los demás del lote pasan', async () => {
      const r = await lote(KEYS.a1, [
        turno('m1', '99', { fondo: 'mucho' }),
        turno('m2', '8', {
          aperturaAt: '2026-10-22T14:06:00.000-06:00',
          cierreAt: null,
          fondo: '300',
          declaradoEfectivo: '0',
          declaradoTarjeta: '0',
        }),
        turno('m3', '98', { aperturaAt: '2026-10-19T09:00:00' }),
        turno('m4', '97', { empresaId: FX.empresaB }),
      ]);
      expect(r.procesados).toEqual(['m2']);
      expect(r.rechazados.map((x) => [x.id, x.reintentable])).toEqual([
        ['m1', false],
        ['m3', false],
        ['m4', false],
      ]);
      expect(r.rechazados[0].motivo).toContain('datos.fondo');
      expect(await prisma.turno.count({ where: { turnoSr: { in: ['99', '98', '97'] } } })).toBe(0);
    });

    it('la sucursal sale de la API key: el mismo turnoSr en otra sucursal es OTRO turno', async () => {
      await lote(KEYS.b1, [turno('b1', '7')]);
      const deB = await turnoDe(FX.sucursalB1, '7');
      expect(deB.empresaId).toBe(FX.empresaB);
      expect(await prisma.turno.count({ where: { turnoSr: '7' } })).toBe(2);
    });

    it('el cheque guarda su turnoSr; llegar después con turno es un cambio y lo reescribe', async () => {
      await lote(KEYS.a1, [cheque('k0', 'K1', undefined, { total: '315.50' })]);
      expect(
        (await prisma.cheque.findFirstOrThrow({ where: { folioSr: 'K1' } })).turnoSr,
      ).toBeNull();
      await lote(KEYS.a1, [cheque('k0b', 'K1', '7', { total: '315.50' })]);
      expect((await prisma.cheque.findFirstOrThrow({ where: { folioSr: 'K1' } })).turnoSr).toBe(
        '7',
      );
      // Sólo espacios = sin turno; más de 64 caracteres se rechaza.
      const r = await lote(KEYS.a1, [
        cheque('k0c', 'KX', '   '),
        cheque('k0d', 'KY', 'x'.repeat(65)),
      ]);
      expect(r.procesados).toEqual(['k0c']);
      expect(
        (await prisma.cheque.findFirstOrThrow({ where: { folioSr: 'KX' } })).turnoSr,
      ).toBeNull();
      await prisma.cheque.deleteMany({ where: { folioSr: 'KX' } });
    });

    it('reenviar el MISMO cheque con turnoSr no lo reescribe (ni updated_at)', async () => {
      const antes = await prisma.cheque.findFirstOrThrow({ where: { folioSr: 'K1' } });
      expect(antes.turnoSr).toBe('7');
      for (const id of ['k1r1', 'k1r2', 'k1r3']) {
        await lote(KEYS.a1, [cheque(id, 'K1', '7', { total: '315.50' })]);
      }
      const despues = await prisma.cheque.findFirstOrThrow({ where: { folioSr: 'K1' } });
      expect(despues.updatedAt.getTime()).toBe(antes.updatedAt.getTime());
      expect(despues).toEqual(antes);
    });

    it('la base: (sucursal_id, turno_sr) es ÚNICO y hay índice por empresa', async () => {
      const filas = await prisma.$queryRaw<{ indexdef: string }[]>`
        SELECT indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename = 'turnos'`;
      const defs = filas.map((f) => f.indexdef);
      expect(defs).toContain(
        'CREATE UNIQUE INDEX turnos_sucursal_id_turno_sr_key ON public.turnos USING btree (sucursal_id, turno_sr)',
      );
      expect(defs.some((d) => /USING btree \(empresa_id[,)]/.test(d))).toBe(true);
    });
  });

  describe('lectura de cortes', () => {
    let t7: string;
    let t8: string;
    let tB: string;

    beforeAll(async () => {
      const r = await lote(KEYS.a1, [
        cheque('c1', 'K1', '7', {
          total: '315.50',
          subtotal: '271.98',
          propina: '25.50',
          comensales: 3,
          partidas: [
            partida('Agua sintética', '1.5', '175.00'),
            partida('Taco sintético', '3', '75.00'),
          ],
          pagos: [
            { formaRaw: 'EFECTIVO', monto: '200.00' },
            { formaRaw: 'TARJETA VISA', monto: '115.50' },
          ],
        }),
        cheque('c2', 'K2', '7', {
          total: '100.00',
          descuentos: '10.00',
          partidas: [partida('Taco sintético', '4', '100.00')],
          pagos: [
            { formaRaw: 'EFECTIVO', monto: '60' },
            { formaRaw: 'CORTESIA RARA', monto: '40' },
          ],
        }),
        cheque('c3', 'K3', '7', { total: '50.00', cancelado: true }),
        cheque('c4', 'K4', '8', {
          cerradoAt: '2026-10-22T15:00:00.000-06:00',
          total: '108.00',
          comensales: 2,
          partidas: [partida('Café sintético', '1', '108.00')],
          pagos: [{ formaRaw: 'TARJETA VISA', monto: '108.00' }],
        }),
        cheque('c5', 'K5', null, { total: '999.00' }),
      ]);
      expect(r.rechazados).toEqual([]);
      expect(
        (await lote(KEYS.a2, [cheque('x1', 'X1', '7', { total: '777.00' })])).rechazados,
      ).toEqual([]);
      t7 = (await turnoDe(FX.sucursalA1, '7')).id;
      t8 = (await turnoDe(FX.sucursalA1, '8')).id;
      tB = (await turnoDe(FX.sucursalB1, '7')).id;
    });

    it('lista: los turnos abiertos en el rango, el más reciente primero, con su venta', async () => {
      const r = await get(
        `/cortes?${Q({ empresaId: FX.empresaA, desde: '2026-10-22', hasta: '2026-10-22' })}`,
      );
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        truncado: false,
        cortes: [
          {
            id: t8,
            sucursalId: FX.sucursalA1,
            sucursal: 'A1',
            zonaHoraria: 'America/Mexico_City',
            turnoSr: '8',
            aperturaAt: '2026-10-22T20:06:00.000Z',
            cierreAt: null,
            abierto: true,
            estacion: 'CAJA1',
            fondo: '300.00',
            venta: '108.00',
            cuentas: 1,
            ticketPromedio: '108.00',
            posiblementeIncompleto: false,
          },
          {
            id: t7,
            sucursalId: FX.sucursalA1,
            sucursal: 'A1',
            zonaHoraria: 'America/Mexico_City',
            turnoSr: '7',
            aperturaAt: '2026-10-19T15:00:00.000Z',
            cierreAt: '2026-10-22T20:05:00.000Z',
            abierto: false,
            estacion: 'CAJA1',
            fondo: '500.00',
            // K1 + K2; ni la cancelada K3, ni K5 sin turno, ni X1 (el 7 de OTRA sucursal).
            venta: '415.50',
            cuentas: 2,
            ticketPromedio: '207.75',
            posiblementeIncompleto: true,
          },
        ],
      });
    });

    it('lista: el rango se corta en la zona de la sucursal (turno cerrado antes no entra)', async () => {
      const despues = await get(
        `/cortes?${Q({ empresaId: FX.empresaA, desde: '2026-10-23', hasta: '2026-10-31' })}`,
      );
      // El 8 sigue abierto: entra aunque haya empezado antes del rango.
      expect(despues.body.cortes.map((c: { turnoSr: string }) => c.turnoSr)).toEqual(['8']);
      // El 7 abrió el 19 a las 09:00 local: el rango del 1 al 18 termina a la medianoche local.
      const antes = await get(
        `/cortes?${Q({ empresaId: FX.empresaA, desde: '2026-10-01', hasta: '2026-10-18' })}`,
      );
      expect(antes.body).toEqual({ cortes: [], truncado: false });
      const soloA2 = await get(
        `/cortes?${Q({ empresaId: FX.empresaA, sucursalId: FX.sucursalA2, desde: '2026-10-01', hasta: '2026-10-31' })}`,
      );
      expect(soloA2.body).toEqual({ cortes: [], truncado: false });
    });

    it('detalle del turno cerrado: cifras a mano, formas con catálogo y declarado vs cobrado', async () => {
      const r = await get(`/cortes/${t7}`);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({
        id: t7,
        sucursalId: FX.sucursalA1,
        sucursal: 'A1',
        zonaHoraria: 'America/Mexico_City',
        turnoSr: '7',
        aperturaAt: '2026-10-19T15:00:00.000Z',
        cierreAt: '2026-10-22T20:05:00.000Z',
        abierto: false,
        estacion: 'CAJA1',
        fondo: '500.00',
        venta: '415.50',
        cuentas: 2,
        ticketPromedio: '207.75',
        // Cerrado el 22-oct, antes de que llegara a la API el primer turno de A1.
        posiblementeIncompleto: true,
        comensales: { total: 3, cuentasConDato: 1 },
        propina: '25.50',
        descuentos: { monto: '10.00', cuentas: 1 },
        cancelados: { cuentas: 1, monto: '50.00' },
        formasPago: {
          formas: [
            { forma: 'efectivo', monto: '260.00' },
            { forma: 'tarjeta', monto: '115.50' },
            { forma: 'transferencia', monto: '0.00' },
            { forma: 'otro', monto: '40.00' },
          ],
          sinCatalogo: [{ formaRaw: 'CORTESIA RARA', monto: '40.00' }],
        },
        cobrado: '415.50',
        cuadre: [
          { concepto: 'efectivo', declarado: '1000.00', cobrado: '260.00', diferencia: '740.00' },
          { concepto: 'tarjeta', declarado: '228.00', cobrado: '115.50', diferencia: '112.50' },
          { concepto: 'vales', declarado: '0.00', cobrado: null, diferencia: null },
          { concepto: 'credito', declarado: '0.00', cobrado: null, diferencia: null },
          { concepto: 'total', declarado: '1228.00', cobrado: '415.50', diferencia: '812.50' },
        ],
        topProductos: [
          // Empate en importe (175.00): por nombre.
          { producto: 'Agua sintética', importe: '175.00', cantidad: '1.500' },
          { producto: 'Taco sintético', importe: '175.00', cantidad: '7.000' },
        ],
      });
    });

    it('detalle del turno abierto: acumulado en curso, sin diferencias de cuadre', async () => {
      const r = await get(`/cortes/${t8}`);
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        abierto: true,
        cierreAt: null,
        venta: '108.00',
        cuentas: 1,
        comensales: { total: 2, cuentasConDato: 1 },
        cobrado: '108.00',
        cancelados: { cuentas: 0, monto: '0.00' },
      });
      expect(r.body.cuadre.map((c: { diferencia: string | null }) => c.diferencia)).toEqual([
        null,
        null,
        null,
        null,
        null,
      ]);
    });

    it('un turno cerrado DESPUÉS de que llegó el primer turno de la sucursal no es incompleto', async () => {
      // Abre y cierra en 2030: después de la primera llegada (hoy). Su venta está completa.
      await lote(KEYS.a1, [
        turno('n1', '9', {
          aperturaAt: '2030-01-01T09:00:00.000-06:00',
          cierreAt: '2030-01-01T18:00:00.000-06:00',
        }),
      ]);
      const r = await get(
        `/cortes?${Q({ empresaId: FX.empresaA, desde: '2030-01-01', hasta: '2030-01-01' })}`,
      );
      expect(
        r.body.cortes.map((c: { turnoSr: string; posiblementeIncompleto: boolean }) => [
          c.turnoSr,
          c.posiblementeIncompleto,
        ]),
      ).toEqual([
        ['9', false],
        // El 8 sigue abierto (entra en cualquier rango posterior) y abierto nunca es incompleto.
        ['8', false],
      ]);
      const t9 = (await turnoDe(FX.sucursalA1, '9')).id;
      expect((await get(`/cortes/${t9}`)).body.posiblementeIncompleto).toBe(false);
      expect((await get(`/cortes/${t7}`)).body.posiblementeIncompleto).toBe(true);
    });

    it('en curso: sólo los turnos sin cierre, con lo cobrado hasta ahora', async () => {
      const r = await get(`/cortes/en-curso?${Q({ empresaId: FX.empresaA })}`);
      expect(r.status).toBe(200);
      expect(r.body.map((c: { id: string; venta: string }) => [c.id, c.venta])).toEqual([
        [t8, '108.00'],
      ]);
      const a2 = await get(
        `/cortes/en-curso?${Q({ empresaId: FX.empresaA, sucursalId: FX.sucursalA2 })}`,
      );
      expect(a2.body).toEqual([]);
    });

    it('scoping por rol: admin de A y admin_global ven; visor de B recibe 404 (nunca 403)', async () => {
      expect((await get(`/cortes/${t7}`, USUARIOS.adminEmpresaA)).status).toBe(200);
      expect((await get(`/cortes/${t7}`, USUARIOS.adminGlobal)).body.venta).toBe('415.50');

      const ajeno = await get(`/cortes/${t7}`, USUARIOS.visorB);
      const inexistente = await get(`/cortes/${FX.inexistente}`, USUARIOS.visorB);
      expect(ajeno.status).toBe(404);
      expect(ajeno.body).toEqual(inexistente.body);

      // Y al revés: el turno de B no existe para el visor de A.
      expect((await get(`/cortes/${tB}`)).status).toBe(404);

      const filtroA = { empresaId: FX.empresaA, desde: '2026-10-01', hasta: '2026-10-31' };
      expect((await get(`/cortes?${Q(filtroA)}`, USUARIOS.visorB)).status).toBe(404);
      expect(
        (await get(`/cortes/en-curso?${Q({ empresaId: FX.empresaA })}`, USUARIOS.visorB)).status,
      ).toBe(404);
      // Una sucursal de B bajo la empresa A: 404, ni para admin_global.
      expect(
        (await get(`/cortes?${Q({ ...filtroA, sucursalId: FX.sucursalB1 })}`, USUARIOS.adminGlobal))
          .status,
      ).toBe(404);
    });

    it('400: id que no es UUID, días inválidos, rango al revés; 401 sin token', async () => {
      expect((await get('/cortes/no-es-uuid')).status).toBe(400);
      expect(
        (
          await get(
            `/cortes?${Q({ empresaId: FX.empresaA, desde: '2026-02-30', hasta: '2026-03-01' })}`,
          )
        ).status,
      ).toBe(400);
      expect(
        (
          await get(
            `/cortes?${Q({ empresaId: FX.empresaA, desde: '2026-10-05', hasta: '2026-10-01' })}`,
          )
        ).status,
      ).toBe(400);
      expect((await request(app.getHttpServer()).get(`/cortes/${t7}`)).status).toBe(401);
    });
  });
});
