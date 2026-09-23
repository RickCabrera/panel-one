import { createECDH, randomBytes } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient, TipoAlerta } from '@prisma/client';
import request from 'supertest';

import { generarSnapshots, type MesaSeed } from '../../prisma/seed-mesas';
import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { PUERTO_PUSH } from '../adaptadores/adaptadores.module';
import type { PushFalso } from '../adaptadores/push/push-falso';
import { AlertasService } from '../alertas/alertas.service';
import { TokensService } from '../auth/tokens.service';
import { AppModule } from '../app.module';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import { MAX_DISPOSITIVOS_POR_USUARIO } from '../scope/escritura-push';
import { NotificacionesService, VIGENCIA_DISPOSITIVO_MS } from './notificaciones.service';
import { NotificacionesProgramador } from './programador';

// E2E de las notificaciones push (F2-146) sobre la app REAL contra Postgres REAL, con el push
// FALSO (`PUSH_IMPL` sin poner) y reloj fijo. Lo que se mide es a QUIÉN le llega QUÉ: el falso
// registra cada envío con su endpoint, y cada navegador de prueba tiene un endpoint propio.
//
// Mesas: los snapshots del seed (`generarSnapshots`): A1 en vivo y A2 desconectada (último
// snapshot hace 2 h). Las mesas que deben alertar se calculan aquí a mano, como en F2-224.
//
// Venta de AYER (A1, CDMX; T0 = martes 22-sep-2026 14:00 CDMX = 20:00Z → ayer = 21-sep):
// 150.50 + 99.50 + 200.00 = 450.00 en 3 cuentas (ticket 150.00). NO entran: una del 22-sep y
// una del 21-sep 05:30Z (= 20-sep 23:30 CDMX).

const T0 = Date.parse('2026-09-22T20:00:00Z');
const AYER = '2026-09-21';

class RelojFijo extends Reloj {
  t = T0;
  override ahora(): number {
    return this.t;
  }
}

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

interface Suscripcion {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** Lo que entrega `PushSubscription.toJSON()` de un navegador real, con llaves de verdad. */
function suscripcion(nombre: string): Suscripcion {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/f2146-${nombre}`,
    keys: {
      p256dh: ecdh.getPublicKey().toString('base64url'),
      auth: randomBytes(16).toString('base64url'),
    },
  };
}

const APAGADAS = {
  mesaAbierta: false,
  sucursalSinReporte: false,
  foliosBajo: false,
  cierreDia: false,
};

describe('Notificaciones push (e2e, F2-146)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojFijo();
  let app: INestApplication;
  let push: PushFalso;
  let mesasVivas: MesaSeed[];
  let ips = 0;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const http = async (
    metodo: 'get' | 'put' | 'post' | 'delete',
    ruta: string,
    u: Usuario,
    body?: object,
  ) => {
    const r = request(app.getHttpServer())
      [metodo](ruta)
      .set('Authorization', `Bearer ${await token(u)}`)
      .set('X-Forwarded-For', `10.46.${Math.floor(++ips / 250)}.${ips % 250}`);
    return body ? r.send(body) : r;
  };
  const vista = (u: Usuario) => http('get', '/cuenta/notificaciones', u);
  const preferencias = (u: Usuario, p: Partial<typeof APAGADAS>) =>
    http('put', '/cuenta/notificaciones/preferencias', u, { ...APAGADAS, ...p });
  const registrar = (u: Usuario, s: Suscripcion) =>
    http('post', '/cuenta/notificaciones/dispositivos', u, s);
  const quitar = (u: Usuario, endpoint: string) =>
    http('delete', '/cuenta/notificaciones/dispositivos', u, { endpoint });
  const prueba = (u: Usuario) => http('post', '/cuenta/notificaciones/prueba', u);

  const a = (s: Suscripcion) => push.enviados.filter((e) => e.endpoint === s.endpoint);
  const deFixtures = () =>
    prisma.dispositivoPush.findMany({
      where: { endpoint: { startsWith: 'https://fcm.googleapis.com/fcm/send/f2146-' } },
    });

  const esperadasMesa = (umbral: number) =>
    mesasVivas
      .filter((m) => Math.floor((T0 - Date.parse(m.abiertoAt)) / 60_000) > umbral)
      .map((m) => m.folio)
      .sort();

  async function evaluar(): Promise<void> {
    await app.get(AlertasService).evaluarEmpresa(FX.empresaA);
    await app.get(NotificacionesService).esperarPendientes();
  }

  async function regla(tipo: TipoAlerta, activa: boolean, umbral: number): Promise<void> {
    const r = await http('put', `/alertas/reglas/${tipo}`, USUARIOS.adminEmpresaA, {
      empresaId: FX.empresaA,
      activa,
      umbral,
    });
    expect(r.status).toBe(200);
    await app.get(NotificacionesService).esperarPendientes();
  }

  async function cheque(
    empresaId: string,
    sucursalId: string,
    folio: string,
    cerrado: string,
    total: string,
  ) {
    await prisma.cheque.create({
      data: {
        empresaId,
        sucursalId,
        folio,
        folioSr: `PUSH-${folio}`,
        abiertoAt: new Date(Date.parse(cerrado) - 30 * 60_000),
        cerradoAt: new Date(cerrado),
        subtotal: total,
        impuestos: '0',
        descuentos: '0',
        propina: '0',
        total,
      },
    });
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.updateMany({
      where: { id: { in: [FX.sucursalA1, FX.sucursalA2, FX.sucursalB1] } },
      data: { zonaHoraria: 'America/Mexico_City' },
    });
    const snaps = generarSnapshots({
      empresaId: FX.empresaA,
      sucursales: [FX.sucursalA1, FX.sucursalA2],
      ahora: new Date(T0),
    });
    mesasVivas = snaps[0].payload.mesas;
    await prisma.mesaSnapshot.createMany({
      data: snaps.map((s) => ({ ...s, payload: s.payload as unknown as Prisma.InputJsonValue })),
    });
    await cheque(FX.empresaA, FX.sucursalA1, 'Y1', '2026-09-21T19:00:00Z', '150.50');
    await cheque(FX.empresaA, FX.sucursalA1, 'Y2', '2026-09-21T19:10:00Z', '99.50');
    await cheque(FX.empresaA, FX.sucursalA2, 'Y3', '2026-09-22T05:00:00Z', '200.00'); // 21-sep 23:00 CDMX
    await cheque(FX.empresaA, FX.sucursalA1, 'HOY', '2026-09-22T18:00:00Z', '1000.00');
    await cheque(FX.empresaA, FX.sucursalA1, 'ANTIER', '2026-09-21T05:30:00Z', '1000.00');

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.init();
    push = app.get<PushFalso>(PUERTO_PUSH);
  });

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  beforeEach(() => {
    reloj.t = T0;
  });

  // ------------------------------------------------------------ cuenta

  describe('cuenta', () => {
    it('sin token: 401 en las cinco rutas', async () => {
      const s = request(app.getHttpServer());
      expect((await s.get('/cuenta/notificaciones')).status).toBe(401);
      expect((await s.put('/cuenta/notificaciones/preferencias').send(APAGADAS)).status).toBe(401);
      expect(
        (await s.post('/cuenta/notificaciones/dispositivos').send(suscripcion('x'))).status,
      ).toBe(401);
      expect(
        (await s.delete('/cuenta/notificaciones/dispositivos').send({ endpoint: 'x' })).status,
      ).toBe(401);
      expect((await s.post('/cuenta/notificaciones/prueba')).status).toBe(401);
    });

    it('GET con los tres roles: todo apagado por defecto; folios sólo para admin_global', async () => {
      for (const u of [USUARIOS.visorA, USUARIOS.adminEmpresaA]) {
        const r = await vista(u);
        expect(r.status).toBe(200);
        expect(r.body).toEqual({
          clavePublica: null,
          preferencias: APAGADAS,
          disponibles: ['mesa_abierta', 'sucursal_sin_reporte', 'cierre_dia'],
          dispositivos: 0,
        });
      }
      const g = await vista(USUARIOS.adminGlobal);
      expect(g.body.disponibles).toEqual([
        'mesa_abierta',
        'sucursal_sin_reporte',
        'folios_bajo',
        'cierre_dia',
      ]);
    });

    it('PUT: cada tipo se guarda por separado; folios_bajo sin ser admin_global = 400', async () => {
      for (const u of [USUARIOS.visorA, USUARIOS.adminEmpresaA]) {
        const r = await preferencias(u, { foliosBajo: true });
        expect(r.status).toBe(400);
        expect(r.body.message).toContain('administrador global');
      }
      expect((await vista(USUARIOS.visorA)).body.preferencias).toEqual(APAGADAS);

      const r = await preferencias(USUARIOS.visorA, { cierreDia: true });
      expect(r.status).toBe(200);
      expect(r.body.preferencias).toEqual({ ...APAGADAS, cierreDia: true });
      expect((await vista(USUARIOS.visorA)).body.preferencias).toEqual({
        ...APAGADAS,
        cierreDia: true,
      });

      const g = await preferencias(USUARIOS.adminGlobal, { foliosBajo: true });
      expect(g.status).toBe(200);
      expect(g.body.preferencias.foliosBajo).toBe(true);

      const malo = await http('put', '/cuenta/notificaciones/preferencias', USUARIOS.visorA, {
        mesaAbierta: 'sí',
      });
      expect(malo.status).toBe(400);

      // Se limpian para lo que sigue.
      await preferencias(USUARIOS.visorA, {});
      await preferencias(USUARIOS.adminGlobal, {});
    });

    it.each([
      ['http://fcm.googleapis.com/fcm/send/f2146-x', 'https'],
      ['https://interno.ejemplo.test/push', 'servicio de notificaciones conocido'],
      ['https://evilfcm.googleapis.com/x', 'servicio de notificaciones conocido'],
      ['https://169.254.169.254/latest/meta-data', 'IP'],
      ['https://fcm.googleapis.com:8443/fcm/send/x', 'puerto'],
      ['https://u:p@fcm.googleapis.com/fcm/send/x', 'usuario'],
    ])('registrar %s = 400 (%s), sin guardar nada', async (endpoint, motivo) => {
      const r = await registrar(USUARIOS.visorA, { ...suscripcion('x'), endpoint });
      expect(r.status).toBe(400);
      expect(r.body.message).toContain(motivo);
      expect(await prisma.dispositivoPush.count({ where: { endpoint } })).toBe(0);
    });

    it('llaves inválidas = 400', async () => {
      const s = suscripcion('llaves');
      for (const keys of [
        { ...s.keys, auth: randomBytes(8).toString('base64url') },
        { ...s.keys, p256dh: randomBytes(65).toString('base64url') },
        { ...s.keys, p256dh: 'no+es+base64url' },
      ]) {
        expect((await registrar(USUARIOS.visorA, { ...s, keys })).status).toBe(400);
      }
      expect(
        (
          await http('post', '/cuenta/notificaciones/dispositivos', USUARIOS.visorA, {
            endpoint: s.endpoint,
          })
        ).status,
      ).toBe(400);
    });

    it('registrar es idempotente (renueva); quitar el propio = 200; ajeno o inexistente = el MISMO 404', async () => {
      const s = suscripcion('propio');
      const r1 = await registrar(USUARIOS.visorA, s);
      expect(r1.status).toBe(200);
      expect(r1.body.dispositivos).toBe(1);
      reloj.t = T0 + 60_000;
      const r2 = await registrar(USUARIOS.visorA, s);
      expect(r2.body.dispositivos).toBe(1);
      const fila = await prisma.dispositivoPush.findUniqueOrThrow({
        where: { endpoint: s.endpoint },
      });
      expect(fila.renovadoAt.getTime()).toBe(T0 + 60_000);
      expect(fila.creadoAt.getTime()).toBe(T0);
      expect(fila.empresaId).toBe(FX.empresaA);

      const ajeno = await quitar(USUARIOS.visorB, s.endpoint);
      const inexistente = await quitar(USUARIOS.visorB, suscripcion('nadie').endpoint);
      expect(ajeno.status).toBe(404);
      expect(ajeno.body).toEqual(inexistente.body);
      // Tampoco de la misma empresa: sólo el dueño.
      expect((await quitar(USUARIOS.adminEmpresaA, s.endpoint)).status).toBe(404);
      expect(await prisma.dispositivoPush.count({ where: { endpoint: s.endpoint } })).toBe(1);

      const ok = await quitar(USUARIOS.visorA, s.endpoint);
      expect(ok.status).toBe(200);
      expect(ok.body.dispositivos).toBe(0);
    });

    it('el mismo navegador con otra sesión (otra EMPRESA): se reasigna sólo con las MISMAS llaves, y la respuesta no lo delata', async () => {
      const s = suscripcion('compartido');
      expect((await registrar(USUARIOS.visorB, s)).status).toBe(200);

      // Otras llaves: no se toca (quien sólo conoce la URL no se lo lleva).
      const intruso = await registrar(USUARIOS.visorA, { ...s, keys: suscripcion('otro').keys });
      expect(intruso.status).toBe(400);
      expect(
        (await prisma.dispositivoPush.findUniqueOrThrow({ where: { endpoint: s.endpoint } }))
          .usuarioId,
      ).toBe(USUARIOS.visorB.id);

      // Mismas llaves: pasa a visorA, con SU empresa.
      const reasignado = await registrar(USUARIOS.visorA, s);
      const fila = await prisma.dispositivoPush.findUniqueOrThrow({
        where: { endpoint: s.endpoint },
      });
      expect(fila.usuarioId).toBe(USUARIOS.visorA.id);
      expect(fila.empresaId).toBe(FX.empresaA);
      expect((await vista(USUARIOS.visorB)).body.dispositivos).toBe(0);

      // Idéntica a un registro nuevo sin dueño anterior.
      await quitar(USUARIOS.visorA, s.endpoint);
      const nuevo = await registrar(USUARIOS.visorA, suscripcion('sin-dueno'));
      expect(reasignado.status).toBe(nuevo.status);
      expect(reasignado.body).toEqual(nuevo.body);
      await quitar(USUARIOS.visorA, suscripcion('sin-dueno').endpoint).catch(() => undefined);
      await prisma.dispositivoPush.deleteMany({ where: { usuarioId: USUARIOS.visorA.id } });
    });

    it('dos registros SIMULTÁNEOS del mismo navegador nuevo: una sola fila, los dos 200', async () => {
      const s = suscripcion('simultaneo');
      const [r1, r2] = await Promise.all([
        registrar(USUARIOS.visorA, s),
        registrar(USUARIOS.visorA, s),
      ]);
      expect([r1.status, r2.status]).toEqual([200, 200]);
      expect(await prisma.dispositivoPush.count({ where: { endpoint: s.endpoint } })).toBe(1);
      await prisma.dispositivoPush.deleteMany({ where: { usuarioId: USUARIOS.visorA.id } });
    });

    it(`tope de ${MAX_DISPOSITIVOS_POR_USUARIO} navegadores por usuario: sale el menos renovado`, async () => {
      const subs = Array.from({ length: MAX_DISPOSITIVOS_POR_USUARIO + 1 }, (_, i) =>
        suscripcion(`tope-${i}`),
      );
      for (const [i, s] of subs.entries()) {
        reloj.t = T0 + i * 1000;
        expect((await registrar(USUARIOS.adminEmpresaA, s)).status).toBe(200);
      }
      const quedan = await prisma.dispositivoPush.findMany({
        where: { usuarioId: USUARIOS.adminEmpresaA.id },
      });
      expect(quedan).toHaveLength(MAX_DISPOSITIVOS_POR_USUARIO);
      expect(quedan.map((d) => d.endpoint)).not.toContain(subs[0].endpoint);
      await prisma.dispositivoPush.deleteMany({ where: { usuarioId: USUARIOS.adminEmpresaA.id } });
    });
  });

  // ------------------------------------------------------------ vigencia y caducidad

  describe('el navegador muere con la sesión', () => {
    afterEach(async () => {
      await prisma.dispositivoPush.deleteMany({ where: { usuarioId: USUARIOS.visorA.id } });
      await prisma.usuario.update({
        where: { id: USUARIOS.visorA.id },
        data: { versionSesion: 0 },
      });
    });

    it('prueba: llega a los vigentes', async () => {
      const s = suscripcion('prueba');
      await registrar(USUARIOS.visorA, s);
      const r = await prueba(USUARIOS.visorA);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ entregados: 1, descartados: 0, fallidos: 0 });
      expect(a(s).at(-1)!.mensaje.titulo).toBe('Notificación de prueba');
    });

    it('cambio de contraseña / baja (versionSesion sube): no recibe y el navegador se borra', async () => {
      const s = suscripcion('version');
      await registrar(USUARIOS.visorA, s);
      await prisma.usuario.update({
        where: { id: USUARIOS.visorA.id },
        data: { versionSesion: { increment: 1 } },
      });
      const antes = a(s).length;
      const r = await prueba(USUARIOS.visorA);
      expect(r.body).toEqual({ entregados: 0, descartados: 1, fallidos: 0 });
      expect(a(s)).toHaveLength(antes);
      expect(await prisma.dispositivoPush.count({ where: { endpoint: s.endpoint } })).toBe(0);
    });

    it('sin renovarse en lo que dura una sesión: no recibe; renovado un instante antes, sí', async () => {
      const s = suscripcion('vigencia');
      await registrar(USUARIOS.visorA, s);
      reloj.t = T0 + VIGENCIA_DISPOSITIVO_MS;
      expect((await prueba(USUARIOS.visorA)).body.entregados).toBe(1);
      reloj.t = T0 + VIGENCIA_DISPOSITIVO_MS + 1;
      expect((await prueba(USUARIOS.visorA)).body).toEqual({
        entregados: 0,
        descartados: 1,
        fallidos: 0,
      });
    });

    it('caducado por el servicio de push (410): se borra; un 500 cuenta como fallido y se queda', async () => {
      const caducado = {
        ...suscripcion('x'),
        endpoint: 'https://fcm.googleapis.com/fcm/send/f2146/caducado/1',
      };
      const falla = {
        ...suscripcion('y'),
        endpoint: 'https://fcm.googleapis.com/fcm/send/f2146/falla/1',
      };
      await registrar(USUARIOS.visorA, caducado);
      await registrar(USUARIOS.visorA, falla);
      expect((await prueba(USUARIOS.visorA)).body).toEqual({
        entregados: 0,
        descartados: 1,
        fallidos: 1,
      });
      expect(await prisma.dispositivoPush.count({ where: { endpoint: caducado.endpoint } })).toBe(
        0,
      );
      expect(await prisma.dispositivoPush.count({ where: { endpoint: falla.endpoint } })).toBe(1);
    });
  });

  // ------------------------------------------------------------ alertas

  describe('alertas: a quién llega qué', () => {
    const subs = {
      visorA: suscripcion('al-visor-a'),
      adminA: suscripcion('al-admin-a'),
      visorB: suscripcion('al-visor-b'),
      global: suscripcion('al-global'),
      inactivo: suscripcion('al-inactivo'),
    };

    beforeAll(async () => {
      await preferencias(USUARIOS.visorA, { sucursalSinReporte: true });
      await preferencias(USUARIOS.adminEmpresaA, { sucursalSinReporte: true, mesaAbierta: true });
      await preferencias(USUARIOS.visorB, { sucursalSinReporte: true, mesaAbierta: true });
      await preferencias(USUARIOS.adminGlobal, { mesaAbierta: true });
      await registrar(USUARIOS.visorA, subs.visorA);
      await registrar(USUARIOS.adminEmpresaA, subs.adminA);
      await registrar(USUARIOS.visorB, subs.visorB);
      await registrar(USUARIOS.adminGlobal, subs.global);
      // Un usuario INACTIVO con todo prendido y un navegador vigente (escrito a mano: ya no
      // puede iniciar sesión).
      await prisma.preferenciaPush.create({
        data: {
          usuarioId: USUARIOS.visorInactivo.id,
          empresaId: FX.empresaA,
          mesaAbierta: true,
          sucursalSinReporte: true,
        },
      });
      await prisma.dispositivoPush.create({
        data: {
          usuarioId: USUARIOS.visorInactivo.id,
          empresaId: FX.empresaA,
          endpoint: subs.inactivo.endpoint,
          ...subs.inactivo.keys,
          versionSesion: 0,
          creadoAt: new Date(T0),
          renovadoAt: new Date(T0),
        },
      });
      push.vaciar();
    });

    it('AC: la sucursal desconectada llega sin la app abierta; cada quien recibe SÓLO lo que prendió', async () => {
      await evaluar();
      const mesas = esperadasMesa(60);
      expect(mesas.length).toBeGreaterThan(0);

      // visorA: sólo sucursal (A2), una vez.
      expect(a(subs.visorA)).toHaveLength(1);
      const aviso = a(subs.visorA)[0];
      expect(aviso.mensaje.titulo).toBe('Sucursal sin reportar');
      expect(aviso.mensaje.cuerpo).toBe(
        'A2 (Empresa Prueba A (F1-011)) no reporta desde hace 2 h.',
      );
      expect(aviso.mensaje.url).toBe(`/alertas?empresa=${FX.empresaA}&sucursal=${FX.sucursalA2}`);
      expect(aviso.opciones).toEqual({ ttlS: 3600, urgencia: 'high' });

      // adminEmpresaA: sucursal + una por cada mesa > 60 min.
      const admin = a(subs.adminA);
      expect(admin.filter((e) => e.mensaje.titulo === 'Sucursal sin reportar')).toHaveLength(1);
      const mesasAdmin = admin.filter((e) => e.mensaje.url.startsWith('/mesas?'));
      expect(mesasAdmin).toHaveLength(mesas.length);
      expect(new Set(admin.map((e) => e.mensaje.etiqueta)).size).toBe(admin.length);
      const alertasMesa = await prisma.alerta.findMany({
        where: { empresaId: FX.empresaA, tipo: TipoAlerta.mesa_abierta, cerradaAt: null },
      });
      expect(alertasMesa.map((x) => x.llave).sort()).toEqual(mesas);
      expect(mesasAdmin.map((e) => e.mensaje.etiqueta).sort()).toEqual(
        alertasMesa.map((x) => `alerta-${x.id}`).sort(),
      );
      expect(mesasAdmin[0].mensaje.titulo).toMatch(/^Mesa .+ abierta hace \d/);

      // admin_global (empresa NULL): las mesas de A, una por alerta; la sucursal no la prendió.
      expect(a(subs.global)).toHaveLength(mesas.length);
      // Otra empresa y usuario inactivo: nada.
      expect(a(subs.visorB)).toHaveLength(0);
      expect(a(subs.inactivo)).toHaveLength(0);
    });

    it('re-evaluar con las alertas ya abiertas no vuelve a mandar', async () => {
      const antes = push.enviados.length;
      await evaluar();
      reloj.t = T0 + 30_000;
      await evaluar();
      expect(push.enviados).toHaveLength(antes);
    });

    it('cada una se apaga por separado: apagar "sucursal" deja de avisar ésa y "mesa" sigue', async () => {
      await preferencias(USUARIOS.visorA, { mesaAbierta: true }); // sucursal apagada
      await preferencias(USUARIOS.adminEmpresaA, { sucursalSinReporte: true }); // mesa apagada
      const antesVisor = a(subs.visorA).length;
      const antesAdmin = a(subs.adminA).length;

      // Bajar el umbral de mesas abre alertas NUEVAS (el PUT de la regla también avisa).
      await regla(TipoAlerta.mesa_abierta, true, 30);
      const nuevas = esperadasMesa(30).length - esperadasMesa(60).length;
      expect(nuevas).toBeGreaterThan(0);
      expect(a(subs.visorA).length - antesVisor).toBe(nuevas);
      expect(a(subs.adminA).length - antesAdmin).toBe(0);

      // Reabrir la de sucursal (apagar y prender la regla de la empresa): adminA sí, visorA no.
      await regla(TipoAlerta.sucursal_sin_reporte, false, 10);
      // Regla de EMPRESA apagada: evaluar no avisa nada de sucursal.
      await evaluar();
      expect(a(subs.adminA).length - antesAdmin).toBe(0);
      await regla(TipoAlerta.sucursal_sin_reporte, true, 10);
      const sucursalVisor = a(subs.visorA).filter(
        (e) => e.mensaje.titulo === 'Sucursal sin reportar',
      );
      expect(sucursalVisor).toHaveLength(1); // sólo la del primer test
      expect(a(subs.adminA).length - antesAdmin).toBe(1);
      expect(a(subs.adminA).at(-1)!.mensaje.titulo).toBe('Sucursal sin reportar');
    });

    it('un push que truena no rompe la evaluación ni el PUT de la regla', async () => {
      const original = push.enviar.bind(push);
      push.enviar = () => Promise.reject(new Error('servicio de push caído (prueba)'));
      try {
        await regla(TipoAlerta.mesa_abierta, true, 20);
        const abiertas = await prisma.alerta.count({
          where: { empresaId: FX.empresaA, tipo: TipoAlerta.mesa_abierta, cerradaAt: null },
        });
        expect(abiertas).toBe(esperadasMesa(20).length);
        await regla(TipoAlerta.sucursal_sin_reporte, false, 10);
        await regla(TipoAlerta.sucursal_sin_reporte, true, 10);
        await expect(evaluar()).resolves.toBeUndefined();
      } finally {
        push.enviar = original;
      }
      // Los navegadores siguen ahí (un fallo no es caducidad).
      expect((await deFixtures()).map((d) => d.endpoint)).toContain(subs.visorA.endpoint);
    });

    afterAll(async () => {
      await regla(TipoAlerta.mesa_abierta, true, 60);
      for (const u of [
        USUARIOS.visorA,
        USUARIOS.adminEmpresaA,
        USUARIOS.visorB,
        USUARIOS.adminGlobal,
      ]) {
        await preferencias(u, {});
      }
      await prisma.dispositivoPush.deleteMany({
        where: { endpoint: { in: Object.values(subs).map((s) => s.endpoint) } },
      });
    });
  });

  // ------------------------------------------------------------ resumen de cierre

  describe('resumen de cierre del día', () => {
    const subs = {
      visorA: suscripcion('cd-visor-a'),
      visorB: suscripcion('cd-visor-b'),
      global: suscripcion('cd-global'),
    };

    beforeAll(async () => {
      await preferencias(USUARIOS.visorA, { cierreDia: true });
      await preferencias(USUARIOS.visorB, { cierreDia: true });
      await preferencias(USUARIOS.adminGlobal, { cierreDia: true });
      await registrar(USUARIOS.visorA, subs.visorA);
      await registrar(USUARIOS.visorB, subs.visorB);
      await registrar(USUARIOS.adminGlobal, subs.global);
      push.vaciar();
    });

    const vuelta = () => app.get(NotificacionesService).vueltaResumen();
    const reclamos = (usuarioId: string) =>
      prisma.envioPushResumen.findMany({ where: { usuarioId } });

    it('antes de las 07:00 de la empresa no sale nada, ni se reclama', async () => {
      reloj.t = Date.parse('2026-09-22T12:59:00Z'); // 06:59 CDMX
      await vuelta();
      expect(a(subs.visorA)).toHaveLength(0);
      expect(await reclamos(USUARIOS.visorA.id)).toHaveLength(0);
    });

    it('a las 07:00 sale UNO con la venta de ayer, = /ventas/resumen y = el cálculo a mano', async () => {
      reloj.t = Date.parse('2026-09-22T13:00:00Z'); // 07:00 CDMX
      await vuelta();
      expect(a(subs.visorA)).toHaveLength(1);
      const m = a(subs.visorA)[0].mensaje;
      // A mano: 150.50 + 99.50 + 200.00 = 450.00; 3 cuentas; 150.00 de ticket.
      expect(m.titulo).toBe('Empresa Prueba A (F1-011): cierre del 21 sep');
      expect(m.cuerpo).toBe('Venta $450.00 · 3 cuentas · ticket prom. $150.00');
      expect(m.url).toBe(`/?empresa=${FX.empresaA}&periodo=rango&desde=${AYER}&hasta=${AYER}`);
      const panel = await http(
        'get',
        `/ventas/resumen?empresaId=${FX.empresaA}&desde=${AYER}&hasta=${AYER}`,
        USUARIOS.visorA,
      );
      expect(panel.body.venta).toBe('450.00');
      expect(panel.body.cuentas).toBe(3);
      expect(await reclamos(USUARIOS.visorA.id)).toEqual([
        expect.objectContaining({ empresaId: FX.empresaA, periodo: AYER }),
      ]);
    });

    it('empresa sin ventas ayer: dice que no llegó nada, NUNCA "$0.00"', async () => {
      const m = a(subs.visorB);
      expect(m).toHaveLength(1);
      expect(m[0].mensaje.titulo).toBe('Empresa Prueba B (F1-011): sin ventas del 21 sep');
      expect(m[0].mensaje.cuerpo).toContain('No recibimos cuentas cerradas');
      expect(JSON.stringify(m[0].mensaje)).not.toContain('$0.00');
    });

    it('admin_global: uno por cada empresa activa de su scope (A y B), ninguno de la inactiva C', async () => {
      const etiquetas = a(subs.global).map((e) => e.mensaje.etiqueta);
      expect(etiquetas).toContain(`cierre-${FX.empresaA}-${AYER}`);
      expect(etiquetas).toContain(`cierre-${FX.empresaB}-${AYER}`);
      expect(etiquetas).not.toContain(`cierre-${FX.empresaC}-${AYER}`);
    });

    it('tres vueltas seguidas y dos SIMULTÁNEAS: sigue siendo uno por día', async () => {
      reloj.t = Date.parse('2026-09-22T15:00:00Z');
      await vuelta();
      await vuelta();
      await Promise.all([vuelta(), vuelta(), app.get(NotificacionesProgramador).vuelta()]);
      expect(a(subs.visorA)).toHaveLength(1);
      expect(a(subs.visorB)).toHaveLength(1);
      expect(await reclamos(USUARIOS.visorA.id)).toHaveLength(1);
    });

    it('al día siguiente sale el del nuevo "ayer"', async () => {
      reloj.t = Date.parse('2026-09-23T13:30:00Z');
      await vuelta();
      expect(a(subs.visorA)).toHaveLength(2);
      // El 22 tuvo una cuenta de 1000.00 (la "HOY" de ayer).
      expect(a(subs.visorA)[1].mensaje.cuerpo).toBe(
        'Venta $1,000.00 · 1 cuenta · ticket prom. $1,000.00',
      );
    });

    it('sin navegador vigente no se reclama (si renueva hoy, todavía le llega)', async () => {
      await prisma.usuario.update({
        where: { id: USUARIOS.visorB.id },
        data: { versionSesion: { increment: 1 } },
      });
      reloj.t = Date.parse('2026-09-24T13:30:00Z');
      await vuelta();
      expect(await reclamos(USUARIOS.visorB.id)).toHaveLength(2); // 21 y 22, no 23
      expect(a(subs.visorB)).toHaveLength(2);
      // Renueva (nuevo login → versión actual) y en la siguiente vuelta sí le llega.
      await registrar(USUARIOS.visorB, subs.visorB);
      await vuelta();
      expect(a(subs.visorB)).toHaveLength(3);
      await prisma.usuario.update({
        where: { id: USUARIOS.visorB.id },
        data: { versionSesion: 0 },
      });
    });

    it('preferencia apagada: no sale', async () => {
      await preferencias(USUARIOS.visorA, {});
      reloj.t = Date.parse('2026-09-25T13:30:00Z');
      const antes = a(subs.visorA).length;
      await vuelta();
      expect(a(subs.visorA)).toHaveLength(antes);
    });
  });
});
