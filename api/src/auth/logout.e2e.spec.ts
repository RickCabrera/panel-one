import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, limpiarFixtures, PASSWORD, USUARIOS } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { COOKIE_REFRESH, REFRESH_TTL_SEGUNDOS } from '../config/auth.config';
import { configurarApp } from '../configurar-app';
import { TokensService } from './tokens.service';

// E2E del logout y la revocación de refresh tokens (F1-093), sobre la app REAL
// contra Postgres REAL, con las fixtures de F1-011.
//
// Mismo cuidado que `auth.e2e.spec.ts` con el rate limit: el login admite 5
// intentos por minuto por IP y el storage del throttler es por instancia de
// app, así que cada `describe` levanta SU app y ninguno pasa de 5 logins. Donde
// basta con una sesión, se crea la fila en base y se firma el refresh con el
// TokensService de la app, sin gastar un login.

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

const HORA_MS = 60 * 60_000;

async function crearApp(): Promise<INestApplication> {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
  await app.init();
  return app;
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

/** El `sid` que lleva el refresh de una cookie (sin verificar: es para el test). */
function sidDe(cookie: string): string {
  const token = valorCookie(cookie).slice(COOKIE_REFRESH.length + 1);
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as {
    sid: string;
  };
  return claims.sid;
}

/** La cabecera que borra la cookie: vacía, mismo Path, vencida en 1970. */
function esperarCookieBorrada(res: request.Response): void {
  const cookie = cookieRefresh(res);
  expect(cookie).toMatch(new RegExp(`^${COOKIE_REFRESH}=;`));
  expect(cookie).toMatch(/; Path=\/auth(;|$)/);
  expect(cookie).toMatch(/; Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  expect(cookie).toMatch(/; HttpOnly/);
  expect(cookie).toMatch(/; SameSite=Strict/);
}

describe('Logout y revocación de refresh tokens (e2e, F1-093)', () => {
  const prisma = new PrismaClient();
  const apps: INestApplication[] = [];

  async function app(): Promise<INestApplication> {
    const nueva = await crearApp();
    apps.push(nueva);
    return nueva;
  }

  const idsFixture = Object.values(USUARIOS).map((u) => u.id);

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
  });

  // Cada bloque arranca sin sesiones de las fixtures: los conteos no dependen
  // del orden de los bloques.
  beforeEach(async () => {
    await prisma.sesionUsuario.deleteMany({ where: { usuarioId: { in: idsFixture } } });
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  function clientes(a: INestApplication) {
    const servidor = () => request(a.getHttpServer());
    const conCookie = (r: request.Test, cookie?: string) =>
      cookie ? r.set('Cookie', valorCookie(cookie)) : r;
    return {
      login: (u: Usuario) =>
        servidor().post('/auth/login').send({ email: u.email, password: PASSWORD }),
      refresh: (cookie?: string) => conCookie(servidor().post('/auth/refresh'), cookie),
      logout: (cookie?: string) => conCookie(servidor().post('/auth/logout'), cookie),
    };
  }

  /** Una sesión en base, sin gastar un login. Devuelve su `sid`. */
  async function sesionEnBase(
    u: Usuario,
    datos: { expiraEn?: Date; revocadaEn?: Date | null } = {},
  ): Promise<string> {
    const id = randomUUID();
    await prisma.sesionUsuario.create({
      data: {
        id,
        usuarioId: u.id,
        empresaId: u.empresaId,
        expiraEn: datos.expiraEn ?? new Date(Date.now() + HORA_MS),
        revocadaEn: datos.revocadaEn ?? null,
      },
    });
    return id;
  }

  async function cookieFirmada(
    a: INestApplication,
    u: Usuario,
    sid: string,
    version = 0,
  ): Promise<string> {
    return `${COOKIE_REFRESH}=${await a.get(TokensService).firmarRefresh(u.id, version, sid)}`;
  }

  const fila = (id: string) => prisma.sesionUsuario.findUniqueOrThrow({ where: { id } });

  describe('login → logout → refresh (2 logins)', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    it('el refresh con la cookie vieja recibe 401 tras el logout', async () => {
      const { login, logout, refresh } = clientes(a);
      const cookie = cookieRefresh(await login(USUARIOS.visorA).expect(200));
      const sid = sidDe(cookie);
      await expect(fila(sid)).resolves.toMatchObject({
        usuarioId: USUARIOS.visorA.id,
        empresaId: USUARIOS.visorA.empresaId,
        revocadaEn: null,
      });

      const res = await logout(cookie).expect(204);
      expect(res.text).toBe('');
      esperarCookieBorrada(res);
      expect((await fila(sid)).revocadaEn).toBeInstanceOf(Date);

      await refresh(cookie).expect(401);
    });

    it('revoca también los refresh anteriores de la sesión (los que ya rotaron)', async () => {
      const { login, logout, refresh } = clientes(a);
      const cookieLogin = cookieRefresh(await login(USUARIOS.visorA).expect(200));
      const cookieRotada = cookieRefresh(await refresh(cookieLogin).expect(200));
      // La rotación conserva la sesión.
      expect(sidDe(cookieRotada)).toBe(sidDe(cookieLogin));

      await logout(cookieRotada).expect(204);

      await refresh(cookieLogin).expect(401);
      await refresh(cookieRotada).expect(401);
    });
  });

  describe('aislamiento entre sesiones y entre usuarios (3 logins)', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    it('cerrar una sesión no cierra otra del mismo usuario (otro navegador)', async () => {
      const { login, logout, refresh } = clientes(a);
      const navegador1 = cookieRefresh(await login(USUARIOS.visorA).expect(200));
      const navegador2 = cookieRefresh(await login(USUARIOS.visorA).expect(200));
      expect(sidDe(navegador1)).not.toBe(sidDe(navegador2));

      await logout(navegador1).expect(204);

      await refresh(navegador1).expect(401);
      await refresh(navegador2).expect(200);
    });

    it('un refresh de A con el sid de una sesión de B (otra empresa) no revoca la de B', async () => {
      const { login, logout, refresh } = clientes(a);
      const cookieB = cookieRefresh(await login(USUARIOS.visorB).expect(200));
      const sidB = sidDe(cookieB);

      // Firmado por nosotros (la firma es válida) pero con `sub` de A y `sid` de B.
      await logout(await cookieFirmada(a, USUARIOS.visorA, sidB)).expect(204);

      expect((await fila(sidB)).revocadaEn).toBeNull();
      await refresh(cookieB).expect(200);
    });
  });

  describe('logout sin sesión que revocar (sin logins)', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    it('sin cookie → 204 y borra la cookie igual', async () => {
      esperarCookieBorrada(await clientes(a).logout().expect(204));
    });

    it('cookie basura → 204', async () => {
      esperarCookieBorrada(await clientes(a).logout(`${COOKIE_REFRESH}=no-es-un-jwt`).expect(204));
    });

    it('un access token en la cookie → 204 y no revoca nada', async () => {
      const sid = await sesionEnBase(USUARIOS.visorA);
      const access = await a.get(TokensService).firmarAccess({
        id: USUARIOS.visorA.id,
        rol: USUARIOS.visorA.rol,
        empresaId: USUARIOS.visorA.empresaId,
      });
      await clientes(a).logout(`${COOKIE_REFRESH}=${access}`).expect(204);
      expect((await fila(sid)).revocadaEn).toBeNull();
    });

    it('es idempotente: dos veces la misma cookie → 204 las dos, y la fecha no cambia', async () => {
      const { logout, refresh } = clientes(a);
      const sid = await sesionEnBase(USUARIOS.visorA);
      const cookie = await cookieFirmada(a, USUARIOS.visorA, sid);

      await logout(cookie).expect(204);
      const primera = (await fila(sid)).revocadaEn;
      expect(primera).toBeInstanceOf(Date);
      await logout(cookie).expect(204);
      expect((await fila(sid)).revocadaEn).toEqual(primera);
      await refresh(cookie).expect(401);
    });

    it('revoca aunque el usuario ya esté inactivo', async () => {
      const sid = await sesionEnBase(USUARIOS.visorInactivo);
      await clientes(a)
        .logout(await cookieFirmada(a, USUARIOS.visorInactivo, sid))
        .expect(204);
      expect((await fila(sid)).revocadaEn).toBeInstanceOf(Date);
    });
  });

  describe('POST /auth/refresh exige una sesión viva (sin logins)', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    /** Un refresh firmado con el secreto real pero con los claims que se quieran. */
    function refreshAMano(claims: Record<string, unknown>): Promise<string> {
      return a.get(JwtService).signAsync(
        { typ: 'refresh', ...claims },
        {
          subject: USUARIOS.visorA.id,
          secret: process.env.JWT_REFRESH_SECRET,
          expiresIn: REFRESH_TTL_SEGUNDOS,
          algorithm: 'HS256',
        },
      );
    }

    it('una sesión viva refresca y su vencimiento se corre 7 días', async () => {
      const sid = await sesionEnBase(USUARIOS.visorA);
      const antes = Date.now();
      await clientes(a)
        .refresh(await cookieFirmada(a, USUARIOS.visorA, sid))
        .expect(200);
      const expira = (await fila(sid)).expiraEn.getTime();
      expect(expira).toBeGreaterThanOrEqual(antes + REFRESH_TTL_SEGUNDOS * 1000);
      expect(expira).toBeLessThanOrEqual(Date.now() + REFRESH_TTL_SEGUNDOS * 1000);
    });

    it('un refresh sin sid (emitido antes de F1-093) → 401', async () => {
      await clientes(a)
        .refresh(`${COOKIE_REFRESH}=${await refreshAMano({ ver: 0 })}`)
        .expect(401);
    });

    it('un sid que no es UUID → 401 (no 500)', async () => {
      await clientes(a)
        .refresh(`${COOKIE_REFRESH}=${await refreshAMano({ ver: 0, sid: 'no-es-uuid' })}`)
        .expect(401);
    });

    it('un sid que no existe → 401', async () => {
      await clientes(a)
        .refresh(await cookieFirmada(a, USUARIOS.visorA, randomUUID()))
        .expect(401);
    });

    it('el sid de una sesión de otro usuario → 401, y esa sesión sigue intacta', async () => {
      const expiraEn = new Date(Date.now() + HORA_MS);
      const sidB = await sesionEnBase(USUARIOS.visorB, { expiraEn });
      await clientes(a)
        .refresh(await cookieFirmada(a, USUARIOS.visorA, sidB))
        .expect(401);
      await expect(fila(sidB)).resolves.toMatchObject({ revocadaEn: null, expiraEn });
    });

    it('una sesión vencida en base → 401', async () => {
      const sid = await sesionEnBase(USUARIOS.visorA, { expiraEn: new Date(Date.now() - 1000) });
      await clientes(a)
        .refresh(await cookieFirmada(a, USUARIOS.visorA, sid))
        .expect(401);
    });

    it('una sesión revocada → 401', async () => {
      const sid = await sesionEnBase(USUARIOS.visorA, { revocadaEn: new Date() });
      await clientes(a)
        .refresh(await cookieFirmada(a, USUARIOS.visorA, sid))
        .expect(401);
    });

    it('la versión de sesión sigue mandando: sesión viva con ver viejo → 401', async () => {
      const sid = await sesionEnBase(USUARIOS.visorA);
      await clientes(a)
        .refresh(await cookieFirmada(a, USUARIOS.visorA, sid, 7))
        .expect(401);
    });
  });

  describe('el login limpia las sesiones vencidas de ese usuario (1 login)', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    it('borra las vencidas del usuario, deja las vivas y no toca las de otro', async () => {
      const vencida = new Date(Date.now() - 1000);
      const vencidaA = await sesionEnBase(USUARIOS.visorA, { expiraEn: vencida });
      const vencidaYRevocadaA = await sesionEnBase(USUARIOS.visorA, {
        expiraEn: vencida,
        revocadaEn: vencida,
      });
      const vivaRevocadaA = await sesionEnBase(USUARIOS.visorA, { revocadaEn: new Date() });
      const vencidaB = await sesionEnBase(USUARIOS.visorB, { expiraEn: vencida });

      const cookie = cookieRefresh(await clientes(a).login(USUARIOS.visorA).expect(200));

      const quedan = await prisma.sesionUsuario.findMany({
        where: { usuarioId: { in: [USUARIOS.visorA.id, USUARIOS.visorB.id] } },
        select: { id: true },
      });
      const ids = quedan.map((s) => s.id).sort();
      expect(ids).toEqual([vivaRevocadaA, vencidaB, sidDe(cookie)].sort());
      expect(ids).not.toContain(vencidaA);
      expect(ids).not.toContain(vencidaYRevocadaA);
    });

    it('la sesión de un admin_global va sin empresa', async () => {
      const sid = await sesionEnBase(USUARIOS.adminGlobal);
      await expect(fila(sid)).resolves.toMatchObject({ empresaId: null });
      await clientes(a)
        .refresh(await cookieFirmada(a, USUARIOS.adminGlobal, sid))
        .expect(200);
    });
  });

  describe('rate limit de logout: 30 por minuto por IP (sin logins)', () => {
    it('el 31.º logout es 429', async () => {
      const a = await app();
      const { logout } = clientes(a);
      for (let i = 0; i < 30; i += 1) {
        await logout().expect(204);
      }
      await logout().expect(429);
    });
  });
});
