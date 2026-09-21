import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from './app.module';
import { CABECERAS_SEGURIDAD, configurarApp } from './configurar-app';

// E2E de F1-092 sobre la app REAL (AppModule + configurarApp): cabeceras de
// seguridad, `trust proxy` y los cubos de rate limit de login y refresh.
//
// RATE LIMIT: el storage del throttler es por instancia de app, así que cada test
// levanta SU app y cuenta desde cero. Ningún test necesita un usuario real: un
// login con cuerpo inválido (400) y un refresh sin cookie (401) también cuentan.
// Que las rutas de agente NO caigan en el cubo de refresh (30/min) lo prueba el
// test de 120/min de `agentes.e2e.spec.ts`: con el cubo encima, el 31.º sería 429.

describe('Hardening de la API (e2e, F1-092)', () => {
  const apps: INestApplication[] = [];

  async function crearApp(entorno: NodeJS.ProcessEnv = {}): Promise<INestApplication> {
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = configurarApp(modulo.createNestApplication<NestExpressApplication>(), entorno);
    await app.init();
    apps.push(app);
    return app;
  }

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  function login(a: INestApplication, ip?: string) {
    const r = request(a.getHttpServer()).post('/auth/login').send({});
    return ip === undefined ? r : r.set('X-Forwarded-For', ip);
  }

  const refresh = (a: INestApplication) => request(a.getHttpServer()).post('/auth/refresh');

  async function gastar(n: number, pedir: () => request.Test, status: number): Promise<void> {
    for (let i = 0; i < n; i++) {
      const res = await pedir();
      if (res.status !== status) {
        throw new Error(`El request ${i + 1} dio ${res.status}, esperaba ${status}.`);
      }
    }
  }

  describe('cabeceras', () => {
    it('toda respuesta lleva las de seguridad y no dice que es Express', async () => {
      const a = await crearApp();
      for (const res of [
        await request(a.getHttpServer()).get('/'),
        await request(a.getHttpServer()).get('/auth/me'),
        await request(a.getHttpServer()).get('/no-existe'),
      ]) {
        for (const [nombre, valor] of Object.entries(CABECERAS_SEGURIDAD)) {
          expect(res.headers[nombre.toLowerCase()]).toBe(valor);
        }
        expect(res.headers['x-powered-by']).toBeUndefined();
      }
    });
  });

  describe('trust proxy', () => {
    it('por defecto NO cree el X-Forwarded-For: cambiarlo no reinicia el límite del login', async () => {
      const a = await crearApp();
      let i = 0;
      await gastar(5, () => login(a, `203.0.113.${++i}`), 400);
      await login(a, '203.0.113.99').expect(429);
    });

    it('con TRUST_PROXY_SALTOS=1 cuenta por la IP del cliente, no por la del proxy', async () => {
      const a = await crearApp({ TRUST_PROXY_SALTOS: '1' });
      await gastar(5, () => login(a, '203.0.113.10'), 400);
      await login(a, '203.0.113.10').expect(429);
      await login(a, '203.0.113.11').expect(400);
    });

    it('un TRUST_PROXY_SALTOS inválido truena al configurar la app', async () => {
      const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
      const app = modulo.createNestApplication<NestExpressApplication>();
      apps.push(app);
      expect(() => configurarApp(app, { TRUST_PROXY_SALTOS: 'true' })).toThrow(
        /TRUST_PROXY_SALTOS/,
      );
    });
  });

  describe('POST /auth/refresh: 30 por minuto por IP', () => {
    it('el 31.º es 429; antes, 401 (el throttler de agentes no truena sin agente)', async () => {
      const a = await crearApp();
      await gastar(30, () => refresh(a), 401);
      await refresh(a).expect(429);
    });

    it('refresh y login no comparten cubo', async () => {
      const a = await crearApp();
      await gastar(30, () => refresh(a), 401);
      await refresh(a).expect(429);
      // El login sigue con sus 5 intactos...
      await gastar(5, () => login(a), 400);
      await login(a).expect(429);

      // ...y agotar el login no toca el refresh.
      const b = await crearApp();
      await gastar(5, () => login(b), 400);
      await login(b).expect(429);
      await refresh(b).expect(401);
    });
  });
});
