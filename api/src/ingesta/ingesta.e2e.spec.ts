import { request as httpRequest } from 'node:http';
import { gzipSync } from 'node:zlib';

import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';

// E2E de la ingesta (F1-031) sobre la app REAL (AppModule + configurarApp)
// contra Postgres REAL, con las fixtures sintéticas de F1-011 (A1 y A2 de la
// empresa A, B1 de la B). Las keys son sintéticas y su hash se escribe directo.
//
// RATE LIMIT: 120/min por sucursal y por instancia de app. Este archivo manda
// unas decenas de requests por sucursal; si crece, abre otra app.

const KEYS = {
  a1: 'msr_sintetica-ingesta-F1-031-sucursal-a1-000000000001',
  a2: 'msr_sintetica-ingesta-F1-031-sucursal-a2-000000000002',
  b1: 'msr_sintetica-ingesta-F1-031-sucursal-b1-000000000003',
} as const;

type Evento = Record<string, unknown>;

function eventoCheque(id: string, folioSr: string, cambios: Record<string, unknown> = {}): Evento {
  return {
    id,
    tipo: 'cheque',
    datos: {
      folioSr,
      folio: `T-${folioSr}`,
      abiertoAt: '2026-09-20T19:00:00.000-06:00',
      cerradoAt: '2026-09-20T20:15:30.5-06:00',
      mesa: '12',
      mesero: 'MESERO SINTETICO',
      comensales: 3,
      subtotal: '250.00',
      impuestos: '40.00',
      descuentos: '0',
      propina: '25.5',
      total: '315.50',
      cancelado: false,
      partidas: [
        {
          producto: 'Taco sintético',
          categoria: 'Tacos',
          cantidad: '3',
          precioUnit: '25.00',
          total: '75.00',
          modificadores: [
            { nombre: 'Sin cebolla', precio: '0' },
            { nombre: 'Extra queso', precio: '10.005' },
          ],
        },
        { producto: 'Agua sintética', cantidad: '1.5', precioUnit: '116.6667', total: '175.0000' },
      ],
      pagos: [
        { formaRaw: 'EFECTIVO', monto: '200.00' },
        { formaRaw: 'TARJETA VISA', monto: '115.50' },
      ],
      ...cambios,
    },
  };
}

function eventoSnapshot(id: string, capturadoAt: Date, mesas: Evento[] = [{ mesa: '12' }]): Evento {
  return { id, tipo: 'snapshot', datos: { capturadoAt: capturadoAt.toISOString(), mesas } };
}

function eventoHeartbeat(id: string, datos: Record<string, unknown> = {}): Evento {
  return {
    id,
    tipo: 'heartbeat',
    datos: {
      versionAgente: '0.1.0',
      versionSr: '10.0',
      ultimaLecturaAt: '2026-09-20T20:16:00Z',
      ultimoError: null,
      ...datos,
    },
  };
}

const hace = (horas: number) => new Date(Date.now() - horas * 3_600_000);

describe('POST /ingesta/eventos (e2e, F1-031)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  function enviar(key: string | null, body: unknown) {
    const r = request(url).post('/ingesta/eventos');
    return (key === null ? r : r.set('X-Api-Key', key)).send(body as object);
  }

  /** POST con http crudo: el body sale tal cual, byte por byte. */
  function postCrudo(
    cuerpo: Buffer,
    headers: Record<string, string>,
  ): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        `${url}/ingesta/eventos`,
        { method: 'POST', headers: { ...headers, 'Content-Length': String(cuerpo.length) } },
        (res) => {
          let body = '';
          res.setEncoding('utf8');
          res.on('data', (c: string) => (body += c));
          res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
        },
      );
      req.on('error', reject);
      req.end(cuerpo);
    });
  }

  async function lote(key: string, eventos: Evento[]) {
    const res = await enviar(key, { eventos });
    expect(res.status).toBe(200);
    return res.body as {
      procesados: string[];
      rechazados: { id: string | null; indice: number; motivo: string; reintentable: boolean }[];
    };
  }

  /**
   * Todo lo que la ingesta escribe de una sucursal, TODAS las columnas (ids,
   * `updated_at` y `recibido_at` incluidos), serializado como lo vería alguien
   * que lee la base.
   *
   * `agente_contacto` (F1-061) queda FUERA de esta foto A PROPÓSITO, y no es
   * precedente para excluir ninguna otra tabla: no es dato de la ingesta sino
   * "cuándo nos habló el agente" (reloj del servidor), y un reenvío lo mueve
   * porque el agente sí volvió a hablar. Su comportamiento se prueba en
   * `agentes/estado-agentes.e2e.spec.ts`.
   */
  async function foto(sucursalId: string) {
    const cheques = await prisma.cheque.findMany({ where: { sucursalId }, orderBy: { id: 'asc' } });
    const ids = cheques.map((c) => c.id);
    const [partidas, pagos, snapshots, estado] = await Promise.all([
      prisma.chequePartida.findMany({ where: { chequeId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.chequePago.findMany({ where: { chequeId: { in: ids } }, orderBy: { id: 'asc' } }),
      prisma.mesaSnapshot.findMany({ where: { sucursalId }, orderBy: { id: 'asc' } }),
      prisma.agenteEstado.findMany({ where: { sucursalId } }),
    ]);
    return JSON.parse(JSON.stringify({ cheques, partidas, pagos, snapshots, estado }));
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({
      where: { id: FX.sucursalA1 },
      data: { apiKeyHash: hashApiKey(KEYS.a1) },
    });
    await prisma.sucursal.update({
      where: { id: FX.sucursalA2 },
      data: { apiKeyHash: hashApiKey(KEYS.a2) },
    });
    await prisma.sucursal.update({
      where: { id: FX.sucursalB1 },
      data: { apiKeyHash: hashApiKey(KEYS.b1) },
    });
    // Las fallas esperadas (choques de lotes en vuelo) se loguean con Logger.error.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    // Escuchando en un puerto real: los requests en paralelo del test de
    // concurrencia no pueden abrir cada uno su puerto efímero (ECONNREFUSED).
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('autenticación', () => {
    it('sin X-Api-Key → 401 y no escribe nada', async () => {
      const res = await enviar(null, { eventos: [eventoCheque('x', 'AUTH-1')] });
      expect(res.status).toBe(401);
      expect(await prisma.cheque.count({ where: { folioSr: 'AUTH-1' } })).toBe(0);
    });

    it('un Bearer de usuario (aunque sea admin_global) NO abre la ruta de agente', async () => {
      const u = USUARIOS.adminGlobal;
      const token = await app.get(TokensService).firmarAccess({
        id: u.id,
        rol: u.rol,
        empresaId: u.empresaId,
      });
      const res = await request(url)
        .post('/ingesta/eventos')
        .set('Authorization', `Bearer ${token}`)
        .send({ eventos: [eventoCheque('x', 'AUTH-2')] });
      expect(res.status).toBe(401);
      expect(await prisma.cheque.count({ where: { folioSr: 'AUTH-2' } })).toBe(0);
    });
  });

  describe('lote mixto válido', () => {
    it('guarda cheques, snapshot y heartbeat en la sucursal de la KEY, con importes exactos', async () => {
      const capturado = hace(0.1);
      const r = await lote(KEYS.a1, [
        eventoCheque('c1', 'MIX-1'),
        eventoCheque('c2', 'MIX-2', { cerradoAt: null, comensales: null, mesa: null }),
        eventoSnapshot('s1', capturado),
        eventoHeartbeat('h1'),
      ]);
      expect(r).toEqual({ procesados: ['c1', 'c2', 's1', 'h1'], rechazados: [] });

      const c = await prisma.cheque.findFirstOrThrow({
        where: { folioSr: 'MIX-1' },
        include: { partidas: { orderBy: { orden: 'asc' } }, pagos: { orderBy: { monto: 'desc' } } },
      });
      expect(c).toMatchObject({
        sucursalId: FX.sucursalA1,
        empresaId: FX.empresaA,
        folio: 'T-MIX-1',
        mesa: '12',
        comensales: 3,
        cancelado: false,
      });
      expect(c.abiertoAt.toISOString()).toBe('2026-09-21T01:00:00.000Z');
      expect(c.cerradoAt?.toISOString()).toBe('2026-09-21T02:15:30.500Z');
      expect(
        [c.subtotal, c.impuestos, c.descuentos, c.propina, c.total].map((d) => d.toFixed(2)),
      ).toEqual(['250.00', '40.00', '0.00', '25.50', '315.50']);
      expect(
        c.partidas.map((p) => [
          p.orden,
          p.producto,
          p.categoria,
          p.cantidad.toFixed(3),
          p.precioUnit.toFixed(2),
          p.total.toFixed(2),
          p.empresaId,
        ]),
      ).toEqual([
        [0, 'Taco sintético', 'Tacos', '3.000', '25.00', '75.00', FX.empresaA],
        [1, 'Agua sintética', null, '1.500', '116.67', '175.00', FX.empresaA],
      ]);
      expect(c.partidas[0].modificadores).toEqual([
        { nombre: 'Sin cebolla', precio: '0.00' },
        { nombre: 'Extra queso', precio: '10.01' },
      ]);
      expect(c.partidas[1].modificadores).toEqual([]);
      expect(c.pagos.map((p) => [p.forma, p.formaRaw, p.monto.toFixed(2)])).toEqual([
        ['otro', 'EFECTIVO', '200.00'],
        ['otro', 'TARJETA VISA', '115.50'],
      ]);

      const c2 = await prisma.cheque.findFirstOrThrow({ where: { folioSr: 'MIX-2' } });
      expect(c2).toMatchObject({ cerradoAt: null, comensales: null, mesa: null });

      const snap = await prisma.mesaSnapshot.findFirstOrThrow({
        where: { sucursalId: FX.sucursalA1, capturadoAt: capturado },
      });
      expect(snap).toMatchObject({ empresaId: FX.empresaA, payload: { mesas: [{ mesa: '12' }] } });

      const estado = await prisma.agenteEstado.findUniqueOrThrow({
        where: { sucursalId: FX.sucursalA1 },
      });
      expect(estado).toMatchObject({
        empresaId: FX.empresaA,
        versionAgente: '0.1.0',
        versionSr: '10.0',
        ultimoError: null,
      });
      expect(estado.ultimaLecturaAt?.toISOString()).toBe('2026-09-20T20:16:00.000Z');
    });
  });

  describe('idempotencia', () => {
    it('reenviar el MISMO lote 3 veces deja exactamente los mismos datos (ids y updated_at incluidos)', async () => {
      const eventos = [
        eventoCheque('i1', 'IDEM-1'),
        eventoCheque('i2', 'IDEM-2', { cancelado: true, cerradoAt: null }),
        eventoSnapshot('i3', hace(0.2)),
        eventoHeartbeat('i4', { ultimaLecturaAt: '2026-09-20T21:00:00Z' }),
      ];
      const primera = await lote(KEYS.a1, eventos);
      expect(primera.rechazados).toEqual([]);
      const despuesDeUna = await foto(FX.sucursalA1);

      for (let i = 0; i < 2; i++) {
        const otra = await lote(KEYS.a1, eventos);
        expect(otra).toEqual(primera);
      }
      expect(await foto(FX.sucursalA1)).toEqual(despuesDeUna);
      expect(await prisma.cheque.count({ where: { folioSr: { startsWith: 'IDEM-' } } })).toBe(2);
    });

    it('un cheque reenviado CON cambios se reemplaza: partidas y pagos no se acumulan', async () => {
      await lote(KEYS.a1, [eventoCheque('r1', 'REEM-1')]);
      const antes = await prisma.cheque.findFirstOrThrow({ where: { folioSr: 'REEM-1' } });

      // Reapertura/cancelación en SR: una partida menos, otro pago, cancelado, y
      // un total que NO es la suma de las partidas (se guarda como lo manda SR).
      const r = await lote(KEYS.a1, [
        eventoCheque('r2', 'REEM-1', {
          cancelado: true,
          total: '999.99',
          partidas: [{ producto: 'Sólo esto', cantidad: '1', precioUnit: '10', total: '10' }],
          pagos: [{ formaRaw: 'TRANSFERENCIA', monto: '999.99' }],
        }),
      ]);
      expect(r.procesados).toEqual(['r2']);

      const despues = await prisma.cheque.findFirstOrThrow({
        where: { folioSr: 'REEM-1' },
        include: { partidas: true, pagos: true },
      });
      expect(despues.id).toBe(antes.id);
      expect(despues.cancelado).toBe(true);
      expect(despues.total.toFixed(2)).toBe('999.99');
      expect(despues.partidas.map((p) => p.producto)).toEqual(['Sólo esto']);
      expect(despues.pagos.map((p) => [p.formaRaw, p.monto.toFixed(2)])).toEqual([
        ['TRANSFERENCIA', '999.99'],
      ]);
      expect(await prisma.chequePartida.count({ where: { chequeId: antes.id } })).toBe(1);
      expect(await prisma.chequePago.count({ where: { chequeId: antes.id } })).toBe(1);
    });

    it('el mismo lote 3 veces EN PARALELO: un solo cheque, sin partidas ni pagos duplicados', async () => {
      const eventos = [eventoCheque('p1', 'PAR-1'), eventoCheque('p2', 'PAR-2')];
      const respuestas = await Promise.all([1, 2, 3].map(() => enviar(KEYS.a1, { eventos })));

      for (const res of respuestas) {
        expect(res.status).toBe(200);
        const { procesados, rechazados } = res.body as {
          procesados: string[];
          rechazados: { id: string; reintentable: boolean }[];
        };
        // Cada evento sale procesado o, si chocó con otro lote en vuelo, reintentable.
        expect([...procesados, ...rechazados.map((x) => x.id)].sort()).toEqual(['p1', 'p2']);
        expect(rechazados.every((x) => x.reintentable)).toBe(true);
      }
      for (const folioSr of ['PAR-1', 'PAR-2']) {
        const c = await prisma.cheque.findMany({ where: { folioSr, sucursalId: FX.sucursalA1 } });
        expect(c).toHaveLength(1);
        expect(await prisma.chequePartida.count({ where: { chequeId: c[0].id } })).toBe(2);
        expect(await prisma.chequePago.count({ where: { chequeId: c[0].id } })).toBe(2);
      }
    });
  });

  describe('un evento inválido no tumba el lote', () => {
    it('cada inválido sale en `rechazados` con su índice, sin reintento, y los válidos se guardan', async () => {
      const valido = eventoCheque('ok1', 'INV-OK');
      const conDatos = (cambios: Record<string, unknown>, id: string, folio: string) =>
        eventoCheque(id, folio, cambios);
      const eventos: Evento[] = [
        valido,
        conDatos({ total: 315.5 }, 'bad-numero', 'INV-1'),
        conDatos({ abiertoAt: '2026-09-20T19:00:00' }, 'bad-sin-zona', 'INV-2'),
        { id: 'bad-tipo', tipo: 'venta', datos: {} },
        conDatos({ sucursalId: FX.sucursalB1 }, 'bad-tenant', 'INV-3'),
        { tipo: 'heartbeat', datos: { versionAgente: '9.9.9' } },
        conDatos({ total: '9999999999.9999' }, 'bad-desborda', 'INV-4'),
        { ...eventoHeartbeat('bad-empresa'), empresaId: FX.empresaB },
        conDatos({ folioSr: undefined }, 'bad-sin-folio', 'INV-5'),
        eventoHeartbeat('ok2', { versionAgente: '0.2.0', ultimaLecturaAt: '2026-09-20T22:00:00Z' }),
      ];
      const r = await lote(KEYS.a2, eventos);

      expect(r.procesados).toEqual(['ok1', 'ok2']);
      expect(r.rechazados.map((x) => [x.indice, x.id, x.reintentable])).toEqual([
        [1, 'bad-numero', false],
        [2, 'bad-sin-zona', false],
        [3, 'bad-tipo', false],
        [4, 'bad-tenant', false],
        [5, null, false],
        [6, 'bad-desborda', false],
        [7, 'bad-empresa', false],
        [8, 'bad-sin-folio', false],
      ]);
      const motivo = (i: number) => r.rechazados.find((x) => x.indice === i)?.motivo;
      expect(motivo(1)).toContain('datos.total');
      expect(motivo(2)).toContain('datos.abiertoAt');
      expect(motivo(3)).toContain('tipo');
      expect(motivo(4)).toContain('sucursalId');
      expect(motivo(5)).toContain('id');
      expect(motivo(6)).toMatch(/datos\.total.*NUMERIC/);
      expect(motivo(7)).toContain('empresaId');
      expect(motivo(8)).toContain('datos.folioSr');

      expect(await prisma.cheque.count({ where: { folioSr: 'INV-OK' } })).toBe(1);
      expect(await prisma.cheque.count({ where: { folioSr: { startsWith: 'INV-' } } })).toBe(1);
      expect(await prisma.cheque.count({ where: { sucursalId: FX.sucursalB1 } })).toBe(0);
      await expect(
        prisma.agenteEstado.findUniqueOrThrow({ where: { sucursalId: FX.sucursalA2 } }),
      ).resolves.toMatchObject({ versionAgente: '0.2.0' });
    });
  });

  describe('aislamiento entre sucursales y empresas', () => {
    it('el mismo folioSr en A1, A2 y B1 son tres cheques; reenviar desde uno no toca a los otros', async () => {
      await lote(KEYS.a1, [eventoCheque('a1', 'ISO-1', { total: '1.00' })]);
      await lote(KEYS.a2, [eventoCheque('a2', 'ISO-1', { total: '2.00' })]);
      await lote(KEYS.b1, [eventoCheque('b1', 'ISO-1', { total: '3.00' })]);
      const fotoA2 = await foto(FX.sucursalA2);
      const fotoB1 = await foto(FX.sucursalB1);

      await lote(KEYS.a1, [eventoCheque('a1b', 'ISO-1', { total: '10.00', partidas: [] })]);

      const todos = await prisma.cheque.findMany({
        where: { folioSr: 'ISO-1' },
        orderBy: { total: 'asc' },
      });
      expect(todos.map((c) => [c.sucursalId, c.empresaId, c.total.toFixed(2)])).toEqual([
        [FX.sucursalA2, FX.empresaA, '2.00'],
        [FX.sucursalB1, FX.empresaB, '3.00'],
        [FX.sucursalA1, FX.empresaA, '10.00'],
      ]);
      expect(await foto(FX.sucursalA2)).toEqual(fotoA2);
      expect(await foto(FX.sucursalB1)).toEqual(fotoB1);
    });
  });

  describe('snapshots', () => {
    it('reenviar el mismo no duplica ni mueve recibido_at; la purga deja 24 h más el último', async () => {
      const suc = { sucursalId: FX.sucursalB1 };
      const viejo = hace(50);
      await lote(KEYS.b1, [eventoSnapshot('v1', viejo)]);
      // Solo y viejo: es el último, se conserva.
      expect(await prisma.mesaSnapshot.count({ where: suc })).toBe(1);

      const medio = hace(30);
      await lote(KEYS.b1, [eventoSnapshot('v2', medio)]);
      let quedan = await prisma.mesaSnapshot.findMany({ where: suc });
      expect(quedan.map((s) => s.capturadoAt.toISOString())).toEqual([medio.toISOString()]);

      const reciente = hace(1);
      const r1 = await lote(KEYS.b1, [eventoSnapshot('v3', reciente, [{ mesa: '1' }])]);
      expect(r1.procesados).toEqual(['v3']);
      const antes = await prisma.mesaSnapshot.findFirstOrThrow({
        where: { ...suc, capturadoAt: reciente },
      });
      quedan = await prisma.mesaSnapshot.findMany({ where: suc });
      expect(quedan.map((s) => s.capturadoAt.toISOString())).toEqual([reciente.toISOString()]);

      await lote(KEYS.b1, [eventoSnapshot('v3', reciente, [{ mesa: '1' }])]);
      const dosHoras = hace(2);
      await lote(KEYS.b1, [eventoSnapshot('v4', dosHoras)]);
      quedan = await prisma.mesaSnapshot.findMany({ where: suc, orderBy: { capturadoAt: 'asc' } });
      expect(quedan.map((s) => s.capturadoAt.toISOString())).toEqual([
        dosHoras.toISOString(),
        reciente.toISOString(),
      ]);
      const despues = quedan.find((s) => s.id === antes.id);
      expect(despues?.recibidoAt).toEqual(antes.recibidoAt);
      expect(despues?.payload).toEqual({ mesas: [{ mesa: '1' }] });
    });
  });

  describe('heartbeat', () => {
    it('uno que llega tarde (lectura anterior a la guardada) se ignora; uno sin lectura no la borra', async () => {
      const donde = { where: { sucursalId: FX.sucursalB1 } };
      await lote(KEYS.b1, [
        eventoHeartbeat('hb1', { versionAgente: '1.0.0', ultimaLecturaAt: '2026-09-20T10:00:00Z' }),
      ]);
      await lote(KEYS.b1, [
        eventoHeartbeat('hb0', { versionAgente: '0.9.0', ultimaLecturaAt: '2026-09-20T09:00:00Z' }),
      ]);
      let estado = await prisma.agenteEstado.findUniqueOrThrow(donde);
      expect(estado).toMatchObject({ empresaId: FX.empresaB, versionAgente: '1.0.0' });

      await lote(KEYS.b1, [
        eventoHeartbeat('hb2', {
          versionAgente: '1.1.0',
          ultimaLecturaAt: null,
          ultimoError: 'timeout sintético',
        }),
      ]);
      estado = await prisma.agenteEstado.findUniqueOrThrow(donde);
      expect(estado).toMatchObject({ versionAgente: '1.1.0', ultimoError: 'timeout sintético' });
      expect(estado.ultimaLecturaAt?.toISOString()).toBe('2026-09-20T10:00:00.000Z');
    });
  });

  describe('heartbeat: tamaño de cola (F1-061)', () => {
    const donde = { where: { sucursalId: FX.sucursalA2 } };

    it('se guarda; ausente = null; uno que llega tarde no lo cambia', async () => {
      await lote(KEYS.a2, [
        eventoHeartbeat('tc1', { ultimaLecturaAt: '2026-09-21T10:00:00Z', tamanoCola: 12 }),
      ]);
      expect((await prisma.agenteEstado.findUniqueOrThrow(donde)).tamanoCola).toBe(12);

      await lote(KEYS.a2, [
        eventoHeartbeat('tc0', { ultimaLecturaAt: '2026-09-21T09:00:00Z', tamanoCola: 99 }),
      ]);
      expect((await prisma.agenteEstado.findUniqueOrThrow(donde)).tamanoCola).toBe(12);

      await lote(KEYS.a2, [eventoHeartbeat('tc2', { ultimaLecturaAt: '2026-09-21T10:01:00Z' })]);
      expect((await prisma.agenteEstado.findUniqueOrThrow(donde)).tamanoCola).toBeNull();

      await lote(KEYS.a2, [
        eventoHeartbeat('tc3', { ultimaLecturaAt: '2026-09-21T10:02:00Z', tamanoCola: 0 }),
      ]);
      expect((await prisma.agenteEstado.findUniqueOrThrow(donde)).tamanoCola).toBe(0);
    });

    it.each([
      ['negativo', -1],
      ['decimal', 1.5],
      ['texto', '3'],
      ['fuera de INT', 2147483648],
    ])('tamanoCola %s → evento rechazado sin reintento, estado intacto', async (_n, valor) => {
      const antes = await foto(FX.sucursalA2);
      const r = await lote(KEYS.a2, [
        eventoHeartbeat('tc-malo', { ultimaLecturaAt: '2026-09-21T11:00:00Z', tamanoCola: valor }),
      ]);
      expect(r.procesados).toEqual([]);
      expect(r.rechazados).toEqual([
        {
          id: 'tc-malo',
          indice: 0,
          reintentable: false,
          motivo: expect.stringContaining('tamanoCola'),
        },
      ]);
      expect(await foto(FX.sucursalA2)).toEqual(antes);
    });
  });

  describe('heartbeat: latencia de la consulta a SR (F1-025)', () => {
    const donde = { where: { sucursalId: FX.sucursalA2 } };

    it('se guarda; ausente = null; uno que llega tarde no la cambia', async () => {
      await lote(KEYS.a2, [
        eventoHeartbeat('lq1', { ultimaLecturaAt: '2026-09-22T10:00:00Z', latenciaQueryMs: 37 }),
      ]);
      expect((await prisma.agenteEstado.findUniqueOrThrow(donde)).latenciaQueryMs).toBe(37);

      await lote(KEYS.a2, [
        eventoHeartbeat('lq0', { ultimaLecturaAt: '2026-09-22T09:00:00Z', latenciaQueryMs: 999 }),
      ]);
      expect((await prisma.agenteEstado.findUniqueOrThrow(donde)).latenciaQueryMs).toBe(37);

      await lote(KEYS.a2, [
        eventoHeartbeat('lq2', { ultimaLecturaAt: '2026-09-22T10:01:00Z', latenciaQueryMs: 0 }),
      ]);
      expect((await prisma.agenteEstado.findUniqueOrThrow(donde)).latenciaQueryMs).toBe(0);

      await lote(KEYS.a2, [eventoHeartbeat('lq3', { ultimaLecturaAt: '2026-09-22T10:02:00Z' })]);
      expect((await prisma.agenteEstado.findUniqueOrThrow(donde)).latenciaQueryMs).toBeNull();
    });

    it.each([
      ['negativa', -1],
      ['decimal', 12.5],
      ['texto', '12'],
      ['fuera de INT', 2147483648],
    ])('latenciaQueryMs %s → evento rechazado sin reintento, estado intacto', async (_n, valor) => {
      const antes = await foto(FX.sucursalA2);
      const r = await lote(KEYS.a2, [
        eventoHeartbeat('lq-mala', { ultimaLecturaAt: '2026-09-22T11:00:00Z', latenciaQueryMs: valor }),
      ]);
      expect(r.procesados).toEqual([]);
      expect(r.rechazados).toEqual([
        {
          id: 'lq-mala',
          indice: 0,
          reintentable: false,
          motivo: expect.stringContaining('latenciaQueryMs'),
        },
      ]);
      expect(await foto(FX.sucursalA2)).toEqual(antes);
    });

    it('el CHECK de base rechaza una latencia negativa aunque alguien brinque el DTO', async () => {
      await expect(
        prisma.agenteEstado.update({ ...donde, data: { latenciaQueryMs: -5 } }),
      ).rejects.toThrow(/agente_estado_latencia_query_ms_chk/);
    });
  });

  describe('sobre y transporte', () => {
    it.each([
      ['sin eventos', {}],
      ['eventos vacío', { eventos: [] }],
      ['eventos no es arreglo', { eventos: 'x' }],
      ['un evento que no es objeto', { eventos: [1] }],
      [
        'más de 100 eventos',
        { eventos: Array.from({ length: 101 }, (_, i) => eventoHeartbeat(`m${i}`)) },
      ],
      [
        'un campo de más en el sobre',
        { eventos: [eventoHeartbeat('x')], sucursalId: FX.sucursalB1 },
      ],
    ])('%s → 400 y no escribe nada', async (_nombre, body) => {
      const antes = await foto(FX.sucursalA2);
      const res = await enviar(KEYS.a2, body);
      expect(res.status).toBe(400);
      expect(await foto(FX.sucursalA2)).toEqual(antes);
    });

    it('acepta el body en gzip (F1-024 lo manda comprimido)', async () => {
      const cuerpo = gzipSync(JSON.stringify({ eventos: [eventoCheque('gz', 'GZIP-1')] }));
      // Con http crudo: superagent re-serializa un Buffer como JSON por el Content-Type.
      const res = await postCrudo(cuerpo, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'X-Api-Key': KEYS.a2,
      });
      expect(res.status).toBe(200);
      expect(JSON.parse(res.body)).toEqual({ procesados: ['gz'], rechazados: [] });
      expect(await prisma.cheque.count({ where: { folioSr: 'GZIP-1' } })).toBe(1);
    });

    it('un gzip que infla a más de 5 MB → 413, sin llegar a la ingesta', async () => {
      const relleno = 'x'.repeat(6 * 1024 * 1024);
      const cuerpo = gzipSync(JSON.stringify({ eventos: [eventoHeartbeat('bomba')], relleno }));
      expect(cuerpo.length).toBeLessThan(100 * 1024);
      const res = await postCrudo(cuerpo, {
        'Content-Type': 'application/json',
        'Content-Encoding': 'gzip',
        'X-Api-Key': KEYS.a2,
      });
      expect(res.status).toBe(413);
    });

    it('acepta un lote de más de 100 KB (el tope por defecto de Express)', async () => {
      const partidas = Array.from({ length: 500 }, (_, i) => ({
        producto: `Producto sintético ${i} `.padEnd(200, 'x'),
        cantidad: '1',
        precioUnit: '1.00',
        total: '1.00',
      }));
      const body = { eventos: [eventoCheque('grande', 'GRANDE-1', { partidas })] };
      expect(JSON.stringify(body).length).toBeGreaterThan(100 * 1024);
      const r = await lote(KEYS.a2, body.eventos);
      expect(r.procesados).toEqual(['grande']);
      const c = await prisma.cheque.findFirstOrThrow({ where: { folioSr: 'GRANDE-1' } });
      expect(await prisma.chequePartida.count({ where: { chequeId: c.id } })).toBe(500);
    });
  });
});
