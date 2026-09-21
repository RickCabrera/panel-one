import { Logger, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, RolUsuario } from '@prisma/client';
import request from 'supertest';

import {
  crearFixtures,
  DOMINIO,
  FX,
  limpiarFixtures,
  PASSWORD,
  USUARIOS,
} from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { COOKIE_REFRESH } from '../config/auth.config';
import { configurarApp } from '../configurar-app';

// E2E de la administración (F1-060) sobre la app REAL (AppModule +
// configurarApp) contra Postgres REAL, con las fixtures sintéticas de F1-011.
//
// Los usuarios que un test modifica (reset, baja, cambio de contraseña) los
// crea ese mismo test: las fixtures compartidas no se tocan, así el orden de
// los tests no importa. Todo usuario nuevo usa el dominio de las fixtures
// (`limpiarFixtures` lo borra) y toda empresa nueva lleva el sufijo `SUFIJO`.
//
// RATE LIMIT: login y `/cuenta/password` admiten 5/min por IP, y el storage es
// por instancia de app. Los bloques que hacen login levantan SU app.

const SUFIJO = '(F1-060)';
const PASSWORD_NUEVA = 'otra-contrasena-sintetica-F1-060';

async function crearApp(): Promise<INestApplication> {
  const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
  await app.init();
  return app;
}

interface Quien {
  id: string;
  rol: RolUsuario;
  empresaId: string | null;
}

let consecutivo = 0;
function emailNuevo(clave: string): string {
  consecutivo += 1;
  return `f1060.${clave}.${consecutivo}${DOMINIO}`;
}

function valorCookie(res: request.Response): string {
  const cabecera = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = (cabecera ?? []).find((c) => c.startsWith(`${COOKIE_REFRESH}=`));
  if (!cookie) {
    throw new Error('La respuesta no puso la cookie de refresh.');
  }
  return cookie.split(';')[0];
}

describe('Administración (e2e, F1-060)', () => {
  const prisma = new PrismaClient();
  const apps: INestApplication[] = [];

  async function app(): Promise<INestApplication> {
    const nueva = await crearApp();
    apps.push(nueva);
    return nueva;
  }

  function como(a: INestApplication, u: Quien) {
    const token = a
      .get(TokensService)
      .firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
    // Devuelve la RESPUESTA: el request (un thenable) se resuelve dentro.
    const enviar = async (r: request.Test, cuerpo?: object): Promise<request.Response> => {
      const conToken = r.set('Authorization', `Bearer ${await token}`);
      return cuerpo === undefined ? conToken : conToken.send(cuerpo);
    };
    const servidor = () => request(a.getHttpServer());
    return {
      get: (ruta: string) => enviar(servidor().get(ruta)),
      post: (ruta: string, cuerpo?: object) => enviar(servidor().post(ruta), cuerpo),
      patch: (ruta: string, cuerpo?: object) => enviar(servidor().patch(ruta), cuerpo),
    };
  }

  /** Crea un usuario directo en la base (con la contraseña de las fixtures). */
  async function usuarioDePrueba(
    clave: string,
    rol: RolUsuario,
    empresaId: string | null,
  ): Promise<Quien & { email: string }> {
    const plantilla = await prisma.usuario.findUniqueOrThrow({
      where: { id: USUARIOS.visorA.id },
      select: { passwordHash: true },
    });
    const email = emailNuevo(clave);
    const u = await prisma.usuario.create({
      data: {
        email,
        nombre: `Prueba ${clave}`,
        rol,
        empresaId,
        passwordHash: plantilla.passwordHash,
      },
    });
    return { id: u.id, rol: u.rol, empresaId: u.empresaId, email };
  }

  const fila = (id: string) => prisma.usuario.findUniqueOrThrow({ where: { id } });

  async function limpiarPropias(): Promise<void> {
    const empresas = await prisma.empresa.findMany({
      where: { nombre: { endsWith: SUFIJO } },
      select: { id: true },
    });
    const ids = empresas.map((e) => e.id);
    // Hojas primero: las FK son Restrict.
    await prisma.usuario.deleteMany({
      where: { email: { endsWith: DOMINIO }, empresaId: { in: ids } },
    });
    await prisma.sucursal.deleteMany({ where: { empresaId: { in: ids } } });
    await prisma.empresa.deleteMany({ where: { id: { in: ids } } });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await limpiarPropias();
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
    await limpiarPropias();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  // -----------------------------------------------------------------------------------
  describe('AC: un admin_empresa no puede tocar otra empresa ni crear admin_global', () => {
    let a: INestApplication;
    let adminA: ReturnType<typeof como>;
    beforeAll(async () => {
      a = await app();
      adminA = como(a, USUARIOS.adminEmpresaA);
    });

    it('empresas: crear o editar cualquiera (la suya incluida) es 403 por ruta, y nada cambia', async () => {
      const antes = await prisma.empresa.findMany({
        where: { id: { in: [FX.empresaA, FX.empresaB] } },
      });
      expect((await adminA.post('/empresas', { nombre: `Intrusa ${SUFIJO}` })).status).toBe(403);
      expect((await adminA.patch(`/empresas/${FX.empresaB}`, { activo: false })).status).toBe(403);
      expect((await adminA.patch(`/empresas/${FX.empresaA}`, { nombre: 'x' })).status).toBe(403);
      await expect(
        prisma.empresa.findMany({ where: { id: { in: [FX.empresaA, FX.empresaB] } } }),
      ).resolves.toEqual(antes);
      await expect(prisma.empresa.count({ where: { nombre: `Intrusa ${SUFIJO}` } })).resolves.toBe(
        0,
      );
    });

    it('sucursal en la empresa B: 404 idéntico a una empresa inexistente, y no se crea', async () => {
      const cuerpo = { nombre: 'Intrusa', zonaHoraria: 'America/Mexico_City' };
      const deB = await adminA.post('/sucursales', { ...cuerpo, empresaId: FX.empresaB });
      const inexistente = await adminA.post('/sucursales', {
        ...cuerpo,
        empresaId: FX.inexistente,
      });
      expect(deB.status).toBe(404);
      expect(deB.body).toEqual(inexistente.body);
      await expect(prisma.sucursal.count({ where: { nombre: 'Intrusa' } })).resolves.toBe(0);
    });

    it('editar la sucursal B1: 404 idéntico a una inexistente, y B1 intacta', async () => {
      const antes = await prisma.sucursal.findUniqueOrThrow({ where: { id: FX.sucursalB1 } });
      const deB = await adminA.patch(`/sucursales/${FX.sucursalB1}`, {
        activo: false,
        nombre: 'x',
      });
      const inexistente = await adminA.patch(`/sucursales/${FX.inexistente}`, { activo: false });
      expect(deB.status).toBe(404);
      expect(deB.body).toEqual(inexistente.body);
      await expect(
        prisma.sucursal.findUniqueOrThrow({ where: { id: FX.sucursalB1 } }),
      ).resolves.toEqual(antes);
    });

    it('usuario de B: editar y resetear son 404 idénticos a uno inexistente, y queda intacto', async () => {
      const antes = await fila(USUARIOS.visorB.id);
      const ruta = (id: string) => `/usuarios/${id}`;
      const editar = await adminA.patch(ruta(USUARIOS.visorB.id), { activo: false });
      const editarNo = await adminA.patch(ruta(FX.inexistente), { activo: false });
      const reset = await adminA.post(`${ruta(USUARIOS.visorB.id)}/password`, {
        password: PASSWORD_NUEVA,
      });
      const resetNo = await adminA.post(`${ruta(FX.inexistente)}/password`, {
        password: PASSWORD_NUEVA,
      });
      for (const r of [editar, editarNo, reset, resetNo]) {
        expect(r.status).toBe(404);
      }
      expect(editar.body).toEqual(editarNo.body);
      expect(reset.body).toEqual(resetNo.body);
      await expect(fila(USUARIOS.visorB.id)).resolves.toEqual(antes);
    });

    it('un admin_global es 404 para él, también con `rol` en el body (no se revela que existe)', async () => {
      const antes = await fila(USUARIOS.adminGlobal.id);
      for (const cuerpo of [
        { activo: false },
        { rol: RolUsuario.visor },
        { rol: RolUsuario.admin_global },
      ]) {
        const r = await adminA.patch(`/usuarios/${USUARIOS.adminGlobal.id}`, cuerpo);
        expect(r.status).toBe(404);
      }
      expect(
        (
          await adminA.post(`/usuarios/${USUARIOS.adminGlobal.id}/password`, {
            password: PASSWORD_NUEVA,
          })
        ).status,
      ).toBe(404);
      await expect(fila(USUARIOS.adminGlobal.id)).resolves.toEqual(antes);
    });

    it('crear un admin_global: 403, con o sin empresa, y no se crea', async () => {
      const email = emailNuevo('intruso-global');
      for (const empresaId of [undefined, null, FX.empresaA]) {
        const r = await adminA.post('/usuarios', {
          email,
          nombre: 'Intruso',
          rol: RolUsuario.admin_global,
          empresaId,
          password: PASSWORD_NUEVA,
        });
        expect(r.status).toBe(403);
      }
      await expect(prisma.usuario.count({ where: { email } })).resolves.toBe(0);
    });

    it('crear un usuario en la empresa B: 404 idéntico a inexistente, y no se crea', async () => {
      const email = emailNuevo('intruso-b');
      const cuerpo = { email, nombre: 'Intruso', rol: RolUsuario.visor, password: PASSWORD_NUEVA };
      const deB = await adminA.post('/usuarios', { ...cuerpo, empresaId: FX.empresaB });
      const inexistente = await adminA.post('/usuarios', { ...cuerpo, empresaId: FX.inexistente });
      expect(deB.status).toBe(404);
      expect(deB.body).toEqual(inexistente.body);
      await expect(prisma.usuario.count({ where: { email } })).resolves.toBe(0);
    });

    it('subir a un usuario de su empresa a admin_global: 403, y no cambia', async () => {
      const u = await usuarioDePrueba('subir', RolUsuario.visor, FX.empresaA);
      const r = await adminA.patch(`/usuarios/${u.id}`, { rol: RolUsuario.admin_global });
      expect(r.status).toBe(403);
      await expect(fila(u.id)).resolves.toMatchObject({
        rol: RolUsuario.visor,
        empresaId: FX.empresaA,
      });
    });

    it('listar usuarios: sólo los de su empresa; con empresaId de B o inexistente, 404 idénticos', async () => {
      const r = await adminA.get('/usuarios');
      expect(r.status).toBe(200);
      const empresas = new Set((r.body as { empresaId: string | null }[]).map((u) => u.empresaId));
      expect([...empresas]).toEqual([FX.empresaA]);

      const deB = await adminA.get(`/usuarios?empresaId=${FX.empresaB}`);
      const inexistente = await adminA.get(`/usuarios?empresaId=${FX.inexistente}`);
      expect(deB.status).toBe(404);
      expect(deB.body).toEqual(inexistente.body);
    });

    it('SÍ administra su empresa: alta y edición de sucursal y de usuario', async () => {
      const s = await adminA.post('/sucursales', {
        empresaId: FX.empresaA,
        nombre: '  Nueva A  ',
        zonaHoraria: 'America/Tijuana',
      });
      expect(s.status).toBe(201);
      expect(s.body).toEqual({
        id: expect.any(String),
        empresaId: FX.empresaA,
        nombre: 'Nueva A',
        zonaHoraria: 'America/Tijuana',
        activo: true,
      });
      const e = await adminA.patch(`/sucursales/${s.body.id}`, { activo: false });
      expect(e.status).toBe(200);
      expect(e.body).toMatchObject({ id: s.body.id, activo: false, nombre: 'Nueva A' });

      const email = emailNuevo('alta-a');
      const u = await adminA.post('/usuarios', {
        email: email.toUpperCase(),
        nombre: 'Alta A',
        rol: RolUsuario.admin_empresa,
        empresaId: FX.empresaA,
        password: PASSWORD_NUEVA,
      });
      expect(u.status).toBe(201);
      expect(u.body).toEqual({
        id: expect.any(String),
        email,
        nombre: 'Alta A',
        rol: RolUsuario.admin_empresa,
        empresaId: FX.empresaA,
        activo: true,
      });
      const cambio = await adminA.patch(`/usuarios/${u.body.id}`, { rol: RolUsuario.visor });
      expect(cambio.status).toBe(200);
      expect(cambio.body).toMatchObject({ rol: RolUsuario.visor });
    });
  });

  // -----------------------------------------------------------------------------------
  describe('admin_global', () => {
    let a: INestApplication;
    let global: ReturnType<typeof como>;
    beforeAll(async () => {
      a = await app();
      global = como(a, USUARIOS.adminGlobal);
    });

    it('crea, renombra, da de baja y reactiva una empresa', async () => {
      const c = await global.post('/empresas', { nombre: `  Nueva ${SUFIJO} ` });
      expect(c.status).toBe(201);
      expect(c.body).toEqual({ id: expect.any(String), nombre: `Nueva ${SUFIJO}`, activo: true });
      const id = c.body.id as string;

      const r = await global.patch(`/empresas/${id}`, {
        nombre: `Renombrada ${SUFIJO}`,
        activo: false,
      });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ id, nombre: `Renombrada ${SUFIJO}`, activo: false });
      expect((await global.patch(`/empresas/${id}`, { activo: true })).body).toMatchObject({
        activo: true,
      });
      expect((await global.patch(`/empresas/${FX.inexistente}`, { activo: true })).status).toBe(
        404,
      );
    });

    it('crea sucursal y usuario en cualquier empresa', async () => {
      const s = await global.post('/sucursales', {
        empresaId: FX.empresaB,
        nombre: 'Nueva B',
        zonaHoraria: 'America/Cancun',
      });
      expect(s.status).toBe(201);
      expect(s.body.empresaId).toBe(FX.empresaB);
      const u = await global.post('/usuarios', {
        email: emailNuevo('alta-b'),
        nombre: 'Alta B',
        rol: RolUsuario.visor,
        empresaId: FX.empresaB,
        password: PASSWORD_NUEVA,
      });
      expect(u.status).toBe(201);
      expect(u.body.empresaId).toBe(FX.empresaB);
    });

    it('crea un admin_global sin empresa; con empresa es 400; otro rol sin empresa es 400', async () => {
      const ok = await global.post('/usuarios', {
        email: emailNuevo('global'),
        nombre: 'Global nuevo',
        rol: RolUsuario.admin_global,
        password: PASSWORD_NUEVA,
      });
      expect(ok.status).toBe(201);
      expect(ok.body).toMatchObject({ rol: RolUsuario.admin_global, empresaId: null });

      const conEmpresa = await global.post('/usuarios', {
        email: emailNuevo('global-emp'),
        nombre: 'x',
        rol: RolUsuario.admin_global,
        empresaId: FX.empresaA,
        password: PASSWORD_NUEVA,
      });
      expect(conEmpresa.status).toBe(400);
      const sinEmpresa = await global.post('/usuarios', {
        email: emailNuevo('visor-sin'),
        nombre: 'x',
        rol: RolUsuario.visor,
        password: PASSWORD_NUEVA,
      });
      expect(sinEmpresa.status).toBe(400);
    });

    it('cambios de rol hacia o desde admin_global: 400, y el usuario no cambia (nunca 500 por el CHECK)', async () => {
      const g = await usuarioDePrueba('otro-global', RolUsuario.admin_global, null);
      const v = await usuarioDePrueba('a-global', RolUsuario.visor, FX.empresaA);
      for (const rol of [RolUsuario.visor, RolUsuario.admin_empresa]) {
        expect((await global.patch(`/usuarios/${g.id}`, { rol })).status).toBe(400);
      }
      expect(
        (await global.patch(`/usuarios/${v.id}`, { rol: RolUsuario.admin_global })).status,
      ).toBe(400);
      await expect(fila(g.id)).resolves.toMatchObject({
        rol: RolUsuario.admin_global,
        empresaId: null,
      });
      await expect(fila(v.id)).resolves.toMatchObject({
        rol: RolUsuario.visor,
        empresaId: FX.empresaA,
      });
      // Mismo rol que ya tiene: no es un cambio, pasa.
      expect(
        (await global.patch(`/usuarios/${g.id}`, { rol: RolUsuario.admin_global })).status,
      ).toBe(200);
    });

    it('lista usuarios de todas las empresas, o de una', async () => {
      const todos = await global.get('/usuarios');
      const empresas = new Set(
        (todos.body as { empresaId: string | null }[]).map((u) => u.empresaId),
      );
      expect(empresas.has(FX.empresaA) && empresas.has(FX.empresaB) && empresas.has(null)).toBe(
        true,
      );
      const deB = await global.get(`/usuarios?empresaId=${FX.empresaB}`);
      expect((deB.body as { empresaId: string }[]).every((u) => u.empresaId === FX.empresaB)).toBe(
        true,
      );
    });
  });

  // -----------------------------------------------------------------------------------
  describe('reglas comunes', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    it('visor: 403 en toda ruta de administración, y nada cambia', async () => {
      const visor = como(a, USUARIOS.visorA);
      const antes = await fila(USUARIOS.visorA.id);
      const respuestas = await Promise.all([
        visor.post('/empresas', { nombre: 'x' }),
        visor.patch(`/empresas/${FX.empresaA}`, { nombre: 'x' }),
        visor.post('/sucursales', {
          empresaId: FX.empresaA,
          nombre: 'x',
          zonaHoraria: 'America/Mexico_City',
        }),
        visor.patch(`/sucursales/${FX.sucursalA1}`, { nombre: 'x' }),
        visor.get('/usuarios'),
        visor.post('/usuarios', {
          email: emailNuevo('visor'),
          nombre: 'x',
          rol: RolUsuario.visor,
          empresaId: FX.empresaA,
          password: PASSWORD_NUEVA,
        }),
        visor.patch(`/usuarios/${USUARIOS.visorA.id}`, { nombre: 'x' }),
        visor.post(`/usuarios/${USUARIOS.visorA.id}/password`, { password: PASSWORD_NUEVA }),
      ]);
      expect(respuestas.map((r) => r.status)).toEqual(Array(8).fill(403));
      await expect(fila(USUARIOS.visorA.id)).resolves.toEqual(antes);
    });

    it('sin token: 401', async () => {
      const s = request(a.getHttpServer());
      await s.get('/usuarios').expect(401);
      await s.post('/empresas').send({ nombre: 'x' }).expect(401);
      await s.patch(`/sucursales/${FX.sucursalA1}`).send({ nombre: 'x' }).expect(401);
      await s.post('/cuenta/password').send({ actual: 'x', nueva: PASSWORD_NUEVA }).expect(401);
    });

    it('ninguna respuesta lleva el hash de la contraseña ni el de la API key', async () => {
      const global = como(a, USUARIOS.adminGlobal);
      const respuestas = [
        await global.get('/usuarios'),
        await global.post('/usuarios', {
          email: emailNuevo('sin-hash'),
          nombre: 'Sin hash',
          rol: RolUsuario.visor,
          empresaId: FX.empresaA,
          password: PASSWORD_NUEVA,
        }),
        await global.patch(`/sucursales/${FX.sucursalA1}`, { nombre: 'A1' }),
      ];
      for (const r of respuestas) {
        const texto = JSON.stringify(r.body);
        expect(r.status).toBeLessThan(300);
        for (const prohibido of [
          'passwordHash',
          'apiKeyHash',
          'versionSesion',
          '$argon2',
          PASSWORD_NUEVA,
        ]) {
          expect(texto).not.toContain(prohibido);
        }
      }
    });

    it.each([['+05:00'], ['-06:00'], ['UTC-6'], ['America/Nowhere'], ['america/tijuana'], ['']])(
      'zonaHoraria %j: 400 al crear y al editar',
      async (zona) => {
        const global = como(a, USUARIOS.adminGlobal);
        const antes = await prisma.sucursal.findUniqueOrThrow({ where: { id: FX.sucursalA2 } });
        const crear = await global.post('/sucursales', {
          empresaId: FX.empresaA,
          nombre: 'Zona',
          zonaHoraria: zona,
        });
        const editar = await global.patch(`/sucursales/${FX.sucursalA2}`, { zonaHoraria: zona });
        expect(crear.status).toBe(400);
        expect(editar.status).toBe(400);
        await expect(
          prisma.sucursal.findUniqueOrThrow({ where: { id: FX.sucursalA2 } }),
        ).resolves.toEqual(antes);
      },
    );

    it('PATCH sin campos, o con null en un campo NOT NULL, o con un campo de más: 400', async () => {
      const global = como(a, USUARIOS.adminGlobal);
      for (const cuerpo of [
        {},
        { nombre: null },
        { activo: null },
        { nombre: '   ' },
        { empresaId: FX.empresaB },
      ]) {
        const r = await global.patch(`/sucursales/${FX.sucursalA1}`, cuerpo);
        expect(r.status).toBe(400);
      }
      await expect(
        prisma.sucursal.findUniqueOrThrow({ where: { id: FX.sucursalA1 } }),
      ).resolves.toMatchObject({ empresaId: FX.empresaA, activo: true });
    });

    it('email duplicado (sin importar mayúsculas): 409', async () => {
      const r = await como(a, USUARIOS.adminGlobal).post('/usuarios', {
        email: USUARIOS.visorA.email.toUpperCase(),
        nombre: 'Duplicado',
        rol: RolUsuario.visor,
        empresaId: FX.empresaA,
        password: PASSWORD_NUEVA,
      });
      expect(r.status).toBe(409);
    });

    it('contraseña nueva de menos de 12: 400', async () => {
      const r = await como(a, USUARIOS.adminGlobal).post('/usuarios', {
        email: emailNuevo('corta'),
        nombre: 'Corta',
        rol: RolUsuario.visor,
        empresaId: FX.empresaA,
        password: 'corta',
      });
      expect(r.status).toBe(400);
    });

    it('nadie se da de baja ni se cambia el rol a sí mismo: 400; su nombre sí', async () => {
      const yo = await usuarioDePrueba('yo', RolUsuario.admin_empresa, FX.empresaA);
      const api = como(a, yo);
      expect((await api.patch(`/usuarios/${yo.id}`, { activo: false })).status).toBe(400);
      expect((await api.patch(`/usuarios/${yo.id}`, { rol: RolUsuario.visor })).status).toBe(400);
      await expect(fila(yo.id)).resolves.toMatchObject({
        activo: true,
        rol: RolUsuario.admin_empresa,
      });
      const nombre = await api.patch(`/usuarios/${yo.id}`, { nombre: 'Otro nombre' });
      expect(nombre.status).toBe(200);
      expect(nombre.body).toMatchObject({ nombre: 'Otro nombre' });
    });
  });

  // -----------------------------------------------------------------------------------
  describe('sesiones: reset por admin, baja y cambio propio', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    const login = (email: string, password: string) =>
      request(a.getHttpServer()).post('/auth/login').send({ email, password });
    const refresh = (cookie: string) =>
      request(a.getHttpServer()).post('/auth/refresh').set('Cookie', cookie);

    it('reset por admin: la contraseña vieja ya no entra, la nueva sí, y el refresh anterior es 401', async () => {
      const u = await usuarioDePrueba('reset', RolUsuario.visor, FX.empresaA);
      const sesion = await login(u.email, PASSWORD).expect(200);
      const cookie = valorCookie(sesion);

      const r = await como(a, USUARIOS.adminEmpresaA).post(`/usuarios/${u.id}/password`, {
        password: PASSWORD_NUEVA,
      });
      expect(r.status).toBe(204);
      await refresh(cookie).expect(401);
      await login(u.email, PASSWORD).expect(401);
      await login(u.email, PASSWORD_NUEVA).expect(200);
    });

    it('dar de baja a un usuario corta su refresh', async () => {
      const u = await usuarioDePrueba('baja', RolUsuario.visor, FX.empresaA);
      const cookie = valorCookie(await login(u.email, PASSWORD).expect(200));
      const r = await como(a, USUARIOS.adminEmpresaA).patch(`/usuarios/${u.id}`, { activo: false });
      expect(r.status).toBe(200);
      await expect(fila(u.id)).resolves.toMatchObject({ activo: false, versionSesion: 1 });
      // Reactivarlo no revive el refresh viejo: la versión ya cambió.
      await como(a, USUARIOS.adminEmpresaA).patch(`/usuarios/${u.id}`, { activo: true });
      await refresh(cookie).expect(401);
    });
    it('un refresh sin `ver` (emitido antes de F1-060) vale como versión 0; un `ver` raro es 401', async () => {
      const u = await usuarioDePrueba('ver', RolUsuario.visor, FX.empresaA);
      const firmar = (claims: Record<string, unknown>) =>
        a.get(JwtService).signAsync(
          { typ: 'refresh', ...claims },
          {
            subject: u.id,
            secret: process.env.JWT_REFRESH_SECRET!,
            expiresIn: 600,
            algorithm: 'HS256',
          },
        );
      const cookie = async (claims: Record<string, unknown>) =>
        `${COOKIE_REFRESH}=${await firmar(claims)}`;

      await refresh(await cookie({})).expect(200);
      for (const ver of [-1, 1.5, '0', null]) {
        await refresh(await cookie({ ver })).expect(401);
      }
      // Tras un reset, el viejo sin `ver` (= 0) también muere.
      await prisma.usuario.update({ where: { id: u.id }, data: { versionSesion: 1 } });
      await refresh(await cookie({})).expect(401);
      await refresh(await cookie({ ver: 1 })).expect(200);
    });
  });

  describe('POST /cuenta/password (cualquier rol)', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    it('con la actual mala: 400 y nada cambia; con la buena: sesión nueva, y el refresh viejo muere', async () => {
      const u = await usuarioDePrueba('propio', RolUsuario.visor, FX.empresaA);
      const servidor = () => request(a.getHttpServer());
      const sesion = await servidor()
        .post('/auth/login')
        .send({ email: u.email, password: PASSWORD })
        .expect(200);
      const cookieVieja = valorCookie(sesion);
      const bearer = `Bearer ${sesion.body.accessToken as string}`;

      const mala = await servidor()
        .post('/cuenta/password')
        .set('Authorization', bearer)
        .send({ actual: 'no-es-la-contrasena', nueva: PASSWORD_NUEVA });
      expect(mala.status).toBe(400);
      await expect(fila(u.id)).resolves.toMatchObject({ versionSesion: 0 });

      const ok = await servidor()
        .post('/cuenta/password')
        .set('Authorization', bearer)
        .send({ actual: PASSWORD, nueva: PASSWORD_NUEVA });
      expect(ok.status).toBe(200);
      expect(ok.body).toMatchObject({ accessToken: expect.any(String), usuario: { id: u.id } });
      const cookieNueva = valorCookie(ok);

      await servidor().post('/auth/refresh').set('Cookie', cookieVieja).expect(401);
      await servidor().post('/auth/refresh').set('Cookie', cookieNueva).expect(200);
      await servidor().post('/auth/login').send({ email: u.email, password: PASSWORD }).expect(401);
      await servidor()
        .post('/auth/login')
        .send({ email: u.email, password: PASSWORD_NUEVA })
        .expect(200);
    });

    it('un usuario ya dado de baja, con su access token todavía válido: 401 y no cambia', async () => {
      const u = await usuarioDePrueba('propio-baja', RolUsuario.visor, FX.empresaA);
      await prisma.usuario.update({ where: { id: u.id }, data: { activo: false } });
      const antes = await fila(u.id);
      const r = await como(a, u).post('/cuenta/password', {
        actual: PASSWORD,
        nueva: PASSWORD_NUEVA,
      });
      expect(r.status).toBe(401);
      await expect(fila(u.id)).resolves.toEqual(antes);
    });

    it('nueva de menos de 12: 400', async () => {
      const r = await como(a, USUARIOS.visorA).post('/cuenta/password', {
        actual: PASSWORD,
        nueva: 'corta',
      });
      expect(r.status).toBe(400);
    });
  });

  describe('POST /cuenta/password: rate limit', () => {
    it('5 intentos por minuto por IP, como el login: el sexto es 429', async () => {
      const a = await app();
      const u = await usuarioDePrueba('limite', RolUsuario.visor, FX.empresaA);
      const api = como(a, u);
      const cuerpo = { actual: 'no-es-la-contrasena', nueva: PASSWORD_NUEVA };
      for (let i = 0; i < 5; i++) {
        expect((await api.post('/cuenta/password', cuerpo)).status).toBe(400);
      }
      expect((await api.post('/cuenta/password', cuerpo)).status).toBe(429);
      await expect(fila(u.id)).resolves.toMatchObject({ versionSesion: 0 });
    });
  });

  // -----------------------------------------------------------------------------------
  describe('auditoría en el log de la API (AC)', () => {
    let a: INestApplication;
    let lineas: string[];
    let espia: jest.SpyInstance;

    beforeAll(async () => {
      a = await app();
    });
    beforeEach(() => {
      lineas = [];
      espia = jest.spyOn(Logger.prototype, 'log').mockImplementation(function (
        this: Logger,
        mensaje: unknown,
      ) {
        if ((this as unknown as { context?: string }).context === 'Auditoria') {
          lineas.push(String(mensaje));
        }
      });
    });
    afterEach(() => espia.mockRestore());

    const eventos = () => lineas.map((l) => JSON.parse(l) as Record<string, unknown>);

    it('cada cambio deja una línea con quién, qué acción y sobre qué; nunca contraseñas ni keys', async () => {
      const global = como(a, USUARIOS.adminGlobal);
      const adminA = como(a, USUARIOS.adminEmpresaA);

      const empresa = await global.post('/empresas', { nombre: `Auditada ${SUFIJO}` });
      await global.patch(`/empresas/${empresa.body.id}`, { nombre: `Auditada 2 ${SUFIJO}` });
      const sucursal = await adminA.post('/sucursales', {
        empresaId: FX.empresaA,
        nombre: 'Auditada',
        zonaHoraria: 'America/Mexico_City',
      });
      await adminA.patch(`/sucursales/${sucursal.body.id}`, {
        zonaHoraria: 'America/Merida',
        activo: false,
      });
      const key = await adminA.post(`/sucursales/${sucursal.body.id}/api-key`);
      const usuario = await adminA.post('/usuarios', {
        email: emailNuevo('auditado'),
        nombre: 'Auditado',
        rol: RolUsuario.visor,
        empresaId: FX.empresaA,
        password: PASSWORD_NUEVA,
      });
      await adminA.patch(`/usuarios/${usuario.body.id}`, { nombre: 'Auditado 2' });
      await adminA.post(`/usuarios/${usuario.body.id}/password`, {
        password: `${PASSWORD_NUEVA}-2`,
      });
      const propio = await usuarioDePrueba('audita-propio', RolUsuario.visor, FX.empresaA);
      await como(a, propio).post('/cuenta/password', {
        actual: PASSWORD,
        nueva: `${PASSWORD_NUEVA}-3`,
      });

      const actorGlobal = { actorId: USUARIOS.adminGlobal.id, actorRol: RolUsuario.admin_global };
      const actorA = { actorId: USUARIOS.adminEmpresaA.id, actorRol: RolUsuario.admin_empresa };
      expect(eventos()).toEqual([
        {
          accion: 'empresa.crear',
          ...actorGlobal,
          recurso: 'empresa',
          recursoId: empresa.body.id,
          empresaId: empresa.body.id,
          campos: [],
        },
        {
          accion: 'empresa.editar',
          ...actorGlobal,
          recurso: 'empresa',
          recursoId: empresa.body.id,
          empresaId: empresa.body.id,
          campos: ['nombre'],
        },
        {
          accion: 'sucursal.crear',
          ...actorA,
          recurso: 'sucursal',
          recursoId: sucursal.body.id,
          empresaId: FX.empresaA,
          campos: [],
        },
        {
          accion: 'sucursal.editar',
          ...actorA,
          recurso: 'sucursal',
          recursoId: sucursal.body.id,
          empresaId: FX.empresaA,
          campos: ['zonaHoraria', 'activo'],
        },
        {
          accion: 'sucursal.rotar_api_key',
          ...actorA,
          recurso: 'sucursal',
          recursoId: sucursal.body.id,
          empresaId: FX.empresaA,
          campos: [],
        },
        {
          accion: 'usuario.crear',
          ...actorA,
          recurso: 'usuario',
          recursoId: usuario.body.id,
          empresaId: FX.empresaA,
          campos: [],
        },
        {
          accion: 'usuario.editar',
          ...actorA,
          recurso: 'usuario',
          recursoId: usuario.body.id,
          empresaId: FX.empresaA,
          campos: ['nombre'],
        },
        {
          accion: 'usuario.reset_password',
          ...actorA,
          recurso: 'usuario',
          recursoId: usuario.body.id,
          empresaId: FX.empresaA,
          campos: [],
        },
        {
          accion: 'usuario.cambiar_password',
          actorId: propio.id,
          actorRol: RolUsuario.visor,
          recurso: 'usuario',
          recursoId: propio.id,
          empresaId: FX.empresaA,
          campos: [],
        },
      ]);

      const todo = lineas.join('\n');
      for (const secreto of [
        key.body.apiKey as string,
        PASSWORD,
        PASSWORD_NUEVA,
        '$argon2',
        'Auditado 2',
      ]) {
        expect(todo).not.toContain(secreto);
      }
    });

    it('un intento rechazado (403/404/400) no deja línea', async () => {
      const adminA = como(a, USUARIOS.adminEmpresaA);
      await adminA.patch(`/sucursales/${FX.sucursalB1}`, { nombre: 'x' });
      await adminA.post('/empresas', { nombre: 'x' });
      await adminA.patch(`/sucursales/${FX.sucursalA1}`, {});
      await adminA.post(`/sucursales/${FX.sucursalB1}/api-key`);
      expect(lineas).toEqual([]);
    });
  });
});
