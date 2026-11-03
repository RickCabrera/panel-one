import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PAC_NO_CONECTADO } from '../adaptadores/adaptadores.module';
import { MENSAJE_FACTURACION_NO_CONECTADA } from '../adaptadores/timbrado/timbrado-no-conectado';
import { AppModule } from '../app.module';
import { configurarApp } from '../configurar-app';

// E2E sobre la app REAL con lo que resuelve producción sin PAC (`PAC_NO_CONECTADO = true`): el
// portal público contesta 503 con el mensaje claro ANTES de validar el cuerpo o buscar el portal,
// y una ruta de administración sigue pidiendo token primero (401), sin decir nada más.
describe('Facturación sin PAC conectado en producción (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PAC_NO_CONECTADO)
      .useValue(true)
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.init();
  });

  afterAll(() => app.close());

  it('POST del portal público → 503 "La facturación no está conectada todavía"', async () => {
    const r = await request(app.getHttpServer())
      .post('/facturacion/portal/cualquier-portal/facturas')
      .send({})
      .expect(503);
    expect(r.body.message).toBe(MENSAJE_FACTURACION_NO_CONECTADA);
  });

  it('una ruta de admin que timbra sigue exigiendo token primero', async () => {
    await request(app.getHttpServer()).post('/facturacion/cfdis/manual').send({}).expect(401);
  });
});
