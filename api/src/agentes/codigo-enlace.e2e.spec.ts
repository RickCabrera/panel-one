import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';
import { hashApiKey, PREFIJO_API_KEY } from './api-key';
import { hashCodigoEnlace, normalizarCodigoEnlace, VIGENCIA_ENLACE_MS } from './codigo-enlace';
import {
  LIMITES_ENLACE,
  LIMITES_ENLACE_POR_DEFECTO,
  MENSAJE_CORTACIRCUITO,
  MENSAJE_IP_BLOQUEADA,
  URL_PUBLICA_API,
  type LimitesEnlace,
} from './codigo-enlace.service';

const FALLOS_ENLACE_POR_IP = LIMITES_ENLACE_POR_DEFECTO.fallosPorIp;

// E2E del instalador de un clic sobre la app REAL (AppModule + configurarApp) contra Postgres
// REAL, con las fixtures sintéticas de F1-011. Cada bloque que cuenta límites levanta SU app:
// el storage del throttler y el de fallos son por instancia. `TRUST_PROXY_SALTOS=1` deja elegir
// la IP con `X-Forwarded-For`, como detrás de Caddy.

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

const URL_PUBLICA = 'https://monitor.ejemplo.test';
const CUERPO_404 = {
  statusCode: 404,
  error: 'Not Found',
  message: expect.stringContaining('ya se usó o ya venció') as unknown,
};

let siguienteIp = 1;
const ipNueva = () => `198.51.100.${siguienteIp++}`;

describe('Código de enlace del instalador de un clic (e2e)', () => {
  const prisma = new PrismaClient();
  const apps: INestApplication[] = [];

  async function app(
    urlPublica: string | null = URL_PUBLICA,
    limites: LimitesEnlace = LIMITES_ENLACE_POR_DEFECTO,
  ): Promise<INestApplication> {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(URL_PUBLICA_API)
      .useValue(urlPublica)
      .overrideProvider(LIMITES_ENLACE)
      .useValue(limites)
      .compile();
    const nueva = configurarApp(modulo.createNestApplication<NestExpressApplication>(), {
      TRUST_PROXY_SALTOS: '1',
    });
    await nueva.init();
    apps.push(nueva);
    return nueva;
  }

  async function emitir(a: INestApplication, sucursalId: string, u: Usuario) {
    const token = await a
      .get(TokensService)
      .firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
    return request(a.getHttpServer())
      .post(`/sucursales/${sucursalId}/codigo-enlace`)
      .set('Authorization', `Bearer ${token}`);
  }

  async function codigoDe(a: INestApplication, sucursalId: string): Promise<string> {
    const res = await emitir(a, sucursalId, USUARIOS.adminGlobal);
    expect(res.status).toBe(201);
    return res.body.codigo as string;
  }

  function canjear(a: INestApplication, codigo: unknown, ip = ipNueva()) {
    return request(a.getHttpServer())
      .post('/agente/enlace')
      .set('X-Forwarded-For', ip)
      .send({ codigo });
  }

  const hashKey = async (id: string) =>
    (await prisma.sucursal.findUniqueOrThrow({ where: { id } })).apiKeyHash;
  const filas = (sucursalId: string) =>
    prisma.codigoEnlace.findMany({ where: { sucursalId }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await prisma.codigoEnlace.deleteMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB, FX.empresaC] } },
    });
  });

  describe('POST /sucursales/:id/codigo-enlace', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    it('admin_empresa emite el de su sucursal: 201, formato K7P4-42XQ, 30 min, en la base sólo el hash, y la key vigente intacta', async () => {
      const antes = await hashKey(FX.sucursalA1);
      const res = await emitir(a, FX.sucursalA1, USUARIOS.adminEmpresaA);

      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual({
        sucursalId: FX.sucursalA1,
        codigo: expect.stringMatching(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/),
        expiraAt: expect.any(String),
        vigenciaSegundos: 1800,
      });
      const restante = Date.parse(res.body.expiraAt) - Date.now();
      expect(restante).toBeGreaterThan(VIGENCIA_ENLACE_MS - 60_000);
      expect(restante).toBeLessThanOrEqual(VIGENCIA_ENLACE_MS);

      const [fila, ...otras] = await filas(FX.sucursalA1);
      expect(otras).toHaveLength(0);
      expect(fila.codigoHash).toBe(hashCodigoEnlace(normalizarCodigoEnlace(res.body.codigo)));
      expect(JSON.stringify(fila)).not.toContain(normalizarCodigoEnlace(res.body.codigo));
      expect(fila.empresaId).toBe(FX.empresaA);
      expect(fila.creadoPor).toBe(USUARIOS.adminEmpresaA.id);
      expect(fila.usadoAt).toBeNull();
      // Emitir no rota la key: el agente que ya estaba sigue reportando hasta el canje.
      expect(await hashKey(FX.sucursalA1)).toBe(antes);
    });

    it('admin_empresa de A sobre una sucursal de B → 404 idéntico a una inexistente, sin crear nada', async () => {
      const deB = await emitir(a, FX.sucursalB1, USUARIOS.adminEmpresaA);
      const inexistente = await emitir(a, FX.inexistente, USUARIOS.adminEmpresaA);

      expect(deB.status).toBe(404);
      expect(inexistente.status).toBe(404);
      expect(deB.body).toEqual(inexistente.body);
      expect(await filas(FX.sucursalB1)).toHaveLength(0);
    });

    it('visor → 403 (depende de la ruta) y sin token → 401; id que no es UUID → 400', async () => {
      expect((await emitir(a, FX.sucursalA1, USUARIOS.visorA)).status).toBe(403);
      await request(a.getHttpServer())
        .post(`/sucursales/${FX.sucursalA1}/codigo-enlace`)
        .expect(401);
      expect((await emitir(a, 'no-es-uuid', USUARIOS.adminGlobal)).status).toBe(400);
      expect(await filas(FX.sucursalA1)).toHaveLength(0);
    });

    it('admin_global emite el de una sucursal de cualquier empresa', async () => {
      const res = await emitir(a, FX.sucursalB1, USUARIOS.adminGlobal);
      expect(res.status).toBe(201);
      expect((await filas(FX.sucursalB1))[0].empresaId).toBe(FX.empresaB);
    });

    it('emitir otro invalida el anterior sin usar: a lo más uno pendiente por sucursal', async () => {
      const primero = await codigoDe(a, FX.sucursalA2);
      const segundo = await codigoDe(a, FX.sucursalA2);

      expect(segundo).not.toBe(primero);
      expect(await filas(FX.sucursalA2)).toHaveLength(1);
      expect((await canjear(a, primero)).status).toBe(404);
      expect((await canjear(a, segundo)).status).toBe(200);
    });

    it('dos emisiones a la vez para la misma sucursal dejan UN solo código pendiente', async () => {
      const [r1, r2] = await Promise.all([
        emitir(a, FX.sucursalA1, USUARIOS.adminGlobal),
        emitir(a, FX.sucursalA1, USUARIOS.adminGlobal),
      ]);
      expect([r1.status, r2.status]).toEqual([201, 201]);
      expect(await filas(FX.sucursalA1)).toHaveLength(1);
    });

    it('sucursal dada de baja → 409 y sin código', async () => {
      await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { activo: false } });
      try {
        expect((await emitir(a, FX.sucursalA2, USUARIOS.adminEmpresaA)).status).toBe(409);
        expect(await filas(FX.sucursalA2)).toHaveLength(0);
      } finally {
        await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { activo: true } });
      }
    });
  });

  describe('POST /agente/enlace', () => {
    let a: INestApplication;
    beforeAll(async () => {
      a = await app();
    });

    it('cambia el código por una key NUEVA que sirve en /agente/yo; la anterior deja de servir; trae la URL pública', async () => {
      const keyVieja = (
        await request(a.getHttpServer())
          .post(`/sucursales/${FX.sucursalA1}/api-key`)
          .set(
            'Authorization',
            `Bearer ${await a.get(TokensService).firmarAccess({
              id: USUARIOS.adminGlobal.id,
              rol: USUARIOS.adminGlobal.rol,
              empresaId: null,
            })}`,
          )
      ).body.apiKey as string;
      const codigo = await codigoDe(a, FX.sucursalA1);

      const res = await canjear(a, codigo);

      expect(res.status).toBe(200);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body).toEqual({
        sucursalId: FX.sucursalA1,
        sucursal: expect.any(String),
        apiKey: expect.stringMatching(new RegExp(`^${PREFIJO_API_KEY}`)),
        apiUrl: URL_PUBLICA,
      });
      expect(await hashKey(FX.sucursalA1)).toBe(hashApiKey(res.body.apiKey));
      await request(a.getHttpServer())
        .get('/agente/yo')
        .set('X-Api-Key', res.body.apiKey)
        .expect(200)
        .expect((r) => expect(r.body.sucursalId).toBe(FX.sucursalA1));
      await request(a.getHttpServer()).get('/agente/yo').set('X-Api-Key', keyVieja).expect(401);

      const [fila] = await filas(FX.sucursalA1);
      expect(fila.usadoAt).not.toBeNull();
    });

    it('se quema al usarse: el segundo canje es 404 y no rota otra vez la key', async () => {
      const codigo = await codigoDe(a, FX.sucursalA2);
      const primera = await canjear(a, codigo);
      expect(primera.status).toBe(200);
      const hash = await hashKey(FX.sucursalA2);

      const segunda = await canjear(a, codigo);

      expect(segunda.status).toBe(404);
      expect(segunda.body).toEqual(CUERPO_404);
      expect(await hashKey(FX.sucursalA2)).toBe(hash);
    });

    it('dos canjes simultáneos del mismo código: sólo uno gana', async () => {
      const codigo = await codigoDe(a, FX.sucursalB1);
      const respuestas = await Promise.all([
        canjear(a, codigo),
        canjear(a, codigo),
        canjear(a, codigo),
      ]);
      const estados = respuestas.map((r) => r.status).sort();
      expect(estados).toEqual([200, 404, 404]);
      const ganadora = respuestas.find((r) => r.status === 200)!;
      expect(await hashKey(FX.sucursalB1)).toBe(hashApiKey(ganadora.body.apiKey));
    });

    it('acepta minúsculas, espacios y sin guión', async () => {
      const codigo = await codigoDe(a, FX.sucursalA1);
      const tecleado = ` ${codigo.slice(0, 4).toLowerCase()} ${codigo.slice(5).toLowerCase()} `;
      expect((await canjear(a, tecleado)).status).toBe(200);
    });

    it('vencido → el MISMO 404 que uno inexistente, y no cambia nada', async () => {
      const codigo = await codigoDe(a, FX.sucursalA1);
      await prisma.codigoEnlace.updateMany({
        where: { sucursalId: FX.sucursalA1 },
        data: {
          expiraAt: new Date(Date.now() - 1000),
          createdAt: new Date(Date.now() - 31 * 60_000),
        },
      });
      const antes = await hashKey(FX.sucursalA1);

      const vencido = await canjear(a, codigo);
      const inexistente = await canjear(a, 'ZZZZ-ZZZZ');

      expect(vencido.status).toBe(404);
      expect(inexistente.status).toBe(404);
      expect(vencido.body).toEqual(inexistente.body);
      expect(await hashKey(FX.sucursalA1)).toBe(antes);
      expect((await filas(FX.sucursalA1))[0].usadoAt).toBeNull();
    });

    it('sucursal o empresa dadas de baja → 404 y el código NO se quema', async () => {
      const codigo = await codigoDe(a, FX.sucursalA2);
      await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { activo: false } });
      try {
        expect((await canjear(a, codigo)).status).toBe(404);
        expect((await filas(FX.sucursalA2))[0].usadoAt).toBeNull();
      } finally {
        await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { activo: true } });
      }
      expect((await canjear(a, codigo)).status).toBe(200);
    });

    it('formato inválido → 400 sin buscar nada; sin código o con campos de más → 400', async () => {
      for (const malo of ['K7P-42X', 'K7P4-42XQQ', 'O0I1-1ABC', 'K7P4_42XQ']) {
        const res = await canjear(a, malo);
        expect(res.status).toBe(400);
        expect(res.body.message).toContain('8 letras y números');
      }
      expect((await canjear(a, undefined)).status).toBe(400);
      expect((await canjear(a, 1234567)).status).toBe(400);
      await request(a.getHttpServer())
        .post('/agente/enlace')
        .set('X-Forwarded-For', ipNueva())
        .send({ codigo: 'K7P4-42XQ', sucursalId: FX.sucursalB1 })
        .expect(400);
    });

    it('sin API_URL_PUBLICA devuelve apiUrl null', async () => {
      const sinUrl = await app(null);
      const codigo = await codigoDe(sinUrl, FX.sucursalA1);
      const res = await canjear(sinUrl, codigo);
      expect(res.status).toBe(200);
      expect(res.body.apiUrl).toBeNull();
    });
  });

  describe('límites', () => {
    it(`${FALLOS_ENLACE_POR_IP} códigos equivocados desde una IP → 429 para esa IP (aun con un código bueno), otras IPs siguen`, async () => {
      const a = await app();
      const ip = ipNueva();
      const bueno = await codigoDe(a, FX.sucursalA1);
      for (let i = 0; i < FALLOS_ENLACE_POR_IP; i++) {
        // Códigos distintos: cada uno en su cubo de código, para medir sólo el de fallos.
        const res = await canjear(a, `ZZZZ-ZZZ${'23456789ABCDEFGH'[i]}`, ip);
        expect(res.status).toBe(404);
      }
      const bloqueada = await canjear(a, bueno, ip);
      expect(bloqueada.status).toBe(429);
      expect(bloqueada.body.message).toBe(MENSAJE_IP_BLOQUEADA);
      expect((await filas(FX.sucursalA1))[0].usadoAt).toBeNull();
      expect((await canjear(a, bueno, ipNueva())).status).toBe(200);
    });

    it('los 400 de formato no cuentan como fallo', async () => {
      const a = await app();
      const ip = ipNueva();
      for (let i = 0; i < FALLOS_ENLACE_POR_IP + 2; i++) {
        expect((await canjear(a, `malo-${i}`, ip)).status).toBe(400);
      }
      expect((await canjear(a, await codigoDe(a, FX.sucursalA1), ip)).status).toBe(200);
    });

    it('5 intentos por código cada 15 min, de cualquier IP: el sexto → 429', async () => {
      const a = await app();
      for (let i = 0; i < 5; i++) {
        expect((await canjear(a, 'XYZW-2345', ipNueva())).status).toBe(404);
      }
      // El mismo código escrito distinto cae en el mismo cubo.
      expect((await canjear(a, 'xyzw2345', ipNueva())).status).toBe(429);
      expect((await canjear(a, 'XYZW-2346', ipNueva())).status).toBe(404);
    });

    it('IPv6: todo el /64 cuenta como UNA IP para los fallos; otro /64 sigue', async () => {
      const a = await app();
      const bueno = await codigoDe(a, FX.sucursalA1);
      for (let i = 0; i < FALLOS_ENLACE_POR_IP; i++) {
        // Una dirección distinta del mismo /64 en cada intento.
        const res = await canjear(
          a,
          `ZZZZ-YYY${'23456789ABCDEFGH'[i]}`,
          `2001:db8:aa:bb::${i + 1}`,
        );
        expect(res.status).toBe(404);
      }
      const mismoPrefijo = await canjear(a, bueno, '2001:db8:aa:bb:ffff:ffff:ffff:fffe');
      expect(mismoPrefijo.status).toBe(429);
      expect((await canjear(a, bueno, '2001:db8:aa:bc::1')).status).toBe(200);
    });

    it('cortacircuito GLOBAL: pasado el tope de fallos de todas las IPs, 429 para TODOS (aun con un código bueno), sin quemarlo', async () => {
      const a = await app(URL_PUBLICA, {
        fallosPorIp: 10,
        fallosGlobales: 4,
        ventanaMs: 60 * 60 * 1000,
      });
      const bueno = await codigoDe(a, FX.sucursalA2);
      for (let i = 0; i < 4; i++) {
        // Cada fallo desde otra IP: ninguna llega a su tope propio.
        expect((await canjear(a, `WWWW-WWW${'23456789'[i]}`, ipNueva())).status).toBe(404);
      }
      const res = await canjear(a, bueno, ipNueva());
      expect(res.status).toBe(429);
      expect(res.body.message).toBe(MENSAJE_CORTACIRCUITO);
      expect((await filas(FX.sucursalA2))[0].usadoAt).toBeNull();
      // Otra instancia (otra ventana) sí lo deja pasar: el código seguía vivo.
      expect((await canjear(await app(), bueno, ipNueva())).status).toBe(200);
    });

    it('20 por minuto por IP: el 21 → 429', async () => {
      const a = await app();
      const ip = ipNueva();
      for (let i = 0; i < 20; i++) {
        expect((await canjear(a, `x${i}`, ip)).status).toBe(400);
      }
      expect((await canjear(a, 'x-ultimo', ip)).status).toBe(429);
    });
  });
});
