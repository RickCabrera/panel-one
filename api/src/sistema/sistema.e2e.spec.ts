import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configurarApp } from '../configurar-app';

// E2E de F2-202 sobre la app REAL: `GET /sistema` es público y dice SÓLO si la
// instancia corre en modo demo. Nada de qué implementación hay detrás de cada puerto,
// versión ni datos de ninguna empresa (igualdad estricta del cuerpo).
// Membresías: también el color de interfaz GLOBAL (`colorAcento`, nulo = el del build), que la
// SPA necesita antes del login. Es de la plataforma, no de ninguna empresa.
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

  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.configuracionPlataforma.updateMany({
      where: { id: 1 },
      data: { colorAcento: null },
    });
    await prisma.$disconnect();
    await Promise.all(apps.map((a) => a.close()));
    if (original === undefined) delete process.env.MODO_DEMO;
    else process.env.MODO_DEMO = original;
  });

  it('sin token y sin MODO_DEMO → 200 { modoDemo: false, colorAcento: null, descargaAgente: null }, y nada más', async () => {
    const app = await crearApp(undefined);
    const r = await request(app.getHttpServer()).get('/sistema').expect(200);
    expect(r.body).toStrictEqual({ modoDemo: false, colorAcento: null, descargaAgente: null });
  });

  it('con MODO_DEMO=1 → { modoDemo: true, colorAcento: null, descargaAgente: null }', async () => {
    const app = await crearApp('1');
    const r = await request(app.getHttpServer()).get('/sistema').expect(200);
    expect(r.body).toStrictEqual({ modoDemo: true, colorAcento: null, descargaAgente: null });
  });

  it('un token inválido no cambia nada: la ruta no depende de quién pregunta', async () => {
    const app = await crearApp(undefined);
    const r = await request(app.getHttpServer())
      .get('/sistema')
      .set('Authorization', 'Bearer basura')
      .expect(200);
    expect(r.body).toStrictEqual({ modoDemo: false, colorAcento: null, descargaAgente: null });
  });

  it('INST-02: con AGENTE_URL_DESCARGA sale la descarga del instalador, tal cual', async () => {
    const antes = process.env.AGENTE_URL_DESCARGA;
    process.env.AGENTE_URL_DESCARGA = 'https://descargas.monitor.test/Instalar-YoControlo.zip';
    try {
      const app = await crearApp(undefined);
      const r = await request(app.getHttpServer()).get('/sistema').expect(200);
      expect(r.body).toStrictEqual({
        modoDemo: false,
        colorAcento: null,
        descargaAgente: 'https://descargas.monitor.test/Instalar-YoControlo.zip',
      });
    } finally {
      if (antes === undefined) delete process.env.AGENTE_URL_DESCARGA;
      else process.env.AGENTE_URL_DESCARGA = antes;
    }
  });

  it('membresías: el color global guardado sale tal cual (la clave, nunca un hex)', async () => {
    await prisma.configuracionPlataforma.updateMany({
      where: { id: 1 },
      data: { colorAcento: 'morado' },
    });
    const app = await crearApp(undefined);
    const r = await request(app.getHttpServer()).get('/sistema').expect(200);
    expect(r.body).toStrictEqual({ modoDemo: false, colorAcento: 'morado', descargaAgente: null });
  });
});
