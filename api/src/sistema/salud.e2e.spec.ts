import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configurarApp } from '../configurar-app';
import { SaludBaseService } from '../prisma/salud-base';

// E2E de F1-002 sobre la app REAL: `GET /health` es lo que miran el healthcheck del
// contenedor y UptimeRobot. Público, cuerpo exacto (igualdad estricta: ni versión ni el
// error de la base), 200 con la base arriba y 503 con la base caída.
describe('GET /health (e2e, F1-002)', () => {
  const apps: INestApplication[] = [];

  async function crearApp(baseCaida = false): Promise<INestApplication> {
    let constructor = Test.createTestingModule({ imports: [AppModule] });
    if (baseCaida) {
      constructor = constructor
        .overrideProvider(SaludBaseService)
        .useValue({ responde: () => Promise.resolve(false) });
    }
    const modulo = await constructor.compile();
    const app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.init();
    apps.push(app);
    return app;
  }

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it('sin token y con la base arriba → 200 { status: ok, db: ok }, y nada más', async () => {
    const app = await crearApp();
    const r = await request(app.getHttpServer()).get('/health').expect(200);
    expect(r.body).toStrictEqual({ status: 'ok', db: 'ok' });
    // Las cabeceras de toda la API (F1-092) también aquí: un monitor no cachea la señal.
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it('un token inválido no cambia nada: la ruta no depende de quién pregunta', async () => {
    const app = await crearApp();
    const r = await request(app.getHttpServer())
      .get('/health')
      .set('Authorization', 'Bearer basura')
      .expect(200);
    expect(r.body).toStrictEqual({ status: 'ok', db: 'ok' });
  });

  it('con la base caída → 503 { status: error, db: error }, sin detalles del error', async () => {
    const app = await crearApp(true);
    const r = await request(app.getHttpServer()).get('/health').expect(503);
    expect(r.body).toStrictEqual({ status: 'error', db: 'error' });
  });
});
