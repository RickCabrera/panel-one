import { Controller, Get, Param, ParseUUIDPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, RolUsuario } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, limpiarFixtures, PASSWORD, USUARIOS, FX } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { COOKIE_REFRESH } from '../config/auth.config';
import { configurarApp } from '../configurar-app';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { Roles } from './decoradores';
import { TokensService } from './tokens.service';

// E2E de auth (F1-011) sobre la app REAL (AppModule + configurarApp: guards
// globales, cookie-parser, ValidationPipe, throttler) contra Postgres REAL.
//
// RATE LIMIT Y ESTOS TESTS: el login admite 5 intentos por minuto por IP y todos
// estos requests salen de la misma IP. El storage del throttler es por instancia
// de app, así que cada bloque `describe` levanta SU app y ningún bloque pasa de
// 5 intentos de login (400 y 401 incluidos, que también cuentan). Donde un test
// sólo necesita un token válido, se firma con el TokensService de la app en vez
// de gastar un login. El límite no se sube ni se apaga para los tests.

/**
 * Controlador SÓLO de prueba: no existe en AppModule ni en el contrato. Hoy no
 * hay ningún endpoint de datos por empresa (`/sucursales` y `/empresas` son de
 * F1-033/F1-060); éste ejercita la tubería real guard → scope → helper → 404
 * sin adelantar esas tareas. F1-033 agrega los e2e de scoping de cada endpoint.
 */
@Controller('prueba-scope')
class PruebaScopeController {
  constructor(private readonly datos: ScopedPrismaService) {}

  @Get('sucursales')
  sucursales(@EmpresaScopeActual() scope: EmpresaScope) {
    return this.datos.para(scope).sucursal.findMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB, FX.empresaC] } },
      orderBy: { nombre: 'asc' },
      select: { id: true },
    });
  }

  @Get('sucursales/:id')
  async sucursal(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return encontradoOr404(
      await this.datos.para(scope).sucursal.findFirst({ where: { id }, select: { id: true } }),
    );
  }

  @Get('empresas/:id')
  async empresa(@EmpresaScopeActual() scope: EmpresaScope, @Param('id', ParseUUIDPipe) id: string) {
    return encontradoOr404(
      await this.datos.para(scope).empresa.findFirst({ where: { id }, select: { id: true } }),
    );
  }

  @Get('solo-admin-empresa')
  @Roles(RolUsuario.admin_empresa, RolUsuario.admin_global)
  soloAdmin() {
    return { ok: true };
  }
}

async function crearApp(): Promise<INestApplication> {
  const modulo = await Test.createTestingModule({
    imports: [AppModule],
    controllers: [PruebaScopeController],
  }).compile();
  const app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
  await app.init();
  return app;
}

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

function tokenDe(app: INestApplication, u: Usuario): Promise<string> {
  return app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
}

function login(app: INestApplication, email: string, password = PASSWORD) {
  return request(app.getHttpServer()).post('/auth/login').send({ email, password });
}

function cookieRefresh(res: request.Response): string {
  const cabecera = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = (cabecera ?? []).find((c) => c.startsWith(`${COOKIE_REFRESH}=`));
  if (!cookie) {
    throw new Error('La respuesta no puso la cookie de refresh.');
  }
  return cookie;
}

/** Sólo `nombre=valor`, como lo reenviaría el navegador. */
function valorCookie(setCookie: string): string {
  return setCookie.split(';')[0];
}

const CUERPO_401_LOGIN = {
  statusCode: 401,
  message: 'Credenciales inválidas',
  error: 'Unauthorized',
};

describe('Auth de usuarios (e2e, F1-011)', () => {
  const prisma = new PrismaClient();
  const apps: INestApplication[] = [];

  async function app(): Promise<INestApplication> {
    const nueva = await crearApp();
    apps.push(nueva);
    return nueva;
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('POST /auth/login (5 intentos)', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    it('login ok: 200, access token que funciona y cookie de refresh httpOnly', async () => {
      const res = await login(a, USUARIOS.visorA.email).expect(200);

      expect(res.body).toEqual({
        accessToken: expect.any(String),
        expiresIn: 900,
        usuario: {
          id: USUARIOS.visorA.id,
          email: USUARIOS.visorA.email,
          nombre: 'Prueba visorA',
          rol: 'visor',
          empresaId: FX.empresaA,
        },
      });
      // Ni el hash ni la contraseña salen nunca.
      expect(JSON.stringify(res.body)).not.toContain('$argon2');

      const cookie = cookieRefresh(res);
      expect(cookie).toMatch(/; HttpOnly/);
      expect(cookie).toMatch(/; SameSite=Strict/);
      expect(cookie).toMatch(/; Path=\/auth/);
      expect(cookie).toMatch(/; Max-Age=604800/);

      await request(a.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });

    it('normaliza el email (mayúsculas y espacios)', async () => {
      const res = await login(a, `  ${USUARIOS.adminEmpresaA.email.toUpperCase()} `).expect(200);
      expect(res.body.usuario.id).toBe(USUARIOS.adminEmpresaA.id);
    });

    it('contraseña mala → 401', async () => {
      const res = await login(a, USUARIOS.visorA.email, 'no-es-la-contrasena').expect(401);
      expect(res.body).toEqual(CUERPO_401_LOGIN);
      expect(res.headers['set-cookie']).toBeUndefined();
    });

    it('email inexistente → 401 con el mismo cuerpo', async () => {
      const res = await login(a, 'nadie@f1-011.test').expect(401);
      expect(res.body).toEqual(CUERPO_401_LOGIN);
    });

    it('usuario inactivo → 401 con el mismo cuerpo, aunque la contraseña sea buena', async () => {
      const res = await login(a, USUARIOS.visorInactivo.email).expect(401);
      expect(res.body).toEqual(CUERPO_401_LOGIN);
    });
  });

  describe('POST /auth/login, más casos (3 intentos)', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    it('usuario de una empresa inactiva → 401 con el mismo cuerpo', async () => {
      const res = await login(a, USUARIOS.visorEmpresaInactiva.email).expect(401);
      expect(res.body).toEqual(CUERPO_401_LOGIN);
    });

    it('admin_global entra con empresaId null', async () => {
      const res = await login(a, USUARIOS.adminGlobal.email).expect(200);
      expect(res.body.usuario).toMatchObject({ rol: 'admin_global', empresaId: null });
    });

    it('cuerpo inválido → 400', async () => {
      await request(a.getHttpServer()).post('/auth/login').send({ password: PASSWORD }).expect(400);
    });
  });

  describe('rate limit de login: 5 por minuto por IP', () => {
    it('el 6.º intento es 429, aunque traiga las credenciales buenas', async () => {
      const a = await app();
      for (let i = 0; i < 5; i++) {
        await login(a, USUARIOS.visorA.email, 'mala').expect(401);
      }
      await login(a, USUARIOS.visorA.email).expect(429);
    });
  });

  describe('GET /auth/me (sin logins)', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    const me = (token?: string) => {
      const r = request(a.getHttpServer()).get('/auth/me');
      return token ? r.set('Authorization', `Bearer ${token}`) : r;
    };

    it('con access token → el usuario, leído de la base', async () => {
      const res = await me(await tokenDe(a, USUARIOS.visorB)).expect(200);
      expect(res.body).toEqual({
        id: USUARIOS.visorB.id,
        email: USUARIOS.visorB.email,
        nombre: 'Prueba visorB',
        rol: 'visor',
        empresaId: FX.empresaB,
      });
    });

    it('sin token → 401', async () => {
      await me().expect(401);
    });

    it('token alterado → 401', async () => {
      const token = await tokenDe(a, USUARIOS.visorA);
      const [h, p, firma] = token.split('.');
      const alterada = (firma[0] === 'A' ? 'B' : 'A') + firma.slice(1);
      await me(`${h}.${p}.${alterada}`).expect(401);
    });

    it('token firmado con otro secreto → 401', async () => {
      const token = await a
        .get(JwtService)
        .signAsync(
          { rol: 'admin_global', empresaId: null, typ: 'access' },
          { subject: USUARIOS.visorA.id, secret: 'x'.repeat(40), algorithm: 'HS256' },
        );
      await me(token).expect(401);
    });

    it('token vencido → 401', async () => {
      const token = await a.get(JwtService).signAsync(
        {
          rol: 'visor',
          empresaId: FX.empresaA,
          typ: 'access',
          exp: Math.floor(Date.now() / 1000) - 60,
        },
        {
          subject: USUARIOS.visorA.id,
          secret: process.env.JWT_ACCESS_SECRET,
          algorithm: 'HS256',
        },
      );
      await me(token).expect(401);
    });

    it('un refresh token usado como bearer → 401', async () => {
      await me(await a.get(TokensService).firmarRefresh(USUARIOS.visorA.id)).expect(401);
    });

    it('usuario desactivado con access token aún vigente → 401 en /me', async () => {
      await me(await tokenDe(a, USUARIOS.visorInactivo)).expect(401);
    });
  });

  describe('POST /auth/refresh (1 intento de login)', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    const refresh = (cookie?: string) => {
      const r = request(a.getHttpServer()).post('/auth/refresh');
      return cookie ? r.set('Cookie', cookie) : r;
    };

    it('con la cookie del login → access nuevo que funciona y cookie rotada', async () => {
      const inicio = await login(a, USUARIOS.visorA.email).expect(200);
      const cookieLogin = cookieRefresh(inicio);

      const res = await refresh(valorCookie(cookieLogin)).expect(200);
      expect(res.body).toMatchObject({ expiresIn: 900, usuario: { id: USUARIOS.visorA.id } });
      const cookieNueva = cookieRefresh(res);
      expect(valorCookie(cookieNueva)).not.toBe(valorCookie(cookieLogin));
      expect(cookieNueva).toMatch(/; HttpOnly/);

      await request(a.getHttpServer())
        .get('/auth/me')
        .set('Authorization', `Bearer ${res.body.accessToken}`)
        .expect(200);
    });

    it('sin cookie → 401', async () => {
      await refresh().expect(401);
    });

    it('cookie basura → 401', async () => {
      await refresh(`${COOKIE_REFRESH}=no-es-un-jwt`).expect(401);
    });

    it('un access token puesto en la cookie → 401', async () => {
      await refresh(`${COOKIE_REFRESH}=${await tokenDe(a, USUARIOS.visorA)}`).expect(401);
    });

    it('refresh de un usuario ya inactivo → 401', async () => {
      const token = await a.get(TokensService).firmarRefresh(USUARIOS.visorInactivo.id);
      await refresh(`${COOKIE_REFRESH}=${token}`).expect(401);
    });
  });

  describe('@Roles', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    const soloAdmin = async (u: Usuario) =>
      (
        await request(a.getHttpServer())
          .get('/prueba-scope/solo-admin-empresa')
          .set('Authorization', `Bearer ${await tokenDe(a, u)}`)
      ).status;

    it('un visor en una ruta de admin → 403 (depende de la ruta, no del recurso)', async () => {
      expect(await soloAdmin(USUARIOS.visorA)).toBe(403);
    });

    it('admin_empresa y admin_global entran', async () => {
      expect(await soloAdmin(USUARIOS.adminEmpresaA)).toBe(200);
      expect(await soloAdmin(USUARIOS.adminGlobal)).toBe(200);
    });
  });

  describe('scope multiempresa: datos de otra empresa son 404, no 403 (1 intento de login)', () => {
    let a: INestApplication;
    let tokenVisorA: string;
    beforeAll(async () => {
      a = await app();
      // De punta a punta: el token sale de un login real, no de firmarlo a mano.
      tokenVisorA = (await login(a, USUARIOS.visorA.email).expect(200)).body.accessToken;
    });

    const get = (ruta: string, token?: string) => {
      const r = request(a.getHttpServer()).get(ruta);
      return token ? r.set('Authorization', `Bearer ${token}`) : r;
    };

    it('visor de A pide una sucursal de B → 404, idéntico a pedir una que no existe', async () => {
      const deB = await get(`/prueba-scope/sucursales/${FX.sucursalB1}`, tokenVisorA);
      const inexistente = await get(`/prueba-scope/sucursales/${FX.inexistente}`, tokenVisorA);

      expect(deB.status).toBe(404);
      expect(inexistente.status).toBe(404);
      expect(deB.body).toEqual(inexistente.body);
    });

    it('visor de A pide la empresa B → 404; la suya → 200', async () => {
      await get(`/prueba-scope/empresas/${FX.empresaB}`, tokenVisorA).expect(404);
      await get(`/prueba-scope/empresas/${FX.empresaA}`, tokenVisorA).expect(200);
    });

    it('visor de A ve sus sucursales, y en la lista sólo las suyas', async () => {
      await get(`/prueba-scope/sucursales/${FX.sucursalA1}`, tokenVisorA).expect(200);
      const lista = await get('/prueba-scope/sucursales', tokenVisorA).expect(200);
      expect(lista.body).toEqual([{ id: FX.sucursalA1 }, { id: FX.sucursalA2 }]);
    });

    it('visor de B ve su sucursal; admin_global ve la de B', async () => {
      await get(
        `/prueba-scope/sucursales/${FX.sucursalB1}`,
        await tokenDe(a, USUARIOS.visorB),
      ).expect(200);
      await get(
        `/prueba-scope/sucursales/${FX.sucursalB1}`,
        await tokenDe(a, USUARIOS.adminGlobal),
      ).expect(200);
    });

    it('sin token → 401', async () => {
      await get(`/prueba-scope/sucursales/${FX.sucursalA1}`).expect(401);
    });
  });
});
