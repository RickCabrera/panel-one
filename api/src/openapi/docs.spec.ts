import { readFileSync } from 'node:fs';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { AppModule } from '../app.module';
import { configurarApp } from '../configurar-app';
import { RUTA_OPENAPI } from './documento';
import { leerDocsConfig, montarDocs, type DocsConfig } from './docs';

// `/docs` protegido (F1-033), sobre la app real. Sólo la UI y el JSON del
// contrato: no toca la base (Swagger no hace queries).

const CONFIG: DocsConfig = { usuario: 'docs-prueba', password: 'contrasena-docs-sintetica-01' };

async function crearApp(config: DocsConfig | null): Promise<INestApplication> {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
  montarDocs(app, config);
  await app.init();
  return app;
}

const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

describe('leerDocsConfig()', () => {
  it('sin ninguna variable → null (no se monta)', () => {
    expect(leerDocsConfig({})).toBeNull();
  });

  it('con las dos → la config', () => {
    expect(leerDocsConfig({ DOCS_USUARIO: 'u', DOCS_PASSWORD: 'dieciseis-chars!' })).toEqual({
      usuario: 'u',
      password: 'dieciseis-chars!',
    });
  });

  it('con sólo una, o con contraseña corta → truena el arranque', () => {
    expect(() => leerDocsConfig({ DOCS_USUARIO: 'u' })).toThrow(/van juntos/);
    expect(() => leerDocsConfig({ DOCS_PASSWORD: 'dieciseis-chars!' })).toThrow(/van juntos/);
    expect(() => leerDocsConfig({ DOCS_USUARIO: 'u', DOCS_PASSWORD: 'corta' })).toThrow(/16/);
  });
});

describe('/docs (e2e, F1-033)', () => {
  const apps: INestApplication[] = [];
  async function app(config: DocsConfig | null): Promise<INestApplication> {
    const nueva = await crearApp(config);
    apps.push(nueva);
    return nueva;
  }

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it('sin config, /docs no existe: 404 en la UI y en el JSON', async () => {
    const a = await app(null);
    await request(a.getHttpServer()).get('/docs').expect(404);
    await request(a.getHttpServer()).get('/docs/openapi.json').expect(404);
    await request(a.getHttpServer()).get('/docs-json').expect(404);
  });

  describe('con config', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app(CONFIG);
    });

    it('sin credenciales → 401 con WWW-Authenticate Basic, en la UI y en el JSON', async () => {
      for (const ruta of ['/docs', '/docs/', '/docs/openapi.json', '/docs/swagger-ui.css']) {
        const res = await request(a.getHttpServer()).get(ruta);
        expect(res.status).toBe(401);
        expect(res.headers['www-authenticate']).toMatch(/^Basic realm="docs"/);
        expect(JSON.stringify(res.body)).not.toContain('openapi');
      }
    });

    it('credenciales malas → 401: usuario malo, contraseña mala, Bearer, basura', async () => {
      const malas = [
        basic('otro', CONFIG.password),
        basic(CONFIG.usuario, 'contrasena-docs-sintetica-02'),
        basic(CONFIG.usuario, ''),
        `Basic ${Buffer.from(CONFIG.usuario + CONFIG.password).toString('base64')}`,
        'Bearer algo',
        'Basic',
      ];
      for (const cabecera of malas) {
        await request(a.getHttpServer())
          .get('/docs/openapi.json')
          .set('Authorization', cabecera)
          .expect(401);
      }
    });

    it('credenciales buenas → la UI y el contrato, que es el mismo de api/openapi.json', async () => {
      const auth = basic(CONFIG.usuario, CONFIG.password);
      const ui = await request(a.getHttpServer())
        .get('/docs')
        .set('Authorization', auth)
        .redirects(1);
      expect(ui.status).toBe(200);
      expect(ui.text).toContain('swagger');
      const json = await request(a.getHttpServer())
        .get('/docs/openapi.json')
        .set('Authorization', auth)
        .expect(200);
      expect(json.body).toEqual(JSON.parse(readFileSync(RUTA_OPENAPI, 'utf8')));
    });

    it('no expone el JSON ni el YAML fuera del prefijo protegido', async () => {
      await request(a.getHttpServer()).get('/docs-json').expect(404);
      await request(a.getHttpServer()).get('/docs-yaml').expect(404);
      await request(a.getHttpServer())
        .get('/docs/openapi.yaml')
        .set('Authorization', basic(CONFIG.usuario, CONFIG.password))
        .expect((r) => expect(r.headers['content-type'] ?? '').not.toMatch(/yaml/));
    });

    it('/docs no abre las rutas de datos: siguen pidiendo Bearer', async () => {
      await request(a.getHttpServer())
        .get('/empresas')
        .set('Authorization', basic(CONFIG.usuario, CONFIG.password))
        .expect(401);
    });
  });
});
