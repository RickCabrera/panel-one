import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, RolUsuario } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, DOMINIO, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { PUERTO_ARCHIVOS, PUERTO_CORREO, PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import {
  ArchivosDisco,
  SECRETO_ARCHIVOS_FALSO,
  URL_BASE_ARCHIVOS_FALSO,
} from '../adaptadores/archivos/archivos-disco';
import type { PuertoArchivos } from '../adaptadores/archivos/puerto';
import { CorreoBrevo } from '../adaptadores/correo/correo-brevo';
import { CorreoFalso } from '../adaptadores/correo/correo-falso';
import type { PuertoCorreo } from '../adaptadores/correo/puerto';
import type { ClienteHttp, PeticionHttp } from '../adaptadores/http';
import { TimbradoFalso } from '../adaptadores/timbrado/timbrado-falso';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import { MENSAJE_SIN_ENVIO_QUE_REINTENTAR } from '../scope/escritura-facturacion';
import { Espera } from './cfdi.service';
import { MENSAJE_SIN_ARCHIVOS } from './entrega.service';

// E2E de la entrega de facturas (F2-105) sobre la app REAL contra Postgres REAL, con el PAC falso,
// los archivos en un disco temporal (la implementación de las dos variantes) y el correo falso
// (su bandeja `correos_enviados`), cada uno envuelto para poder hacerlo fallar. Cubre el AC
// nocturno: XML y PDF en la ruta correcta que sobreviven un reinicio, el correo con ambos adjuntos
// y su plantilla, y una falla del correo que queda para reintento sin quitarle la descarga al
// portal. Más el scope y los roles de cada endpoint nuevo.

const KEYS = {
  a1: 'msr_sintetica-entrega-F2-105-sucursal-a1-00000000001',
  b1: 'msr_sintetica-entrega-F2-105-sucursal-b1-00000000003',
} as const;
/** Una api key SINTÉTICA de Brevo: no debe aparecer nunca en la bitácora de envíos. */
const API_KEY_BREVO = 'xkeysib-sintetica-F2-105-0000000000000000000000000000';

class RelojControlado extends Reloj {
  t: number | null = null;
  ahora(): number {
    return this.t ?? Date.now();
  }
}

/** Archivos en disco temporal; `fallar` hace que `guardar` truene (disco lleno). */
class ArchivosControlados implements PuertoArchivos {
  fallar = false;
  constructor(readonly disco: ArchivosDisco) {}
  guardar(clave: string, contenido: Buffer): Promise<void> {
    if (this.fallar) return Promise.reject(new Error('ENOSPC: disco lleno (sintético)'));
    return this.disco.guardar(clave, contenido);
  }
  leer: PuertoArchivos['leer'] = (c) => this.disco.leer(c);
  urlFirmada: PuertoArchivos['urlFirmada'] = (c, t) => this.disco.urlFirmada(c, t);
  verificarUrl: PuertoArchivos['verificarUrl'] = (c, e, f) => this.disco.verificarUrl(c, e, f);
}

/**
 * El correo falso; con `fallar`, el adaptador REAL de Brevo contra un HTTP falso que contesta 401
 * (así el error que se guarda es el que produciría el adaptador de verdad).
 */
class CorreoControlado implements PuertoCorreo {
  fallar = false;
  readonly peticionesBrevo: PeticionHttp[] = [];
  readonly #brevo: CorreoBrevo;
  constructor(private readonly falso: CorreoFalso) {
    const http: ClienteHttp = {
      enviar: (p) => {
        this.peticionesBrevo.push(p);
        return Promise.resolve({
          status: 401,
          cuerpo: { code: 'unauthorized', message: 'Key not found' },
        });
      },
    };
    this.#brevo = new CorreoBrevo({ email: 'facturas@ejemplo.test', nombre: 'Prueba' }, http);
  }
  enviar: PuertoCorreo['enviar'] = (d, p, a, o) =>
    this.fallar ? this.#brevo.enviar(d, p, a) : this.falso.enviar(d, p, a, o);
}

const EN_PLAZO = Date.parse('2026-09-20T12:00:00Z');
const CIERRE = '2026-09-15T14:00:00.000-06:00';
const SLUG_A1 = 'f2105-a1';
const SLUG_B1 = 'f2105-b1';
const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;
const ADMIN_B = {
  id: 'f1011000-0000-4000-8000-000000000195',
  email: `admin.b.f2105${DOMINIO}`,
  rol: RolUsuario.admin_empresa,
  empresaId: FX.empresaB,
};

const RECEPTOR = {
  rfc: 'EKU9003173C9',
  razonSocial: 'ESCUELA KEMPER URGATE',
  regimenFiscal: '601',
  cp: '42501',
  usoCfdi: 'G03',
  email: 'facturas.f2105@ejemplo.test',
};

function cheque(id: string, folioSr: string) {
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
    },
  };
}

/** Parser de supertest que junta los bytes tal cual (XML y PDF no se interpretan). */
function binario(res: request.Response, listo: (e: Error | null, cuerpo: unknown) => void) {
  // En node, la respuesta que recibe el parser es el stream HTTP.
  const flujo = res as unknown as NodeJS.ReadableStream;
  const trozos: Buffer[] = [];
  flujo.on('data', (t: Buffer) => trozos.push(t));
  flujo.on('end', () => listo(null, Buffer.concat(trozos)));
}

const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
/** La ruta de un enlace firmado vista por Nest (el proxy quita `/api`). */
const rutaNest = (enlace: string) => enlace.replace(/^\/api/, '');

describe('Entrega de la factura (e2e, F2-105)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojControlado();
  const pac = new TimbradoFalso({ ahora: () => reloj.ahora() });
  let raizArchivos: string;
  let dirCorreo: string;
  let archivos: ArchivosControlados;
  let correo: CorreoControlado;
  let app: NestExpressApplication;
  let url: string;

  let ips = 0;
  const ip = () => `10.5.${Math.floor(++ips / 250)}.${ips % 250}`;
  type Usuario = { id: string; rol: RolUsuario; empresaId: string | null };
  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const como = async (u: Usuario, metodo: 'get' | 'post', ruta: string) => {
    const t = await token(u);
    return request(url)[metodo](ruta).set('Authorization', `Bearer ${t}`);
  };
  /** GET que devuelve los BYTES del cuerpo (con sesión si se da usuario). */
  const bajar = async (ruta: string, u?: Usuario) => {
    const r = request(url).get(ruta).buffer(true).parse(binario);
    if (u) r.set('Authorization', `Bearer ${await token(u)}`);
    const res = await r;
    return { res, bytes: res.body as Buffer };
  };

  const pedirFactura = (folioSr: string, slug = SLUG_A1) =>
    codigoDe(folioSr).then((codigo) =>
      request(url)
        .post(`/facturacion/portal/${slug}/facturas`)
        .set('X-Forwarded-For', ip())
        .send({ codigo, receptor: RECEPTOR }),
    );
  const codigoDe = async (folioSr: string) =>
    (
      await prisma.codigoFacturacion.findFirstOrThrow({
        where: { cheque: { folioSr, sucursal: { empresaId: { in: [FX.empresaA, FX.empresaB] } } } },
      })
    ).codigo;
  const cfdiDe = (uuid: string) => prisma.cfdi.findFirstOrThrow({ where: { uuid } });
  const envioDe = (cfdiId: string) => prisma.cfdiEnvio.findFirstOrThrow({ where: { cfdiId } });
  const correosA = (email = RECEPTOR.email) =>
    prisma.correoEnviado.findMany({
      where: { empresaId: FX.empresaA, destinatario: email },
      orderBy: { enviadoAt: 'asc' },
    });

  async function lote(key: string, eventos: object[]) {
    const res = await request(url).post('/ingesta/eventos').set('X-Api-Key', key).send({ eventos });
    expect(res.status).toBe(200);
    expect(res.body.rechazados).toEqual([]);
  }

  async function levantar(): Promise<void> {
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .overrideProvider(PUERTO_TIMBRADO)
      .useValue(pac)
      .overrideProvider(PUERTO_ARCHIVOS)
      .useValue(archivos)
      .overrideProvider(PUERTO_CORREO)
      .useValue(correo)
      .overrideProvider(Espera)
      .useValue({ esperar: () => Promise.resolve() })
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>(), {
      TRUST_PROXY_SALTOS: '1',
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  }

  function perfil(empresaId: string, rfc: string, ahora: Date) {
    return prisma.perfilFiscal.create({
      data: {
        empresaId,
        rfc,
        razonSocial: 'ESCUELA KEMPER URGATE',
        regimenFiscal: '601',
        cp: '06700',
        serie: 'A',
        folioActual: 500,
        facturamaOrgId: rfc,
        csdNoCertificado: '30001000000500003416',
        csdRfc: rfc,
        csdVigenteDesde: new Date('2026-01-01T06:00:00Z'),
        csdVigenteHasta: new Date('2027-01-01T06:00:00Z'),
        csdCargadoAt: ahora,
        updatedAt: ahora,
      },
    });
  }

  beforeAll(async () => {
    raizArchivos = await mkdtemp(join(tmpdir(), 'monitor-entrega-e2e-'));
    dirCorreo = await mkdtemp(join(tmpdir(), 'monitor-correo-e2e-'));
    archivos = new ArchivosControlados(
      new ArchivosDisco(raizArchivos, SECRETO_ARCHIVOS_FALSO, URL_BASE_ARCHIVOS_FALSO, reloj),
    );
    correo = new CorreoControlado(new CorreoFalso(prisma, reloj, dirCorreo));

    await prisma.$connect();
    await crearFixtures(prisma);
    for (const [id, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalB1, KEYS.b1],
    ]) {
      await prisma.sucursal.update({ where: { id }, data: { apiKeyHash: hashApiKey(key) } });
    }
    await prisma.usuario.create({
      data: { ...ADMIN_B, nombre: 'Prueba adminB F2-105', passwordHash: 'x', activo: true },
    });
    await levantar();

    const folios = ['OK', 'CORREO', 'DISCO', 'ATORADO', 'RECIENTE', 'SIMULTANEO'];
    await lote(
      KEYS.a1,
      folios.map((f, i) => cheque(`a${i}`, `F2105-${f}`)),
    );
    await lote(KEYS.b1, [cheque('b1', 'F2105-B')]);

    const ahora = new Date(EN_PLAZO);
    for (const empresaId of [FX.empresaA, FX.empresaB]) {
      await prisma.formaPagoCatalogo.create({
        data: { empresaId, formaRaw: 'EFECTIVO', forma: 'efectivo' },
      });
    }
    await perfil(FX.empresaA, 'EKU9003173C9', ahora);
    await perfil(FX.empresaB, 'EKU9003173C9', ahora);
    for (const [sucursalId, empresaId, slug, color] of [
      [FX.sucursalA1, FX.empresaA, SLUG_A1, '#1d4ed8'],
      [FX.sucursalB1, FX.empresaB, SLUG_B1, '#0f766e'],
    ]) {
      await prisma.portalFacturacion.create({
        data: { sucursalId, empresaId, slug, color, updatedAt: ahora },
      });
    }
  });

  beforeEach(() => {
    reloj.t = EN_PLAZO;
    archivos.fallar = false;
    correo.fallar = false;
  });

  afterAll(async () => {
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
    await rm(raizArchivos, { recursive: true, force: true });
    await rm(dirCorreo, { recursive: true, force: true });
  });

  // Estado compartido entre pruebas: el CFDI que salió bien.
  let ok: { uuid: string; cfdiId: string; xml: string; pdf: string };

  it('201: XML y PDF en cfdi/{empresa}/{AAAA}/{MM}/, enlaces firmados, y el correo con los dos', async () => {
    const res = await pedirFactura('F2105-OK');
    expect(res.status).toBe(201);
    expect(res.body.uuid).toMatch(UUID);
    const cfdi = await cfdiDe(res.body.uuid);
    // Timbrado el 20/09 a las 06:00 en CDMX: septiembre.
    const base = `cfdi/${FX.empresaA}/2026/09/${res.body.uuid}`;
    expect(cfdi.xmlClave).toBe(`${base}.xml`);
    expect(cfdi.pdfClave).toBe(`${base}.pdf`);
    expect(res.body.descargas.xml).toMatch(
      new RegExp(`^/api/archivos/${base}\\.xml\\?expira=\\d+&firma=[A-Za-z0-9_-]+$`),
    );
    expect(res.body.descargas.pdf).toMatch(
      new RegExp(`^/api/archivos/${base}\\.pdf\\?expira=\\d+&firma=[A-Za-z0-9_-]+$`),
    );

    // Los archivos son los del PAC: el XML lleva el UUID del timbre; el PDF es un PDF.
    const xml = await archivos.leer(`${base}.xml`);
    const pdf = await archivos.leer(`${base}.pdf`);
    expect(xml.toString('utf8')).toContain(`UUID="${res.body.uuid}"`);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');

    // El correo: al del receptor, plantilla factura-emitida, PDF y XML con los MISMOS bytes.
    const [enviado] = await correosA();
    expect(enviado).toMatchObject({ plantilla: 'factura-emitida' });
    expect(enviado.asunto).toBe(`Tu factura de A1 (${res.body.serieFolio})`);
    expect(enviado.adjuntos).toEqual([
      expect.objectContaining({
        nombre: `${res.body.serieFolio}.pdf`,
        tipo: 'application/pdf',
        sha256: sha256(pdf),
      }),
      expect.objectContaining({
        nombre: `${res.body.serieFolio}.xml`,
        tipo: 'application/xml',
        sha256: sha256(xml),
      }),
    ]);
    const envio = await envioDe(cfdi.id);
    expect(envio).toMatchObject({
      email: RECEPTOR.email,
      estado: 'enviado',
      intentos: 1,
      error: null,
      correoId: enviado.id,
    });

    ok = {
      uuid: res.body.uuid,
      cfdiId: cfdi.id,
      xml: res.body.descargas.xml,
      pdf: res.body.descargas.pdf,
    };
  });

  it('el enlace firmado descarga los bytes como adjunto; alterado, vencido o fuera de cfdi/: el MISMO 404', async () => {
    const { res: pdf, bytes } = await bajar(rutaNest(ok.pdf));
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toMatch(/^application\/pdf/);
    expect(pdf.headers['content-disposition']).toBe(`attachment; filename="${ok.uuid}.pdf"`);
    expect(pdf.headers['x-content-type-options']).toBe('nosniff');
    expect(pdf.headers['content-security-policy']).toBe("default-src 'none'");
    expect(pdf.headers['cache-control']).toBe('private, no-store');
    const clave = `cfdi/${FX.empresaA}/2026/09/${ok.uuid}.pdf`;
    expect(bytes.equals(await archivos.leer(clave))).toBe(true);

    const xml = await bajar(rutaNest(ok.xml));
    expect(xml.res.status).toBe(200);
    expect(xml.res.headers['content-type']).toMatch(/^application\/xml/);
    expect(xml.bytes.toString('utf8')).toContain(`UUID="${ok.uuid}"`);

    const alterada = rutaNest(ok.pdf).replace(/firma=./, (m) =>
      m.endsWith('A') ? 'firma=B' : 'firma=A',
    );
    const otraClave = rutaNest(ok.pdf).replace('.pdf?', '.xml?');
    const sinFirma = rutaNest(ok.pdf).split('?')[0];
    const fueraDeCfdi = rutaNest(await archivos.urlFirmada(`portal/${FX.empresaA}/x.pdf`, 600));
    const inexistente = rutaNest(
      await archivos.urlFirmada(`cfdi/${FX.empresaA}/2026/09/NO-EXISTE.pdf`, 600),
    );
    const cuerpos: string[] = [];
    for (const ruta of [alterada, otraClave, sinFirma, fueraDeCfdi, inexistente]) {
      const r = await request(url).get(ruta);
      expect([ruta, r.status]).toEqual([ruta, 404]);
      cuerpos.push(JSON.stringify(r.body));
    }
    reloj.t = EN_PLAZO + 3601 * 1000;
    const vencido = await request(url).get(rutaNest(ok.pdf));
    expect(vencido.status).toBe(404);
    cuerpos.push(JSON.stringify(vencido.body));
    expect(new Set(cuerpos).size).toBe(1);
  });

  it('el correo falla (Brevo 401): el 201 sale con sus descargas y el envío queda fallido, sin la api key', async () => {
    correo.fallar = true;
    const res = await pedirFactura('F2105-CORREO');
    expect(res.status).toBe(201);
    expect(res.body.descargas.pdf).toEqual(expect.stringMatching(/^\/api\/archivos\/cfdi\//));
    expect((await request(url).get(rutaNest(res.body.descargas.pdf))).status).toBe(200);

    const cfdi = await cfdiDe(res.body.uuid);
    const envio = await envioDe(cfdi.id);
    expect(envio).toMatchObject({ estado: 'fallido', intentos: 1, correoId: null });
    expect(envio.error).toBe('El servicio de correo rechazó el envío (HTTP 401): Key not found.');
    expect(envio.error).not.toContain(API_KEY_BREVO);
    expect(envio.error).not.toContain('api-key');
    // Y en el cuerpo que se le mandó a Brevo iban los dos adjuntos.
    const cuerpo = correo.peticionesBrevo.at(-1)?.cuerpo as { attachment: { name: string }[] };
    expect(cuerpo.attachment.map((a) => a.name)).toEqual([
      `${res.body.serieFolio}.pdf`,
      `${res.body.serieFolio}.xml`,
    ]);
  });

  it('GET /facturacion/envios: admin de A ve lo suyo (no el fallido de B); B pidiendo A = 404; visor = 403', async () => {
    // Un envío fallido de la empresa B, que A nunca debe ver.
    correo.fallar = true;
    const b = await pedirFactura('F2105-B', SLUG_B1);
    expect(b.status).toBe(201);
    correo.fallar = false;

    const a = await como(
      USUARIOS.adminEmpresaA,
      'get',
      `/facturacion/envios?empresaId=${FX.empresaA}`,
    );
    expect(a.status).toBe(200);
    const cfdisA = new Set(
      (await prisma.cfdi.findMany({ where: { empresaId: FX.empresaA }, select: { id: true } })).map(
        (c) => c.id,
      ),
    );
    expect(a.body.length).toBeGreaterThan(0);
    for (const e of a.body as { cfdiId: string }[]) expect(cfdisA.has(e.cfdiId)).toBe(true);
    expect(JSON.stringify(a.body)).not.toContain(b.body.uuid);
    const fallidoA = (
      a.body as { email: string; estado: string; requiereReintento: boolean; intentos: number }[]
    )[0];
    expect(fallidoA).toMatchObject({
      email: RECEPTOR.email,
      estado: 'fallido',
      requiereReintento: true,
      intentos: 1,
    });

    const bPideA = await como(ADMIN_B, 'get', `/facturacion/envios?empresaId=${FX.empresaA}`);
    expect(bPideA.status).toBe(404);
    const bPropio = await como(ADMIN_B, 'get', `/facturacion/envios?empresaId=${FX.empresaB}`);
    expect(bPropio.status).toBe(200);
    expect(bPropio.body.map((e: { uuid: string }) => e.uuid)).toEqual([b.body.uuid]);
    const visor = await como(
      USUARIOS.visorA,
      'get',
      `/facturacion/envios?empresaId=${FX.empresaA}`,
    );
    expect(visor.status).toBe(403);
    const atorados = await como(
      USUARIOS.adminEmpresaA,
      'get',
      `/facturacion/envios?empresaId=${FX.empresaA}&estado=atorado`,
    );
    expect(atorados.body).toEqual([]);
  });

  it('reintento: visor 403, admin de B 404, admin de A → enviado (intentos 2) y el segundo 409', async () => {
    const cfdi = await prisma.cfdi.findFirstOrThrow({
      where: { empresaId: FX.empresaA, envios: { some: { estado: 'fallido' } } },
    });
    const ruta = `/facturacion/cfdis/${cfdi.id}/envios/reintento`;
    expect((await como(USUARIOS.visorA, 'post', ruta)).status).toBe(403);
    const deB = await como(ADMIN_B, 'post', ruta);
    expect(deB.status).toBe(404);
    expect(deB.body.message).not.toContain('archivos');
    expect((await envioDe(cfdi.id)).intentos).toBe(1);

    const antes = (await correosA()).length;
    const r = await como(USUARIOS.adminEmpresaA, 'post', ruta);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      cfdiId: cfdi.id,
      email: RECEPTOR.email,
      estado: 'enviado',
      requiereReintento: false,
      intentos: 2,
      error: null,
    });
    const correos = await correosA();
    expect(correos).toHaveLength(antes + 1);
    expect(correos.at(-1)?.adjuntos).toHaveLength(2);

    const otra = await como(USUARIOS.adminEmpresaA, 'post', ruta);
    expect(otra.status).toBe(409);
    expect(otra.body.message).toBe(MENSAJE_SIN_ENVIO_QUE_REINTENTAR);
  });

  it('dos reintentos a la vez: uno 200, el otro 409, y un solo correo', async () => {
    correo.fallar = true;
    const res = await pedirFactura('F2105-SIMULTANEO');
    correo.fallar = false;
    const cfdi = await cfdiDe(res.body.uuid);
    const ruta = `/facturacion/cfdis/${cfdi.id}/envios/reintento`;
    const antes = (await correosA()).length;
    const t = await token(USUARIOS.adminEmpresaA);
    const [x, y] = await Promise.all(
      [1, 2].map(() => request(url).post(ruta).set('Authorization', `Bearer ${t}`)),
    );
    expect([x.status, y.status].sort()).toEqual([200, 409]);
    expect(await correosA()).toHaveLength(antes + 1);
    expect(await envioDe(cfdi.id)).toMatchObject({ estado: 'enviado', intentos: 2 });
  });

  it('un envío atorado en `enviando` más de 10 min se lista y se recupera; uno reciente da 409 y no aparece', async () => {
    const viejo = await pedirFactura('F2105-ATORADO');
    const reciente = await pedirFactura('F2105-RECIENTE');
    const cViejo = await cfdiDe(viejo.body.uuid);
    const cReciente = await cfdiDe(reciente.body.uuid);
    // Como si el proceso hubiera caído a media llamada (fechas con el reloj de la app).
    await prisma.cfdiEnvio.updateMany({
      where: { cfdiId: cViejo.id },
      data: {
        estado: 'enviando',
        correoId: null,
        ultimoIntentoAt: new Date(EN_PLAZO - 11 * 60_000),
      },
    });
    await prisma.cfdiEnvio.updateMany({
      where: { cfdiId: cReciente.id },
      data: { estado: 'enviando', correoId: null, ultimoIntentoAt: new Date(EN_PLAZO - 60_000) },
    });

    const atorados = await como(
      USUARIOS.adminEmpresaA,
      'get',
      `/facturacion/envios?empresaId=${FX.empresaA}&estado=atorado`,
    );
    expect(atorados.body.map((e: { cfdiId: string }) => e.cfdiId)).toEqual([cViejo.id]);
    expect(atorados.body[0]).toMatchObject({ estado: 'enviando', requiereReintento: true });

    const r = await como(
      USUARIOS.adminEmpresaA,
      'post',
      `/facturacion/cfdis/${cViejo.id}/envios/reintento`,
    );
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ estado: 'enviado', intentos: 2 });
    const r2 = await como(
      USUARIOS.adminEmpresaA,
      'post',
      `/facturacion/cfdis/${cReciente.id}/envios/reintento`,
    );
    expect(r2.status).toBe(409);
    expect(await envioDe(cReciente.id)).toMatchObject({ estado: 'enviando', intentos: 1 });
  });

  it('el disco falla al guardar: 201 sin enlaces, el correo sale igual con los dos adjuntos; sin archivos no hay descarga ni reintento', async () => {
    archivos.fallar = true;
    const res = await pedirFactura('F2105-DISCO');
    expect(res.status).toBe(201);
    expect(res.body.descargas).toEqual({ xml: null, pdf: null });
    const cfdi = await cfdiDe(res.body.uuid);
    expect(cfdi).toMatchObject({ xmlClave: null, pdfClave: null });
    const envio = await envioDe(cfdi.id);
    expect(envio.estado).toBe('enviado');
    const enviado = await prisma.correoEnviado.findUniqueOrThrow({
      where: { id: envio.correoId! },
    });
    expect(enviado.adjuntos).toHaveLength(2);

    expect(
      (await como(USUARIOS.adminEmpresaA, 'get', `/facturacion/cfdis/${cfdi.id}/xml`)).status,
    ).toBe(404);
    await prisma.cfdiEnvio.updateMany({ where: { cfdiId: cfdi.id }, data: { estado: 'fallido' } });
    const r = await como(
      USUARIOS.adminEmpresaA,
      'post',
      `/facturacion/cfdis/${cfdi.id}/envios/reintento`,
    );
    expect(r.status).toBe(409);
    expect(r.body.message).toBe(MENSAJE_SIN_ARCHIVOS);
    // No reclamó nada: el envío sigue como estaba.
    expect(await envioDe(cfdi.id)).toMatchObject({ estado: 'fallido', intentos: 1 });
  });

  it('descarga autenticada: el visor de A baja XML y PDF; el admin de B recibe 404 en los dos', async () => {
    const clave = `cfdi/${FX.empresaA}/2026/09/${ok.uuid}`;
    for (const ext of ['xml', 'pdf'] as const) {
      const { res: r, bytes } = await bajar(
        `/facturacion/cfdis/${ok.cfdiId}/${ext}`,
        USUARIOS.visorA,
      );
      expect(r.status).toBe(200);
      expect(r.headers['content-disposition']).toMatch(
        new RegExp(`^attachment; filename="A-\\d+\\.${ext}"$`),
      );
      expect(bytes.equals(await archivos.leer(`${clave}.${ext}`))).toBe(true);
      const b = await como(ADMIN_B, 'get', `/facturacion/cfdis/${ok.cfdiId}/${ext}`);
      expect(b.status).toBe(404);
    }
    expect(
      (await como(USUARIOS.visorA, 'get', `/facturacion/cfdis/${FX.inexistente}/pdf`)).status,
    ).toBe(404);
  });

  it('sobrevive un reinicio: otra app y otro adaptador sobre la MISMA raíz sirven los mismos bytes', async () => {
    const clave = `cfdi/${FX.empresaA}/2026/09/${ok.uuid}.pdf`;
    const antes = await archivos.leer(clave);
    await app.close();
    archivos = new ArchivosControlados(
      new ArchivosDisco(raizArchivos, SECRETO_ARCHIVOS_FALSO, URL_BASE_ARCHIVOS_FALSO, reloj),
    );
    await levantar();
    expect((await archivos.leer(clave)).equals(antes)).toBe(true);
    const { res: r, bytes } = await bajar(rutaNest(ok.pdf));
    expect(r.status).toBe(200);
    expect(bytes.equals(antes)).toBe(true);
  });
});
