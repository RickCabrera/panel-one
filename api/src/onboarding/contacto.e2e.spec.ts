import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';

import { PUERTO_CORREO } from '../adaptadores/adaptadores.module';
import type { PlantillaCorreo, PuertoCorreo } from '../adaptadores/correo/puerto';
import { AppModule } from '../app.module';
import { configurarApp } from '../configurar-app';
import { ONBOARDING_CONFIG, type OnboardingConfig } from './onboarding.config';

// E2E del formulario de contacto de la landing (F2-147) sobre la app REAL. El puerto de correo
// es un espía: aquí se prueba QUÉ se le entrega; la forma de la petición a Brevo ya la fija
// `correo.contrato.spec.ts`. Cada bloque levanta SU app: el throttler es por instancia.

const DESTINO = 'ventas@monitor.test';

class CorreoEspia implements PuertoCorreo {
  enviados: { email: string; plantilla: PlantillaCorreo }[] = [];
  falla = false;
  enviar(destinatario: { email: string }, plantilla: PlantillaCorreo): Promise<{ id: string }> {
    if (this.falla) return Promise.reject(new Error('Brevo caído'));
    this.enviados.push({ email: destinatario.email, plantilla });
    return Promise.resolve({ id: `c-${this.enviados.length}` });
  }
}

async function crearApp(
  correo: CorreoEspia,
  config: OnboardingConfig = { contactoDestino: DESTINO, descargaAgente: null },
): Promise<{ app: NestExpressApplication; url: string }> {
  const modulo = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PUERTO_CORREO)
    .useValue(correo)
    .overrideProvider(ONBOARDING_CONFIG)
    .useValue(config)
    .compile();
  const app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
  await app.listen(0, '127.0.0.1');
  return { app, url: await app.getUrl() };
}

const VALIDO = {
  nombre: 'Ana Sintética',
  email: 'ANA@Ejemplo.test',
  telefono: '55 0000 0000',
  negocio: 'Tacos Demo',
  sucursales: 3,
  mensaje: 'Quiero ver una demo.\nTenemos tres sucursales.',
};

describe('Contacto de la landing (e2e, F2-147)', () => {
  describe('envío', () => {
    // Una app por test: con 3/min por IP, el bloque entero agotaría el cubo.
    let correo: CorreoEspia;
    let app: NestExpressApplication;
    let url: string;

    beforeEach(async () => {
      correo = new CorreoEspia();
      ({ app, url } = await crearApp(correo));
    });
    afterEach(async () => app.close());

    it('202 sin sesión, y el correo sale al buzón de CONTACTO_DESTINO con todo escapado', async () => {
      const res = await request(url)
        .post('/publico/contacto')
        .send({
          ...VALIDO,
          nombre: '<script>alert(1)</script>',
          mensaje: '<a href="https://phish.test">clic</a>',
        });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ recibido: true });
      expect(correo.enviados).toHaveLength(1);
      const [{ email, plantilla }] = correo.enviados;
      expect(email).toBe(DESTINO);
      expect(plantilla.nombre).toBe('contacto-landing');
      expect(plantilla.html).not.toContain('<script>');
      expect(plantilla.html).not.toContain('<a href');
      expect(plantilla.html).toContain('&lt;script&gt;');
      expect(plantilla.texto).toContain('Email: ana@ejemplo.test');
      expect(plantilla.texto).toContain('Sucursales: 3');
    });

    it('un salto de línea en el nombre no llega al asunto (inyección de cabeceras)', async () => {
      const res = await request(url)
        .post('/publico/contacto')
        .send({ ...VALIDO, nombre: 'Ana\r\nBcc: todos@x.test' });
      expect(res.status).toBe(202);
      expect(correo.enviados[0].plantilla.asunto).not.toMatch(/[\r\n]/);
    });

    it('la trampa para bots responde 202 y no manda nada', async () => {
      const res = await request(url)
        .post('/publico/contacto')
        .send({ ...VALIDO, sitio: 'https://spam.test' });
      expect(res.status).toBe(202);
      expect(correo.enviados).toHaveLength(0);
    });

    it.each([
      ['sin mensaje', { mensaje: '   ' }],
      ['email inválido', { email: 'no-es-email' }],
      ['sucursales en cero', { sucursales: 0 }],
      ['mensaje enorme', { mensaje: 'x'.repeat(2001) }],
    ])('%s es 400 y no manda nada', async (_caso, cambios) => {
      const res = await request(url)
        .post('/publico/contacto')
        .send({ ...VALIDO, ...cambios });
      expect(res.status).toBe(400);
      expect(correo.enviados).toHaveLength(0);
    });

    it('si el puerto falla, 503 en español (reintentable)', async () => {
      correo.falla = true;
      const res = await request(url).post('/publico/contacto').send(VALIDO);
      expect(res.status).toBe(503);
      expect(String(res.body.message)).toMatch(/Intenta de nuevo/);
    });
  });

  describe('sin buzón configurado (producción sin CONTACTO_DESTINO)', () => {
    const correo = new CorreoEspia();
    let app: NestExpressApplication;
    let url: string;

    beforeAll(
      async () =>
        ({ app, url } = await crearApp(correo, { contactoDestino: null, descargaAgente: null })),
    );
    afterAll(async () => app.close());

    it('503 y no manda nada', async () => {
      const res = await request(url).post('/publico/contacto').send(VALIDO);
      expect(res.status).toBe(503);
      expect(correo.enviados).toHaveLength(0);
    });
  });

  describe('límite por IP', () => {
    const correo = new CorreoEspia();
    let app: NestExpressApplication;
    let url: string;

    beforeAll(async () => ({ app, url } = await crearApp(correo)));
    afterAll(async () => app.close());

    it('3 por minuto; el 4.º es 429, y no gasta el cubo de otras rutas públicas', async () => {
      for (let i = 0; i < 3; i += 1) {
        expect((await request(url).post('/publico/contacto').send(VALIDO)).status).toBe(202);
      }
      expect((await request(url).post('/publico/contacto').send(VALIDO)).status).toBe(429);
      expect(correo.enviados).toHaveLength(3);
      // El login (otro cubo) sigue respondiendo por sus reglas, no con 429.
      const login = await request(url)
        .post('/auth/login')
        .send({ email: 'nadie@f2147.test', password: 'contrasena-cualquiera' });
      expect(login.status).toBe(401);
      // Y el portal público de facturación, tampoco.
      expect((await request(url).get('/facturacion/catalogos-sat')).status).toBe(200);
    });
  });
});
