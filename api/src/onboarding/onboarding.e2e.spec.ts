import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
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
import { configurarApp } from '../configurar-app';
import type { AltaGuiadaRespuestaDto, ArranqueDto } from './dto/onboarding.dto';

// E2E del onboarding (F2-147) sobre la app REAL contra Postgres REAL, con las fixtures
// sintéticas de F1-011. Las empresas que crea el alta guiada llevan el sufijo `SUFIJO` y se
// barren con `limpiarFixtures(prisma, creadas)`.

const SUFIJO = '(F2-147)';
const KEY_A1 = 'msr_key-sintetica-f2147-a1-000000000000000000';
const ZONA = 'America/Mexico_City';

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

function heartbeat(id: string) {
  return {
    id,
    tipo: 'heartbeat',
    datos: { versionAgente: '0.1.0', versionSr: '10.0', ultimaLecturaAt: null },
  };
}

function cheque(id: string, folioSr: string) {
  return {
    id,
    tipo: 'cheque',
    datos: {
      folioSr,
      folio: `T-${folioSr}`,
      abiertoAt: '2026-09-15T13:00:00.000-06:00',
      cerradoAt: '2026-09-15T14:00:00.000-06:00',
      mesa: '7',
      mesero: 'MESERO SINTETICO',
      comensales: 2,
      subtotal: '100.00',
      impuestos: '16.00',
      descuentos: '0',
      propina: '0',
      total: '116.00',
      cancelado: false,
      partidas: [
        { producto: 'Platillo sintético', cantidad: '1', precioUnit: '100.00', total: '100.00' },
      ],
      pagos: [{ formaRaw: 'EFECTIVO', monto: '116.00' }],
    },
  };
}

describe('Onboarding: alta guiada y checklist de arranque (e2e, F2-147)', () => {
  const prisma = new PrismaClient();
  const creadas: string[] = [];
  let app: NestExpressApplication;
  let url: string;
  let consecutivo = 0;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });

  async function alta(u: Usuario, cuerpo: object) {
    return request(url)
      .post('/empresas/alta-guiada')
      .set('Authorization', `Bearer ${await token(u)}`)
      .send(cuerpo);
  }

  async function arranque(u: Usuario, empresaId: string) {
    return request(url)
      .get(`/empresas/${empresaId}/arranque`)
      .set('Authorization', `Bearer ${await token(u)}`);
  }

  function lote(key: string, eventos: object[]) {
    return request(url).post('/ingesta/eventos').set('X-Api-Key', key).send({ eventos });
  }

  function paso(a: ArranqueDto, clave: string) {
    const p = a.pasos.find((x) => x.clave === clave);
    if (!p) throw new Error(`Falta el paso ${clave}`);
    return p;
  }

  function nombre(base: string): string {
    consecutivo += 1;
    return `${base} ${consecutivo} ${SUFIJO}`;
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterAll(async () => {
    await app.close();
    await limpiarFixtures(prisma, creadas);
    await prisma.$disconnect();
  });

  // -----------------------------------------------------------------------------------
  describe('POST /empresas/alta-guiada', () => {
    it('crea empresa + sucursales con key + admin en un paso, y cada key sirve al agente', async () => {
      const email = `f2147.admin.${Date.now()}${DOMINIO}`;
      const res = await alta(USUARIOS.adminGlobal, {
        nombre: `  ${nombre('Grupo Nuevo')}  `,
        sucursales: [
          { nombre: 'Centro', zonaHoraria: ZONA },
          { nombre: 'Norte', zonaHoraria: 'America/Monterrey' },
          { nombre: 'Playa', zonaHoraria: 'America/Cancun' },
        ],
        administrador: {
          nombre: 'Dueña Sintética',
          email: email.toUpperCase(),
          password: PASSWORD,
        },
      });
      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      const cuerpo = res.body as AltaGuiadaRespuestaDto;
      creadas.push(cuerpo.empresa.id);

      expect(cuerpo.empresa.nombre).toMatch(/^Grupo Nuevo \d+ \(F2-147\)$/);
      expect(cuerpo.empresa.activo).toBe(true);
      expect(cuerpo.sucursales.map((s) => [s.nombre, s.zonaHoraria])).toEqual([
        ['Centro', ZONA],
        ['Norte', 'America/Monterrey'],
        ['Playa', 'America/Cancun'],
      ]);
      expect(cuerpo.administrador).toMatchObject({
        email: email.toLowerCase(),
        rol: 'admin_empresa',
        empresaId: cuerpo.empresa.id,
        activo: true,
      });
      // Ni la contraseña ni su hash vuelven.
      expect(JSON.stringify(cuerpo)).not.toContain(PASSWORD);
      expect(JSON.stringify(cuerpo)).not.toMatch(/passwordHash|apiKeyHash/);

      // Keys distintas, y en la base sólo su hash.
      const keys = cuerpo.sucursales.map((s) => s.apiKey);
      expect(new Set(keys).size).toBe(3);
      const enBase = await prisma.sucursal.findMany({
        where: { empresaId: cuerpo.empresa.id },
        select: { id: true, apiKeyHash: true },
      });
      for (const s of cuerpo.sucursales) {
        expect(s.apiKey).toMatch(/^msr_/);
        expect(enBase.find((b) => b.id === s.id)?.apiKeyHash).toBe(hashApiKey(s.apiKey));
      }

      // Cada key identifica a SU sucursal ante el agente.
      for (const s of cuerpo.sucursales) {
        const yo = await request(url).get('/agente/yo').set('X-Api-Key', s.apiKey);
        expect(yo.status).toBe(200);
        expect(yo.body).toMatchObject({ sucursalId: s.id, nombre: s.nombre });
      }

      // Y el administrador entra con su contraseña.
      const login = await request(url).post('/auth/login').send({ email, password: PASSWORD });
      expect(login.status).toBe(200);
    });

    it('sin administrador también sirve (se crea después en Usuarios)', async () => {
      const res = await alta(USUARIOS.adminGlobal, {
        nombre: nombre('Sin admin'),
        sucursales: [{ nombre: 'Única', zonaHoraria: ZONA }],
      });
      expect(res.status).toBe(201);
      creadas.push((res.body as AltaGuiadaRespuestaDto).empresa.id);
      expect((res.body as AltaGuiadaRespuestaDto).administrador).toBeNull();
    });

    it('un email duplicado es 409 y NO deja nada creado (una sola transacción)', async () => {
      const antes = await prisma.empresa.count();
      const sucursalesAntes = await prisma.sucursal.count();
      const nombreEmpresa = nombre('Rollback');
      const res = await alta(USUARIOS.adminGlobal, {
        nombre: nombreEmpresa,
        sucursales: [
          { nombre: 'Uno', zonaHoraria: ZONA },
          { nombre: 'Dos', zonaHoraria: ZONA },
        ],
        administrador: { nombre: 'Repetido', email: USUARIOS.visorA.email, password: PASSWORD },
      });
      expect(res.status).toBe(409);
      expect(await prisma.empresa.count()).toBe(antes);
      expect(await prisma.sucursal.count()).toBe(sucursalesAntes);
      expect(await prisma.empresa.count({ where: { nombre: nombreEmpresa } })).toBe(0);
    });

    it.each([
      ['sin sucursales', { sucursales: [] }],
      ['zona que no es IANA', { sucursales: [{ nombre: 'X', zonaHoraria: '-06:00' }] }],
      [
        'dos sucursales con el mismo nombre (sin distinguir mayúsculas ni espacios)',
        {
          sucursales: [
            { nombre: 'Centro', zonaHoraria: ZONA },
            { nombre: '  centro ', zonaHoraria: ZONA },
          ],
        },
      ],
      [
        'contraseña corta',
        {
          sucursales: [{ nombre: 'X', zonaHoraria: ZONA }],
          administrador: { nombre: 'A', email: `corta${DOMINIO}`, password: 'corta' },
        },
      ],
      ['nombre vacío', { nombre: '   ', sucursales: [{ nombre: 'X', zonaHoraria: ZONA }] }],
    ])('%s es 400 y no crea nada', async (_caso, cambios) => {
      const antes = await prisma.empresa.count();
      const res = await alta(USUARIOS.adminGlobal, { nombre: nombre('Inválida'), ...cambios });
      expect(res.status).toBe(400);
      expect(await prisma.empresa.count()).toBe(antes);
    });

    it.each([
      ['admin_empresa', USUARIOS.adminEmpresaA],
      ['visor', USUARIOS.visorA],
    ])('%s recibe 403 por ruta y no crea nada', async (_rol, u) => {
      const antes = await prisma.empresa.count();
      const res = await alta(u, {
        nombre: nombre('Prohibida'),
        sucursales: [{ nombre: 'X', zonaHoraria: ZONA }],
      });
      expect(res.status).toBe(403);
      expect(await prisma.empresa.count()).toBe(antes);
    });

    it('sin token es 401', async () => {
      const res = await request(url)
        .post('/empresas/alta-guiada')
        .send({ nombre: nombre('Anónima'), sucursales: [{ nombre: 'X', zonaHoraria: ZONA }] });
      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------------------
  describe('GET /empresas/:id/arranque', () => {
    it('evoluciona con la empresa: llaves → agente (heartbeat) → ventas (cheque) → completo', async () => {
      const res = await alta(USUARIOS.adminGlobal, {
        nombre: nombre('Arranque'),
        sucursales: [
          { nombre: 'Centro', zonaHoraria: ZONA },
          { nombre: 'Norte', zonaHoraria: ZONA },
        ],
      });
      expect(res.status).toBe(201);
      const nueva = res.body as AltaGuiadaRespuestaDto;
      creadas.push(nueva.empresa.id);
      const [centro, norte] = nueva.sucursales;

      // Recién creada: sucursales y llaves hechas; agente, ventas y usuario pendientes.
      let a = (await arranque(USUARIOS.adminGlobal, nueva.empresa.id)).body as ArranqueDto;
      expect(a.completo).toBe(false);
      expect(a.pasos.map((p) => [p.clave, p.hecho])).toEqual([
        ['sucursales', true],
        ['llaves', true],
        ['agente', false],
        ['ventas', false],
        ['usuario', false],
      ]);
      expect(paso(a, 'agente').pendientes.map((p) => p.nombre)).toEqual(['Centro', 'Norte']);
      expect(paso(a, 'agente').detalle).toBe(
        'El agente todavía no se reporta en 2 de 2 sucursales.',
      );
      expect(a.descargaAgente).toBeNull();

      // Un lote SIN cheques (sólo heartbeat) registra el contacto: el agente de Centro se reportó,
      // pero las ventas siguen pendientes.
      expect((await lote(centro.apiKey, [heartbeat('h1')])).status).toBe(200);
      a = (await arranque(USUARIOS.adminGlobal, nueva.empresa.id)).body as ArranqueDto;
      expect(paso(a, 'agente').pendientes.map((p) => p.nombre)).toEqual(['Norte']);
      expect(paso(a, 'ventas').pendientes.map((p) => p.nombre)).toEqual(['Centro', 'Norte']);

      // Norte manda su primer cheque (el lote también cuenta como contacto).
      expect((await lote(norte.apiKey, [cheque('c1', 'F2147-1')])).status).toBe(200);
      expect((await lote(centro.apiKey, [cheque('c2', 'F2147-2')])).status).toBe(200);
      a = (await arranque(USUARIOS.adminGlobal, nueva.empresa.id)).body as ArranqueDto;
      expect(paso(a, 'agente').hecho).toBe(true);
      expect(paso(a, 'ventas').hecho).toBe(true);
      expect(paso(a, 'ventas').detalle).toBe('Ya llegan las cuentas de cada sucursal.');
      expect(a.completo).toBe(false);

      // Con un admin_empresa activo, completo.
      const usuario = await request(url)
        .post('/usuarios')
        .set('Authorization', `Bearer ${await token(USUARIOS.adminGlobal)}`)
        .send({
          email: `f2147.tarde.${Date.now()}${DOMINIO}`,
          nombre: 'Admin tardío',
          rol: 'admin_empresa',
          empresaId: nueva.empresa.id,
          password: PASSWORD,
        });
      expect(usuario.status).toBe(201);
      a = (await arranque(USUARIOS.adminGlobal, nueva.empresa.id)).body as ArranqueDto;
      expect(a.completo).toBe(true);

      // Una sucursal NUEVA sin key reabre el checklist: se deduce, no se guarda.
      const otra = await request(url)
        .post('/sucursales')
        .set('Authorization', `Bearer ${await token(USUARIOS.adminGlobal)}`)
        .send({ empresaId: nueva.empresa.id, nombre: 'Sur', zonaHoraria: ZONA });
      expect(otra.status).toBe(201);
      a = (await arranque(USUARIOS.adminGlobal, nueva.empresa.id)).body as ArranqueDto;
      expect(a.completo).toBe(false);
      expect(paso(a, 'llaves').pendientes.map((p) => p.nombre)).toEqual(['Sur']);
    });

    it('ventas sin agente reportado (como el seed) lo dice en vez de fingir que todo fluye', async () => {
      // Empresa A de las fixtures: sucursales SIN key ni contacto, pero A1 con un cheque metido
      // con una key temporal y luego sin contacto (así queda el seed: ventas sin agente).
      await prisma.sucursal.update({
        where: { id: FX.sucursalA1 },
        data: { apiKeyHash: hashApiKey(KEY_A1) },
      });
      await prisma.sucursal.update({
        where: { id: FX.sucursalA2 },
        data: { apiKeyHash: hashApiKey(`${KEY_A1}-a2`) },
      });
      expect((await lote(KEY_A1, [cheque('c3', 'F2147-A1')])).status).toBe(200);
      expect((await lote(`${KEY_A1}-a2`, [cheque('c4', 'F2147-A2')])).status).toBe(200);
      await prisma.agenteContacto.deleteMany({ where: { empresaId: FX.empresaA } });

      const a = (await arranque(USUARIOS.adminGlobal, FX.empresaA)).body as ArranqueDto;
      expect(paso(a, 'ventas').hecho).toBe(true);
      expect(paso(a, 'agente').hecho).toBe(false);
      expect(paso(a, 'ventas').detalle).toMatch(/nunca se ha reportado: son datos de demostración/);
      expect(a.completo).toBe(false);
    });

    it('scope: admin_global ve cualquiera; admin_empresa la suya y 404 en la ajena', async () => {
      expect((await arranque(USUARIOS.adminGlobal, FX.empresaB)).status).toBe(200);
      expect((await arranque(USUARIOS.adminEmpresaA, FX.empresaA)).status).toBe(200);
      const ajena = await arranque(USUARIOS.adminEmpresaA, FX.empresaB);
      const inexistente = await arranque(USUARIOS.adminEmpresaA, FX.inexistente);
      expect(ajena.status).toBe(404);
      expect(inexistente.status).toBe(404);
      expect(ajena.body).toEqual(inexistente.body);
    });

    it('visor: 403 por ruta, en la suya, en la ajena y en una inexistente (no distingue)', async () => {
      const propia = await arranque(USUARIOS.visorA, FX.empresaA);
      const ajena = await arranque(USUARIOS.visorA, FX.empresaB);
      const inexistente = await arranque(USUARIOS.visorA, FX.inexistente);
      for (const r of [propia, ajena, inexistente]) expect(r.status).toBe(403);
      expect(ajena.body).toEqual(inexistente.body);
    });

    it('una sucursal dada de baja no bloquea el arranque', async () => {
      const res = await alta(USUARIOS.adminGlobal, {
        nombre: nombre('Baja'),
        sucursales: [
          { nombre: 'Activa', zonaHoraria: ZONA },
          { nombre: 'Cerrada', zonaHoraria: ZONA },
        ],
      });
      const nueva = res.body as AltaGuiadaRespuestaDto;
      creadas.push(nueva.empresa.id);
      await prisma.sucursal.update({
        where: { id: nueva.sucursales[1].id },
        data: { activo: false },
      });
      const a = (await arranque(USUARIOS.adminGlobal, nueva.empresa.id)).body as ArranqueDto;
      expect(paso(a, 'agente').pendientes.map((p) => p.nombre)).toEqual(['Activa']);
    });

    it('`id` que no es UUID es 400', async () => {
      expect((await arranque(USUARIOS.adminGlobal, 'no-es-uuid')).status).toBe(400);
    });
  });
});
