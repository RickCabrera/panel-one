import type { NestExpressApplication } from '@nestjs/platform-express';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { io, type Socket as SocketCliente } from 'socket.io-client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';
import type { AvisoIngesta } from './avisos';
import type { DatosSocket } from './sesion-socket';
import { RUTA_SOCKET, TiempoRealGateway } from './tiempo-real.gateway';

// E2E del socket del tiempo real (F2-142) sobre la app REAL (AppModule + configurarApp, guards
// globales incluidos) escuchando en un puerto real, contra Postgres REAL, con las fixtures
// sintéticas de F1-011. El agente es sintético (key cuyo hash se escribe directo).
//
// Lo central: el socket exige el MISMO access token que HTTP (y rechaza uno vencido), la
// suscripción pasa por el scope (fuera de alcance = "No encontrado", como el 404), y un lote de
// ingesta se avisa a quien corresponde en < 5 s.

const KEYS = {
  a1: 'msr_sintetica-tiempo-real-F2-142-sucursal-a1-00000000001',
  b1: 'msr_sintetica-tiempo-real-F2-142-sucursal-b1-00000000002',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

/** Tope de espera de un evento que SÍ debe llegar. El AC es < 5 s. */
const PRESUPUESTO_MS = 5_000;
/** Cuánto se espera para afirmar que un evento NO llegó (el emit es uno solo, síncrono). */
const SILENCIO_MS = 400;

/** Base de los `capturadoAt` sintéticos: hace una hora. */
const INICIO = Date.now() - 3_600_000;

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Socket del tiempo real (e2e, F2-142)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;
  const abiertos: SocketCliente[] = [];
  let capturado = 0;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });

  /** Un access token firmado con el secreto real y el `exp` que se pida (segundos epoch). */
  function tokenConExp(u: Usuario, exp: number, typ = 'access', secreto?: string): string {
    return app.get(JwtService, { strict: false }).sign(
      { rol: u.rol, empresaId: u.empresaId, typ, exp },
      {
        subject: u.id,
        secret:
          secreto ??
          (typ === 'access' ? process.env.JWT_ACCESS_SECRET : process.env.JWT_REFRESH_SECRET),
        algorithm: 'HS256',
      },
    );
  }

  function cliente(auth: Record<string, unknown>): SocketCliente {
    const s = io(url, {
      path: RUTA_SOCKET,
      transports: ['websocket'],
      auth,
      reconnection: false,
      forceNew: true,
    });
    abiertos.push(s);
    return s;
  }

  /** Conecta; resuelve con el socket o rechaza con el mensaje del `connect_error`. */
  function conectar(auth: Record<string, unknown>): Promise<SocketCliente> {
    const s = cliente(auth);
    return new Promise((resolve, reject) => {
      s.once('connect', () => resolve(s));
      s.once('connect_error', (e) => reject(new Error(e.message)));
    });
  }

  async function conectarComo(u: Usuario): Promise<SocketCliente> {
    return conectar({ token: await token(u) });
  }

  function suscribir(s: SocketCliente, cuerpo: unknown): Promise<unknown> {
    return s.timeout(PRESUPUESTO_MS).emitWithAck('suscribir', cuerpo);
  }

  /** Anota los avisos `ingesta` que recibe el socket. */
  function anotar(s: SocketCliente): AvisoIngesta[] {
    const recibidos: AvisoIngesta[] = [];
    s.on('ingesta', (a: AvisoIngesta) => recibidos.push(a));
    return recibidos;
  }

  function siguienteAviso(s: SocketCliente): Promise<{ aviso: AvisoIngesta; en: number }> {
    return new Promise((resolve, reject) => {
      const tope = setTimeout(() => reject(new Error('sin aviso en 5 s')), PRESUPUESTO_MS);
      s.once('ingesta', (aviso: AvisoIngesta) => {
        clearTimeout(tope);
        resolve({ aviso, en: Date.now() });
      });
    });
  }

  function snapshot(id: string) {
    capturado += 1;
    // Recientes y distintos: la purga de 24 h de la ingesta no los toca.
    const capturadoAt = new Date(INICIO + capturado * 1000).toISOString();
    return { id, tipo: 'snapshot', datos: { capturadoAt, mesas: [{ mesa: String(capturado) }] } };
  }

  async function ingerir(key: string, eventos: unknown[]) {
    const res = await request(url).post('/ingesta/eventos').set('X-Api-Key', key).send({ eventos });
    expect(res.status).toBe(200);
    return res.body as { procesados: string[]; rechazados: unknown[] };
  }

  /** El socket del lado del servidor, para mirar/alterar su `data` en las pruebas del guard. */
  function delServidor(s: SocketCliente) {
    const server = (app.get(TiempoRealGateway) as unknown as { server: import('socket.io').Server })
      .server;
    const lado = server.sockets.sockets.get(s.id as string);
    if (!lado) throw new Error('socket no encontrado en el servidor');
    return lado;
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({
      where: { id: FX.sucursalA1 },
      data: { apiKeyHash: hashApiKey(KEYS.a1) },
    });
    await prisma.sucursal.update({
      where: { id: FX.sucursalB1 },
      data: { apiKeyHash: hashApiKey(KEYS.b1) },
    });
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterEach(() => {
    for (const s of abiertos.splice(0)) s.disconnect();
  });

  afterAll(async () => {
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('handshake: el mismo JWT que HTTP', () => {
    it('sin token, token basura, vacío o no-texto → connect_error "No autenticado"', async () => {
      await expect(conectar({})).rejects.toThrow('No autenticado');
      await expect(conectar({ token: 'no-es-un-jwt' })).rejects.toThrow('No autenticado');
      await expect(conectar({ token: '' })).rejects.toThrow('No autenticado');
      await expect(conectar({ token: 123 })).rejects.toThrow('No autenticado');
    });

    it('un access VENCIDO se rechaza; el mismo con exp futuro entra', async () => {
      const ahora = Math.floor(Date.now() / 1000);
      await expect(conectar({ token: tokenConExp(USUARIOS.visorA, ahora - 5) })).rejects.toThrow(
        'No autenticado',
      );
      const s = await conectar({ token: tokenConExp(USUARIOS.visorA, ahora + 60) });
      expect(s.connected).toBe(true);
    });

    it('un refresh token, o un access firmado con otro secreto, no abre el socket', async () => {
      const exp = Math.floor(Date.now() / 1000) + 60;
      await expect(
        conectar({ token: tokenConExp(USUARIOS.visorA, exp, 'refresh') }),
      ).rejects.toThrow('No autenticado');
      await expect(
        conectar({ token: tokenConExp(USUARIOS.visorA, exp, 'access', 'otro-secreto-sintetico') }),
      ).rejects.toThrow('No autenticado');
    });

    it('el token en la QUERY STRING no cuenta (sólo `auth.token`)', async () => {
      const t = await token(USUARIOS.visorA);
      const s = io(`${url}?token=${t}`, {
        path: RUTA_SOCKET,
        transports: ['websocket'],
        reconnection: false,
        forceNew: true,
      });
      abiertos.push(s);
      const error = await new Promise<string>((resolve) => {
        s.once('connect', () => resolve('conectó'));
        s.once('connect_error', (e) => resolve(e.message));
      });
      expect(error).toBe('No autenticado');
    });

    it('al vencer el token el servidor corta el socket, y su timer se limpia', async () => {
      const s = await conectar({
        token: tokenConExp(USUARIOS.visorA, Math.floor(Date.now() / 1000) + 2),
      });
      const lado = delServidor(s);
      expect((lado.data as DatosSocket).corte).toBeDefined();
      const motivo = await new Promise<string>((resolve) => s.once('disconnect', resolve));
      expect(motivo).toBe('io server disconnect');
      expect((lado.data as DatosSocket).corte).toBeUndefined();
    }, 10_000);

    it('si el CLIENTE se va, el timer del vencimiento también se limpia', async () => {
      const s = await conectarComo(USUARIOS.visorA);
      const lado = delServidor(s);
      expect((lado.data as DatosSocket).corte).toBeDefined();
      s.disconnect();
      await esperar(200);
      expect(lado.connected).toBe(false);
      expect((lado.data as DatosSocket).corte).toBeUndefined();
    });
  });

  describe('el guard del socket cuida cada mensaje', () => {
    it.each([
      ['sin sesión en socket.data', (d: DatosSocket) => delete d.sesion],
      [
        'con la sesión ya vencida',
        (d: DatosSocket) => {
          if (d.sesion) d.sesion.venceEnMs = Date.now() - 1;
        },
      ],
    ])('`suscribir` %s se rechaza con "No autenticado" y sin ack', async (_caso, alterar) => {
      const s = await conectarComo(USUARIOS.visorA);
      alterar(delServidor(s).data as DatosSocket);
      const excepcion = new Promise<unknown>((resolve) => s.once('exception', resolve));
      const ack = s.timeout(SILENCIO_MS).emitWithAck('suscribir', { empresaId: FX.empresaA });
      // Nest devuelve además, en `cause`, el mismo mensaje que mandó el cliente.
      expect(await excepcion).toMatchObject({ status: 'error', message: 'No autenticado' });
      await expect(ack).rejects.toThrow();
    });
  });

  describe('suscribir: el alcance del token', () => {
    it('cuerpo inválido → "Parámetros inválidos"', async () => {
      const s = await conectarComo(USUARIOS.visorA);
      expect(await suscribir(s, { empresaId: 'no-uuid' })).toEqual({
        ok: false,
        error: 'Parámetros inválidos',
      });
      expect(await suscribir(s, { empresaId: FX.empresaA, otra: 1 })).toEqual({
        ok: false,
        error: 'Parámetros inválidos',
      });
      expect(await suscribir(s, null)).toEqual({ ok: false, error: 'Parámetros inválidos' });
    });

    it('otra empresa, sucursal de otra empresa o inexistente → el MISMO "No encontrado"', async () => {
      const s = await conectarComo(USUARIOS.visorA);
      const noEncontrado = { ok: false, error: 'No encontrado' };
      expect(await suscribir(s, { empresaId: FX.empresaB })).toEqual(noEncontrado);
      expect(await suscribir(s, { empresaId: FX.empresaA, sucursalId: FX.sucursalB1 })).toEqual(
        noEncontrado,
      );
      expect(await suscribir(s, { empresaId: FX.inexistente })).toEqual(noEncontrado);
      // Ni admin_global mezcla la empresa A con una sucursal de B.
      const g = await conectarComo(USUARIOS.adminGlobal);
      expect(await suscribir(g, { empresaId: FX.empresaA, sucursalId: FX.sucursalB1 })).toEqual(
        noEncontrado,
      );
    });

    it('dentro del alcance → ok', async () => {
      const s = await conectarComo(USUARIOS.visorA);
      expect(await suscribir(s, { empresaId: FX.empresaA })).toEqual({ ok: true });
      expect(await suscribir(s, { empresaId: FX.empresaA, sucursalId: FX.sucursalA2 })).toEqual({
        ok: true,
      });
    });
  });

  describe('aviso de ingesta', () => {
    it('llega en < 5 s a quien ve esa sucursal, y a nadie más', async () => {
      const visorA = await conectarComo(USUARIOS.visorA);
      const soloA1 = await conectarComo(USUARIOS.adminEmpresaA);
      const soloA2 = await conectarComo(USUARIOS.visorA);
      const visorB = await conectarComo(USUARIOS.visorB);
      const global = await conectarComo(USUARIOS.adminGlobal);
      const sinSuscribir = await conectarComo(USUARIOS.visorA);
      expect(await suscribir(visorA, { empresaId: FX.empresaA })).toEqual({ ok: true });
      expect(
        await suscribir(soloA1, { empresaId: FX.empresaA, sucursalId: FX.sucursalA1 }),
      ).toEqual({ ok: true });
      expect(
        await suscribir(soloA2, { empresaId: FX.empresaA, sucursalId: FX.sucursalA2 }),
      ).toEqual({ ok: true });
      expect(await suscribir(visorB, { empresaId: FX.empresaB })).toEqual({ ok: true });
      expect(await suscribir(global, { empresaId: FX.empresaA })).toEqual({ ok: true });
      const aA1 = anotar(soloA1);
      const aA2 = anotar(soloA2);
      const aB = anotar(visorB);
      const aNadie = anotar(sinSuscribir);
      const aGlobal = anotar(global);

      const llega = siguienteAviso(visorA);
      const antes = Date.now();
      await ingerir(KEYS.a1, [snapshot('rt-1')]);
      const { aviso, en } = await llega;

      expect(en - antes).toBeLessThan(PRESUPUESTO_MS);
      expect(aviso).toEqual({ sucursalId: FX.sucursalA1, mesas: true, cheques: false });
      await esperar(SILENCIO_MS);
      expect(aA1).toEqual([aviso]);
      expect(aGlobal).toEqual([aviso]);
      expect(aA2).toEqual([]);
      expect(aB).toEqual([]);
      expect(aNadie).toEqual([]);
    });

    it('el aviso es SÓLO un aviso: nada de mesas, montos ni folios viaja por el socket', async () => {
      const s = await conectarComo(USUARIOS.visorA);
      await suscribir(s, { empresaId: FX.empresaA });
      const llega = siguienteAviso(s);
      await ingerir(KEYS.a1, [snapshot('rt-solo-aviso')]);
      const { aviso } = await llega;
      expect(Object.keys(aviso).sort()).toEqual(['cheques', 'mesas', 'sucursalId']);
    });

    it('volver a suscribir cambia de sala: la anterior deja de avisar', async () => {
      const s = await conectarComo(USUARIOS.visorA);
      await suscribir(s, { empresaId: FX.empresaA });
      expect(await suscribir(s, { empresaId: FX.empresaA, sucursalId: FX.sucursalA2 })).toEqual({
        ok: true,
      });
      const recibidos = anotar(s);
      await ingerir(KEYS.a1, [snapshot('rt-cambio')]);
      await esperar(SILENCIO_MS);
      expect(recibidos).toEqual([]);
    });

    it('una suscripción RECHAZADA no suelta la anterior', async () => {
      const s = await conectarComo(USUARIOS.visorA);
      await suscribir(s, { empresaId: FX.empresaA });
      expect(await suscribir(s, { empresaId: FX.empresaB })).toEqual({
        ok: false,
        error: 'No encontrado',
      });
      const llega = siguienteAviso(s);
      await ingerir(KEYS.a1, [snapshot('rt-sigue')]);
      expect((await llega).aviso.sucursalId).toBe(FX.sucursalA1);
    });

    it('lote sólo de heartbeat → sin aviso; otra empresa ingiere → A no se entera', async () => {
      const s = await conectarComo(USUARIOS.visorA);
      await suscribir(s, { empresaId: FX.empresaA });
      const recibidos = anotar(s);
      await ingerir(KEYS.a1, [{ id: 'hb', tipo: 'heartbeat', datos: { versionAgente: '0.1.0' } }]);
      await ingerir(KEYS.b1, [snapshot('rt-b')]);
      await esperar(SILENCIO_MS);
      expect(recibidos).toEqual([]);
    });

    it('reenviar el MISMO lote vuelve a avisar y deja los datos idénticos', async () => {
      const s = await conectarComo(USUARIOS.visorA);
      await suscribir(s, { empresaId: FX.empresaA });
      const recibidos = anotar(s);
      const lote = [snapshot('rt-reenvio')];
      const foto = async () =>
        JSON.stringify(
          await prisma.mesaSnapshot.findMany({
            where: { sucursalId: FX.sucursalA1 },
            orderBy: { id: 'asc' },
          }),
        );
      await ingerir(KEYS.a1, lote);
      const primera = await foto();
      await ingerir(KEYS.a1, lote);
      await ingerir(KEYS.a1, lote);
      await esperar(SILENCIO_MS);
      expect(await foto()).toBe(primera);
      expect(recibidos).toHaveLength(3);
    });
  });
});
