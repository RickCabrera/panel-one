import { Logger, type INestApplication } from '@nestjs/common';
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
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { COOKIE_REFRESH } from '../config/auth.config';
import { configurarApp } from '../configurar-app';

// E2E del panel de plataforma (membresías) sobre la app REAL contra Postgres REAL, con las
// fixtures sintéticas de F1-011. El reloj de la app está fijo (`AHORA`, mediodía en CDMX del
// 3 de noviembre de 2026): "hoy" y el mes de las cifras no dependen de cuándo corre el CI.
//
// Lo que crea este archivo lleva el sufijo `SUF` (empresas y planes) o el dominio de las
// fixtures (usuarios): `limpiar()` lo borra todo, antes y después.
//
// RATE LIMIT: el login admite 5/min por IP y por instancia de app. Cada bloque que hace login
// levanta SU app (`appNueva()`).

const SUF = '(plataforma e2e)';
const AHORA = Date.UTC(2026, 10, 3, 18, 0, 0);
const KEY_AGENTE = 'msr_sintetica-plataforma-e2e-sucursal-000000000001';

interface Quien {
  id: string;
  rol: RolUsuario;
  empresaId: string | null;
}

const GLOBAL: Quien = USUARIOS.adminGlobal;

let consecutivo = 0;
const unico = (clave: string) => `${clave} ${++consecutivo} ${SUF}`;
const emailNuevo = (clave: string) => `plat.${clave}.${++consecutivo}${DOMINIO}`;

function cookieDe(res: request.Response): string {
  const cabecera = res.headers['set-cookie'] as unknown as string[] | undefined;
  const cookie = (cabecera ?? []).find((c) => c.startsWith(`${COOKIE_REFRESH}=`));
  if (!cookie) throw new Error('La respuesta no puso la cookie de refresh.');
  return cookie.split(';')[0];
}

describe('Panel de plataforma (e2e, membresías)', () => {
  const prisma = new PrismaClient();
  const apps: INestApplication[] = [];
  let app: INestApplication;
  let ahora = AHORA;

  async function appNueva(): Promise<INestApplication> {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue({ ahora: () => ahora })
      .compile();
    const nueva = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await nueva.init();
    apps.push(nueva);
    return nueva;
  }

  function como(a: INestApplication, u: Quien) {
    const token = a
      .get(TokensService)
      .firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
    const enviar = async (r: request.Test, cuerpo?: object): Promise<request.Response> => {
      const conToken = r.set('Authorization', `Bearer ${await token}`);
      return cuerpo === undefined ? conToken : conToken.send(cuerpo);
    };
    const s = () => request(a.getHttpServer());
    return {
      get: (ruta: string) => enviar(s().get(ruta)),
      post: (ruta: string, cuerpo?: object) => enviar(s().post(ruta), cuerpo ?? {}),
      patch: (ruta: string, cuerpo?: object) => enviar(s().patch(ruta), cuerpo ?? {}),
      put: (ruta: string, cuerpo?: object) => enviar(s().put(ruta), cuerpo ?? {}),
      delete: (ruta: string) => enviar(s().delete(ruta)),
    };
  }

  const yo = () => como(app, GLOBAL);

  async function crearPlan(cambios: Record<string, unknown> = {}) {
    const r = await yo().post('/plataforma/planes', {
      nombre: unico('Plan'),
      precioMensual: '499.00',
      ...cambios,
    });
    expect(r.status).toBe(201);
    return r.body as { id: string; nombre: string; precioMensual: string };
  }

  async function altaCliente(planId: string, cambios: Record<string, unknown> = {}) {
    const email = emailNuevo('dueno');
    const r = await yo().post('/plataforma/clientes', {
      nombre: unico('Negocio'),
      planId,
      diaCorte: 5,
      contactoNombre: 'Dueña Sintética',
      contactoTelefono: '55 1234 5678',
      contactoEmail: 'contacto@negocio.test',
      rfc: 'xaxx010101000',
      administrador: { nombre: 'Dueña Sintética', email, password: PASSWORD },
      ...cambios,
    });
    expect(r.status).toBe(201);
    return { cliente: r.body as ClienteDetalle, email };
  }

  async function bitacora(empresaId: string) {
    return prisma.bitacoraPlataforma.findMany({
      where: { empresaId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async function limpiar(): Promise<void> {
    const propias = (
      await prisma.empresa.findMany({ where: { nombre: { endsWith: SUF } }, select: { id: true } })
    ).map((e) => e.id);
    await limpiarFixtures(prisma, propias);
    await prisma.plan.deleteMany({ where: { nombre: { endsWith: SUF } } });
    await prisma.configuracionPlataforma.updateMany({
      where: { id: 1 },
      data: { colorAcento: null },
    });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await limpiar();
    await crearFixtures(prisma);
    // Los 404/409 esperados no ensucian la salida.
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    app = await appNueva();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await Promise.all(apps.map((a) => a.close()));
    await limpiar();
    await prisma.$disconnect();
  });

  // --- Acceso por rol --------------------------------------------------------------------------

  describe('sólo admin_global: cualquier otro rol recibe 404 (como una ruta que no existe)', () => {
    const X = FX.inexistente;
    const rutas: [string, string, object?][] = [
      ['GET', '/plataforma/metricas'],
      ['GET', '/plataforma/planes'],
      ['POST', '/plataforma/planes', { nombre: `Intruso ${SUF}`, precioMensual: '1.00' }],
      ['PATCH', `/plataforma/planes/${X}`, { activo: false }],
      ['DELETE', `/plataforma/planes/${X}`],
      ['GET', '/plataforma/clientes'],
      ['POST', '/plataforma/clientes', {}],
      ['GET', `/plataforma/clientes/${FX.empresaA}`],
      ['PATCH', `/plataforma/clientes/${FX.empresaA}`, { nombre: 'x' }],
      ['PUT', `/plataforma/clientes/${FX.empresaA}/suscripcion`, { diaCorte: 3 }],
      ['POST', `/plataforma/clientes/${FX.empresaA}/estado`, { estado: 'suspendida' }],
      ['GET', '/plataforma/pagos'],
      ['GET', `/plataforma/clientes/${FX.empresaA}/pagos`],
      ['POST', `/plataforma/clientes/${FX.empresaA}/pagos`, { monto: '1.00' }],
      ['POST', `/plataforma/pagos/${X}/anular`, { motivo: 'xxx' }],
      ['GET', '/plataforma/administradores'],
      ['POST', '/plataforma/administradores', {}],
      ['PATCH', `/plataforma/administradores/${GLOBAL.id}`, { activo: false }],
      ['GET', `/plataforma/administradores/buscar-cuenta?email=${USUARIOS.visorA.email}`],
      ['POST', '/plataforma/administradores/convertir', { usuarioId: USUARIOS.visorA.id }],
      ['GET', '/plataforma/bitacora'],
      ['GET', '/plataforma/ajustes'],
      ['PUT', '/plataforma/ajustes', { colorAcento: 'rojo' }],
    ];

    it.each([
      ['admin_empresa', USUARIOS.adminEmpresaA],
      ['visor', USUARIOS.visorA],
    ])(
      '%s: 404 en TODAS las rutas, con el mismo cuerpo que una ruta inexistente',
      async (_r, u) => {
        const inexistente = await como(app, u).get('/plataforma/no-existe-de-verdad');
        expect(inexistente.status).toBe(404);
        const planesAntes = await prisma.plan.count();
        for (const [metodo, ruta, cuerpo] of rutas) {
          const c = como(app, u);
          const r =
            metodo === 'GET'
              ? await c.get(ruta)
              : metodo === 'POST'
                ? await c.post(ruta, cuerpo)
                : metodo === 'PATCH'
                  ? await c.patch(ruta, cuerpo)
                  : metodo === 'PUT'
                    ? await c.put(ruta, cuerpo)
                    : await c.delete(ruta);
          expect([metodo, ruta, r.status]).toEqual([metodo, ruta, 404]);
          expect(r.body).toEqual({
            statusCode: 404,
            error: 'Not Found',
            message: `Cannot ${metodo} ${ruta}`,
          });
          expect(Object.keys(r.body).sort()).toEqual(Object.keys(inexistente.body).sort());
        }
        // Nada se escribió.
        expect(await prisma.plan.count()).toBe(planesAntes);
        expect(
          await prisma.usuario.findUniqueOrThrow({ where: { id: USUARIOS.visorA.id } }),
        ).toMatchObject({ rol: RolUsuario.visor, empresaId: FX.empresaA });
      },
    );

    it('sin token: 401 (como en todo el API)', async () => {
      await request(app.getHttpServer()).get('/plataforma/metricas').expect(401);
    });
  });

  // --- Planes ----------------------------------------------------------------------------------

  describe('planes', () => {
    it('crea, lista con cuántos clientes lo usan, edita y valida el dinero como texto', async () => {
      const plan = await crearPlan({ precioMensual: '1299.5', limiteSucursales: 3 });
      expect(plan).toMatchObject({ precioMensual: '1299.50', periodicidad: 'mensual' });

      const lista = await yo().get('/plataforma/planes');
      expect(lista.body.find((p: { id: string }) => p.id === plan.id)).toMatchObject({
        clientes: 0,
        limiteSucursales: 3,
        activo: true,
      });

      const editado = await yo().patch(`/plataforma/planes/${plan.id}`, {
        precioMensual: '999.99',
        limiteSucursales: null,
        periodicidad: 'anual',
      });
      expect(editado.status).toBe(200);
      expect(editado.body).toMatchObject({
        precioMensual: '999.99',
        limiteSucursales: null,
        periodicidad: 'anual',
      });
      const fila = await prisma.plan.findUniqueOrThrow({ where: { id: plan.id } });
      expect(fila.precioMensual.toFixed(2)).toBe('999.99');

      for (const malo of ['12.345', '-1', 'abc', 499.5]) {
        const r = await yo().post('/plataforma/planes', {
          nombre: unico('Malo'),
          precioMensual: malo,
        });
        expect([malo, r.status]).toEqual([malo, 400]);
      }
      const vacio = await yo().patch(`/plataforma/planes/${plan.id}`, {});
      expect(vacio.status).toBe(400);
    });

    it('nombre repetido: 409; borrar uno sin clientes: 204; con clientes: 409', async () => {
      const plan = await crearPlan();
      const dup = await yo().post('/plataforma/planes', {
        nombre: plan.nombre,
        precioMensual: '1',
      });
      expect(dup.status).toBe(409);

      const libre = await crearPlan();
      await yo()
        .delete(`/plataforma/planes/${libre.id}`)
        .then((r) => expect(r.status).toBe(204));
      expect(await prisma.plan.count({ where: { id: libre.id } })).toBe(0);

      await altaCliente(plan.id);
      const enUso = await yo().delete(`/plataforma/planes/${plan.id}`);
      expect(enUso.status).toBe(409);
      expect(await prisma.plan.count({ where: { id: plan.id } })).toBe(1);
    });

    it('cada cambio de plan queda en la bitácora con antes y después', async () => {
      const plan = await crearPlan({ precioMensual: '100.00' });
      await yo().patch(`/plataforma/planes/${plan.id}`, { precioMensual: '150.00' });
      const filas = await prisma.bitacoraPlataforma.findMany({
        where: { recursoId: plan.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(filas.map((f) => f.accion)).toEqual(['plan.crear', 'plan.editar']);
      expect(filas[1]).toMatchObject({
        actorId: GLOBAL.id,
        actorEmail: USUARIOS.adminGlobal.email,
        antes: expect.objectContaining({ precioMensual: '100.00' }),
        despues: expect.objectContaining({ precioMensual: '150.00' }),
      });
    });
  });

  // --- Clientes --------------------------------------------------------------------------------

  describe('clientes', () => {
    it('alta: empresa con contacto + suscripción + admin_empresa, y su admin puede entrar', async () => {
      const plan = await crearPlan();
      const { cliente, email } = await altaCliente(plan.id, { estado: 'prueba' });
      expect(cliente).toMatchObject({
        activo: true,
        sucursales: 0,
        usuarios: 1,
        agentesConectados: 0,
        ultimoPago: null,
        ultimaVentaRecibidaAt: null,
        contacto: {
          contactoNombre: 'Dueña Sintética',
          contactoTelefono: '55 1234 5678',
          contactoEmail: 'contacto@negocio.test',
          rfc: 'XAXX010101000',
        },
        suscripcion: {
          estado: 'prueba',
          estadoEfectivo: 'prueba',
          inicio: '2026-11-03',
          // Sin vencimiento: el siguiente día de corte (5) después de hoy (3).
          vencimiento: '2026-11-05',
          fechaLimite: '2026-11-10',
          diaCorte: 5,
          diasGracia: 5,
          plan: { id: plan.id },
        },
      });
      expect(cliente.listaUsuarios).toEqual([
        expect.objectContaining({
          email,
          rol: 'admin_empresa',
          activo: true,
          ultimoAccesoAt: null,
        }),
      ]);
      const [entrada] = await bitacora(cliente.id);
      expect(entrada).toMatchObject({ accion: 'cliente.crear', actorId: GLOBAL.id });
      // La contraseña nunca llega a la bitácora, ni en claro ni su hash.
      expect(JSON.stringify(entrada)).not.toContain(PASSWORD);
      expect(JSON.stringify(entrada)).not.toContain('argon2');

      const otra = await appNueva();
      const login = await request(otra.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD });
      expect(login.status).toBe(200);
      expect(login.body.usuario).toMatchObject({ rol: 'admin_empresa', empresaId: cliente.id });
    });

    it('alta con email repetido: 409 y NO queda nada (una transacción)', async () => {
      const plan = await crearPlan();
      const nombre = unico('Duplicado');
      const r = await yo().post('/plataforma/clientes', {
        nombre,
        planId: plan.id,
        diaCorte: 1,
        administrador: { nombre: 'X', email: USUARIOS.visorA.email, password: PASSWORD },
      });
      expect(r.status).toBe(409);
      expect(await prisma.empresa.count({ where: { nombre } })).toBe(0);
    });

    it('alta con plan inactivo: 400; con fecha que no existe: 400', async () => {
      const plan = await crearPlan({ activo: false });
      const inactivo = await yo().post('/plataforma/clientes', {
        nombre: unico('Inactivo'),
        planId: plan.id,
        diaCorte: 1,
        administrador: { nombre: 'X', email: emailNuevo('x'), password: PASSWORD },
      });
      expect(inactivo.status).toBe(400);
      const activo = await crearPlan();
      const fecha = await yo().post('/plataforma/clientes', {
        nombre: unico('Fecha'),
        planId: activo.id,
        diaCorte: 1,
        vencimiento: '2026-02-30',
        administrador: { nombre: 'X', email: emailNuevo('x'), password: PASSWORD },
      });
      expect(fecha.status).toBe(400);
      const corte = await yo().post('/plataforma/clientes', {
        nombre: unico('Corte'),
        planId: activo.id,
        diaCorte: 31,
        administrador: { nombre: 'X', email: emailNuevo('x'), password: PASSWORD },
      });
      expect(corte.status).toBe(400);
    });

    it('lista: filtra por estado efectivo y busca por nombre; cuenta sucursales, agentes y última venta', async () => {
      const plan = await crearPlan();
      const { cliente } = await altaCliente(plan.id);
      // Una sucursal con agente que se reportó hace 2 min y una venta cerrada.
      const suc = await prisma.sucursal.create({
        data: { empresaId: cliente.id, nombre: 'Matriz' },
      });
      await prisma.agenteContacto.create({
        data: {
          sucursalId: suc.id,
          empresaId: cliente.id,
          ultimoContactoAt: new Date(AHORA - 120_000),
        },
      });
      const cerrado = new Date('2026-11-02T22:00:00Z');
      await prisma.cheque.create({
        data: {
          sucursalId: suc.id,
          empresaId: cliente.id,
          folioSr: 'PLAT-1',
          folio: 'T-PLAT-1',
          abiertoAt: new Date('2026-11-02T21:00:00Z'),
          cerradoAt: cerrado,
          subtotal: '100.00',
          impuestos: '16.00',
          descuentos: '0',
          propina: '0',
          total: '116.00',
        },
      });

      const r = await yo().get(`/plataforma/clientes?q=${encodeURIComponent(cliente.nombre)}`);
      expect(r.status).toBe(200);
      expect(r.body).toHaveLength(1);
      expect(r.body[0]).toMatchObject({
        id: cliente.id,
        sucursales: 1,
        agentesConectados: 1,
        usuarios: 1,
        ultimaVentaRecibidaAt: cerrado.toISOString(),
      });

      const activas = await yo().get('/plataforma/clientes?estado=activa');
      expect(activas.body.map((c: { id: string }) => c.id)).toContain(cliente.id);
      const vencidas = await yo().get('/plataforma/clientes?estado=vencida');
      expect(vencidas.body.map((c: { id: string }) => c.id)).not.toContain(cliente.id);
      // Las fixtures nacieron sin suscripción.
      const sin = await yo().get('/plataforma/clientes?estado=sin_suscripcion');
      expect(sin.body.map((c: { id: string }) => c.id)).toEqual(
        expect.arrayContaining([FX.empresaA, FX.empresaB]),
      );
      expect((await yo().get('/plataforma/clientes?estado=otro')).status).toBe(400);
    });

    it('detalle de una empresa que no existe: 404; edición de contacto con bitácora', async () => {
      expect((await yo().get(`/plataforma/clientes/${FX.inexistente}`)).status).toBe(404);
      const plan = await crearPlan();
      const { cliente } = await altaCliente(plan.id);
      const r = await yo().patch(`/plataforma/clientes/${cliente.id}`, {
        contactoTelefono: null,
        notasPlataforma: 'Paga por transferencia',
      });
      expect(r.status).toBe(200);
      expect(r.body.contacto).toMatchObject({
        contactoTelefono: null,
        notasPlataforma: 'Paga por transferencia',
      });
      const entradas = await bitacora(cliente.id);
      expect(entradas.at(-1)).toMatchObject({
        accion: 'cliente.editar',
        antes: expect.objectContaining({ contactoTelefono: '55 1234 5678' }),
        despues: expect.objectContaining({ contactoTelefono: null }),
      });
      expect(
        (await yo().patch(`/plataforma/clientes/${cliente.id}`, { rfc: 'no-es-rfc' })).status,
      ).toBe(400);
    });

    it('cambiar de plan o crear la suscripción de una empresa que no tenía', async () => {
      const a = await crearPlan();
      const b = await crearPlan();
      const { cliente } = await altaCliente(a.id);
      const r = await yo().put(`/plataforma/clientes/${cliente.id}/suscripcion`, {
        planId: b.id,
        diasGracia: 10,
      });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        plan: { id: b.id },
        diasGracia: 10,
        fechaLimite: '2026-11-15',
      });
      expect((await bitacora(cliente.id)).at(-1)).toMatchObject({
        accion: 'suscripcion.cambiar_plan',
        antes: expect.objectContaining({ planId: a.id }),
        despues: expect.objectContaining({ planId: b.id }),
      });

      // Empresa B de las fixtures: sin suscripción. Sin plan es 400; con plan, se crea.
      const sinPlan = await yo().put(`/plataforma/clientes/${FX.empresaB}/suscripcion`, {
        diaCorte: 3,
      });
      expect(sinPlan.status).toBe(400);
      const creada = await yo().put(`/plataforma/clientes/${FX.empresaB}/suscripcion`, {
        planId: a.id,
        diaCorte: 20,
      });
      expect(creada.status).toBe(200);
      expect(creada.body).toMatchObject({
        estado: 'activa',
        inicio: '2026-11-03',
        vencimiento: '2026-11-20',
      });
      await prisma.suscripcion.deleteMany({ where: { empresaId: FX.empresaB } });
    });
  });

  // --- Estado, login y la ingesta --------------------------------------------------------------

  describe('suspender / cancelar: los usuarios no entran; la ingesta sigue', () => {
    it('suspendida: login 403 con el mensaje, refresh 401 con el mensaje; reactivar los deja entrar', async () => {
      const plan = await crearPlan();
      const { cliente, email } = await altaCliente(plan.id);
      const a = await appNueva();
      const srv = () => request(a.getHttpServer());

      const antes = await srv().post('/auth/login').send({ email, password: PASSWORD }).expect(200);
      const cookie = cookieDe(antes);
      const version = (await prisma.usuario.findUniqueOrThrow({ where: { email } })).versionSesion;

      const s = await yo().post(`/plataforma/clientes/${cliente.id}/estado`, {
        estado: 'suspendida',
        motivo: 'Falta de pago',
      });
      expect(s.status).toBe(200);
      expect(s.body).toMatchObject({ estado: 'suspendida', estadoEfectivo: 'suspendida' });
      // Sus refresh tokens dejan de servir: la versión de sesión subió.
      expect((await prisma.usuario.findUniqueOrThrow({ where: { email } })).versionSesion).toBe(
        version + 1,
      );

      const login = await srv().post('/auth/login').send({ email, password: PASSWORD });
      expect(login.status).toBe(403);
      expect(login.body.message).toBe('Tu cuenta está suspendida. Contacta a soporte.');
      // Con la contraseña MAL, nada distinto de siempre: no se revela el estado de la cuenta.
      const mala = await srv().post('/auth/login').send({ email, password: 'no-es-la-contrasena' });
      expect(mala.status).toBe(401);
      expect(mala.body.message).toBe('Credenciales inválidas');

      const refresh = await srv().post('/auth/refresh').set('Cookie', cookie);
      expect(refresh.status).toBe(401);
      expect(refresh.body.message).toBe('Tu cuenta está suspendida. Contacta a soporte.');

      await yo()
        .post(`/plataforma/clientes/${cliente.id}/estado`, { estado: 'activa' })
        .then((r) => expect(r.status).toBe(200));
      await srv().post('/auth/login').send({ email, password: PASSWORD }).expect(200);

      const acciones = (await bitacora(cliente.id)).map((e) => e.accion);
      expect(acciones).toEqual(
        expect.arrayContaining(['cliente.crear', 'cliente.suspender', 'cliente.reactivar']),
      );
      const susp = (await bitacora(cliente.id)).find((e) => e.accion === 'cliente.suspender');
      expect(susp).toMatchObject({
        antes: { estado: 'activa' },
        despues: { estado: 'suspendida', motivo: 'Falta de pago' },
      });
    });

    it('cancelada: el mensaje dice cancelada', async () => {
      const plan = await crearPlan();
      const { cliente, email } = await altaCliente(plan.id);
      await yo().post(`/plataforma/clientes/${cliente.id}/estado`, { estado: 'cancelada' });
      const a = await appNueva();
      const r = await request(a.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD });
      expect(r.status).toBe(403);
      expect(r.body.message).toBe('Tu cuenta está cancelada. Contacta a soporte.');
    });

    it('vencida (calculada): SÍ entra y /cuenta/membresia lo dice para el aviso', async () => {
      const plan = await crearPlan();
      const { cliente, email } = await altaCliente(plan.id, { vencimiento: '2026-10-20' });
      expect(cliente.suscripcion).toMatchObject({ estado: 'activa', estadoEfectivo: 'vencida' });
      const a = await appNueva();
      const login = await request(a.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      const m = await request(a.getHttpServer())
        .get('/cuenta/membresia')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      expect(m.body).toEqual({
        membresia: {
          estado: 'vencida',
          vencimiento: '2026-10-20',
          fechaLimite: '2026-10-25',
          plan: plan.nombre,
        },
      });
    });

    it('/cuenta/membresia: nula para admin_global y para una empresa sin suscripción', async () => {
      expect((await yo().get('/cuenta/membresia')).body).toEqual({ membresia: null });
      expect((await como(app, USUARIOS.visorB).get('/cuenta/membresia')).body).toEqual({
        membresia: null,
      });
    });

    it('LA INGESTA NO SE BLOQUEA: el agente de una empresa suspendida (o cancelada) sigue mandando ventas', async () => {
      const plan = await crearPlan();
      const { cliente } = await altaCliente(plan.id);
      const suc = await prisma.sucursal.create({
        data: { empresaId: cliente.id, nombre: 'Con agente', apiKeyHash: hashApiKey(KEY_AGENTE) },
      });
      for (const [estado, folio] of [
        ['suspendida', 'SUSP-1'],
        ['cancelada', 'CANC-1'],
      ]) {
        await yo().post(`/plataforma/clientes/${cliente.id}/estado`, { estado });
        const r = await request(app.getHttpServer())
          .post('/ingesta/eventos')
          .set('X-Api-Key', KEY_AGENTE)
          .send({
            eventos: [
              {
                id: `e-${folio}`,
                tipo: 'cheque',
                datos: {
                  folioSr: folio,
                  folio: `T-${folio}`,
                  abiertoAt: '2026-11-03T10:00:00-06:00',
                  cerradoAt: '2026-11-03T11:00:00-06:00',
                  subtotal: '100.00',
                  impuestos: '16.00',
                  descuentos: '0',
                  propina: '0',
                  total: '116.00',
                  cancelado: false,
                  partidas: [],
                  pagos: [{ formaRaw: 'EFECTIVO', monto: '116.00' }],
                },
              },
            ],
          });
        expect([estado, r.status, r.body]).toEqual([
          estado,
          200,
          { procesados: [`e-${folio}`], rechazados: [] },
        ]);
        const cheque = await prisma.cheque.findFirstOrThrow({
          where: { sucursalId: suc.id, folioSr: folio },
        });
        expect(cheque.total.toFixed(2)).toBe('116.00');
      }
    });

    it('sin suscripción no se puede suspender (409); un estado inventado es 400', async () => {
      const r = await yo().post(`/plataforma/clientes/${FX.empresaC}/estado`, {
        estado: 'suspendida',
      });
      expect(r.status).toBe(409);
      const plan = await crearPlan();
      const { cliente } = await altaCliente(plan.id);
      const v = await yo().post(`/plataforma/clientes/${cliente.id}/estado`, { estado: 'vencida' });
      expect(v.status).toBe(400);
    });
  });

  // --- Pagos -----------------------------------------------------------------------------------

  describe('pagos', () => {
    const pago = (cambios: Record<string, unknown> = {}) => ({
      monto: '499.00',
      fechaPago: '2026-11-02',
      metodo: 'transferencia',
      referencia: 'SPEI 123',
      ...cambios,
    });

    it('registrar extiende el vencimiento un periodo DESDE el vencimiento y reactiva la suspendida', async () => {
      const plan = await crearPlan();
      const { cliente } = await altaCliente(plan.id, { vencimiento: '2026-10-05' });
      await yo().post(`/plataforma/clientes/${cliente.id}/estado`, { estado: 'suspendida' });

      const r = await yo().post(`/plataforma/clientes/${cliente.id}/pagos`, pago());
      expect(r.status).toBe(201);
      expect(r.body.pago).toMatchObject({
        monto: '499.00',
        moneda: 'MXN',
        fechaPago: '2026-11-02',
        metodo: 'transferencia',
        periodoDesde: '2026-10-05',
        periodoHasta: '2026-11-05',
        anuladoAt: null,
      });
      expect(r.body.pago.registradoPor).toContain(USUARIOS.adminGlobal.email);
      expect(r.body.suscripcion).toMatchObject({
        estado: 'activa',
        estadoEfectivo: 'activa',
        vencimiento: '2026-11-05',
      });

      // Tres meses de una vez.
      const tres = await yo().post(
        `/plataforma/clientes/${cliente.id}/pagos`,
        pago({ periodos: 3 }),
      );
      expect(tres.body.pago).toMatchObject({
        periodoDesde: '2026-11-05',
        periodoHasta: '2027-02-05',
      });

      const fila = await prisma.pagoSuscripcion.findUniqueOrThrow({
        where: { id: r.body.pago.id },
      });
      expect(fila.monto.toFixed(2)).toBe('499.00');
      expect(
        (await bitacora(cliente.id)).filter((e) => e.accion === 'pago.registrar'),
      ).toHaveLength(2);
    });

    it('un plan ANUAL corre el vencimiento 12 meses; una prueba que paga queda activa', async () => {
      const plan = await crearPlan({ periodicidad: 'anual', precioMensual: '400.00' });
      const { cliente } = await altaCliente(plan.id, {
        estado: 'prueba',
        vencimiento: '2026-11-10',
      });
      const r = await yo().post(
        `/plataforma/clientes/${cliente.id}/pagos`,
        pago({ monto: '4800.00', metodo: 'tarjeta' }),
      );
      expect(r.body.suscripcion).toMatchObject({ estado: 'activa', vencimiento: '2027-11-10' });
    });

    it('validaciones: monto 0, decimales de más, fecha futura o inexistente, cancelada', async () => {
      const plan = await crearPlan();
      const { cliente } = await altaCliente(plan.id);
      const ruta = `/plataforma/clientes/${cliente.id}/pagos`;
      for (const malo of [
        pago({ monto: '0' }),
        pago({ monto: '0.00' }),
        pago({ monto: '10.001' }),
        pago({ monto: 10 }),
        pago({ fechaPago: '2026-11-04' }),
        pago({ fechaPago: '2026-02-30' }),
        pago({ metodo: 'cheque' }),
        pago({ periodos: 0 }),
      ]) {
        const r = await yo().post(ruta, malo);
        expect([malo, r.status]).toEqual([malo, 400]);
      }
      await yo().post(`/plataforma/clientes/${cliente.id}/estado`, { estado: 'cancelada' });
      expect((await yo().post(ruta, pago())).status).toBe(409);
      expect(await prisma.pagoSuscripcion.count({ where: { empresaId: cliente.id } })).toBe(0);
      expect((await yo().post(`/plataforma/clientes/${FX.empresaC}/pagos`, pago())).status).toBe(
        409,
      );
      expect((await yo().post(`/plataforma/clientes/${FX.inexistente}/pagos`, pago())).status).toBe(
        404,
      );
    });

    it('anular: sólo el más reciente; regresa el vencimiento; no se borra; no dos veces', async () => {
      const plan = await crearPlan();
      const { cliente } = await altaCliente(plan.id, { vencimiento: '2026-11-05' });
      const ruta = `/plataforma/clientes/${cliente.id}/pagos`;
      const p1 = (await yo().post(ruta, pago())).body.pago;
      const p2 = (await yo().post(ruta, pago({ fechaPago: '2026-11-03' }))).body.pago;
      expect(p2).toMatchObject({ periodoDesde: '2026-12-05', periodoHasta: '2027-01-05' });

      const viejo = await yo().post(`/plataforma/pagos/${p1.id}/anular`, { motivo: 'Duplicado' });
      expect(viejo.status).toBe(409);

      const r = await yo().post(`/plataforma/pagos/${p2.id}/anular`, { motivo: 'Rebotó el SPEI' });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ motivoAnulacion: 'Rebotó el SPEI' });
      expect(r.body.anuladoAt).not.toBeNull();
      expect(r.body.anuladoPor).toContain(USUARIOS.adminGlobal.email);
      const s = await prisma.suscripcion.findUniqueOrThrow({ where: { empresaId: cliente.id } });
      expect(s.vencimiento.toISOString().slice(0, 10)).toBe('2026-12-05');

      expect(
        (await yo().post(`/plataforma/pagos/${p2.id}/anular`, { motivo: 'otra vez' })).status,
      ).toBe(409);
      // Ya anulado el posterior, el primero sí se puede.
      expect(
        (await yo().post(`/plataforma/pagos/${p1.id}/anular`, { motivo: 'Duplicado' })).status,
      ).toBe(200);
      const historial = await yo().get(`/plataforma/clientes/${cliente.id}/pagos`);
      expect(historial.body).toHaveLength(2);
      expect(historial.body.every((p: { anuladoAt: string | null }) => p.anuladoAt !== null)).toBe(
        true,
      );
      expect(await prisma.pagoSuscripcion.count({ where: { empresaId: cliente.id } })).toBe(2);
      expect(
        (await yo().post(`/plataforma/pagos/${FX.inexistente}/anular`, { motivo: 'xxx' })).status,
      ).toBe(404);
      const anulacion = (await bitacora(cliente.id)).filter((e) => e.accion === 'pago.anular');
      expect(anulacion[0]).toMatchObject({
        antes: expect.objectContaining({ vencimiento: '2027-01-05', anulado: false }),
        despues: expect.objectContaining({ vencimiento: '2026-12-05', anulado: true }),
      });
    });

    it('la pantalla de Pagos: pagado / pendiente / vencido del mes, conteos y lo cobrado', async () => {
      const antes = (await yo().get('/plataforma/pagos')).body;
      const plan = await crearPlan({ precioMensual: '300.00' });
      const pendiente = (await altaCliente(plan.id, { diaCorte: 6, vencimiento: '2026-11-06' }))
        .cliente;
      const vencido = (await altaCliente(plan.id, { diaCorte: 1, vencimiento: '2026-10-01' }))
        .cliente;
      const pagado = (await altaCliente(plan.id, { diaCorte: 6, vencimiento: '2026-11-06' }))
        .cliente;
      await yo().post(`/plataforma/clientes/${pagado.id}/pagos`, {
        monto: '300.00',
        fechaPago: '2026-11-01',
        metodo: 'efectivo',
      });

      const r = await yo().get('/plataforma/pagos');
      expect(r.status).toBe(200);
      expect(r.body.mes).toBe('2026-11');
      const de = (id: string) =>
        r.body.mensualidades.find((m: { empresaId: string }) => m.empresaId === id);
      expect(de(pendiente.id)).toMatchObject({
        estadoPago: 'pendiente',
        diaCorte: 6,
        ultimoPago: null,
      });
      expect(de(vencido.id)).toMatchObject({ estadoPago: 'vencido', estadoEfectivo: 'vencida' });
      expect(de(pagado.id)).toMatchObject({
        estadoPago: 'pagado',
        vencimiento: '2026-12-06',
        ultimoPago: { fechaPago: '2026-11-01', monto: '300.00', moneda: 'MXN' },
      });
      expect(r.body.conteos.todos - antes.conteos.todos).toBe(3);
      expect(r.body.conteos.pagados - antes.conteos.pagados).toBe(1);
      expect(r.body.conteos.pendientes - antes.conteos.pendientes).toBe(1);
      expect(r.body.conteos.vencidos - antes.conteos.vencidos).toBe(1);
      // Dinero en texto y a mano: 300.00 más que antes.
      expect(Number(r.body.cobradoMes) * 100 - Number(antes.cobradoMes) * 100).toBe(30000);

      const soloPagados = await yo().get('/plataforma/pagos?estado=pagado');
      expect(
        soloPagados.body.mensualidades.every(
          (m: { estadoPago: string }) => m.estadoPago === 'pagado',
        ),
      ).toBe(true);
      // Los conteos no cambian con el filtro.
      expect(soloPagados.body.conteos).toEqual(r.body.conteos);
      const busca = await yo().get(`/plataforma/pagos?q=${encodeURIComponent(vencido.nombre)}`);
      expect(busca.body.mensualidades.map((m: { empresaId: string }) => m.empresaId)).toEqual([
        vencido.id,
      ]);
    });
  });

  // --- Métricas --------------------------------------------------------------------------------

  describe('métricas', () => {
    it('MRR, conteos por estado, ingresos del mes y por vencer en 7 días (deltas contra un cálculo a mano)', async () => {
      const antes = (await yo().get('/plataforma/metricas')).body;
      expect(antes.hoy).toBe('2026-11-03');

      const plan = await crearPlan({ precioMensual: '350.50' });
      const a = (await altaCliente(plan.id, { vencimiento: '2026-11-08' })).cliente; // activa, vence en 5 días
      const b = (await altaCliente(plan.id, { vencimiento: '2026-10-01' })).cliente; // vencida
      const c = (await altaCliente(plan.id, { estado: 'prueba', vencimiento: '2026-11-30' }))
        .cliente;
      const d = (await altaCliente(plan.id)).cliente;
      await yo().post(`/plataforma/clientes/${d.id}/estado`, { estado: 'suspendida' });
      await yo().post(`/plataforma/clientes/${a.id}/pagos`, {
        monto: '350.50',
        fechaPago: '2026-11-03',
        metodo: 'efectivo',
      });
      // Un pago anulado no suma.
      const anulado = await yo().post(`/plataforma/clientes/${c.id}/pagos`, {
        monto: '99.99',
        fechaPago: '2026-11-03',
        metodo: 'otro',
      });
      await yo().post(`/plataforma/pagos/${anulado.body.pago.id}/anular`, { motivo: 'Prueba' });
      void b;

      const r = (await yo().get('/plataforma/metricas')).body;
      // MRR: activas + vencidas = a + b (c en prueba se volvió activa al pagar, pero el pago se
      // anuló: queda activa) = 3 × 350.50.
      const centavos = (x: string) => Math.round(Number(x) * 100);
      expect(centavos(r.mrr) - centavos(antes.mrr)).toBe(3 * 35050);
      expect(r.activos - antes.activos).toBe(2);
      expect(r.vencidos - antes.vencidos).toBe(1);
      expect(r.prueba - antes.prueba).toBe(0);
      expect(r.suspendidos - antes.suspendidos).toBe(1);
      expect(centavos(r.ingresosMes) - centavos(antes.ingresosMes)).toBe(35050);
      // `a` pagó (vence 2026-12-08); `c` vence el 30. Ninguno en 7 días... salvo d, suspendida
      // (no cuenta). Ajustamos uno a mano para que caiga en la ventana.
      await yo().put(`/plataforma/clientes/${c.id}/suscripcion`, { vencimiento: '2026-11-10' });
      const r2 = (await yo().get('/plataforma/metricas')).body;
      expect(r2.vencenProximos7Dias - antes.vencenProximos7Dias).toBe(1);
    });
  });

  // --- Administradores internos ----------------------------------------------------------------

  describe('administradores internos', () => {
    async function adminNuevo(clave: string) {
      const r = await yo().post('/plataforma/administradores', {
        nombre: `Admin ${clave}`,
        email: emailNuevo(clave),
        password: PASSWORD,
      });
      expect(r.status).toBe(201);
      return r.body as { id: string; email: string; nombre: string };
    }

    it('lista con último acceso (se escribe en el login) y alta con contraseña inicial', async () => {
      const nuevo = await adminNuevo('alta');
      expect(nuevo).toMatchObject({ activo: true, ultimoAccesoAt: null });
      const dup = await yo().post('/plataforma/administradores', {
        nombre: 'X',
        email: nuevo.email.toUpperCase(),
        password: PASSWORD,
      });
      expect(dup.status).toBe(409);

      const a = await appNueva();
      await request(a.getHttpServer())
        .post('/auth/login')
        .send({ email: nuevo.email, password: PASSWORD })
        .expect(200);
      const lista = (await yo().get('/plataforma/administradores')).body as {
        id: string;
        ultimoAccesoAt: string | null;
      }[];
      const fila = lista.find((x) => x.id === nuevo.id);
      expect(fila?.ultimoAccesoAt).not.toBeNull();
      // Sólo admin_global en la lista.
      expect(lista.map((x) => x.id)).not.toContain(USUARIOS.adminEmpresaA.id);
      expect(JSON.stringify(lista)).not.toContain('passwordHash');
    });

    it('editar nombre y correo de OTRO sí; desactivarte a ti mismo no (400); desactivar a otro corta su sesión', async () => {
      const otro = await adminNuevo('editar');
      const r = await yo().patch(`/plataforma/administradores/${otro.id}`, {
        nombre: 'Otro Nombre',
        email: emailNuevo('nuevo-correo'),
      });
      expect(r.status).toBe(200);
      expect(r.body.nombre).toBe('Otro Nombre');

      const yoMismo = await yo().patch(`/plataforma/administradores/${GLOBAL.id}`, {
        activo: false,
      });
      expect(yoMismo.status).toBe(400);
      expect(yoMismo.body.message).toBe('No puedes desactivarte a ti mismo');

      const version = (await prisma.usuario.findUniqueOrThrow({ where: { id: otro.id } }))
        .versionSesion;
      const baja = await yo().patch(`/plataforma/administradores/${otro.id}`, { activo: false });
      expect(baja.status).toBe(200);
      expect(baja.body.activo).toBe(false);
      const fila = await prisma.usuario.findUniqueOrThrow({ where: { id: otro.id } });
      expect(fila.versionSesion).toBe(version + 1);
      // Un admin desactivado ya no escribe en la plataforma, aunque su access token siga vivo.
      const muerto = await como(app, { id: otro.id, rol: 'admin_global', empresaId: null }).post(
        '/plataforma/planes',
        { nombre: unico('Del desactivado'), precioMensual: '1.00' },
      );
      expect(muerto.status).toBe(401);

      const reactivar = await yo().patch(`/plataforma/administradores/${otro.id}`, {
        activo: true,
      });
      expect(reactivar.body.activo).toBe(true);
      const acciones = (
        await prisma.bitacoraPlataforma.findMany({
          where: { recursoId: otro.id },
          orderBy: { createdAt: 'asc' },
        })
      ).map((e) => e.accion);
      expect(acciones).toEqual([
        'admin.crear',
        'admin.editar',
        'admin.desactivar',
        'admin.reactivar',
      ]);

      // Un usuario que no es admin_global no se edita por aquí.
      expect(
        (await yo().patch(`/plataforma/administradores/${USUARIOS.visorA.id}`, { nombre: 'x' }))
          .status,
      ).toBe(404);
    });

    it('dos admins que se desactivan uno al otro A LA VEZ: sólo uno lo logra; siempre queda alguien activo', async () => {
      const x = await adminNuevo('x');
      const y = await adminNuevo('y');
      const comoX = como(app, { id: x.id, rol: 'admin_global', empresaId: null });
      const comoY = como(app, { id: y.id, rol: 'admin_global', empresaId: null });
      const [rx, ry] = await Promise.all([
        comoX.patch(`/plataforma/administradores/${y.id}`, { activo: false }),
        comoY.patch(`/plataforma/administradores/${x.id}`, { activo: false }),
      ]);
      expect([rx.status, ry.status].sort()).toEqual([200, 401]);
      const activos = await prisma.usuario.count({
        where: { id: { in: [x.id, y.id] }, activo: true },
      });
      expect(activos).toBe(1);
    });

    it('NADIE cambia ni restablece la contraseña de otro admin, ni lo borra: no hay ruta', async () => {
      const otro = await adminNuevo('pwd');
      const antes = (await prisma.usuario.findUniqueOrThrow({ where: { id: otro.id } }))
        .passwordHash;
      const r1 = await yo().post(`/plataforma/administradores/${otro.id}/password`, {
        password: 'otra-contrasena-de-12+',
      });
      expect(r1.status).toBe(404);
      const r2 = await yo().delete(`/plataforma/administradores/${otro.id}`);
      expect(r2.status).toBe(404);
      // Tampoco por la ruta vieja de la administración.
      const r3 = await yo().post(`/usuarios/${otro.id}/password`, {
        password: 'otra-contrasena-de-12+',
      });
      expect(r3.status).toBe(400);
      expect(r3.body.message).toBe(
        'La contraseña de un administrador sólo la cambia él mismo, en Mi cuenta',
      );
      const despues = await prisma.usuario.findUniqueOrThrow({ where: { id: otro.id } });
      expect(despues.passwordHash).toBe(antes);
      expect(despues.activo).toBe(true);
      // La de un usuario de empresa sí se sigue restableciendo (no cambió).
      const visor = await prisma.usuario.create({
        data: {
          email: emailNuevo('visor-reset'),
          nombre: 'Visor reset',
          rol: 'visor',
          empresaId: FX.empresaA,
          passwordHash: antes,
        },
      });
      expect(
        (await yo().post(`/usuarios/${visor.id}/password`, { password: 'otra-contrasena-de-12+' }))
          .status,
      ).toBe(204);
    });

    it('convertir una cuenta de cliente: mismo correo y contraseña, queda admin_global, sale de su empresa', async () => {
      const plan = await crearPlan();
      const { cliente, email } = await altaCliente(plan.id);
      const buscada = await yo().get(
        `/plataforma/administradores/buscar-cuenta?email=${encodeURIComponent(email.toUpperCase())}`,
      );
      expect(buscada.status).toBe(200);
      expect(buscada.body).toMatchObject({
        email,
        rol: 'admin_empresa',
        empresaId: cliente.id,
        empresa: cliente.nombre,
      });
      const hashAntes = (await prisma.usuario.findUniqueOrThrow({ where: { email } })).passwordHash;

      const r = await yo().post('/plataforma/administradores/convertir', {
        usuarioId: buscada.body.id,
      });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        admin: { email, activo: true },
        empresaId: cliente.id,
        empresaSinAdmin: true,
      });
      const fila = await prisma.usuario.findUniqueOrThrow({ where: { email } });
      expect(fila).toMatchObject({ rol: 'admin_global', empresaId: null, passwordHash: hashAntes });

      const a = await appNueva();
      const login = await request(a.getHttpServer())
        .post('/auth/login')
        .send({ email, password: PASSWORD })
        .expect(200);
      expect(login.body.usuario).toMatchObject({ rol: 'admin_global', empresaId: null });

      expect((await bitacora(cliente.id)).at(-1)).toMatchObject({
        accion: 'admin.convertir_cuenta',
        recursoId: fila.id,
        antes: expect.objectContaining({ rol: 'admin_empresa', empresaId: cliente.id }),
        despues: expect.objectContaining({ rol: 'admin_global', empresaId: null }),
      });

      // Un admin_global (o un correo que no existe) no se encuentra como cuenta de cliente.
      expect(
        (
          await yo().get(
            `/plataforma/administradores/buscar-cuenta?email=${encodeURIComponent(email)}`,
          )
        ).status,
      ).toBe(404);
      expect(
        (await yo().post('/plataforma/administradores/convertir', { usuarioId: fila.id })).status,
      ).toBe(404);
    });
  });

  // --- Límite de sucursales del plan -----------------------------------------------------------

  describe('límite de sucursales del plan (POST/PATCH /sucursales)', () => {
    it('admin_empresa: 409 claro por encima del límite (aunque mande forzarLimite); admin_global lo fuerza con confirmación', async () => {
      // La empresa A de las fixtures tiene 2 sucursales activas (A1, A2).
      const plan = await crearPlan({ limiteSucursales: 2 });
      await yo().put(`/plataforma/clientes/${FX.empresaA}/suscripcion`, { planId: plan.id });
      const nueva = {
        empresaId: FX.empresaA,
        nombre: 'Tercera',
        zonaHoraria: 'America/Mexico_City',
      };

      const dueno = como(app, USUARIOS.adminEmpresaA);
      const r1 = await dueno.post('/sucursales', nueva);
      expect(r1.status).toBe(409);
      expect(r1.body).toMatchObject({
        codigo: 'limite_sucursales',
        limite: 2,
        activas: 2,
        message: `Tu plan (${plan.nombre}) permite 2 sucursales activas. Para agregar más, contacta a soporte.`,
      });
      expect((await dueno.post('/sucursales', { ...nueva, forzarLimite: true })).status).toBe(409);

      const sinConfirmar = await yo().post('/sucursales', nueva);
      expect(sinConfirmar.status).toBe(409);
      expect(sinConfirmar.body.message).toContain('forzarLimite');
      expect(await prisma.sucursal.count({ where: { empresaId: FX.empresaA } })).toBe(2);

      const forzada = await yo().post('/sucursales', { ...nueva, forzarLimite: true });
      expect(forzada.status).toBe(201);
      expect((await bitacora(FX.empresaA)).at(-1)).toMatchObject({
        accion: 'sucursal.forzar_limite',
        antes: { plan: plan.nombre, limite: 2, activas: 2 },
      });

      // Reactivar también cuenta: se da de baja y el dueño no la puede reactivar.
      await yo()
        .patch(`/sucursales/${forzada.body.id}`, { activo: false })
        .then((r) => expect(r.status).toBe(200));
      const reactivar = await dueno.patch(`/sucursales/${forzada.body.id}`, { activo: true });
      expect(reactivar.status).toBe(409);
      expect(reactivar.body.codigo).toBe('limite_sucursales');
      // Editar el nombre de una que ya existe no cuenta contra el límite.
      expect((await dueno.patch(`/sucursales/${FX.sucursalA1}`, { nombre: 'A1 bis' })).status).toBe(
        200,
      );
      await prisma.sucursal.update({ where: { id: FX.sucursalA1 }, data: { nombre: 'A1' } });

      await prisma.sucursal.delete({ where: { id: forzada.body.id } });
      await prisma.suscripcion.deleteMany({ where: { empresaId: FX.empresaA } });
    });

    it('sin suscripción o con plan ilimitado no hay límite; una empresa ajena sigue siendo 404', async () => {
      const r = await yo().post('/sucursales', {
        empresaId: FX.empresaB,
        nombre: 'Sin límite',
        zonaHoraria: 'America/Mexico_City',
      });
      expect(r.status).toBe(201);
      await prisma.sucursal.delete({ where: { id: r.body.id } });
      const ajena = await como(app, USUARIOS.adminEmpresaA).post('/sucursales', {
        empresaId: FX.empresaB,
        nombre: 'Ajena',
        zonaHoraria: 'America/Mexico_City',
      });
      expect(ajena.status).toBe(404);
    });
  });

  // --- Bitácora y ajustes ----------------------------------------------------------------------

  describe('bitácora y ajustes', () => {
    it('bitácora paginada, de la más reciente a la más vieja, con nombre de empresa', async () => {
      const plan = await crearPlan();
      const { cliente } = await altaCliente(plan.id);
      await yo().patch(`/plataforma/clientes/${cliente.id}`, { notasPlataforma: 'Una' });
      await yo().patch(`/plataforma/clientes/${cliente.id}`, { notasPlataforma: 'Dos' });
      const p1 = await yo().get(`/plataforma/bitacora?empresaId=${cliente.id}&porPagina=2`);
      expect(p1.status).toBe(200);
      expect(p1.body).toMatchObject({ total: 3, pagina: 1, porPagina: 2 });
      expect(p1.body.entradas.map((e: { accion: string }) => e.accion)).toEqual([
        'cliente.editar',
        'cliente.editar',
      ]);
      expect(p1.body.entradas[0]).toMatchObject({
        empresa: cliente.nombre,
        despues: expect.objectContaining({ notasPlataforma: 'Dos' }),
      });
      const p2 = await yo().get(
        `/plataforma/bitacora?empresaId=${cliente.id}&porPagina=2&pagina=2`,
      );
      expect(p2.body.entradas.map((e: { accion: string }) => e.accion)).toEqual(['cliente.crear']);
      expect((await yo().get('/plataforma/bitacora?porPagina=500')).status).toBe(400);
    });

    it('color de interfaz global: se guarda, sale en /sistema (público) y vuelve al del build con null', async () => {
      const r = await yo().put('/plataforma/ajustes', { colorAcento: 'magenta' });
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ colorAcento: 'magenta' });
      expect((await yo().get('/plataforma/ajustes')).body).toEqual({ colorAcento: 'magenta' });
      const publico = await request(app.getHttpServer()).get('/sistema').expect(200);
      expect(publico.body.colorAcento).toBe('magenta');

      expect((await yo().put('/plataforma/ajustes', { colorAcento: '#ff0000' })).status).toBe(400);
      expect((await yo().put('/plataforma/ajustes', {})).status).toBe(400);
      expect((await yo().put('/plataforma/ajustes', { colorAcento: null })).body).toEqual({
        colorAcento: null,
      });
      const entradas = await prisma.bitacoraPlataforma.findMany({
        where: { accion: 'ajustes.editar', actorId: GLOBAL.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(entradas.map((e) => e.despues)).toEqual([
        { colorAcento: 'magenta' },
        { colorAcento: null },
      ]);
    });
  });

  it('el reloj fijo sí manda: un día después del límite, la vencida aparece sola (sin job)', async () => {
    const plan = await crearPlan();
    const { cliente } = await altaCliente(plan.id, { vencimiento: '2026-11-03' });
    expect(cliente.suscripcion.estadoEfectivo).toBe('activa');
    ahora = Date.UTC(2026, 10, 9, 18, 0, 0); // 9 de nov: límite = 8 de nov
    try {
      const r = await yo().get(`/plataforma/clientes/${cliente.id}`);
      expect(r.body.suscripcion).toMatchObject({ estado: 'activa', estadoEfectivo: 'vencida' });
    } finally {
      ahora = AHORA;
    }
  });
});

interface ClienteDetalle {
  id: string;
  nombre: string;
  suscripcion: { estado: string; estadoEfectivo: string };
  listaUsuarios: unknown[];
}
