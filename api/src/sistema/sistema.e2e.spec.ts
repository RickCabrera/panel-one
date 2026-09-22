import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configurarApp } from '../configurar-app';

// E2E de F2-202 sobre la app REAL: `GET /sistema` es público y dice SÓLO si la
// instancia corre en modo demo. Nada de qué implementación hay detrás de cada puerto,
// versión ni datos de ninguna empresa (igualdad estricta del cuerpo).
describe('GET /sistema (e2e, F2-202)', () => {
  const original = process.env.MODO_DEMO;
  const apps: INestApplication[] = [];

  async function crearApp(modoDemo: string | undefined): Promise<INestApplication> {
    if (modoDemo === undefined) delete process.env.MODO_DEMO;
    else process.env.MODO_DEMO = modoDemo;
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    const app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.init();
    apps.push(app);
    return app;
  }

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
    if (original === undefined) delete process.env.MODO_DEMO;
    else process.env.MODO_DEMO = original;
  });

  it('sin token y sin MODO_DEMO → 200 { modoDemo: false }, y nada más', async () => {
    const app = await crearApp(undefined);
    const r = await request(app.getHttpServer()).get('/sistema').expect(200);
    expect(r.body).toStrictEqual({ modoDemo: false });
  });

  it('con MODO_DEMO=1 → { modoDemo: true }', async () => {
    const app = await crearApp('1');
    const r = await request(app.getHttpServer()).get('/sistema').expect(200);
    expect(r.body).toStrictEqual({ modoDemo: true });
  });

  it('un token inválido no cambia nada: la ruta no depende de quién pregunta', async () => {
    const app = await crearApp(undefined);
    const r = await request(app.getHttpServer())
      .get('/sistema')
      .set('Authorization', 'Bearer basura')
      .expect(200);
    expect(r.body).toStrictEqual({ modoDemo: false });
  });
});
