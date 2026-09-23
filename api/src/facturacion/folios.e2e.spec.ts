import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import {
  Prisma,
  PrismaClient,
  RolUsuario,
  type ConfiguracionFolios,
  type PaqueteFolios,
} from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { PUERTO_CORREO, PUERTO_PUSH, PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import type { PushFalso } from '../adaptadores/push/push-falso';
import type { Destinatario, PlantillaCorreo, PuertoCorreo } from '../adaptadores/correo/puerto';
import type { CfdiTimbrado, PuertoTimbrado, SolicitudCfdi } from '../adaptadores/timbrado/puerto';
import { TimbradoFalso } from '../adaptadores/timbrado/timbrado-falso';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { fechaLocal } from '../comun/fechas';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import {
  MENSAJE_SIN_FOLIOS_ADMIN,
  MENSAJE_SIN_FOLIOS_PORTAL,
} from '../scope/escritura-facturacion';
import { MENSAJE_PAQUETE_CON_CONSUMO } from '../scope/folios-plataforma';
import { Espera } from './cfdi.service';
import { PLANTILLA_FOLIOS_BAJO, PLANTILLA_FOLIOS_POR_VENCER } from './folios';
import {
  FoliosService,
  MENSAJE_FECHA_COMPRA_FUTURA,
  MENSAJE_FECHA_COMPRA_INVALIDA,
  MENSAJE_RANGO_REPORTE,
} from './folios.service';

// E2E de F2-110 (control de folios del PAC) sobre la app REAL contra Postgres REAL, con el PAC FALSO
// (que cuenta sus emisiones) y un correo que captura. Las pruebas corren EN ORDEN y comparten estado.
//
// El saldo es de la PLATAFORMA (todas las empresas), así que esta suite:
// - GUARDA las filas exactas de `paquetes_folios` y `configuracion_folios`, borra los paquetes, y
//   las RESTAURA tal cual en `afterAll` (que corre aunque falle un caso), después de borrar lo suyo.
// - Vive con el reloj en 2031–2033: ningún otro dato de la base está ahí (el seed no pasa de "hoy" y
//   las demás suites viven en 2026–2027), así que el FIFO del test sólo ve sus timbres. Aun así mide
//   al empezar las reservas `timbrando` ajenas (consumen "ahora") y los timbres ajenos de esos años.
// Si la suite se interrumpe SIN llegar al `afterAll`: `npm run seed` vuelve a poner los paquetes del
// seed (ver docs/nocturno-log.md, F2-110).

const KEY_A1 = 'msr_sintetica-folios-F2-110-sucursal-a1-00000000000001';
const SLUG_A1 = 'f2110-a1';
const CSD_HASTA = new Date('2034-01-01T06:00:00Z');

class RelojControlado extends Reloj {
  t: number | null = null;
  ahora(): number {
    return this.t ?? Date.now();
  }
}

/** El PAC falso con bitácora de emisiones: "no se llamó al puerto" se mide aquí. */
class PacContado implements PuertoTimbrado {
  readonly emisiones: SolicitudCfdi[] = [];
  constructor(readonly falso: TimbradoFalso) {}
  registrarCsd: PuertoTimbrado['registrarCsd'] = (s) => this.falso.registrarCsd(s);
  buscarPorFolio: PuertoTimbrado['buscarPorFolio'] = (c) => this.falso.buscarPorFolio(c);
  descargarArchivos: PuertoTimbrado['descargarArchivos'] = (c) => this.falso.descargarArchivos(c);
  emitir(s: SolicitudCfdi): Promise<CfdiTimbrado> {
    this.emisiones.push(s);
    return this.falso.emitir(s);
  }
  cancelar: PuertoTimbrado['cancelar'] = (s) => this.falso.cancelar(s);
  consultarEstado: PuertoTimbrado['consultarEstado'] = (s) => this.falso.consultarEstado(s);
}

class CorreoCaptura implements PuertoCorreo {
  readonly enviados: Array<{ para: string; plantilla: PlantillaCorreo }> = [];
  falla = false;
  enviar(d: Destinatario, plantilla: PlantillaCorreo) {
    if (this.falla) return Promise.reject(new Error('el servicio de correo no contestó (prueba)'));
    this.enviados.push({ para: d.email, plantilla });
    return Promise.resolve({ id: `correo-${this.enviados.length}` });
  }
  de(nombre: string) {
    return this.enviados.filter((e) => e.plantilla.nombre === nombre);
  }
}

const RECEPTOR = {
  rfc: 'EKU9003173C9',
  razonSocial: 'ESCUELA KEMPER URGATE',
  regimenFiscal: '601',
  cp: '42501',
  usoCfdi: 'G03',
  email: 'kemper@ejemplo.test',
};
const RECEPTOR_ADMIN = { ...RECEPTOR, email: undefined };

function cheque(folioSr: string, cerradoAt: string, total: string) {
  return {
    id: folioSr,
    tipo: 'cheque',
    datos: {
      folioSr,
      folio: `T-${folioSr}`,
      abiertoAt: cerradoAt,
      cerradoAt,
      mesa: 'MESA-SINTETICA',
      mesero: 'MESERO SINTETICO',
      comensales: 2,
      subtotal: total,
      impuestos: '0',
      descuentos: '0',
      propina: '0',
      total,
      cancelado: false,
      partidas: [{ producto: 'Platillo sintético', cantidad: '1', precioUnit: total, total }],
      pagos: [{ formaRaw: 'EFECTIVO', monto: total }],
    },
  };
}

// J1: enero (entra a la global de enero). F1: febrero (se factura por el portal).
const CHEQUES = [
  cheque('J1', '2031-01-10T13:00:00-06:00', '100.00'),
  cheque('F1', '2031-02-05T13:00:00-06:00', '200.00'),
];

type Usuario = { id: string; rol: RolUsuario; empresaId: string | null };
const GLOBAL: Usuario = USUARIOS.adminGlobal;
const ADMIN_A: Usuario = USUARIOS.adminEmpresaA;
const VISOR_A: Usuario = USUARIOS.visorA;

describe('Control de folios del PAC (e2e, F2-110)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojControlado();
  const pac = new PacContado(new TimbradoFalso({ ahora: () => reloj.ahora() }));
  const correo = new CorreoCaptura();
  let app: NestExpressApplication;
  let url: string;
  let ips = 0;
  const ip = () => `10.11.${Math.floor(++ips / 250)}.${ips % 250}`;

  let paquetesGuardados: PaqueteFolios[] = [];
  let configGuardada: ConfiguracionFolios | null = null;
  let timbrandoAjenos = 0;

  const token = (u: Usuario) => app.get(TokensService).firmarAccess(u);
  const auth = async (u: Usuario) => `Bearer ${await token(u)}`;
  const get = async (u: Usuario, ruta: string) =>
    request(url)
      .get(ruta)
      .set('Authorization', await auth(u));
  const post = async (u: Usuario, ruta: string, cuerpo: object = {}) =>
    request(url)
      .post(ruta)
      .set('Authorization', await auth(u))
      .send(cuerpo);
  const put = async (u: Usuario, ruta: string, cuerpo: object) =>
    request(url)
      .put(ruta)
      .set('Authorization', await auth(u))
      .send(cuerpo);
  const del = async (u: Usuario, ruta: string) =>
    request(url)
      .delete(ruta)
      .set('Authorization', await auth(u));

  const en = (iso: string) => (reloj.t = Date.parse(iso));
  const estado = async () => {
    const res = await get(GLOBAL, '/facturacion/folios');
    expect(res.status).toBe(200);
    return res.body as {
      control: boolean;
      estado: string;
      disponible: number;
      vigenteTotal: number;
      enEmision: number;
      sobregiro: number;
      umbralPct: number;
      paquetes: Array<{ id: string; consumidos: number; restantes: number; estado: string }>;
      consumoPorEmpresa: Array<{ empresaId: string; mesActual: number; ultimos12Meses: number }>;
    };
  };
  const alta = (fechaCompra: string, cantidad: number) =>
    post(GLOBAL, '/facturacion/folios/paquetes', { cantidad, fechaCompra });
  const manual = (empresaId: string, sucursalId: string, u: Usuario = GLOBAL) =>
    post(u, '/facturacion/cfdis/manual', {
      empresaId,
      sucursalId,
      solicitudId: randomUUID(),
      total: '116.00',
      formaPago: 'efectivo',
      receptor: RECEPTOR_ADMIN,
    });
  const codigoDe = (folioSr: string) =>
    prisma.codigoFacturacion.findFirstOrThrow({
      where: { empresaId: FX.empresaA, cheque: { folioSr } },
    });
  const portal = async (folioSr: string) =>
    request(url)
      .post(`/facturacion/portal/${SLUG_A1}/facturas`)
      .set('X-Forwarded-For', ip())
      .send({ codigo: (await codigoDe(folioSr)).codigo, receptor: RECEPTOR });
  const globalEnero = () =>
    post(GLOBAL, '/facturacion/global', {
      empresaId: FX.empresaA,
      sucursalId: FX.sucursalA1,
      periodicidad: 'mensual',
      clave: '2031-01-01',
    });
  const cfdisDeFixtures = () =>
    prisma.cfdi.count({ where: { empresaId: { in: [FX.empresaA, FX.empresaB] } } });
  const folioActualA = async () =>
    (await prisma.perfilFiscal.findFirstOrThrow({ where: { empresaId: FX.empresaA } })).folioActual;
  const avisos = () => app.get(FoliosService).vueltaAvisos();
  const destinatarios = () =>
    prisma.usuario.count({ where: { rol: RolUsuario.admin_global, activo: true } });

  let serieDirecta = 9000;
  /** Un timbre escrito directo en la base (el reporte y los bordes del FIFO). */
  const timbre = async (
    empresaId: string,
    sucursalId: string,
    estadoCfdi: 'vigente' | 'cancelado' | 'timbrando',
    emitidoAt: Date | null,
  ) => {
    const perfil = await prisma.perfilFiscal.findFirstOrThrow({ where: { empresaId } });
    const timbrado = estadoCfdi !== 'timbrando';
    return prisma.cfdi.create({
      data: {
        empresaId,
        sucursalId,
        origen: 'manual',
        solicitudId: randomUUID(),
        perfilFiscalId: perfil.id,
        serie: 'D',
        folio: ++serieDirecta,
        receptor: RECEPTOR_ADMIN,
        formaPago: '01',
        subtotal: new Prisma.Decimal('100.00'),
        iva: new Prisma.Decimal('16.00'),
        total: new Prisma.Decimal('116.00'),
        estado: estadoCfdi,
        uuid: timbrado ? randomUUID().toUpperCase() : null,
        idPac: timbrado ? `directo-${serieDirecta}` : null,
        emitidoAt: timbrado ? emitidoAt : null,
        updatedAt: new Date(),
      },
    });
  };

  beforeAll(async () => {
    await prisma.$connect();
    // El saldo es global: se guarda TAL CUAL y se restaura en afterAll.
    paquetesGuardados = await prisma.paqueteFolios.findMany();
    configGuardada = await prisma.configuracionFolios.findUnique({ where: { id: 1 } });
    await prisma.paqueteFolios.deleteMany({});
    await prisma.configuracionFolios.update({
      where: { id: 1 },
      data: { controlActivo: false, umbralPct: 20, avisoUmbralAt: null },
    });
    timbrandoAjenos = await prisma.cfdi.count({ where: { estado: 'timbrando' } });
    // Nada ajeno en los años del test: si lo hubiera, las cifras a mano no valdrían.
    expect(
      await prisma.cfdi.count({
        where: {
          estado: { in: ['vigente', 'cancelado'] },
          emitidoAt: { gte: new Date('2031-01-01T00:00:00Z') },
        },
      }),
    ).toBe(0);

    await prisma.configuracionFacturacion.deleteMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
    });
    await crearFixtures(prisma);
    await prisma.sucursal.update({
      where: { id: FX.sucursalA1 },
      data: { apiKeyHash: hashApiKey(KEY_A1) },
    });
    // A2 en Tijuana: el borde de mes del reporte se corta en SU zona.
    await prisma.sucursal.update({
      where: { id: FX.sucursalA2 },
      data: { zonaHoraria: 'America/Tijuana' },
    });
    const alta0 = new Date('2031-01-01T00:00:00Z');
    for (const empresaId of [FX.empresaA, FX.empresaB]) {
      await prisma.configuracionFacturacion.create({
        data: { empresaId, vigenciaCodigos: 'fin_de_mes', updatedAt: alta0 },
      });
      await prisma.formaPagoCatalogo.create({
        data: { empresaId, formaRaw: 'EFECTIVO', forma: 'efectivo' },
      });
      await prisma.perfilFiscal.create({
        data: {
          empresaId,
          rfc: 'EKU9003173C9',
          razonSocial: 'ESCUELA KEMPER URGATE',
          regimenFiscal: '601',
          cp: '06700',
          serie: 'A',
          folioActual: 100,
          facturamaOrgId: 'EKU9003173C9',
          csdNoCertificado: '30001000000500003416',
          csdRfc: 'EKU9003173C9',
          csdVigenteDesde: new Date('2030-01-01T06:00:00Z'),
          csdVigenteHasta: CSD_HASTA,
          csdCargadoAt: alta0,
          updatedAt: alta0,
        },
      });
    }
    await prisma.portalFacturacion.create({
      data: {
        sucursalId: FX.sucursalA1,
        empresaId: FX.empresaA,
        slug: SLUG_A1,
        color: '#0f766e',
        updatedAt: alta0,
      },
    });

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .overrideProvider(PUERTO_TIMBRADO)
      .useValue(pac)
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

    en('2031-02-10T12:00:00-06:00');
    const lote = await request(url)
      .post('/ingesta/eventos')
      .set('X-Api-Key', KEY_A1)
      .send({ eventos: CHEQUES });
    expect(lote.status).toBe(200);
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    // PRIMERO lo del test, DESPUÉS lo guardado, tal cual (ids, fechas y marcas de aviso).
    await prisma.paqueteFolios.deleteMany({});
    if (paquetesGuardados.length > 0) {
      await prisma.paqueteFolios.createMany({ data: paquetesGuardados });
    }
    if (configGuardada) {
      await prisma.configuracionFolios.update({
        where: { id: 1 },
        data: {
          umbralPct: configGuardada.umbralPct,
          controlActivo: configGuardada.controlActivo,
          avisoUmbralAt: configGuardada.avisoUmbralAt,
          updatedAt: configGuardada.updatedAt,
        },
      });
    }
    await prisma.configuracionFacturacion.deleteMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
    });
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('sin paquetes el control está apagado: se emite y la vista lo dice', async () => {
    const e = await estado();
    expect(e).toMatchObject({ control: false, estado: 'sin_control', paquetes: [] });
    const res = await manual(FX.empresaA, FX.sucursalA1);
    expect(res.status).toBe(201);
    expect(await avisos()).toEqual({
      umbral: 'sin_control',
      vigenciaEnviados: 0,
      vigenciaFallidos: 0,
    });
  });

  it('acceso: sólo admin_global (403 por la ruta), 401 sin token; validaciones 400', async () => {
    expect((await get(ADMIN_A, '/facturacion/folios')).status).toBe(403);
    expect((await get(VISOR_A, '/facturacion/folios')).status).toBe(403);
    expect(
      (
        await post(ADMIN_A, '/facturacion/folios/paquetes', {
          cantidad: 5,
          fechaCompra: '2031-02-01',
        })
      ).status,
    ).toBe(403);
    expect((await request(url).get('/facturacion/folios')).status).toBe(401);

    expect((await alta('2031-02-01', 0)).status).toBe(400);
    const invalida = await alta('2031-02-30', 5);
    expect(invalida.status).toBe(400);
    expect(invalida.body.message).toBe(MENSAJE_FECHA_COMPRA_INVALIDA);
    const futura = await alta('2031-02-11', 5);
    expect(futura.status).toBe(400);
    expect(futura.body.message).toBe(MENSAJE_FECHA_COMPRA_FUTURA);
    expect(
      (await put(GLOBAL, '/facturacion/folios/configuracion', { umbralPct: 101 })).status,
    ).toBe(400);
    const alReves = await get(GLOBAL, '/facturacion/folios/reporte?desde=2031-03&hasta=2031-02');
    expect(alReves.status).toBe(400);
    expect(alReves.body.message).toBe(MENSAJE_RANGO_REPORTE);
    expect(
      (await get(GLOBAL, '/facturacion/folios/reporte?desde=2029-01&hasta=2031-01')).status,
    ).toBe(400);
    expect((await del(GLOBAL, `/facturacion/folios/paquetes/${randomUUID()}`)).status).toBe(404);
    // Nada de eso prendió el control.
    expect((await estado()).control).toBe(false);
  });

  it('SALDO EN 0: las cuatro emisiones dan 503 ANTES de llamar al PAC, sin tomar folio', async () => {
    en('2031-02-12T12:00:00-06:00');
    // Un folio para nosotros más las reservas ajenas en emisión (consumen "ahora").
    const p0 = await alta('2031-02-12', 1 + timbrandoAjenos);
    expect(p0.status).toBe(201);
    expect(await estado()).toMatchObject({
      control: true,
      estado: 'ok',
      disponible: 1,
      enEmision: timbrandoAjenos,
    });
    const m1 = await manual(FX.empresaA, FX.sucursalA1);
    expect(m1.status).toBe(201);
    expect(await estado()).toMatchObject({ estado: 'agotado', disponible: 0 });

    const emisiones = pac.emisiones.length;
    const cfdis = await cfdisDeFixtures();
    const folio = await folioActualA();

    const sinTicket = await manual(FX.empresaA, FX.sucursalA1, ADMIN_A);
    expect(sinTicket.status).toBe(503);
    expect(sinTicket.body.message).toBe(MENSAJE_SIN_FOLIOS_ADMIN);

    const delPortal = await portal('F1');
    expect(delPortal.status).toBe(503);
    expect(delPortal.body.message).toBe(MENSAJE_SIN_FOLIOS_PORTAL);
    const pagina = await request(url)
      .get(`/facturacion/portal/${SLUG_A1}`)
      .set('X-Forwarded-For', ip());
    expect(pagina.status).toBe(200);
    expect(pagina.body.emisionDisponible).toBe(false);

    const refactura = await post(GLOBAL, `/facturacion/cfdis/${m1.body.id}/refacturar`, {
      receptor: RECEPTOR_ADMIN,
    });
    expect(refactura.status).toBe(503);
    expect(refactura.body.message).toBe(MENSAJE_SIN_FOLIOS_ADMIN);

    const global = await globalEnero();
    expect(global.status).toBe(503);
    expect(global.body.message).toBe(MENSAJE_SIN_FOLIOS_ADMIN);

    // Ningún texto trae cifras del saldo (no es de esta empresa).
    for (const r of [sinTicket, delPortal, refactura, global]) {
      expect(JSON.stringify(r.body)).not.toMatch(/\d+ folios/);
    }
    // Ni PAC, ni reserva, ni folio.
    expect(pac.emisiones).toHaveLength(emisiones);
    expect(await cfdisDeFixtures()).toBe(cfdis);
    expect(await folioActualA()).toBe(folio);
  });

  it('aviso de umbral (reloj falso): falla el correo → se reintenta; dos vueltas → UN correo', async () => {
    const n = await destinatarios();
    // F2-146: un navegador del admin_global con el push de folios prendido, y uno de un
    // admin_empresa con la columna en true (p. ej. un admin_global degradado): ése NO recibe.
    const push = app.get<PushFalso>(PUERTO_PUSH);
    const navegador = async (u: Usuario, nombre: string) => {
      const { versionSesion } = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id } });
      await prisma.preferenciaPush.upsert({
        where: { usuarioId: u.id },
        create: { usuarioId: u.id, empresaId: u.empresaId, foliosBajo: true },
        update: { foliosBajo: true },
      });
      const endpoint = `https://fcm.googleapis.com/fcm/send/folios-${nombre}`;
      await prisma.dispositivoPush.create({
        data: {
          usuarioId: u.id,
          empresaId: u.empresaId,
          endpoint,
          p256dh: 'BA',
          auth: 'AA',
          versionSesion,
          creadoAt: new Date(reloj.ahora()),
          renovadoAt: new Date(reloj.ahora()),
        },
      });
      return endpoint;
    };
    const delGlobal = await navegador(USUARIOS.adminGlobal, 'global');
    const delAdminEmpresa = await navegador(USUARIOS.adminEmpresaA, 'admin-empresa');
    const pushes = (endpoint: string) => push.enviados.filter((e) => e.endpoint === endpoint);
    correo.falla = true;
    expect((await avisos()).umbral).toBe('fallido');
    expect(
      (await prisma.configuracionFolios.findUniqueOrThrow({ where: { id: 1 } })).avisoUmbralAt,
    ).toBeNull();
    correo.falla = false;
    const [a, b] = await Promise.all([avisos(), avisos()]);
    expect([a.umbral, b.umbral].sort()).toEqual(['enviado', 'ya_avisado']);
    const enviados = correo.de(PLANTILLA_FOLIOS_BAJO);
    expect(enviados).toHaveLength(n);
    expect(enviados.map((e) => e.para)).toContain(USUARIOS.adminGlobal.email);
    expect(enviados[0].plantilla.asunto).toBe('Folios de timbrado AGOTADOS');
    expect((await avisos()).umbral).toBe('ya_avisado');
    expect(correo.de(PLANTILLA_FOLIOS_BAJO)).toHaveLength(n);
    // F2-146: el push sale UNA vez, sólo cuando el correo salió (no en el reclamo que falló, ni
    // en la vuelta simultánea, ni en la siguiente), y sólo al admin_global.
    expect(pushes(delGlobal)).toHaveLength(1);
    expect(pushes(delGlobal)[0].mensaje).toMatchObject({
      titulo: 'Se acabaron los folios',
      url: '/facturacion?tab=folios',
    });
    expect(pushes(delAdminEmpresa)).toHaveLength(0);
  });

  it('con saldo 1, dos reservas SIMULTÁNEAS de dos empresas: exactamente una pasa', async () => {
    expect((await alta('2031-02-12', 1)).status).toBe(201);
    const emisiones = pac.emisiones.length;
    const [a, b] = await Promise.all([
      manual(FX.empresaA, FX.sucursalA1),
      manual(FX.empresaB, FX.sucursalB1),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 503]);
    const perdedora = a.status === 503 ? a : b;
    expect(perdedora.body.message).toBe(MENSAJE_SIN_FOLIOS_ADMIN);
    expect(pac.emisiones).toHaveLength(emisiones + 1);
    ganoB = b.status === 201;
  });
  let ganoB = false;

  it('con un paquete nuevo todo vuelve a emitir; el aviso se re-arma; cuentan global y sustituto', async () => {
    const p2 = await alta('2031-02-12', 100);
    expect(p2.status).toBe(201);
    expect((await avisos()).umbral).toBe('rearmado');
    expect((await globalEnero()).status).toBe(201);
    const t = await portal('F1');
    expect(t.status).toBe(201);
    // Refacturar M1: el sustituto es un timbre; M1 queda cancelado (01) y SIGUE contando.
    const m1 = await prisma.cfdi.findFirstOrThrow({
      where: { empresaId: FX.empresaA, origen: 'manual', sustituyeAId: null, estado: 'vigente' },
      orderBy: { emitidoAt: 'desc' },
    });
    const r = await post(GLOBAL, `/facturacion/cfdis/${m1.id}/refacturar`, {
      receptor: RECEPTOR_ADMIN,
    });
    expect(r.status).toBe(201);
    // A mano: 100 del paquete P2 − global − portal − sustituto = 97.
    const e = await estado();
    expect(e).toMatchObject({ estado: 'ok', disponible: 97 });
  });

  it('umbral configurable: al 99 % el saldo es bajo y avisa; al volver a 20 se re-arma', async () => {
    const res = await put(GLOBAL, '/facturacion/folios/configuracion', { umbralPct: 99 });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ umbralPct: 99, estado: 'bajo' });
    const antes = correo.de(PLANTILLA_FOLIOS_BAJO).length;
    expect((await avisos()).umbral).toBe('enviado');
    const nuevos = correo.de(PLANTILLA_FOLIOS_BAJO).slice(antes);
    expect(nuevos).toHaveLength(await destinatarios());
    expect(nuevos[0].plantilla.asunto).toBe('Saldo de folios de timbrado bajo');
    expect((await put(GLOBAL, '/facturacion/folios/configuracion', { umbralPct: 20 })).status).toBe(
      200,
    );
    expect((await avisos()).umbral).toBe('rearmado');
  });

  it('REPORTE MENSUAL: cuadra con los CFDI vigentes + cancelados, mes en la zona de la sucursal', async () => {
    en('2031-04-15T12:00:00-06:00');
    // 23:30 del 31 de marzo en CDMX (A1) y en Tijuana (A2, UTC−7 en abril); 00:30 del 1 de abril
    // en CDMX para B1. Y una reserva `timbrando` que NO cuenta.
    await timbre(FX.empresaA, FX.sucursalA1, 'vigente', new Date('2031-04-01T05:30:00Z'));
    await timbre(FX.empresaA, FX.sucursalA2, 'cancelado', new Date('2031-04-01T06:30:00Z'));
    await timbre(FX.empresaB, FX.sucursalB1, 'vigente', new Date('2031-04-01T06:30:00Z'));
    const colgada = await timbre(FX.empresaA, FX.sucursalA1, 'timbrando', null);

    const res = await get(GLOBAL, '/facturacion/folios/reporte?desde=2031-01&hasta=2031-04');
    expect(res.status).toBe(200);
    const filas = (res.body.filas as Array<Record<string, unknown>>).filter((f) =>
      ([FX.empresaA, FX.empresaB] as string[]).includes(f.empresaId as string),
    );
    // A mano. Febrero, A: M0 y M1 (manual; M1 cancelado por la refacturación), su sustituto, la
    // global de enero (emitida en febrero), el portal de F1, y la reserva simultánea si la ganó A.
    const a = { empresa: 'Empresa Prueba A (F1-011)' };
    const b = { empresa: 'Empresa Prueba B (F1-011)' };
    const manualesFebA = ganoB ? 2 : 3;
    expect(filas).toEqual([
      {
        empresaId: FX.empresaA,
        ...a,
        mes: '2031-02',
        vigentes: manualesFebA + 3 - 1,
        cancelados: 1,
        total: manualesFebA + 3,
        ticket: 1,
        manual: manualesFebA,
        global: 1,
        sustitutos: 1,
      },
      ...(ganoB
        ? [
            {
              empresaId: FX.empresaB,
              ...b,
              mes: '2031-02',
              vigentes: 1,
              cancelados: 0,
              total: 1,
              ticket: 0,
              manual: 1,
              global: 0,
              sustitutos: 0,
            },
          ]
        : []),
      {
        empresaId: FX.empresaA,
        ...a,
        mes: '2031-03',
        vigentes: 1,
        cancelados: 1,
        total: 2,
        ticket: 0,
        manual: 2,
        global: 0,
        sustitutos: 0,
      },
      {
        empresaId: FX.empresaB,
        ...b,
        mes: '2031-04',
        vigentes: 1,
        cancelados: 0,
        total: 1,
        ticket: 0,
        manual: 1,
        global: 0,
        sustitutos: 0,
      },
    ]);

    // Contra un conteo INDEPENDIENTE: cada CFDI con su mes local calculado aquí, no en SQL.
    const cfdis = await prisma.cfdi.findMany({
      where: {
        empresaId: { in: [FX.empresaA, FX.empresaB] },
        estado: { in: ['vigente', 'cancelado'] },
      },
      select: { empresaId: true, emitidoAt: true, sucursal: { select: { zonaHoraria: true } } },
    });
    const conteo = new Map<string, number>();
    for (const c of cfdis) {
      const llave = `${c.empresaId}|${fechaLocal(c.emitidoAt!, c.sucursal.zonaHoraria).slice(0, 7)}`;
      conteo.set(llave, (conteo.get(llave) ?? 0) + 1);
    }
    expect(
      Object.fromEntries(
        filas.map((f) => [`${f.empresaId as string}|${f.mes as string}`, f.total]),
      ),
    ).toEqual(
      Object.fromEntries(
        [...conteo].filter(([k]) => k.split('|')[1] >= '2031-01' && k.split('|')[1] <= '2031-04'),
      ),
    );
    // Los totales traen TODOS los meses del rango (enero en 0).
    expect((res.body.totales as Array<{ mes: string }>).map((t) => t.mes)).toEqual([
      '2031-01',
      '2031-02',
      '2031-03',
      '2031-04',
    ]);

    // La tarjeta de consumo sale de la MISMA consulta: su mes en curso (abril) = la fila del reporte.
    const e = await estado();
    const consumo = (id: string) => e.consumoPorEmpresa.find((c) => c.empresaId === id);
    expect(consumo(FX.empresaA)).toMatchObject({
      mesActual: 0,
      ultimos12Meses: manualesFebA + 3 + 2,
    });
    expect(consumo(FX.empresaB)).toMatchObject({
      mesActual: 1,
      ultimos12Meses: (ganoB ? 1 : 0) + 1,
    });
    // La reserva colgada se cuenta EN EMISIÓN (resta saldo hasta que la concilie F2-110b).
    expect(e.enEmision).toBe(timbrandoAjenos + 1);
    await prisma.cfdi.delete({ where: { id: colgada.id } });
  });

  it('borrar: 409 si el paquete ya tiene timbres (no se reescribe el historial); 204 si no', async () => {
    const e = await estado();
    const usado = e.paquetes.find((p) => p.consumidos > 0)!;
    const r = await del(GLOBAL, `/facturacion/folios/paquetes/${usado.id}`);
    expect(r.status).toBe(409);
    expect(r.body.message).toBe(MENSAJE_PAQUETE_CON_CONSUMO);
  });

  it('vigencia (reloj falso): a 30 días y 1 ms no avisa, a 30 días sí, una vez por paquete', async () => {
    // P0, P1 y P2 (comprados el 2031-02-12 en CDMX) vencen el 2032-02-12T06:00Z. Vencen en el MISMO
    // instante, así que el FIFO no distingue cuál se gasta primero: avisa cada uno que tenga restante.
    en('2032-01-13T05:59:59.999Z');
    expect((await avisos()).vigenciaEnviados).toBe(0);
    expect((await estado()).paquetes.filter((p) => p.estado === 'por_vencer')).toEqual([]);
    en('2032-01-13T06:00:00.000Z');
    const porVencer = (await estado()).paquetes.filter((p) => p.estado === 'por_vencer');
    // A mano: 102 + ajenos comprados, 8 timbres después de la compra + ajenos en emisión → sobra.
    expect(porVencer.length).toBeGreaterThanOrEqual(1);
    expect(porVencer.every((p) => p.restantes > 0)).toBe(true);
    const r = await avisos();
    expect(r.vigenciaEnviados).toBe(porVencer.length);
    yaAvisados = porVencer.map((p) => p.id);
    const enviados = correo.de(PLANTILLA_FOLIOS_POR_VENCER);
    expect(enviados).toHaveLength(porVencer.length * (await destinatarios()));
    expect(enviados[0].plantilla.texto).toContain(
      'comprado el 2031-02-12 vence al terminar el 2032-02-11',
    );
    // Una vez por paquete.
    expect((await avisos()).vigenciaEnviados).toBe(0);
    expect(correo.de(PLANTILLA_FOLIOS_POR_VENCER)).toHaveLength(enviados.length);
  });

  let yaAvisados: string[] = [];

  it('un paquete registrado YA dentro de los 30 días avisa en la vuelta siguiente; si el correo falla, reintenta', async () => {
    // Comprado el 2031-01-25: vence el 2032-01-25 (12 días después de "hoy").
    const r = await alta('2031-01-25', 50);
    expect(r.status).toBe(201);
    // R vence ANTES que P0–P2: el FIFO le pasa sus timbres, y un P que estaba agotado puede volver
    // a tener restante (y avisar, porque nunca se le avisó). Se avisa a cada uno UNA vez.
    const pendientes = (await estado()).paquetes.filter(
      (p) => p.estado === 'por_vencer' && !yaAvisados.includes(p.id),
    );
    expect(pendientes.map((p) => p.id)).toContain(r.body.id);
    correo.falla = true;
    expect(await avisos()).toMatchObject({
      vigenciaEnviados: 0,
      vigenciaFallidos: pendientes.length,
    });
    correo.falla = false;
    expect(await avisos()).toMatchObject({
      vigenciaEnviados: pendientes.length,
      vigenciaFallidos: 0,
    });
    expect((await avisos()).vigenciaEnviados).toBe(0);
  });

  it('bordes del FIFO en SQL: emitido = compra cuenta; emitido = vencimiento y el hueco son sobregiro', async () => {
    // Todos los paquetes anteriores vencieron (a más tardar 2032-02-12). Q: 2032-03-01 → 2033-03-01.
    en('2032-03-10T12:00:00-06:00');
    const q = await alta('2032-03-01', 10);
    expect(q.status).toBe(201);
    // Un paquete sin timbres se puede borrar.
    const z = await alta('2032-03-10', 5);
    expect((await del(GLOBAL, `/facturacion/folios/paquetes/${z.body.id as string}`)).status).toBe(
      204,
    );

    const antes = await estado();
    const qAntes = antes.paquetes.find((p) => p.id === q.body.id)!;
    // Las reservas ajenas en emisión consumen "ahora", y ahora sólo Q está vigente.
    expect(qAntes.consumidos).toBe(timbrandoAjenos);
    const compra = new Date('2032-03-01T06:00:00.000Z');
    const vence = new Date('2033-03-01T06:00:00.000Z');
    await timbre(FX.empresaA, FX.sucursalA1, 'vigente', compra);
    await timbre(FX.empresaA, FX.sucursalA1, 'vigente', vence);
    await timbre(FX.empresaA, FX.sucursalA1, 'vigente', new Date(compra.getTime() - 1));
    const despues = await estado();
    const qDespues = despues.paquetes.find((p) => p.id === q.body.id)!;
    expect(qDespues).toMatchObject({
      consumidos: 1 + timbrandoAjenos,
      restantes: 9 - timbrandoAjenos,
      estado: 'vigente',
    });
    expect(despues.sobregiro - antes.sobregiro).toBe(2);
    expect(despues).toMatchObject({ disponible: 9 - timbrandoAjenos, vigenteTotal: 10 });
  });
});
