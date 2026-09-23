import { createHash } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, TipoAlerta } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { AlertasService } from '../alertas/alertas.service';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import { hashApiKey } from './api-key';

// E2E del auto-update del agente (F2-143) sobre la app REAL contra Postgres REAL, con el canal de
// versiones LOCAL (archivos falsos en disco temporal) y binarios de prueba sintéticos. Lo que
// necesita una PC con Windows (el watchdog, el swap, el rollback) lo prueban los tests del agente;
// la prueba en una máquina real es diurna (F1-020b).
//
// `versiones_agente` es de PLATAFORMA (sin empresa): esta suite es su única usuaria en la base de
// pruebas y la vacía antes de cada caso.

const KEYS = {
  a1: 'msr_sintetica-actualizacion-F2-143-sucursal-a1-000000001',
  a2: 'msr_sintetica-actualizacion-F2-143-sucursal-a2-000000002',
  b1: 'msr_sintetica-actualizacion-F2-143-sucursal-b1-000000003',
} as const;

const T0 = Date.parse('2026-09-23T18:00:00Z');

class RelojFijo extends Reloj {
  t = T0;
  override ahora(): number {
    return this.t;
  }
}

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

/** Un "agente.exe" de prueba: bytes deterministas y distintos por versión. */
function binario(version: string, tamano = 4096): Buffer {
  const b = Buffer.alloc(tamano);
  for (let i = 0; i < tamano; i++) b[i] = (i * 31 + version.charCodeAt(i % version.length)) % 256;
  return b;
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

interface Canal {
  disponible: boolean;
  version?: string;
  sha256?: string;
  tamanoBytes?: number;
  url?: string;
}

describe('Auto-update del agente (e2e, F2-143)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojFijo();
  let app: NestExpressApplication;
  let url: string;
  let alertas: AlertasService;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });

  async function publicar(version: string, cuerpo: Buffer, u: Usuario = USUARIOS.adminGlobal) {
    return request(url)
      .post(`/agente/versiones?version=${version}&notas=prueba`)
      .set('Authorization', `Bearer ${await token(u)}`)
      .set('Content-Type', 'application/octet-stream')
      .send(cuerpo);
  }

  async function bandera(sucursalId: string, activa: boolean, u: Usuario = USUARIOS.adminGlobal) {
    return request(url)
      .put(`/sucursales/${sucursalId}/actualizacion-automatica`)
      .set('Authorization', `Bearer ${await token(u)}`)
      .send({ activa });
  }

  async function canal(key: string): Promise<Canal> {
    const res = await request(url).get('/agente/version').set('X-Api-Key', key);
    expect(res.status).toBe(200);
    return res.body as Canal;
  }

  const reportar = (key: string, body: object) =>
    request(url).post('/agente/actualizacion').set('X-Api-Key', key).send(body);

  /** Descarga por el enlace del canal, como el agente: relativo a la URL base y SIN API key. */
  const descargar = (relativa: string) =>
    request(url)
      .get(`/${relativa}`)
      .buffer(true)
      .parse((res, cb) => {
        const partes: Buffer[] = [];
        res.on('data', (c: Buffer) => partes.push(c));
        res.on('end', () => cb(null, Buffer.concat(partes)));
      });

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    for (const [sucursal, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalA2, KEYS.a2],
      [FX.sucursalB1, KEYS.b1],
    ] as const) {
      await prisma.sucursal.update({
        where: { id: sucursal },
        data: { apiKeyHash: hashApiKey(key) },
      });
    }
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
    alertas = app.get(AlertasService);
  });

  beforeEach(async () => {
    reloj.t = T0;
    await prisma.versionAgente.deleteMany({});
    await prisma.agenteActualizacion.deleteMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
    });
    await prisma.agenteEstado.deleteMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
    });
    await prisma.alerta.deleteMany({ where: { empresaId: { in: [FX.empresaA, FX.empresaB] } } });
    await prisma.sucursal.updateMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
      data: { actualizacionAutomatica: false },
    });
  });

  afterAll(async () => {
    await prisma.versionAgente.deleteMany({});
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------------- canal
  describe('el canal respeta la bandera de rollout por sucursal', () => {
    it('sin bandera, o sin vigente, disponible = false y nada más', async () => {
      expect(await canal(KEYS.a1)).toEqual({ disponible: false });
      expect((await bandera(FX.sucursalA1, true)).status).toBe(200);
      expect(await canal(KEYS.a1)).toEqual({ disponible: false });
      expect((await publicar('1.1.0', binario('1.1.0'))).status).toBe(201);
      // A2 y B1 no tienen la bandera: no ven la versión aunque exista.
      expect(await canal(KEYS.a2)).toEqual({ disponible: false });
      expect(await canal(KEYS.b1)).toEqual({ disponible: false });
    });

    it('con bandera: la vigente, su SHA-256 y tamaño, y un enlace RELATIVO que baja esos bytes sin API key', async () => {
      const bin = binario('1.2.0', 10_000);
      await publicar('1.2.0', bin);
      await bandera(FX.sucursalA1, true);
      const c = await canal(KEYS.a1);
      expect(c).toEqual({
        disponible: true,
        version: '1.2.0',
        sha256: sha(bin),
        tamanoBytes: 10_000,
        url: expect.stringMatching(/^agente\/binario\/1\.2\.0\?expira=\d+&firma=[A-Za-z0-9_-]+$/),
      });
      const res = await descargar(c.url!);
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/octet-stream');
      expect(sha(res.body as Buffer)).toBe(c.sha256);
      expect((res.body as Buffer).length).toBe(10_000);
    });

    it('apagar la bandera deja de ofrecer la versión en la siguiente consulta', async () => {
      await publicar('1.3.0', binario('1.3.0'));
      await bandera(FX.sucursalA1, true);
      expect((await canal(KEYS.a1)).disponible).toBe(true);
      await bandera(FX.sucursalA1, false);
      expect(await canal(KEYS.a1)).toEqual({ disponible: false });
    });

    it('sin API key el canal es 401', async () => {
      expect((await request(url).get('/agente/version')).status).toBe(401);
    });
  });

  // ------------------------------------------------------------------------------- descarga
  describe('la descarga firmada: cualquier alteración es el MISMO 404', () => {
    it('firma alterada, otra versión con la misma firma, vencida, retirada: 404', async () => {
      await publicar('2.0.0', binario('2.0.0'));
      await publicar('2.0.1', binario('2.0.1'));
      await bandera(FX.sucursalA1, true);
      const c = await canal(KEYS.a1);
      expect(c.version).toBe('2.0.1');
      const u = new URL(c.url!, 'http://x/');
      const firma = u.searchParams.get('firma')!;
      const expira = u.searchParams.get('expira')!;
      const alterada = firma.slice(0, 10) + (firma[10] === 'Q' ? 'R' : 'Q') + firma.slice(11);

      const casos = [
        `agente/binario/2.0.1?expira=${expira}&firma=${alterada}`,
        `agente/binario/2.0.0?expira=${expira}&firma=${firma}`,
        `agente/binario/2.0.1?expira=${Number(expira) + 1}&firma=${firma}`,
        `agente/binario/9.9.9?expira=${expira}&firma=${firma}`,
        `agente/binario/..%2F..%2Fetc?expira=${expira}&firma=${firma}`,
      ];
      const cuerpos = new Set<string>();
      for (const ruta of casos) {
        const res = await request(url).get(`/${ruta}`);
        expect(res.status).toBe(404);
        cuerpos.add(JSON.stringify(res.body));
      }
      expect(cuerpos.size).toBe(1);

      // Vencida: 15 min + 1 s después.
      reloj.t = T0 + 15 * 60_000 + 1000;
      expect((await request(url).get(`/${c.url}`)).status).toBe(404);
      reloj.t = T0;
      // Retirada: ya no se sirve aunque el enlace sea bueno.
      expect((await request(url).get(`/${c.url}`)).status).toBe(200);
      await request(url)
        .post('/agente/versiones/2.0.1/retirar')
        .set('Authorization', `Bearer ${await token(USUARIOS.adminGlobal)}`);
      expect((await request(url).get(`/${c.url}`)).status).toBe(404);
    });
  });

  // ------------------------------------------------------------------------ administración
  describe('publicar, listar y retirar: sólo admin_global', () => {
    it('publicar calcula SHA y tamaño en el servidor; repetida 409; vacía, JSON o versión mala 400', async () => {
      const bin = binario('3.0.0', 777);
      const res = await publicar('3.0.0', bin);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        version: '3.0.0',
        sha256: sha(bin),
        tamanoBytes: 777,
        notas: 'prueba',
        retiradaAt: null,
        vigente: true,
      });
      expect((await publicar('3.0.0', binario('otra'))).status).toBe(409);
      expect((await publicar('3.0.1', Buffer.alloc(0))).status).toBe(400);
      expect((await publicar('3.0', binario('x'))).status).toBe(400);
      expect((await publicar('3.0.0-beta', binario('x'))).status).toBe(400);
      const json = await request(url)
        .post('/agente/versiones?version=3.0.2')
        .set('Authorization', `Bearer ${await token(USUARIOS.adminGlobal)}`)
        .send({ binario: 'no' });
      expect(json.status).toBe(400);
      expect(await prisma.versionAgente.count()).toBe(1);
    });

    it('más de 128 MB: 413 y no se publica nada', async () => {
      const res = await publicar('3.1.0', Buffer.alloc(128 * 1024 * 1024 + 1));
      expect(res.status).toBe(413);
      expect(await prisma.versionAgente.count()).toBe(0);
    });

    it('admin_empresa y visor: 403 en publicar, listar, retirar y la bandera', async () => {
      await publicar('3.2.0', binario('3.2.0'));
      for (const u of [USUARIOS.adminEmpresaA, USUARIOS.visorA]) {
        expect((await publicar('3.2.1', binario('3.2.1'), u)).status).toBe(403);
        const t = await token(u);
        expect(
          (await request(url).get('/agente/versiones').set('Authorization', `Bearer ${t}`)).status,
        ).toBe(403);
        expect(
          (
            await request(url)
              .post('/agente/versiones/3.2.0/retirar')
              .set('Authorization', `Bearer ${t}`)
          ).status,
        ).toBe(403);
        expect((await bandera(FX.sucursalA1, true, u)).status).toBe(403);
      }
      expect(await prisma.versionAgente.count()).toBe(1);
      const s = await prisma.sucursal.findUniqueOrThrow({ where: { id: FX.sucursalA1 } });
      expect(s.actualizacionAutomatica).toBe(false);
    });

    it('retirar la vigente es el rollback: la anterior vuelve a ser la vigente; idempotente; 404 si no existe', async () => {
      await publicar('4.0.0', binario('4.0.0'));
      reloj.t = T0 + 60_000;
      await publicar('4.1.0', binario('4.1.0'));
      await bandera(FX.sucursalA1, true);
      expect((await canal(KEYS.a1)).version).toBe('4.1.0');

      const t = await token(USUARIOS.adminGlobal);
      const r1 = await request(url)
        .post('/agente/versiones/4.1.0/retirar')
        .set('Authorization', `Bearer ${t}`);
      expect(r1.status).toBe(200);
      expect(r1.body).toMatchObject({ version: '4.1.0', vigente: false });
      const r2 = await request(url)
        .post('/agente/versiones/4.1.0/retirar')
        .set('Authorization', `Bearer ${t}`);
      expect(r2.status).toBe(200);
      expect(r2.body.retiradaAt).toBe(r1.body.retiradaAt);
      expect((await canal(KEYS.a1)).version).toBe('4.0.0');

      const lista = await request(url).get('/agente/versiones').set('Authorization', `Bearer ${t}`);
      expect(
        (lista.body as { version: string; vigente: boolean }[]).map((v) => [v.version, v.vigente]),
      ).toEqual([
        ['4.1.0', false],
        ['4.0.0', true],
      ]);
      expect(
        (
          await request(url)
            .post('/agente/versiones/9.9.9/retirar')
            .set('Authorization', `Bearer ${t}`)
        ).status,
      ).toBe(404);
    });

    it('la bandera: sucursal inexistente 404; el estado de agentes la refleja con la versión objetivo', async () => {
      expect((await bandera('f1430000-0000-4000-8000-00000000dead', true)).status).toBe(404);
      await publicar('5.0.0', binario('5.0.0'));
      const r = await bandera(FX.sucursalA1, true);
      expect(r.body).toEqual({ sucursalId: FX.sucursalA1, actualizacionAutomatica: true });
      const estado = await request(url)
        .get(`/agentes/estado?empresaId=${FX.empresaA}`)
        .set('Authorization', `Bearer ${await token(USUARIOS.adminEmpresaA)}`);
      expect(estado.status).toBe(200);
      const filas = estado.body as {
        sucursalId: string;
        actualizacionAutomatica: boolean;
        versionObjetivo: string | null;
        actualizacion: unknown;
      }[];
      const a1 = filas.find((f) => f.sucursalId === FX.sucursalA1)!;
      const a2 = filas.find((f) => f.sucursalId === FX.sucursalA2)!;
      expect(a1).toMatchObject({
        actualizacionAutomatica: true,
        versionObjetivo: '5.0.0',
        actualizacion: null,
      });
      expect(a2).toMatchObject({
        actualizacionAutomatica: false,
        versionObjetivo: null,
        actualizacion: null,
      });
      // Un admin de la empresa A no ve el estado de la empresa B: 404 (nunca 403).
      const ajeno = await request(url)
        .get(`/agentes/estado?empresaId=${FX.empresaB}`)
        .set('Authorization', `Bearer ${await token(USUARIOS.adminEmpresaA)}`);
      expect(ajeno.status).toBe(404);
    });
  });

  // ------------------------------------------------------------------------------ reportes
  describe('el reporte del agente: upsert por sucursal, idempotente, con su racha', () => {
    it('validación: fallida sin motivo, aplicada con motivo, versión mala o motivo desconocido: 400', async () => {
      for (const body of [
        { version: '1.0.0', resultado: 'fallida' },
        { version: '1.0.0', resultado: 'aplicada', motivo: 'descarga' },
        { version: '1.0', resultado: 'aplicada' },
        { version: '1.0.0', resultado: 'fallida', motivo: 'otro' },
        { version: '1.0.0', resultado: 'rara' },
        { version: '1.0.0', resultado: 'fallida', motivo: 'descarga', detalle: 'x'.repeat(501) },
        { version: '1.0.0', resultado: 'aplicada', sucursalId: FX.sucursalB1 },
      ]) {
        expect((await reportar(KEYS.a1, body)).status).toBe(400);
      }
      expect(await prisma.agenteActualizacion.count({ where: { empresaId: FX.empresaA } })).toBe(0);
    });

    it('reenviar el mismo reporte deja la misma fila y CONSERVA la racha; otra versión o aplicada la reinician', async () => {
      const falla = {
        version: '6.0.0',
        resultado: 'fallida',
        motivo: 'hash_invalido',
        detalle: 'SHA distinto',
      };
      expect((await reportar(KEYS.a1, falla)).status).toBe(204);
      reloj.t = T0 + 5 * 60_000;
      expect((await reportar(KEYS.a1, falla)).status).toBe(204);
      expect((await reportar(KEYS.a1, falla)).status).toBe(204);
      const filas = await prisma.agenteActualizacion.findMany({
        where: { empresaId: FX.empresaA },
      });
      expect(filas).toHaveLength(1);
      expect(filas[0]).toMatchObject({
        sucursalId: FX.sucursalA1,
        empresaId: FX.empresaA,
        resultado: 'fallida',
        version: '6.0.0',
        motivo: 'hash_invalido',
        detalle: 'SHA distinto',
      });
      expect(filas[0].primeraFallaAt?.getTime()).toBe(T0);
      expect(filas[0].reportadaAt.getTime()).toBe(T0 + 5 * 60_000);

      reloj.t = T0 + 6 * 60_000;
      await reportar(KEYS.a1, { ...falla, version: '6.0.1' });
      let f = await prisma.agenteActualizacion.findUniqueOrThrow({
        where: { sucursalId: FX.sucursalA1 },
      });
      expect(f.primeraFallaAt?.getTime()).toBe(T0 + 6 * 60_000);

      await reportar(KEYS.a1, { version: '6.0.1', resultado: 'aplicada' });
      f = await prisma.agenteActualizacion.findUniqueOrThrow({
        where: { sucursalId: FX.sucursalA1 },
      });
      expect(f).toMatchObject({
        resultado: 'aplicada',
        motivo: null,
        detalle: null,
        primeraFallaAt: null,
      });
      // Sólo la sucursal de la key: ninguna otra fila.
      expect(await prisma.agenteActualizacion.count({ where: { empresaId: FX.empresaB } })).toBe(0);
    });
  });

  // ------------------------------------------------------------------------------- alerta
  describe('hash inválido aborta y ALERTA', () => {
    const abiertas = (empresaId: string) =>
      prisma.alerta.findMany({
        where: { empresaId, tipo: TipoAlerta.actualizacion_fallida, cerradaAt: null },
      });

    it('una falla de la vigente con la bandera abre la alerta pasado el umbral y se cierra al aplicar', async () => {
      await publicar('7.0.0', binario('7.0.0'));
      await bandera(FX.sucursalA1, true);
      await reportar(KEYS.a1, {
        version: '7.0.0',
        resultado: 'fallida',
        motivo: 'hash_invalido',
        detalle: 'El binario descargado no tiene el SHA-256 del canal.',
      });
      // A la misma hora (racha de 0 s) todavía no: el umbral por defecto es MÁS de 1 min.
      await alertas.evaluarEmpresa(FX.empresaA);
      expect(await abiertas(FX.empresaA)).toHaveLength(0);

      reloj.t = T0 + 61_000;
      await alertas.evaluarEmpresa(FX.empresaA);
      const [a] = await abiertas(FX.empresaA);
      expect(a).toMatchObject({
        sucursalId: FX.sucursalA1,
        llave: '7.0.0',
        severidad: 'advertencia',
        umbral: 1,
        detalle: {
          version: '7.0.0',
          motivo: 'hash_invalido',
          detalle: 'El binario descargado no tiene el SHA-256 del canal.',
          minutos: 1,
        },
      });
      // Evaluar otra vez no duplica.
      await alertas.evaluarEmpresa(FX.empresaA);
      expect(await abiertas(FX.empresaA)).toHaveLength(1);
      expect(await abiertas(FX.empresaB)).toHaveLength(0);

      await reportar(KEYS.a1, { version: '7.0.0', resultado: 'aplicada' });
      await alertas.evaluarEmpresa(FX.empresaA);
      expect(await abiertas(FX.empresaA)).toHaveLength(0);
      const cerrada = await prisma.alerta.findFirstOrThrow({
        where: { empresaId: FX.empresaA, tipo: TipoAlerta.actualizacion_fallida },
      });
      expect(cerrada.motivoCierre).toBe('condicion');
    });

    it('no alerta sin bandera, ni por una falla de una versión que ya no es la vigente, ni si el heartbeat ya trae la vigente', async () => {
      await publicar('8.0.0', binario('8.0.0'));
      const falla = { version: '8.0.0', resultado: 'fallida', motivo: 'arranque' };
      await reportar(KEYS.a1, falla);
      reloj.t = T0 + 10 * 60_000;
      await alertas.evaluarEmpresa(FX.empresaA);
      expect(await abiertas(FX.empresaA)).toHaveLength(0);

      await bandera(FX.sucursalA1, true);
      await alertas.evaluarEmpresa(FX.empresaA);
      expect(await abiertas(FX.empresaA)).toHaveLength(1);

      // El heartbeat trae la vigente (con su +commit): ya no hay falla que alertar.
      await prisma.agenteEstado.create({
        data: { sucursalId: FX.sucursalA1, empresaId: FX.empresaA, versionAgente: '8.0.0+abc1234' },
      });
      await alertas.evaluarEmpresa(FX.empresaA);
      expect(await abiertas(FX.empresaA)).toHaveLength(0);

      // Una versión nueva publicada: la falla reportada era de la anterior.
      await prisma.agenteEstado.deleteMany({ where: { sucursalId: FX.sucursalA1 } });
      reloj.t = T0 + 11 * 60_000;
      await publicar('8.1.0', binario('8.1.0'));
      reloj.t = T0 + 20 * 60_000;
      await alertas.evaluarEmpresa(FX.empresaA);
      expect(await abiertas(FX.empresaA)).toHaveLength(0);
    });
  });
});
