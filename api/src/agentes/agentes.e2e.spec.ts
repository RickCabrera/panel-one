import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';
import { hashApiKey, PREFIJO_API_KEY } from './api-key';

// E2E de auth de agentes (F1-012) sobre la app REAL (AppModule + configurarApp)
// contra Postgres REAL, con las fixtures sintéticas de F1-011.
//
// RATE LIMIT: el storage del throttler es por instancia de app. El test de los
// 120/min levanta SU propia app para contar exacto; los demás bloques no pasan
// de unas decenas de requests por sucursal.

async function crearApp(): Promise<INestApplication> {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
  await app.init();
  return app;
}

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

const CUERPO_401 = { statusCode: 401, message: 'No autenticado', error: 'Unauthorized' };

describe('Auth de agentes por API key (e2e, F1-012)', () => {
  const prisma = new PrismaClient();
  const apps: INestApplication[] = [];

  async function app(): Promise<INestApplication> {
    const nueva = await crearApp();
    apps.push(nueva);
    return nueva;
  }

  async function tokenDe(a: INestApplication, u: Usuario): Promise<string> {
    return a.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  }

  async function rotar(a: INestApplication, sucursalId: string, u: Usuario) {
    return request(a.getHttpServer())
      .post(`/sucursales/${sucursalId}/api-key`)
      .set('Authorization', `Bearer ${await tokenDe(a, u)}`);
  }

  async function rotarEsperando(
    a: INestApplication,
    sucursalId: string,
    u: Usuario,
    status: number,
  ): Promise<request.Response> {
    const res = await rotar(a, sucursalId, u);
    expect(res.status).toBe(status);
    return res;
  }

  /** Rota como admin_global y devuelve la key nueva. */
  async function keyDe(a: INestApplication, sucursalId: string): Promise<string> {
    const res = await rotar(a, sucursalId, USUARIOS.adminGlobal);
    expect(res.status).toBe(201);
    return res.body.apiKey as string;
  }

  function yo(a: INestApplication, apiKey?: string) {
    const r = request(a.getHttpServer()).get('/agente/yo');
    return apiKey === undefined ? r : r.set('X-Api-Key', apiKey);
  }

  const hashEnBase = async (id: string) =>
    (await prisma.sucursal.findUniqueOrThrow({ where: { id } })).apiKeyHash;

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('POST /sucursales/:id/api-key', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    it('admin_empresa genera la key de su sucursal: 201, una sola vez, y en la base sólo el hash', async () => {
      const res = await rotarEsperando(a, FX.sucursalA1, USUARIOS.adminEmpresaA, 201);

      expect(res.body).toEqual({ sucursalId: FX.sucursalA1, apiKey: expect.any(String) });
      const { apiKey } = res.body as { apiKey: string };
      expect(apiKey.startsWith(PREFIJO_API_KEY)).toBe(true);
      expect(res.headers['cache-control']).toBe('no-store');

      const guardado = await hashEnBase(FX.sucursalA1);
      expect(guardado).toBe(hashApiKey(apiKey));
      expect(guardado).not.toContain(apiKey);
    });

    it('admin_empresa de A sobre una sucursal de B → 404, idéntico a una inexistente, y B intacta', async () => {
      const antes = await hashEnBase(FX.sucursalB1);
      const deB = await rotar(a, FX.sucursalB1, USUARIOS.adminEmpresaA);
      const inexistente = await rotar(a, FX.inexistente, USUARIOS.adminEmpresaA);

      expect(deB.status).toBe(404);
      expect(inexistente.status).toBe(404);
      expect(deB.body).toEqual(inexistente.body);
      expect(JSON.stringify(deB.body)).not.toContain(PREFIJO_API_KEY);
      expect(await hashEnBase(FX.sucursalB1)).toBe(antes);
    });

    it('visor → 403 (depende de la ruta, no del recurso) y no cambia nada', async () => {
      const antes = await hashEnBase(FX.sucursalA2);
      await rotarEsperando(a, FX.sucursalA2, USUARIOS.visorA, 403);
      expect(await hashEnBase(FX.sucursalA2)).toBe(antes);
    });

    it('admin_global genera la key de una sucursal de cualquier empresa', async () => {
      const res = await rotarEsperando(a, FX.sucursalB1, USUARIOS.adminGlobal, 201);
      expect(await hashEnBase(FX.sucursalB1)).toBe(hashApiKey(res.body.apiKey));
    });

    it('sin token → 401; id que no es UUID → 400', async () => {
      await request(a.getHttpServer()).post(`/sucursales/${FX.sucursalA1}/api-key`).expect(401);
      await rotarEsperando(a, 'no-es-uuid', USUARIOS.adminGlobal, 400);
    });

    it('una API key no sirve como sesión de usuario', async () => {
      const apiKey = await keyDe(a, FX.sucursalA2);
      await request(a.getHttpServer())
        .post(`/sucursales/${FX.sucursalA2}/api-key`)
        .set('X-Api-Key', apiKey)
        .expect(401);
      await request(a.getHttpServer()).get('/auth/me').set('X-Api-Key', apiKey).expect(401);
      await request(a.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${apiKey}`)
        .expect(401);
    });
  });

  describe('GET /agente/yo: la sucursal sale de la key', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    it('con la key → la sucursal de la key, sólo lo mínimo', async () => {
      const res = await yo(a, await keyDe(a, FX.sucursalA1)).expect(200);
      expect(res.body).toEqual({
        sucursalId: FX.sucursalA1,
        nombre: 'A1',
        zonaHoraria: 'America/Mexico_City',
      });
    });

    it('el agente no manda el tenant: query, headers y body con otra sucursal no cambian nada', async () => {
      const apiKey = await keyDe(a, FX.sucursalA1);
      const res = await request(a.getHttpServer())
        .get(`/agente/yo?sucursalId=${FX.sucursalB1}&empresaId=${FX.empresaB}`)
        .set('X-Api-Key', apiKey)
        .set('X-Sucursal-Id', FX.sucursalB1)
        .set('X-Empresa-Id', FX.empresaB)
        .send({ sucursalId: FX.sucursalB1 })
        .expect(200);
      expect(res.body.sucursalId).toBe(FX.sucursalA1);
    });

    it('cada key queda ligada a SU sucursal', async () => {
      const [keyA2, keyB1] = [await keyDe(a, FX.sucursalA2), await keyDe(a, FX.sucursalB1)];
      expect((await yo(a, keyA2).expect(200)).body.sucursalId).toBe(FX.sucursalA2);
      expect((await yo(a, keyB1).expect(200)).body.sucursalId).toBe(FX.sucursalB1);
    });

    it('ROTAR invalida la key anterior de inmediato; la nueva sirve', async () => {
      const vieja = await keyDe(a, FX.sucursalA1);
      await yo(a, vieja).expect(200);

      const nueva = await keyDe(a, FX.sucursalA1);
      expect(nueva).not.toBe(vieja);

      expect((await yo(a, vieja).expect(401)).body).toEqual(CUERPO_401);
      expect((await yo(a, nueva).expect(200)).body.sucursalId).toBe(FX.sucursalA1);
    });

    it('rotar la key de una sucursal no toca la de otra', async () => {
      const keyA1 = await keyDe(a, FX.sucursalA1);
      await keyDe(a, FX.sucursalB1);
      await keyDe(a, FX.sucursalA2);
      expect((await yo(a, keyA1).expect(200)).body.sucursalId).toBe(FX.sucursalA1);
    });

    it('401 con el mismo cuerpo: sin header, vacía, inventada, o dos keys', async () => {
      const buena = await keyDe(a, FX.sucursalA2);
      // Cada request se arma justo antes de mandarlo: supertest abre un puerto
      // efímero por request y armarlos todos de golpe los deja sin servidor.
      for (const apiKey of [
        undefined,
        '',
        `${PREFIJO_API_KEY}inventada-no-existe`,
        `${buena},${buena}`,
      ]) {
        expect((await yo(a, apiKey).expect(401)).body).toEqual(CUERPO_401);
      }
    });

    it('un Bearer de usuario válido no abre una ruta de agente', async () => {
      const res = await request(a.getHttpServer())
        .get('/agente/yo')
        .set('Authorization', `Bearer ${await tokenDe(a, USUARIOS.adminGlobal)}`)
        .expect(401);
      expect(res.body).toEqual(CUERPO_401);
    });

    it('sucursal desactivada → 401 con el mismo cuerpo; reactivada vuelve a entrar', async () => {
      const apiKey = await keyDe(a, FX.sucursalA2);
      await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { activo: false } });
      try {
        expect((await yo(a, apiKey).expect(401)).body).toEqual(CUERPO_401);
      } finally {
        await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { activo: true } });
      }
      await yo(a, apiKey).expect(200);
    });

    it('empresa desactivada → 401 con el mismo cuerpo, aunque la sucursal esté activa', async () => {
      const apiKey = await keyDe(a, FX.sucursalB1);
      await prisma.empresa.update({ where: { id: FX.empresaB }, data: { activo: false } });
      try {
        expect((await yo(a, apiKey).expect(401)).body).toEqual(CUERPO_401);
      } finally {
        await prisma.empresa.update({ where: { id: FX.empresaB }, data: { activo: true } });
      }
      await yo(a, apiKey).expect(200);
    });
  });

  describe('rate limit: 120 requests por minuto POR SUCURSAL', () => {
    it('el 121.º de A1 es 429; B1 en la misma ventana sigue entrando', async () => {
      // App propia: su throttler arranca en cero.
      const a = await app();
      const [keyA1, keyB1] = [await keyDe(a, FX.sucursalA1), await keyDe(a, FX.sucursalB1)];

      for (let i = 0; i < 120; i++) {
        const res = await yo(a, keyA1);
        if (res.status !== 200) {
          throw new Error(`El request ${i + 1} de A1 dio ${res.status}, esperaba 200.`);
        }
      }
      const bloqueado = await yo(a, keyA1).expect(429);
      expect(bloqueado.headers['retry-after-agente']).toBeDefined();

      await yo(a, keyB1).expect(200);

      // El límite es de la SUCURSAL, no de la key: rotar no reinicia el contador.
      const keyNuevaA1 = await keyDe(a, FX.sucursalA1);
      await yo(a, keyNuevaA1).expect(429);
    });
  });
});
