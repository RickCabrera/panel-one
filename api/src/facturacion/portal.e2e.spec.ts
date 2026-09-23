import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import { logoSintetico } from '../../prisma/seed-facturacion';
import { MENSAJE_CODIGO_FORMATO, MENSAJE_CODIGO_NO_ENCONTRADO } from './codigos.service';
import { MENSAJE_EMISION_NO_DISPONIBLE } from './emision-portal';
import { MAX_BYTES_LOGO, MENSAJE_SLUG } from './portal';
import { MENSAJE_PORTAL_NO_ENCONTRADO } from './portal.service';

// E2E del portal público de autofactura (F2-103) sobre la app REAL contra Postgres REAL, con las
// fixtures sintéticas de F1-011. Cubre: la configuración por sucursal (admins, alcance, slug
// único, logo por sus bytes), las rutas públicas (marca, logo, código acotado a la empresa del
// portal con su desglose, estados sin datos), y el POST de facturas (orden de errores, campos en
// español, 409 por estado, 503 del puerto y que NO escribe nada). También el código en Tickets.
//
// TRUST_PROXY_SALTOS=1: cada petición pública lleva su propia IP en X-Forwarded-For, así los
// límites por IP no se cruzan entre pruebas; los tests de rate limit usan IPs fijas.

const KEYS = {
  a1: 'msr_sintetica-portal-F2-103-sucursal-a1-00000000001',
  a2: 'msr_sintetica-portal-F2-103-sucursal-a2-00000000002',
  b1: 'msr_sintetica-portal-F2-103-sucursal-b1-00000000003',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

class RelojControlado extends Reloj {
  t: number | null = null;
  ahora(): number {
    return this.t ?? Date.now();
  }
}

const CIERRE = '2026-09-15T14:00:00.000-06:00';
const FIN_DE_SEPTIEMBRE = '2026-10-01T06:00:00.000Z';
const EN_PLAZO = Date.parse('2026-09-20T12:00:00Z');

function cheque(id: string, folioSr: string, cambios: Record<string, unknown> = {}) {
  return {
    id,
    tipo: 'cheque',
    datos: {
      folioSr,
      folio: `T-${folioSr}`,
      abiertoAt: '2026-09-15T13:00:00.000-06:00',
      cerradoAt: CIERRE,
      mesa: 'MESA-SINTETICA',
      mesero: 'MESERO SINTETICO',
      comensales: 2,
      subtotal: '271.98',
      impuestos: '43.52',
      descuentos: '0',
      propina: '0',
      total: '315.50',
      cancelado: false,
      partidas: [
        { producto: 'Platillo sintético', cantidad: '2', precioUnit: '135.99', total: '271.98' },
      ],
      pagos: [{ formaRaw: 'EFECTIVO', monto: '315.50' }],
      ...cambios,
    },
  };
}

const RECEPTOR = {
  rfc: 'EKU9003173C9',
  razonSocial: 'ESCUELA KEMPER URGATE',
  regimenFiscal: '601',
  cp: '42501',
  usoCfdi: 'G03',
  email: 'facturas@ejemplo.test',
};

const SLUG_A1 = 'f2103-a1';
const SLUG_B1 = 'f2103-b1';

describe('Portal público de autofactura (e2e, F2-103)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojControlado();
  let app: NestExpressApplication;
  let url: string;
  const codigos: Record<string, string> = {};

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });

  async function lote(key: string, eventos: object[]) {
    const res = await request(url).post('/ingesta/eventos').set('X-Api-Key', key).send({ eventos });
    expect(res.status).toBe(200);
    expect(res.body.rechazados).toEqual([]);
  }

  let ips = 0;
  const ip = () => `10.3.${Math.floor(++ips / 250)}.${ips % 250}`;
  const publico = (ruta: string, desde = ip()) =>
    request(url).get(ruta).set('X-Forwarded-For', desde);
  const pedirFactura = (slug: string, body: object, desde = ip()) =>
    request(url)
      .post(`/facturacion/portal/${slug}/facturas`)
      .set('X-Forwarded-For', desde)
      .send(body);

  const guardarPortal = async (u: Usuario, sucursalId: string, body: object) =>
    request(url)
      .put(`/facturacion/portales/${sucursalId}`)
      .set('Authorization', `Bearer ${await token(u)}`)
      .send(body);
  const subirLogo = async (u: Usuario, sucursalId: string, bytes: Buffer) =>
    request(url)
      .put(`/facturacion/portales/${sucursalId}/logo`)
      .set('Authorization', `Bearer ${await token(u)}`)
      .send({ contenidoBase64: bytes.toString('base64') });

  const codigoDe = async (folioSr: string, sucursalId: string) =>
    (
      await prisma.codigoFacturacion.findFirstOrThrow({
        where: { cheque: { sucursalId, folioSr } },
      })
    ).codigo;

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    for (const [id, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalA2, KEYS.a2],
      [FX.sucursalB1, KEYS.b1],
    ]) {
      await prisma.sucursal.update({ where: { id }, data: { apiKeyHash: hashApiKey(key) } });
    }
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>(), {
      TRUST_PROXY_SALTOS: '1',
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    await lote(KEYS.a1, [
      cheque('p1', 'POR-PEND'),
      // Descuento: subtotal + impuestos no suman el total (315.50 - 20 = 295.50).
      cheque('p2', 'POR-NO-CUADRA', { descuentos: '20.00', total: '295.50' }),
      cheque('p3', 'POR-FACT'),
    ]);
    await lote(KEYS.a2, [cheque('p4', 'POR-A2')]);
    await lote(KEYS.b1, [cheque('p5', 'POR-B1')]);
    codigos.pend = await codigoDe('POR-PEND', FX.sucursalA1);
    codigos.noCuadra = await codigoDe('POR-NO-CUADRA', FX.sucursalA1);
    codigos.fact = await codigoDe('POR-FACT', FX.sucursalA1);
    codigos.a2 = await codigoDe('POR-A2', FX.sucursalA2);
    codigos.b1 = await codigoDe('POR-B1', FX.sucursalB1);
    await prisma.codigoFacturacion.updateMany({
      where: { codigo: codigos.fact },
      data: { estado: 'facturado' },
    });

    expect(
      (
        await guardarPortal(USUARIOS.adminEmpresaA, FX.sucursalA1, {
          slug: SLUG_A1,
          color: '#0F766E',
          activo: true,
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await guardarPortal(USUARIOS.adminGlobal, FX.sucursalB1, {
          slug: SLUG_B1,
          color: '#9333ea',
          activo: true,
        })
      ).status,
    ).toBe(200);
  });

  beforeEach(() => {
    reloj.t = EN_PLAZO;
  });

  afterAll(async () => {
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------------------------
  describe('configuración del portal (admins)', () => {
    it('lista las sucursales de la empresa con su portal; el color se guardó en minúsculas', async () => {
      const res = await request(url)
        .get('/facturacion/portales')
        .query({ empresaId: FX.empresaA })
        .set('Authorization', `Bearer ${await token(USUARIOS.adminEmpresaA)}`);
      expect(res.status).toBe(200);
      const a1 = res.body.find((s: { sucursalId: string }) => s.sucursalId === FX.sucursalA1);
      const a2 = res.body.find((s: { sucursalId: string }) => s.sucursalId === FX.sucursalA2);
      expect(a1).toMatchObject({
        sucursal: 'A1',
        sucursalActiva: true,
        portal: { slug: SLUG_A1, color: '#0f766e', activo: true, tieneLogo: false },
      });
      expect(a2.portal).toBeNull();
      // Nada de la empresa B.
      expect(res.text).not.toContain(SLUG_B1);
    });

    it('404 (no 403) para una sucursal o empresa ajenas, con el mismo cuerpo que una inexistente', async () => {
      const ajena = await guardarPortal(USUARIOS.adminEmpresaA, FX.sucursalB1, {
        slug: 'otro-slug',
        color: '#000000',
        activo: true,
      });
      const inexistente = await guardarPortal(USUARIOS.adminEmpresaA, FX.inexistente, {
        slug: 'otro-slug',
        color: '#000000',
        activo: true,
      });
      expect(ajena.status).toBe(404);
      expect(ajena.body).toEqual(inexistente.body);
      // Alcance ANTES que el formato: un slug inválido en sucursal ajena también es 404.
      const invalido = await guardarPortal(USUARIOS.adminEmpresaA, FX.sucursalB1, {
        slug: 'X',
        color: 'rojo',
        activo: true,
      });
      expect(invalido.status).toBe(404);
      const logo = await subirLogo(USUARIOS.adminEmpresaA, FX.sucursalB1, Buffer.from('nada'));
      expect(logo.status).toBe(404);
      const lista = await request(url)
        .get('/facturacion/portales')
        .query({ empresaId: FX.empresaB })
        .set('Authorization', `Bearer ${await token(USUARIOS.adminEmpresaA)}`);
      expect(lista.status).toBe(404);
      // Nada cambió en el portal de B.
      const b1 = await prisma.portalFacturacion.findFirstOrThrow({
        where: { sucursalId: FX.sucursalB1 },
      });
      expect(b1).toMatchObject({ slug: SLUG_B1, color: '#9333ea', logo: null });
    });

    it('403 para el visor y 401 sin token', async () => {
      const visor = await guardarPortal(USUARIOS.visorA, FX.sucursalA1, {
        slug: SLUG_A1,
        color: '#000000',
        activo: true,
      });
      expect(visor.status).toBe(403);
      const lista = await request(url)
        .get('/facturacion/portales')
        .query({ empresaId: FX.empresaA })
        .set('Authorization', `Bearer ${await token(USUARIOS.visorA)}`);
      expect(lista.status).toBe(403);
      const sin = await request(url)
        .put(`/facturacion/portales/${FX.sucursalA1}`)
        .send({ slug: SLUG_A1, color: '#000000', activo: true });
      expect(sin.status).toBe(401);
    });

    it('400 por slug o color inválidos; 409 si el slug ya lo usa OTRO portal (de otra empresa)', async () => {
      const malo = await guardarPortal(USUARIOS.adminEmpresaA, FX.sucursalA2, {
        slug: 'Demo_Norte',
        color: '#12',
        activo: true,
      });
      expect(malo.status).toBe(400);
      expect(malo.body.message).toEqual([
        MENSAJE_SLUG,
        'El color va como #rrggbb (p. ej. #0f766e).',
      ]);
      const ocupado = await guardarPortal(USUARIOS.adminEmpresaA, FX.sucursalA2, {
        slug: SLUG_B1,
        color: '#123456',
        activo: true,
      });
      expect(ocupado.status).toBe(409);
      expect(ocupado.body.message).toMatch(/ya lo usa otro portal/);
      expect(await prisma.portalFacturacion.count({ where: { sucursalId: FX.sucursalA2 } })).toBe(
        0,
      );
    });

    it('el logo: 409 sin portal; SVG, GIF y > 200 KB rechazados; PNG aceptado y se puede quitar', async () => {
      const png = logoSintetico('#0f766e');
      const sinPortal = await subirLogo(USUARIOS.adminEmpresaA, FX.sucursalA2, png);
      expect(sinPortal.status).toBe(409);

      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>x()</script></svg>');
      for (const malo of [svg, Buffer.from('GIF89a......'), Buffer.alloc(0)]) {
        const res = await subirLogo(USUARIOS.adminEmpresaA, FX.sucursalA1, malo);
        expect(res.status).toBe(400);
      }
      // Un PNG de 200 KB + 1 byte: el DTO ya lo rechaza por el largo del base64 o el servicio
      // por los bytes; en ningún caso llega a la base.
      const grande = Buffer.concat([png, Buffer.alloc(MAX_BYTES_LOGO + 1 - png.length)]);
      expect((await subirLogo(USUARIOS.adminEmpresaA, FX.sucursalA1, grande)).status).toBe(400);
      expect(
        (await prisma.portalFacturacion.findFirstOrThrow({ where: { sucursalId: FX.sucursalA1 } }))
          .logo,
      ).toBeNull();

      const ok = await subirLogo(USUARIOS.adminEmpresaA, FX.sucursalA1, png);
      expect(ok.status).toBe(200);
      expect(ok.body.portal.tieneLogo).toBe(true);

      const logo = await publico(`/facturacion/portal/${SLUG_A1}/logo`).buffer(true);
      expect(logo.status).toBe(200);
      expect(logo.headers['content-type']).toBe('image/png');
      expect(logo.headers['x-content-type-options']).toBe('nosniff');
      expect(logo.headers['content-security-policy']).toBe("default-src 'none'");
      expect(Buffer.compare(logo.body as Buffer, png)).toBe(0);

      const quitar = await request(url)
        .delete(`/facturacion/portales/${FX.sucursalA1}/logo`)
        .set('Authorization', `Bearer ${await token(USUARIOS.adminEmpresaA)}`);
      expect(quitar.status).toBe(200);
      expect(quitar.body.portal.tieneLogo).toBe(false);
      expect((await publico(`/facturacion/portal/${SLUG_A1}/logo`)).status).toBe(404);
      // Se deja puesto para las pruebas públicas.
      expect((await subirLogo(USUARIOS.adminEmpresaA, FX.sucursalA1, png)).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('GET /facturacion/portal/:slug y su logo (públicas)', () => {
    it('la marca del portal, sin sesión: sucursal, color, logo y que hoy NO puede emitir', async () => {
      const res = await publico(`/facturacion/portal/${SLUG_A1}`);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        slug: SLUG_A1,
        sucursal: 'A1',
        color: '#0f766e',
        logoUrl: `/facturacion/portal/${SLUG_A1}/logo`,
        emisionDisponible: false,
      });
      // Sin ids internos.
      expect(res.text).not.toContain(FX.empresaA);
      expect(res.text).not.toContain(FX.sucursalA1);
    });

    it('inexistente, con forma inválida, portal inactivo, sucursal o empresa de baja: el MISMO 404 (marca y logo)', async () => {
      const inexistente = await publico('/facturacion/portal/no-existe-f2103');
      expect(inexistente.status).toBe(404);
      expect(inexistente.body).toMatchObject({ message: MENSAJE_PORTAL_NO_ENCONTRADO });
      expect((await publico('/facturacion/portal/NO_VALIDO')).body).toEqual(inexistente.body);
      const logoInexistente = await publico('/facturacion/portal/no-existe-f2103/logo');
      expect(logoInexistente.status).toBe(404);

      for (const [baja, alta] of [
        [
          () =>
            prisma.portalFacturacion.updateMany({
              where: { sucursalId: FX.sucursalA1 },
              data: { activo: false },
            }),
          () =>
            prisma.portalFacturacion.updateMany({
              where: { sucursalId: FX.sucursalA1 },
              data: { activo: true },
            }),
        ],
        [
          () => prisma.sucursal.update({ where: { id: FX.sucursalA1 }, data: { activo: false } }),
          () => prisma.sucursal.update({ where: { id: FX.sucursalA1 }, data: { activo: true } }),
        ],
        [
          () => prisma.empresa.update({ where: { id: FX.empresaA }, data: { activo: false } }),
          () => prisma.empresa.update({ where: { id: FX.empresaA }, data: { activo: true } }),
        ],
      ] as const) {
        await baja();
        try {
          for (const ruta of ['', '/logo', `/codigo/${codigos.pend}`]) {
            const res = await publico(`/facturacion/portal/${SLUG_A1}${ruta}`);
            expect(res.status).toBe(404);
            expect(res.body).toEqual(inexistente.body);
          }
          const post = await pedirFactura(SLUG_A1, { codigo: codigos.pend, receptor: RECEPTOR });
          expect(post.status).toBe(404);
          expect(post.body).toEqual(inexistente.body);
        } finally {
          await alta();
        }
      }
      expect((await publico(`/facturacion/portal/${SLUG_A1}`)).status).toBe(200);
    });

    it('un portal sin logo: logoUrl null y la ruta del logo 404', async () => {
      const res = await publico(`/facturacion/portal/${SLUG_B1}`);
      expect(res.body.logoUrl).toBeNull();
      expect((await publico(`/facturacion/portal/${SLUG_B1}/logo`)).status).toBe(404);
    });

    it('los catálogos del SAT son públicos: regímenes y usos con sus regímenes', async () => {
      const res = await publico('/facturacion/catalogos-sat');
      expect(res.status).toBe(200);
      expect(res.body.regimenesFiscales).toContainEqual(
        expect.objectContaining({ clave: '601', moral: true, fisica: false }),
      );
      const g03 = res.body.usosCfdi.find((u: { clave: string }) => u.clave === 'G03');
      expect(g03.regimenes).toContain('601');
      expect(g03.regimenes).not.toContain('605');
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('GET /facturacion/portal/:slug/codigo/:codigo (pública)', () => {
    const consultar = (slug: string, codigo: string, desde?: string) =>
      publico(`/facturacion/portal/${slug}/codigo/${encodeURIComponent(codigo)}`, desde);

    it('pendiente: datos no sensibles del ticket y el desglose que suma el total', async () => {
      const res = await consultar(SLUG_A1, codigos.pend);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        codigo: codigos.pend,
        estado: 'pendiente',
        mensaje: 'El ticket se puede facturar.',
        ticket: {
          sucursal: 'A1',
          fecha: '2026-09-15T20:00:00.000Z',
          zonaHoraria: 'America/Mexico_City',
          total: '315.50',
          expiraAt: FIN_DE_SEPTIEMBRE,
          desglose: { subtotal: '271.98', impuestos: '43.52' },
        },
      });
      for (const dato of ['T-POR-PEND', 'MESA-SINTETICA', 'MESERO', 'Platillo', 'EFECTIVO']) {
        expect(res.text).not.toContain(dato);
      }
      expect(res.text).not.toContain(FX.sucursalA1);
    });

    it('un desglose que NO suma el total (hay descuento) no se muestra: sólo el total', async () => {
      const res = await consultar(SLUG_A1, codigos.noCuadra);
      expect(res.body.ticket.total).toBe('295.50');
      expect(res.body.ticket.desglose).toBeNull();
      expect(res.text).not.toContain('271.98');
    });

    it('un código de OTRA sucursal de la MISMA empresa sí se puede consultar', async () => {
      const res = await consultar(SLUG_A1, codigos.a2);
      expect(res.status).toBe(200);
      expect(res.body.ticket.sucursal).toBe('A2');
    });

    it('un código de OTRA empresa: el mismo 404 que uno que no existe', async () => {
      const ajeno = await consultar(SLUG_A1, codigos.b1);
      const inexistente = await consultar(SLUG_A1, 'ZZZZZZZZZ');
      expect(ajeno.status).toBe(404);
      expect(ajeno.body).toEqual(inexistente.body);
      expect(ajeno.body).toMatchObject({ message: MENSAJE_CODIGO_NO_ENCONTRADO });
      // Y al revés: el portal de B no ve los de A.
      expect((await consultar(SLUG_B1, codigos.pend)).status).toBe(404);
      expect((await consultar(SLUG_B1, codigos.b1)).status).toBe(200);
    });

    it('formato inválido: 400; minúsculas y espacios se normalizan', async () => {
      const malo = await consultar(SLUG_A1, '7JQRECP3O');
      expect(malo.status).toBe(400);
      expect(malo.body.message).toEqual([MENSAJE_CODIGO_FORMATO]);
      const minus = await consultar(SLUG_A1, ` ${codigos.pend.toLowerCase()} `);
      expect(minus.body.codigo).toBe(codigos.pend);
    });

    it('facturado, expirado y cancelado: sólo el estado y su mensaje, sin datos del ticket', async () => {
      const fact = await consultar(SLUG_A1, codigos.fact);
      expect(fact.body).toEqual({
        codigo: codigos.fact,
        estado: 'facturado',
        mensaje: 'Este ticket ya fue facturado.',
        ticket: null,
      });
      reloj.t = Date.parse(FIN_DE_SEPTIEMBRE);
      const exp = await consultar(SLUG_A1, codigos.pend);
      expect(exp.body).toMatchObject({ estado: 'expirado', ticket: null });
      for (const r of [fact, exp]) {
        expect(r.text).not.toContain('315.50');
        expect(r.text).not.toContain('A1');
      }
    });

    it('rate limit: 10 por minuto por IP (el mismo cubo que la consulta de F2-101)', async () => {
      for (let i = 0; i < 10; i++) {
        expect((await consultar(SLUG_A1, codigos.pend, '203.0.113.30')).status).toBe(200);
      }
      expect((await consultar(SLUG_A1, codigos.pend, '203.0.113.30')).status).toBe(429);
      expect((await consultar(SLUG_A1, codigos.pend, '203.0.113.31')).status).toBe(200);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('POST /facturacion/portal/:slug/facturas (pública)', () => {
    /** Todo lo que el POST podría llegar a tocar: tiene que quedar idéntico. */
    const foto = async () =>
      JSON.stringify({
        codigos: await prisma.codigoFacturacion.findMany({
          where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
          orderBy: { codigo: 'asc' },
        }),
        receptores: await prisma.receptorFrecuente.findMany({
          where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
          orderBy: { rfc: 'asc' },
        }),
        perfiles: await prisma.perfilFiscal.findMany({
          where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
        }),
        portales: await prisma.portalFacturacion.findMany({
          where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
          orderBy: { slug: 'asc' },
          select: { slug: true, color: true, activo: true, updatedAt: true },
        }),
      });

    it('datos válidos de un código pendiente: 503 con el mensaje honesto, y NO escribe nada', async () => {
      const antes = await foto();
      const res = await pedirFactura(SLUG_A1, {
        codigo: ` ${codigos.pend.toLowerCase()} `,
        receptor: { ...RECEPTOR, rfc: ' eku9003173c9 ' },
      });
      expect(res.status).toBe(503);
      expect(res.body).toMatchObject({ statusCode: 503, message: MENSAJE_EMISION_NO_DISPONIBLE });
      expect(await foto()).toBe(antes);
    });

    it('datos del receptor inválidos: 400 con un mensaje en español POR CAMPO, y no escribe', async () => {
      const antes = await foto();
      const res = await pedirFactura(SLUG_A1, {
        codigo: codigos.pend,
        receptor: {
          rfc: 'XAXX010101000',
          razonSocial: ' ',
          regimenFiscal: '999',
          cp: '123',
          usoCfdi: 'P01',
          email: 'no-es-correo',
        },
      });
      expect(res.status).toBe(400);
      expect(Object.keys(res.body.campos).sort()).toEqual(
        ['cp', 'email', 'razonSocial', 'regimenFiscal', 'rfc', 'usoCfdi'].sort(),
      );
      expect(res.body.campos.rfc).toMatch(/público en general/);
      expect(res.body.campos.cp).toMatch(/5 dígitos/);
      expect(res.body.message).toEqual(Object.values(res.body.campos));
      expect(await foto()).toBe(antes);

      const regimen = await pedirFactura(SLUG_A1, {
        codigo: codigos.pend,
        receptor: { ...RECEPTOR, regimenFiscal: '612' },
      });
      expect(regimen.body.campos).toEqual({
        regimenFiscal: 'Ese régimen es de persona física y tu RFC es de empresa (persona moral).',
      });
    });

    it('orden de errores: portal (404) → formato (400) → código de la empresa (404) → estado (409) → receptor (400)', async () => {
      const receptorMalo = { ...RECEPTOR, cp: 'x' };
      const sinPortal = await pedirFactura('no-existe-f2103', {
        codigo: 'basura',
        receptor: receptorMalo,
      });
      expect(sinPortal.status).toBe(404);
      expect(sinPortal.body.message).toBe(MENSAJE_PORTAL_NO_ENCONTRADO);

      const formato = await pedirFactura(SLUG_A1, { codigo: 'basura', receptor: receptorMalo });
      expect(formato.status).toBe(400);
      expect(formato.body.message).toEqual([MENSAJE_CODIGO_FORMATO]);
      expect(formato.body.campos).toBeUndefined();

      const ajeno = await pedirFactura(SLUG_A1, { codigo: codigos.b1, receptor: receptorMalo });
      expect(ajeno.status).toBe(404);
      expect(ajeno.body.message).toBe(MENSAJE_CODIGO_NO_ENCONTRADO);

      const facturado = await pedirFactura(SLUG_A1, {
        codigo: codigos.fact,
        receptor: receptorMalo,
      });
      expect(facturado.status).toBe(409);
      expect(facturado.body).toEqual({
        statusCode: 409,
        error: 'Conflict',
        message: 'Este ticket ya fue facturado.',
        estado: 'facturado',
      });

      reloj.t = Date.parse(FIN_DE_SEPTIEMBRE);
      const expirado = await pedirFactura(SLUG_A1, { codigo: codigos.pend, receptor: RECEPTOR });
      expect(expirado.status).toBe(409);
      expect(expirado.body.estado).toBe('expirado');
    });

    it('cuerpo mal formado (sin receptor, campos que no son texto o de más): 400 de validación', async () => {
      expect((await pedirFactura(SLUG_A1, { codigo: codigos.pend })).status).toBe(400);
      expect(
        (
          await pedirFactura(SLUG_A1, {
            codigo: codigos.pend,
            receptor: { ...RECEPTOR, cp: 42501 },
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await pedirFactura(SLUG_A1, {
            codigo: codigos.pend,
            receptor: RECEPTOR,
            empresaId: FX.empresaB,
          })
        ).status,
      ).toBe(400);
    });

    it('rate limit: 5 por minuto por IP; la 6.ª es 429 y otra IP sigue', async () => {
      for (let i = 0; i < 5; i++) {
        const res = await pedirFactura(
          SLUG_A1,
          { codigo: codigos.pend, receptor: RECEPTOR },
          '203.0.113.40',
        );
        expect(res.status).toBe(503);
      }
      expect(
        (await pedirFactura(SLUG_A1, { codigo: codigos.pend, receptor: RECEPTOR }, '203.0.113.40'))
          .status,
      ).toBe(429);
      expect(
        (await pedirFactura(SLUG_A1, { codigo: codigos.pend, receptor: RECEPTOR }, '203.0.113.41'))
          .status,
      ).toBe(503);
    });
  });

  // ---------------------------------------------------------------------------------------------
  it('Tickets: cada ticket trae su código de facturación con el estado público', async () => {
    const res = await request(url)
      .get('/ventas/tickets')
      .query({ empresaId: FX.empresaA, desde: '2026-09-15', hasta: '2026-09-15' })
      .set('Authorization', `Bearer ${await token(USUARIOS.visorA)}`);
    expect(res.status).toBe(200);
    const porFolio = new Map(
      (res.body.items as { folio: string; codigoFacturacion: unknown }[]).map((t) => [
        t.folio,
        t.codigoFacturacion,
      ]),
    );
    expect(porFolio.get('T-POR-PEND')).toEqual({
      codigo: codigos.pend,
      estado: 'pendiente',
      mensaje: 'El ticket se puede facturar.',
    });
    expect(porFolio.get('T-POR-FACT')).toMatchObject({ codigo: codigos.fact, estado: 'facturado' });
    // Los de la empresa B no aparecen.
    expect(res.text).not.toContain(codigos.b1);
  });
});
