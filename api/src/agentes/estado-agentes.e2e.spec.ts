import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import { hashApiKey } from './api-key';

// E2E del estado de agentes (F1-061) sobre la app REAL contra Postgres REAL.
// El AC ("refleja en < 1 min la caída del agente, probado matando el
// servicio") necesita el agente instalado, que todavía no existe (F1-020+).
// De noche se prueba la lógica de frescura como pide el backlog: el contacto
// y el estado se manipulan en base, y el reloj del servidor es un `Reloj` fijo
// que el test mueve (`overrideProvider(Reloj)`).

const KEYS = {
  a1: 'msr_sintetica-estado-F1-061-sucursal-a1-00000000000001',
  a2: 'msr_sintetica-estado-F1-061-sucursal-a2-00000000000002',
  b1: 'msr_sintetica-estado-F1-061-sucursal-b1-00000000000003',
} as const;

/** Una sucursal inactiva de la empresa A: no debe salir en el estado. */
const SUCURSAL_A_INACTIVA = 'f1061000-0000-4000-8000-0000000000a9';

class RelojFijo extends Reloj {
  t = Date.parse('2026-09-21T18:00:00Z');
  override ahora(): number {
    return this.t;
  }
}

function heartbeat(id: string, datos: Record<string, unknown> = {}) {
  return {
    id,
    tipo: 'heartbeat',
    datos: { versionAgente: '0.1.0', versionSr: '10.0', ultimaLecturaAt: null, ...datos },
  };
}

interface Fila {
  sucursalId: string;
  nombre: string;
  zonaHoraria: string;
  ultimoContactoAt: string | null;
  edadContactoSegundos: number | null;
  ultimaLecturaAt: string | null;
  edadLecturaSegundos: number | null;
  versionAgente: string | null;
  versionSr: string | null;
  tamanoCola: number | null;
  ultimoError: string | null;
}

describe('Estado de agentes (e2e, F1-061)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojFijo();
  let app: NestExpressApplication;
  let url: string;

  function enviar(key: string, body: unknown) {
    return request(url)
      .post('/ingesta/eventos')
      .set('X-Api-Key', key)
      .send(body as object);
  }

  async function como(u: (typeof USUARIOS)[keyof typeof USUARIOS], query: string) {
    const token = await app
      .get(TokensService)
      .firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
    return request(url).get(`/agentes/estado${query}`).set('Authorization', `Bearer ${token}`);
  }

  async function estado(empresaId: string): Promise<Fila[]> {
    const res = await como(USUARIOS.adminGlobal, `?empresaId=${empresaId}`);
    expect(res.status).toBe(200);
    return res.body as Fila[];
  }

  const contacto = async (sucursalId: string) =>
    (await prisma.agenteContacto.findUnique({ where: { sucursalId } }))?.ultimoContactoAt ?? null;

  async function borrarAgentes(): Promise<void> {
    const deFixtures = { where: { empresaId: { in: [FX.empresaA, FX.empresaB] } } };
    await prisma.agenteContacto.deleteMany(deFixtures);
    await prisma.agenteEstado.deleteMany(deFixtures);
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.create({
      data: {
        id: SUCURSAL_A_INACTIVA,
        empresaId: FX.empresaA,
        nombre: 'A9 inactiva',
        activo: false,
      },
    });
    for (const [sucursal, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalA2, KEYS.a2],
      [FX.sucursalB1, KEYS.b1],
    ] as const) {
      await prisma.sucursal.update({
        where: { id: sucursal },
        data: { apiKeyHash: hashApiKey(key) },
      });
    }
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  beforeEach(async () => {
    reloj.t = Date.parse('2026-09-21T18:00:00Z');
    await borrarAgentes();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  // -----------------------------------------------------------------------------------
  describe('contacto: lo registra la ingesta con el reloj del servidor', () => {
    it('un lote aceptado registra el contacto = Reloj.ahora(), sólo en la sucursal de la key', async () => {
      const res = await enviar(KEYS.a1, { eventos: [heartbeat('h1')] });
      expect(res.status).toBe(200);
      expect((await contacto(FX.sucursalA1))?.toISOString()).toBe('2026-09-21T18:00:00.000Z');
      const fila = await prisma.agenteContacto.findUniqueOrThrow({
        where: { sucursalId: FX.sucursalA1 },
      });
      expect(fila.empresaId).toBe(FX.empresaA);
      expect(await contacto(FX.sucursalA2)).toBeNull();
      expect(await contacto(FX.sucursalB1)).toBeNull();
    });

    it('un lote con TODOS sus eventos rechazados cuenta como contacto: el agente está vivo', async () => {
      const res = await enviar(KEYS.a1, {
        eventos: [
          { id: 'malo', tipo: 'venta', datos: {} },
          heartbeat('sin-version', { versionAgente: '' }),
        ],
      });
      expect(res.status).toBe(200);
      expect((res.body as { procesados: string[] }).procesados).toEqual([]);
      expect(await contacto(FX.sucursalA1)).not.toBeNull();
    });

    it('un sobre inválido (400) NO cuenta como contacto', async () => {
      for (const body of [{}, { eventos: [] }, { eventos: 'x' }]) {
        const res = await enviar(KEYS.a1, body);
        expect(res.status).toBe(400);
      }
      expect(await contacto(FX.sucursalA1)).toBeNull();
    });

    it('sin key válida (401) NO cuenta como contacto', async () => {
      const res = await enviar('msr_key-que-no-existe', { eventos: [heartbeat('h')] });
      expect(res.status).toBe(401);
      expect(
        await prisma.agenteContacto.count({
          where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
        }),
      ).toBe(0);
    });

    it('reenviar el mismo lote 3 veces: los DATOS quedan idénticos y el contacto avanza al último envío', async () => {
      const eventos = [heartbeat('i1', { ultimaLecturaAt: '2026-09-21T17:59:30Z', tamanoCola: 2 })];
      await enviar(KEYS.a2, { eventos });
      const datosTrasUna = await prisma.agenteEstado.findUniqueOrThrow({
        where: { sucursalId: FX.sucursalA2 },
      });
      for (const segundos of [30, 60]) {
        reloj.t = Date.parse('2026-09-21T18:00:00Z') + segundos * 1000;
        expect((await enviar(KEYS.a2, { eventos })).status).toBe(200);
      }
      expect(
        await prisma.agenteEstado.findUniqueOrThrow({ where: { sucursalId: FX.sucursalA2 } }),
      ).toEqual(datosTrasUna);
      expect((await contacto(FX.sucursalA2))?.toISOString()).toBe('2026-09-21T18:01:00.000Z');
    });

    it('el contacto nunca retrocede: un lote con un reloj anterior no lo mueve hacia atrás', async () => {
      await enviar(KEYS.a1, { eventos: [heartbeat('h1')] });
      reloj.t -= 60_000;
      await enviar(KEYS.a1, { eventos: [heartbeat('h2')] });
      expect((await contacto(FX.sucursalA1))?.toISOString()).toBe('2026-09-21T18:00:00.000Z');
    });

    it('dos lotes EN PARALELO de una sucursal sin contacto: ninguno truena, queda una sola fila', async () => {
      const [r1, r2] = await Promise.all([
        enviar(KEYS.b1, { eventos: [heartbeat('p1')] }),
        enviar(KEYS.b1, { eventos: [heartbeat('p2')] }),
      ]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      expect(await prisma.agenteContacto.count({ where: { sucursalId: FX.sucursalB1 } })).toBe(1);
      expect((await contacto(FX.sucursalB1))?.toISOString()).toBe('2026-09-21T18:00:00.000Z');
    });
  });

  // -----------------------------------------------------------------------------------
  describe('GET /agentes/estado: frescura con el estado manipulado en base', () => {
    it('una fila por sucursal ACTIVA, las que nunca reportaron con todo en null', async () => {
      const filas = await estado(FX.empresaA);
      expect(filas.map((f) => f.sucursalId)).toEqual([FX.sucursalA1, FX.sucursalA2]);
      expect(filas[0]).toEqual({
        sucursalId: FX.sucursalA1,
        nombre: 'A1',
        zonaHoraria: 'America/Mexico_City',
        ultimoContactoAt: null,
        edadContactoSegundos: null,
        ultimaLecturaAt: null,
        edadLecturaSegundos: null,
        versionAgente: null,
        versionSr: null,
        tamanoCola: null,
        ultimoError: null,
      });
      expect(filas.some((f) => f.sucursalId === SUCURSAL_A_INACTIVA)).toBe(false);
    });

    it('de la base al endpoint: contacto registrado y el reloj avanza 91 s → edad 91', async () => {
      await enviar(KEYS.a1, {
        eventos: [
          heartbeat('h1', {
            versionAgente: '0.3.0',
            versionSr: '11.2',
            ultimaLecturaAt: '2026-09-21T17:59:50Z',
            ultimoError: 'timeout sintético',
            tamanoCola: 7,
          }),
        ],
      });
      reloj.t += 91_000;
      const [a1] = await estado(FX.empresaA);
      expect(a1).toEqual({
        sucursalId: FX.sucursalA1,
        nombre: 'A1',
        zonaHoraria: 'America/Mexico_City',
        ultimoContactoAt: '2026-09-21T18:00:00.000Z',
        edadContactoSegundos: 91,
        ultimaLecturaAt: '2026-09-21T17:59:50.000Z',
        edadLecturaSegundos: 101,
        versionAgente: '0.3.0',
        versionSr: '11.2',
        tamanoCola: 7,
        ultimoError: 'timeout sintético',
      });
    });

    it.each([89, 90, 91, 600, 601])(
      'contacto de hace %i s en base → edadContactoSegundos exacta',
      async (segundos) => {
        await prisma.agenteContacto.create({
          data: {
            sucursalId: FX.sucursalA2,
            empresaId: FX.empresaA,
            ultimoContactoAt: new Date(reloj.t - segundos * 1000),
          },
        });
        const a2 = (await estado(FX.empresaA)).find((f) => f.sucursalId === FX.sucursalA2);
        expect(a2?.edadContactoSegundos).toBe(segundos);
      },
    );

    it('agente vivo que no puede leer SR: contacto fresco, lectura vieja (se ven por separado)', async () => {
      await prisma.agenteEstado.create({
        data: {
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          versionAgente: '0.1.0',
          ultimaLecturaAt: new Date(reloj.t - 45 * 60_000),
          ultimoError: 'no conecta a SQL Server (sintético)',
        },
      });
      await prisma.agenteContacto.create({
        data: {
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          ultimoContactoAt: new Date(reloj.t - 5_000),
        },
      });
      const [a1] = await estado(FX.empresaA);
      expect(a1.edadContactoSegundos).toBe(5);
      expect(a1.edadLecturaSegundos).toBe(45 * 60);
      expect(a1.ultimoError).toBe('no conecta a SQL Server (sintético)');
    });

    it('un reloj del POS adelantado no da edad de lectura negativa', async () => {
      await prisma.agenteEstado.create({
        data: {
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          versionAgente: '0.1.0',
          ultimaLecturaAt: new Date(reloj.t + 10 * 60_000),
        },
      });
      const [a1] = await estado(FX.empresaA);
      expect(a1.edadLecturaSegundos).toBe(0);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('alcance y roles', () => {
    beforeEach(async () => {
      // B1 con estado y contacto: si el filtro de empresa fallara, se colarían.
      await prisma.agenteEstado.create({
        data: { sucursalId: FX.sucursalB1, empresaId: FX.empresaB, versionAgente: '9.9.9-B' },
      });
      await prisma.agenteContacto.create({
        data: {
          sucursalId: FX.sucursalB1,
          empresaId: FX.empresaB,
          ultimoContactoAt: new Date(reloj.t),
        },
      });
    });

    it('admin_empresa A ve su empresa y nada de B', async () => {
      const res = await como(USUARIOS.adminEmpresaA, `?empresaId=${FX.empresaA}`);
      expect(res.status).toBe(200);
      const filas = res.body as Fila[];
      expect(filas.map((f) => f.sucursalId)).toEqual([FX.sucursalA1, FX.sucursalA2]);
      expect(JSON.stringify(filas)).not.toContain('9.9.9-B');
      expect(filas.every((f) => f.ultimoContactoAt === null)).toBe(true);
    });

    it('admin_empresa A pidiendo la empresa B → 404 con el MISMO body que un uuid inexistente', async () => {
      const ajena = await como(USUARIOS.adminEmpresaA, `?empresaId=${FX.empresaB}`);
      const inexistente = await como(USUARIOS.adminEmpresaA, `?empresaId=${FX.inexistente}`);
      expect(ajena.status).toBe(404);
      expect(ajena.body).toEqual(inexistente.body);
      expect(inexistente.status).toBe(404);
    });

    it('admin_global ve la empresa B', async () => {
      const [b1] = await estado(FX.empresaB);
      expect(b1).toMatchObject({
        sucursalId: FX.sucursalB1,
        versionAgente: '9.9.9-B',
        edadContactoSegundos: 0,
      });
    });

    it('visor → 403 por ruta, también en su propia empresa', async () => {
      const res = await como(USUARIOS.visorA, `?empresaId=${FX.empresaA}`);
      expect(res.status).toBe(403);
    });

    it.each([
      ['empresaId ausente', ''],
      ['empresaId no es uuid', '?empresaId=no-es-uuid'],
    ])('%s → 400', async (_nombre, query) => {
      const res = await como(USUARIOS.adminGlobal, query);
      expect(res.status).toBe(400);
    });

    it('sin token → 401', async () => {
      const res = await request(url).get(`/agentes/estado?empresaId=${FX.empresaA}`);
      expect(res.status).toBe(401);
    });
  });

  it('el CHECK de la base rechaza un tamano_cola negativo aunque se salte el DTO', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await expect(
      prisma.agenteEstado.create({
        data: {
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          versionAgente: '0.1.0',
          tamanoCola: -1,
        },
      }),
    ).rejects.toThrow(/agente_estado_tamano_cola_chk/);
  });
});
