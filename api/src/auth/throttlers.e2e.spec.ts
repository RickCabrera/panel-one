import type { INestApplication } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerStorage } from '@nestjs/throttler';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, limpiarFixtures, PASSWORD, USUARIOS } from '../../test/fixtures-auth';
import { UsuariosAdminController } from '../administracion/administracion.controller';
import { AgenteController } from '../agentes/agente.controller';
import { AppModule } from '../app.module';
import { CodigoFacturacionPublicoController } from '../facturacion/codigos.controller';
import { IngestaController } from '../ingesta/ingesta.controller';
import { BajaReportesController } from '../reportes/reportes.controller';
import { configurarApp } from '../configurar-app';
import { AuthController } from './auth.controller';
import { CuentaController } from './cuenta.controller';
import { THROTTLERS, type NombreThrottler } from './throttlers';
import { TokensService } from './tokens.service';

// F2-203: los dos cubos nuevos (`login-hora` 30/h y `reset` 10/min) y que cada ruta
// con ThrottlerGuard aplica EXACTAMENTE sus cubos. Contra Postgres real y con la
// app real; una app por prueba, porque el storage del throttler es por instancia.
//
// Para llegar al intento 31 del cubo de hora sin que responda antes el de 5/min,
// entre tandas de 5 se simula que pasó el minuto: se ponen en cero SÓLO los
// contadores del cubo `login` en el storage (lo mismo que hace su timeout al
// vencer). Los límites no se tocan. Y cada 429 se atribuye a su cubo por el header
// `Retry-After-<cubo>`: sin eso, un 429 del cubo de minuto pasaría por verde.

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

interface Registro {
  totalHits: Map<string, number>;
}
interface StorageEnMemoria {
  storage: Map<string, Registro>;
  resetBlockedRequest(key: string, throttlerName: string): void;
}

async function crearApp(): Promise<INestApplication> {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
  await app.init();
  return app;
}

/** "Pasó un minuto" para el cubo `cubo`, y sólo para él. */
function vencer(app: INestApplication, cubo: NombreThrottler): void {
  const storage = app.get(ThrottlerStorage) as unknown as StorageEnMemoria;
  for (const [llave, registro] of storage.storage) {
    if (registro.totalHits.has(cubo)) storage.resetBlockedRequest(llave, cubo);
  }
}

describe('Throttlers de F2-203 (e2e)', () => {
  const prisma = new PrismaClient();
  const apps: INestApplication[] = [];
  async function app(): Promise<INestApplication> {
    const nueva = await crearApp();
    apps.push(nueva);
    return nueva;
  }
  const token = (a: INestApplication, u: Usuario) =>
    a.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const login = (a: INestApplication, password = PASSWORD) =>
    request(a.getHttpServer()).post('/auth/login').send({ email: USUARIOS.visorA.email, password });

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
  });

  afterEach(async () => {
    await Promise.all(apps.splice(0).map((a) => a.close()));
  });

  afterAll(async () => {
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('login-hora: 30 por hora por IP en /auth/login', () => {
    it('respetando el de 5/min, el intento 31 es 429 y lo da el cubo de hora', async () => {
      const a = await app();
      for (let i = 0; i < 30; i++) {
        if (i > 0 && i % 5 === 0) vencer(a, 'login');
        const res = await login(a, 'mala').expect(401);
        expect(res.headers['x-ratelimit-limit-login-hora']).toBe('30');
        expect(res.headers['x-ratelimit-remaining-login-hora']).toBe(String(29 - i));
      }
      vencer(a, 'login');
      // Con la contraseña buena: el cubo no distingue aciertos de fallos.
      const res = await login(a).expect(429);
      expect(res.headers['retry-after-login-hora']).toBeDefined();
      expect(res.headers['retry-after-login']).toBeUndefined();
      expect(Number(res.headers['retry-after-login-hora'])).toBeGreaterThan(3000);
    });

    it('el de 5/min sigue igual: el 6.º en el mismo minuto lo da el cubo de minuto', async () => {
      const a = await app();
      for (let i = 0; i < 5; i++) await login(a, 'mala').expect(401);
      const res = await login(a).expect(429);
      expect(res.headers['retry-after-login']).toBeDefined();
      expect(res.headers['retry-after-login-hora']).toBeUndefined();
    });

    it('/cuenta/password lleva los mismos dos cubos', async () => {
      const a = await app();
      const res = await request(a.getHttpServer())
        .post('/cuenta/password')
        .set('Authorization', `Bearer ${await token(a, USUARIOS.visorA)}`)
        .send({ actual: 'mala-mala-mala', nueva: 'otra-contrasena-larga' });
      expect(res.status).not.toBe(429);
      expect(res.headers['x-ratelimit-limit-login']).toBe('5');
      expect(res.headers['x-ratelimit-limit-login-hora']).toBe('30');
      expect(res.headers['x-ratelimit-limit-reset']).toBeUndefined();
    });
  });

  describe('reset: 10 por minuto por IP en POST /usuarios/:id/password', () => {
    it('el 11.º restablecimiento es 429 y lo da el cubo reset', async () => {
      const a = await app();
      const bearer = `Bearer ${await token(a, USUARIOS.adminEmpresaA)}`;
      const reset = () =>
        request(a.getHttpServer())
          .post(`/usuarios/${USUARIOS.visorA.id}/password`)
          .set('Authorization', bearer)
          .send({ password: PASSWORD });
      for (let i = 0; i < 10; i++) {
        const res = await reset().expect(204);
        expect(res.headers['x-ratelimit-limit-reset']).toBe('10');
        expect(res.headers['x-ratelimit-limit-login']).toBeUndefined();
      }
      const res = await reset().expect(429);
      expect(res.headers['retry-after-reset']).toBeDefined();
      // El visor sigue entrando con la misma contraseña: el reset lo dejó igual.
      await login(a).expect(200);
    });

    it('sin token es 401 y no gasta el cubo (el JWT global va antes)', async () => {
      const a = await app();
      for (let i = 0; i < 12; i++) {
        const res = await request(a.getHttpServer())
          .post(`/usuarios/${USUARIOS.visorA.id}/password`)
          .send({ password: PASSWORD });
        expect(res.status).toBe(401);
      }
      const res = await request(a.getHttpServer())
        .post(`/usuarios/${USUARIOS.visorA.id}/password`)
        .set('Authorization', `Bearer ${await token(a, USUARIOS.adminEmpresaA)}`)
        .send({ password: PASSWORD });
      expect(res.status).toBe(204);
      expect(res.headers['x-ratelimit-remaining-reset']).toBe('9');
    });
  });

  describe('refresh y logout no gastan ni muestran los cubos nuevos', () => {
    it.each(['/auth/refresh', '/auth/logout'])('%s', async (ruta) => {
      const a = await app();
      const res = await request(a.getHttpServer()).post(ruta);
      expect(res.status).not.toBe(429);
      expect(res.headers['x-ratelimit-limit-refresh']).toBe('30');
      for (const cubo of ['login', 'login-hora', 'reset']) {
        expect(res.headers[`x-ratelimit-limit-${cubo}`]).toBeUndefined();
      }
    });
  });
});

// Cada ruta con ThrottlerGuard aplica exactamente sus cubos: los demás, saltados
// por `SoloThrottlers`. Por metadata, sin HTTP (así entra también la ruta de
// agente, que pide una API key real).
describe('Cada ruta con ThrottlerGuard aplica exactamente sus cubos', () => {
  const salta = (metodo: object, cubo: string): boolean =>
    Reflect.getMetadata(`THROTTLER:SKIP${cubo}`, metodo) === true;

  const RUTAS: Array<[string, object, NombreThrottler[]]> = [
    ['POST /auth/login', AuthController.prototype.login, ['login', 'login-hora']],
    ['POST /auth/refresh', AuthController.prototype.refresh, ['refresh']],
    ['POST /auth/logout', AuthController.prototype.logout, ['refresh']],
    ['POST /cuenta/password', CuentaController.prototype.cambiarPassword, ['login', 'login-hora']],
    ['POST /usuarios/:id/password', UsuariosAdminController.prototype.resetPassword, ['reset']],
    // `@AutenticacionAgente()` va en la clase: la metadata vive ahí.
    ['rutas de agente (GET /agente/yo, POST /ingesta/eventos)', AgenteController, ['agente']],
    ['POST /ingesta/eventos', IngestaController, ['agente']],
    // F2-101: pública; su cubo no gasta el de la baja de reportes, ni al revés.
    [
      'GET /facturacion/codigo/:codigo',
      CodigoFacturacionPublicoController.prototype.consultar,
      ['codigo-facturacion'],
    ],
    ['POST /reportes/baja', BajaReportesController.prototype.baja, ['baja-reportes']],
  ];

  it.each(RUTAS)('%s', (_ruta, metodo, propios) => {
    const guards = (Reflect.getMetadata(GUARDS_METADATA, metodo) ?? []) as unknown[];
    expect(guards).toContain(ThrottlerGuard);
    const aplicados = THROTTLERS.filter((c) => !salta(metodo, c));
    expect(aplicados.sort()).toEqual([...propios].sort());
  });
});
