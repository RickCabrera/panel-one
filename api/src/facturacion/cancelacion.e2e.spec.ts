import { ConflictException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, RolUsuario } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { PUERTO_CORREO, PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import type {
  Adjunto,
  Destinatario,
  PlantillaCorreo,
  PuertoCorreo,
} from '../adaptadores/correo/puerto';
import {
  ErrorTimbrado,
  type CfdiTimbrado,
  type PuertoTimbrado,
  type SolicitudCancelacion,
  type SolicitudCfdi,
} from '../adaptadores/timbrado/puerto';
import {
  RFC_CANCELACION_CON_ACEPTACION,
  TimbradoFalso,
} from '../adaptadores/timbrado/timbrado-falso';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import {
  MENSAJE_01_SIN_SUSTITUTO,
  MENSAJE_04_NO_GLOBAL,
  MENSAJE_ANTERIOR_VIGENTE,
  MENSAJE_CANCELACION_ABIERTA,
  MENSAJE_CANCELACION_INCIERTA,
  MENSAJE_CON_SUSTITUTO,
  MENSAJE_GLOBAL_SIN_SUSTITUCION,
  MENSAJE_PAC_CAIDO_CANCELACION,
  MENSAJE_REFACTURAR_CON_CANCELACION,
  MENSAJE_SIN_SOLICITUD,
  MENSAJE_YA_CANCELADA,
  NOMBRE_PLANTILLA_CANCELACION,
} from './cancelacion';
import { CancelacionCfdiService, MENSAJE_EN_PROCESO } from './cancelacion.service';
import { Espera } from './cfdi.service';
import { MENSAJE_CANCELACION_PENDIENTE } from './emision-admin.service';
import { MENSAJE_REENVIO_CANCELADA } from './entrega.service';
import { FacturaGlobalService } from './global.service';

// E2E de F2-109 (cancelación de CFDI) sobre la app REAL contra Postgres REAL, con el PAC FALSO (que
// modela la cancelación que espera al receptor con dos RFC reservados) y un correo que captura. Las
// pruebas corren EN ORDEN y comparten estado. Las cifras del tablero están ESCRITAS A MANO desde los
// importes de la fixture, no recalculadas.

const KEY_A1 = 'msr_sintetica-cancelacion-F2-109-sucursal-a1-000000001';
const SLUG_A1 = 'f2109-a1';

class RelojControlado extends Reloj {
  t: number | null = null;
  ahora(): number {
    return this.t ?? Date.now();
  }
}

/** El PAC falso con fallas a la carta al cancelar, bitácora de cancelaciones y compuerta al emitir. */
class PacControlado implements PuertoTimbrado {
  readonly emisiones: SolicitudCfdi[] = [];
  readonly cancelaciones: SolicitudCancelacion[] = [];
  fallasCancelar: Error[] = [];
  #compuerta: Promise<void> | null = null;
  #abrir: (() => void) | null = null;
  constructor(readonly falso: TimbradoFalso) {}

  cerrar(): void {
    this.#compuerta = new Promise((listo) => (this.#abrir = listo));
  }
  abrir(): void {
    this.#abrir?.();
    this.#compuerta = null;
  }

  registrarCsd: PuertoTimbrado['registrarCsd'] = (s) => this.falso.registrarCsd(s);

  async emitir(s: SolicitudCfdi): Promise<CfdiTimbrado> {
    this.emisiones.push(s);
    if (this.#compuerta) await this.#compuerta;
    return this.falso.emitir(s);
  }

  cancelar: PuertoTimbrado['cancelar'] = (s) => {
    this.cancelaciones.push(s);
    const falla = this.fallasCancelar.shift();
    if (falla) return Promise.reject(falla);
    return this.falso.cancelar(s);
  };

  consultarEstado: PuertoTimbrado['consultarEstado'] = (s) => this.falso.consultarEstado(s);
}

/** Correo que captura lo que se manda y puede fallar a pedido. */
class CorreoCaptura implements PuertoCorreo {
  readonly enviados: Array<{ para: string; plantilla: PlantillaCorreo; adjuntos: Adjunto[] }> = [];
  falla = false;
  enviar(d: Destinatario, plantilla: PlantillaCorreo, adjuntos: Adjunto[]) {
    if (this.falla) return Promise.reject(new Error('el servicio de correo no contestó (prueba)'));
    this.enviados.push({ para: d.email, plantilla, adjuntos });
    return Promise.resolve({ id: `correo-${this.enviados.length}` });
  }
  deCancelacion(para?: string) {
    return this.enviados.filter(
      (e) => e.plantilla.nombre === NOMBRE_PLANTILLA_CANCELACION && (!para || e.para === para),
    );
  }
}

const RECEPTORES = {
  eku: {
    rfc: 'EKU9003173C9',
    razonSocial: 'ESCUELA KEMPER URGATE',
    regimenFiscal: '601',
    cp: '42501',
    usoCfdi: 'G03',
    email: 'kemper@ejemplo.test',
  },
  xia: {
    rfc: 'XIA190128J61',
    razonSocial: 'XENON INDUSTRIAL ARTICLES',
    regimenFiscal: '601',
    cp: '76343',
    usoCfdi: 'G03',
    email: 'xenon@ejemplo.test',
  },
  // El PAC falso deja su cancelación esperando al receptor (acepta cuando se le diga).
  acepta: {
    rfc: RFC_CANCELACION_CON_ACEPTACION.acepta,
    razonSocial: 'PERSONA QUE ACEPTA',
    regimenFiscal: '612',
    cp: '06700',
    usoCfdi: 'G03',
    email: 'acepta@ejemplo.test',
  },
  // ... y éste la rechaza en la primera consulta.
  rechaza: {
    rfc: RFC_CANCELACION_CON_ACEPTACION.rechaza,
    razonSocial: 'PERSONA QUE RECHAZA',
    regimenFiscal: '612',
    cp: '06700',
    usoCfdi: 'G03',
    email: 'rechaza@ejemplo.test',
  },
} as const;

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

// Todo en A1 (CDMX, UTC−6). Septiembre: 1000 + 400 + 250 + 80 + 60 + 120 + 300 + 90 = 2300.00 de
// venta, cada uno facturado por el portal el mismo día a las 14:00. Agosto: dos sin facturar para
// la global (30.00 + 45.50 = 75.50).
const CHEQUES = [
  cheque('C1', '2026-09-05T13:00:00-06:00', '1000.00'),
  cheque('C2', '2026-09-06T13:00:00-06:00', '400.00'),
  cheque('C3', '2026-09-07T13:00:00-06:00', '250.00'),
  cheque('C4', '2026-09-08T13:00:00-06:00', '80.00'),
  cheque('C5', '2026-09-09T13:00:00-06:00', '60.00'),
  cheque('C6', '2026-09-10T13:00:00-06:00', '120.00'),
  cheque('C7', '2026-09-11T13:00:00-06:00', '300.00'),
  cheque('C8', '2026-09-12T13:00:00-06:00', '90.00'),
  cheque('G1', '2026-08-20T13:00:00-06:00', '30.00'),
  cheque('G2', '2026-08-21T13:00:00-06:00', '45.50'),
];
const EMISIONES: ReadonlyArray<[string, string, keyof typeof RECEPTORES]> = [
  ['C1', '05', 'eku'],
  ['C2', '06', 'eku'],
  ['C3', '07', 'acepta'],
  ['C4', '08', 'rechaza'],
  ['C5', '09', 'eku'],
  ['C6', '10', 'eku'],
  ['C7', '11', 'acepta'],
  ['C8', '12', 'eku'],
];
const SEPTIEMBRE = 'desde=2026-09-01&hasta=2026-09-30';
const SOLICITUD_MANUAL = 'f2109000-0000-4000-8000-000000000001';

type Usuario = { id: string; rol: RolUsuario; empresaId: string | null };
const ADMIN_A: Usuario = USUARIOS.adminEmpresaA;
const ADMIN_B: Usuario = {
  id: 'f2109000-0000-4000-8000-0000000000b0',
  rol: RolUsuario.admin_empresa,
  empresaId: FX.empresaB,
};
const VISOR_A: Usuario = USUARIOS.visorA;

describe('Cancelación de CFDI (e2e, F2-109)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojControlado();
  const pac = new PacControlado(new TimbradoFalso({ ahora: () => reloj.ahora() }));
  const correo = new CorreoCaptura();
  let app: NestExpressApplication;
  let url: string;
  let ips = 0;
  const ip = () => `10.9.${Math.floor(++ips / 250)}.${ips % 250}`;

  const token = (u: Usuario) => app.get(TokensService).firmarAccess(u);
  const get = async (u: Usuario, ruta: string) =>
    request(url)
      .get(ruta)
      .set('Authorization', `Bearer ${await token(u)}`);
  const post = async (u: Usuario, ruta: string, cuerpo: object = {}) =>
    request(url)
      .post(ruta)
      .set('Authorization', `Bearer ${await token(u)}`)
      .send(cuerpo);
  const cancelar = (id: string, cuerpo: object, u: Usuario = ADMIN_A) =>
    post(u, `/facturacion/cfdis/${id}/cancelar`, cuerpo);
  const consultar = (id: string, u: Usuario = ADMIN_A) =>
    post(u, `/facturacion/cfdis/${id}/cancelacion/consultar`);
  const refacturar = (id: string, receptor: object = RECEPTORES.xia) =>
    post(ADMIN_A, `/facturacion/cfdis/${id}/refacturar`, { receptor });
  const tablero = () => get(ADMIN_A, `/facturacion/tablero?empresaId=${FX.empresaA}&${SEPTIEMBRE}`);
  const fila = async (id: string) => {
    const res = await get(
      ADMIN_A,
      `/facturacion/cfdis?empresaId=${FX.empresaA}&${SEPTIEMBRE}&porPagina=200`,
    );
    expect(res.status).toBe(200);
    return (res.body.cfdis as Array<{ id: string }>).find((c) => c.id === id) as
      Record<string, unknown> | undefined;
  };
  /** El CFDI ORIGINAL del ticket (no un sustituto, no la re-emisión). */
  const cfdiDe = (folioSr: string) =>
    prisma.cfdi.findFirstOrThrow({
      where: { cheque: { folioSr }, sustituyeAId: null },
      orderBy: { emitidoAt: 'asc' },
      include: { sustituidoPor: true },
    });
  const codigoDe = (folioSr: string) =>
    prisma.codigoFacturacion.findFirstOrThrow({ where: { cheque: { folioSr } } });
  const estadoPublico = async (folioSr: string) =>
    (
      await request(url)
        .get(`/facturacion/codigo/${(await codigoDe(folioSr)).codigo}`)
        .set('X-Forwarded-For', ip())
    ).body.estado as string;
  const solicitudes = (cfdiId: string) =>
    prisma.cfdiCancelacion.findMany({ where: { cfdiId }, orderBy: { solicitadaAt: 'asc' } });
  const emitirPortal = (codigo: string, receptor: object) =>
    request(url)
      .post(`/facturacion/portal/${SLUG_A1}/facturas`)
      .set('X-Forwarded-For', ip())
      .send({ codigo, receptor });
  const esperar = async (condicion: () => boolean) => {
    for (let i = 0; i < 200 && !condicion(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(condicion()).toBe(true);
  };
  const en = (iso: string) => (reloj.t = Date.parse(iso));

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.configuracionFacturacion.deleteMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
    });
    await crearFixtures(prisma);
    await prisma.sucursal.update({
      where: { id: FX.sucursalA1 },
      data: { apiKeyHash: hashApiKey(KEY_A1) },
    });
    const alta = new Date('2026-08-01T00:00:00Z');
    for (const empresaId of [FX.empresaA, FX.empresaB]) {
      await prisma.configuracionFacturacion.create({
        data: { empresaId, vigenciaCodigos: 'fin_de_mes', updatedAt: alta },
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
          csdVigenteDesde: new Date('2026-01-01T06:00:00Z'),
          csdVigenteHasta: new Date('2027-06-01T06:00:00Z'),
          csdCargadoAt: alta,
          updatedAt: alta,
        },
      });
    }
    await prisma.portalFacturacion.create({
      data: {
        sucursalId: FX.sucursalA1,
        empresaId: FX.empresaA,
        slug: SLUG_A1,
        color: '#0f766e',
        updatedAt: alta,
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

    const lote = await request(url)
      .post('/ingesta/eventos')
      .set('X-Api-Key', KEY_A1)
      .send({ eventos: CHEQUES });
    expect(lote.status).toBe(200);
    for (const [folioSr, dia, receptor] of EMISIONES) {
      en(`2026-09-${dia}T14:00:00-06:00`);
      const res = await emitirPortal((await codigoDe(folioSr)).codigo, RECEPTORES[receptor]);
      expect(res.status).toBe(201);
    }
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma.configuracionFacturacion.deleteMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
    });
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('punto de partida (a mano): septiembre 2300.00 facturado en 8 CFDI, tasa 1.0000, nada cancelado', async () => {
    const t = await tablero();
    expect(t.status).toBe(200);
    expect(t.body.ventas).toEqual({ venta: '2300.00', cuentas: 8 });
    expect(t.body.facturado).toEqual({ monto: '2300.00', cfdis: 8 });
    expect(t.body.cancelados).toEqual({ monto: '0.00', cfdis: 0 });
    expect(t.body.tasa).toBe('1.0000');
  });

  it('motivo 02: cancelado al instante, el ticket se suelta, aviso al receptor y la tasa baja', async () => {
    const c1 = await cfdiDe('C1');
    en('2026-09-15T10:00:00-06:00');
    const res = await cancelar(c1.id, { motivo: '02' });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      cfdiId: c1.id,
      uuid: c1.uuid,
      motivo: '02',
      estado: 'cancelado',
      mensaje: null,
    });
    expect(pac.falso.cancelacionDe(c1.uuid!)).toEqual({ motivo: '02' });
    const despues = await prisma.cfdi.findUniqueOrThrow({ where: { id: c1.id } });
    expect(despues).toMatchObject({
      estado: 'cancelado',
      motivoCancelacion: '02',
      canceladoAt: new Date('2026-09-15T16:00:00.000Z'),
      codigoId: null,
    });
    // El candado de emisión se soltó: el código vuelve a `pendiente` y el portal lo dice.
    expect((await codigoDe('C1')).estado).toBe('pendiente');
    expect(await estadoPublico('C1')).toBe('pendiente');
    const [s] = await solicitudes(c1.id);
    expect(s).toMatchObject({
      estado: 'aceptada',
      motivo: '02',
      uuidSustitucion: null,
      resueltaAt: new Date('2026-09-15T16:00:00.000Z'),
      avisoEnviadoAt: new Date('2026-09-15T16:00:00.000Z'),
      avisoError: null,
    });
    const avisos = correo.deCancelacion(RECEPTORES.eku.email);
    expect(avisos).toHaveLength(1);
    expect(avisos[0].adjuntos).toEqual([]);
    expect(avisos[0].plantilla.texto).toContain(c1.uuid);
    expect(avisos[0].plantilla.texto).toContain('Motivo: 02');
    // Tablero a mano: 2300 − 1000 = 1300.00 en 7; tasa 1300 / 2300 = 0.5652. Por facturar: C1.
    const t = await tablero();
    expect(t.body.facturado).toEqual({ monto: '1300.00', cfdis: 7 });
    expect(t.body.cancelados).toEqual({ monto: '1000.00', cfdis: 1 });
    expect(t.body.tasa).toBe('0.5652');
    expect(t.body.porFacturar).toEqual({ cuentas: 1, monto: '1000.00' });
    expect(await fila(c1.id)).toMatchObject({
      estado: 'cancelado',
      motivoCancelacion: '02',
      cancelacion: null,
    });
  });

  it('el ticket soltado se vuelve a facturar por el portal; el candado sigue valiendo (201 + 409)', async () => {
    en('2026-09-15T10:05:00-06:00');
    const { codigo } = await codigoDe('C1');
    const [a, b] = await Promise.all([
      emitirPortal(codigo, RECEPTORES.xia),
      emitirPortal(codigo, RECEPTORES.xia),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    const deC1 = await prisma.cfdi.findMany({
      where: { cheque: { folioSr: 'C1' } },
      orderBy: { emitidoAt: 'asc' },
    });
    expect(deC1.map((c) => c.estado)).toEqual(['cancelado', 'vigente']);
    expect(deC1[1].codigoId).toBe((await codigoDe('C1')).id);
    expect((await codigoDe('C1')).estado).toBe('facturado');
    const t = await tablero();
    expect(t.body.facturado).toEqual({ monto: '2300.00', cfdis: 8 });
    expect(t.body.porFacturar).toEqual({ cuentas: 0, monto: '0.00' });
  });

  it('forma, motivo y alcance: 400 / 409 / 404 / 403 sin llamar al PAC', async () => {
    const c2 = await cfdiDe('C2');
    const c1 = await cfdiDe('C1');
    const antes = pac.cancelaciones.length;
    expect((await cancelar(c2.id, { motivo: '05' })).status).toBe(400);
    const sinUuid = await cancelar(c2.id, { motivo: '01' });
    expect(sinUuid.status).toBe(400);
    expect(sinUuid.body.campos).toEqual({
      uuidSustitucion: expect.stringMatching(/motivo 01/),
    });
    expect((await cancelar(c2.id, { motivo: '01', uuidSustitucion: 'no-es-uuid' })).status).toBe(
      400,
    );
    const sin01 = await cancelar(c2.id, { motivo: '01', uuidSustitucion: c1.uuid });
    expect(sin01.status).toBe(409);
    expect(sin01.body.message).toBe(MENSAJE_01_SIN_SUSTITUTO);
    const con04 = await cancelar(c2.id, { motivo: '04' });
    expect(con04.status).toBe(409);
    expect(con04.body.message).toBe(MENSAJE_04_NO_GLOBAL);
    const otraVez = await cancelar(c1.id, { motivo: '02' });
    expect(otraVez.status).toBe(409);
    expect(otraVez.body.message).toBe(MENSAJE_YA_CANCELADA);
    expect((await cancelar('no-uuid', { motivo: '02' })).status).toBe(400);
    expect((await cancelar(c2.id, { motivo: '02' }, ADMIN_B)).status).toBe(404);
    expect((await cancelar(c2.id, { motivo: '02' }, VISOR_A)).status).toBe(403);
    expect((await cancelar('f2109000-0000-4000-8000-00000000dead', { motivo: '02' })).status).toBe(
      404,
    );
    expect((await consultar(c2.id, ADMIN_B)).status).toBe(404);
    const nada = await consultar(c2.id);
    expect(nada.status).toBe(409);
    expect(nada.body.message).toBe(MENSAJE_SIN_SOLICITUD);
    expect(pac.cancelaciones).toHaveLength(antes);
    expect(await solicitudes(c2.id)).toEqual([]);
  });

  it('motivo 03; una factura cancelada ya no se reenvía por correo (409)', async () => {
    const c2 = await cfdiDe('C2');
    en('2026-09-15T11:00:00-06:00');
    const res = await cancelar(c2.id, { motivo: '03' });
    expect(res.status).toBe(201);
    expect(res.body.estado).toBe('cancelado');
    expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: c2.id } })).toMatchObject({
      estado: 'cancelado',
      motivoCancelacion: '03',
      codigoId: null,
    });
    expect((await codigoDe('C2')).estado).toBe('pendiente');
    const reenvio = await post(ADMIN_A, `/facturacion/cfdis/${c2.id}/envios/reintento`);
    expect(reenvio.status).toBe(409);
    expect(reenvio.body.message).toBe(MENSAJE_REENVIO_CANCELADA);
  });

  it('EN PROCESO: la factura sigue contando; no se puede pedir otra ni refacturar; al aceptar, cae', async () => {
    const c3 = await cfdiDe('C3');
    en('2026-09-16T10:00:00-06:00');
    const res = await cancelar(c3.id, { motivo: '02' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ estado: 'en_proceso', mensaje: MENSAJE_EN_PROCESO });
    expect((await prisma.cfdi.findUniqueOrThrow({ where: { id: c3.id } })).estado).toBe('vigente');
    expect(correo.deCancelacion(RECEPTORES.acepta.email)).toHaveLength(0);
    // A mano: 2300 − 400 (C2) = 1900.00 en 7: C3 SIGUE contando mientras el receptor no acepte.
    let t = await tablero();
    expect(t.body.facturado).toEqual({ monto: '1900.00', cfdis: 7 });
    expect(t.body.tasa).toBe('0.8261');
    expect(await fila(c3.id)).toMatchObject({
      estado: 'vigente',
      cancelacion: {
        estado: 'en_proceso',
        motivo: '02',
        solicitadaAt: '2026-09-16T16:00:00.000Z',
        resueltaAt: null,
      },
    });
    const otra = await cancelar(c3.id, { motivo: '03' });
    expect(otra.status).toBe(409);
    expect(otra.body.message).toBe(MENSAJE_CANCELACION_ABIERTA);
    const emisiones = pac.emisiones.length;
    const refa = await refacturar(c3.id);
    expect(refa.status).toBe(409);
    expect(refa.body.message).toBe(MENSAJE_REFACTURAR_CON_CANCELACION);
    expect(pac.emisiones).toHaveLength(emisiones);
    // Consultar sin respuesta del receptor: nada cambia.
    const sigue = await consultar(c3.id);
    expect(sigue.status).toBe(200);
    expect(sigue.body).toEqual({
      cfdiId: c3.id,
      estado: 'en_proceso',
      mensaje: MENSAJE_EN_PROCESO,
    });
    // El receptor acepta: la consulta lo anota, avisa y la tasa baja.
    pac.falso.responderCancelacion(c3.uuid!, 'aceptar');
    en('2026-09-16T12:00:00-06:00');
    const acepto = await consultar(c3.id);
    expect(acepto.body).toEqual({ cfdiId: c3.id, estado: 'aceptada', mensaje: null });
    expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: c3.id } })).toMatchObject({
      estado: 'cancelado',
      motivoCancelacion: '02',
      canceladoAt: new Date('2026-09-16T18:00:00.000Z'),
      codigoId: null,
    });
    expect(correo.deCancelacion(RECEPTORES.acepta.email)).toHaveLength(1);
    // A mano: 1900 − 250 = 1650.00 en 6; tasa 1650 / 2300 = 0.7174.
    t = await tablero();
    expect(t.body.facturado).toEqual({ monto: '1650.00', cfdis: 6 });
    expect(t.body.tasa).toBe('0.7174');
    expect(t.body.cancelados).toEqual({ monto: '1650.00', cfdis: 3 });
    expect((await fila(c3.id))?.cancelacion).toBeNull();
  });

  it('RECHAZADA por el receptor: sigue vigente, la tabla lo dice y se puede volver a pedir', async () => {
    const c4 = await cfdiDe('C4');
    en('2026-09-17T09:00:00-06:00');
    expect((await cancelar(c4.id, { motivo: '02' })).body.estado).toBe('en_proceso');
    en('2026-09-17T09:30:00-06:00');
    const res = await consultar(c4.id);
    expect(res.body.estado).toBe('rechazada');
    expect((await prisma.cfdi.findUniqueOrThrow({ where: { id: c4.id } })).estado).toBe('vigente');
    expect(await fila(c4.id)).toMatchObject({
      estado: 'vigente',
      cancelacion: {
        estado: 'rechazada',
        motivo: '02',
        solicitadaAt: '2026-09-17T15:00:00.000Z',
        resueltaAt: '2026-09-17T15:30:00.000Z',
      },
    });
    expect((await codigoDe('C4')).estado).toBe('facturado');
    // Una nueva solicitud: otra fila (el historial se queda).
    en('2026-09-17T10:00:00-06:00');
    expect((await cancelar(c4.id, { motivo: '02' })).body.estado).toBe('en_proceso');
    expect((await solicitudes(c4.id)).map((s) => s.estado)).toEqual(['rechazada', 'en_proceso']);
  });

  it('AMBIGUO: se queda `solicitando` (502), no se repite a ciegas y a los 10 min se concilia', async () => {
    const c5 = await cfdiDe('C5');
    en('2026-09-18T10:00:00-06:00');
    pac.fallasCancelar = [new ErrorTimbrado('PAC_SIN_RESPUESTA', 'sin respuesta (prueba)', false)];
    const res = await cancelar(c5.id, { motivo: '02' });
    expect(res.status).toBe(502);
    expect(res.body.message).toBe(MENSAJE_CANCELACION_INCIERTA);
    const [s] = await solicitudes(c5.id);
    expect(s).toMatchObject({
      estado: 'solicitando',
      ultimoError: 'PAC_SIN_RESPUESTA: sin respuesta (prueba)',
    });
    expect(await fila(c5.id)).toMatchObject({ cancelacion: { estado: 'solicitando' } });
    const cancelaciones = pac.cancelaciones.length;
    expect((await cancelar(c5.id, { motivo: '02' })).status).toBe(409);
    // Menos de 10 min: puede haber una llamada en vuelo; la consulta no la toca.
    en('2026-09-18T10:09:00-06:00');
    expect((await consultar(c5.id)).body.estado).toBe('solicitando');
    // La consulta la MARCA (el sondeo rota por `updated_at`) y, como el PAC contestó, sin error.
    expect((await solicitudes(c5.id))[0]).toMatchObject({
      estado: 'solicitando',
      ultimoError: null,
      updatedAt: new Date('2026-09-18T16:09:00.000Z'),
    });
    // A los 10 min el PAC la ve vigente: nunca llegó; se libera (sin pedir otra cancelación).
    en('2026-09-18T10:11:00-06:00');
    expect((await consultar(c5.id)).body.estado).toBe('no_procedio');
    expect(await solicitudes(c5.id)).toEqual([]);
    expect(pac.cancelaciones).toHaveLength(cancelaciones);
    // PAC no disponible (no procesó): 503 y no queda solicitud.
    pac.fallasCancelar = [new ErrorTimbrado('PAC_NO_DISPONIBLE', 'no disponible (prueba)', true)];
    const caido = await cancelar(c5.id, { motivo: '02' });
    expect(caido.status).toBe(503);
    expect(caido.body.message).toBe(MENSAJE_PAC_CAIDO_CANCELACION);
    expect(await solicitudes(c5.id)).toEqual([]);
    // El PAC la rechaza: 422 con su mensaje, y no queda solicitud.
    pac.fallasCancelar = [new ErrorTimbrado('RECHAZADO_POR_PAC', 'El SAT dice que no (prueba).')];
    const rechazo = await cancelar(c5.id, { motivo: '02' });
    expect(rechazo.status).toBe(422);
    expect(rechazo.body.message).toBe('El SAT dice que no (prueba).');
    expect(await solicitudes(c5.id)).toEqual([]);
    expect((await cancelar(c5.id, { motivo: '02' })).body.estado).toBe('cancelado');
  });

  it('una solicitud ambigua VENCIDA se concilia sola al volver a pedir la cancelación', async () => {
    const c8 = await cfdiDe('C8');
    en('2026-09-18T11:00:00-06:00');
    pac.fallasCancelar = [new ErrorTimbrado('PAC_SIN_RESPUESTA', 'sin respuesta (prueba)', false)];
    expect((await cancelar(c8.id, { motivo: '02' })).status).toBe(502);
    en('2026-09-18T11:15:00-06:00');
    const res = await cancelar(c8.id, { motivo: '03' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ estado: 'cancelado', motivo: '03' });
    expect((await solicitudes(c8.id)).map((s) => [s.estado, s.motivo])).toEqual([
      ['aceptada', '03'],
    ]);
  });

  describe('refacturación × cancelación (B1: el mismo candado)', () => {
    it('con una cancelación abierta no se emite sustituto (tampoco bajo el candado de la base)', async () => {
      const c6 = await cfdiDe('C6');
      en('2026-09-19T10:00:00-06:00');
      pac.fallasCancelar = [
        new ErrorTimbrado('PAC_SIN_RESPUESTA', 'sin respuesta (prueba)', false),
      ];
      expect((await cancelar(c6.id, { motivo: '02' })).status).toBe(502);
      const emisiones = pac.emisiones.length;
      const folio = (
        await prisma.perfilFiscal.findFirstOrThrow({ where: { empresaId: FX.empresaA } })
      ).folioActual;
      const refa = await refacturar(c6.id);
      expect(refa.status).toBe(409);
      expect(refa.body.message).toBe(MENSAJE_REFACTURAR_CON_CANCELACION);
      // La misma regla, medida bajo el FOR UPDATE de `reservarSustituto` (la segunda red).
      await expect(
        app
          .get(ScopedPrismaService)
          .facturacion({ tipo: 'empresa', empresaId: FX.empresaA })
          .reservarSustituto(FX.empresaA, c6.id, { ...RECEPTORES.xia }, new Date(reloj.ahora())),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(pac.emisiones).toHaveLength(emisiones);
      expect(
        (await prisma.perfilFiscal.findFirstOrThrow({ where: { empresaId: FX.empresaA } }))
          .folioActual,
      ).toBe(folio);
      // Se concilia (nunca llegó) y queda libre.
      en('2026-09-19T10:11:00-06:00');
      expect((await consultar(c6.id)).body.estado).toBe('no_procedio');
    });

    it('con el sustituto EN EMISIÓN, cancelar con 02 es 409; al confirmarse, la 01 procede', async () => {
      const c6 = await cfdiDe('C6');
      en('2026-09-19T11:00:00-06:00');
      pac.cerrar();
      const emisiones = pac.emisiones.length;
      const enCurso = refacturar(c6.id);
      await esperar(() => pac.emisiones.length === emisiones + 1);
      const res = await cancelar(c6.id, { motivo: '02' });
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(MENSAJE_CON_SUSTITUTO);
      pac.abrir();
      const hecho = await enCurso;
      expect(hecho.status).toBe(201);
      expect(hecho.body.cancelacion).toBe('cancelado');
      const anterior = await cfdiDe('C6');
      expect(anterior).toMatchObject({ estado: 'cancelado', motivoCancelacion: '01' });
      expect(
        (await solicitudes(c6.id)).map((s) => [s.estado, s.motivo, s.uuidSustitucion]),
      ).toEqual([['aceptada', '01', hecho.body.nuevo.uuid]]);
    });

    it('el sustituto (con el anterior ya cancelado) sí se cancela con 02 y suelta el ticket', async () => {
      const sustituto = (await cfdiDe('C6')).sustituidoPor!;
      expect(sustituto.codigoId).toBe((await codigoDe('C6')).id);
      en('2026-09-19T12:00:00-06:00');
      const res = await cancelar(sustituto.id, { motivo: '02' });
      expect(res.status).toBe(201);
      expect(res.body.estado).toBe('cancelado');
      expect((await codigoDe('C6')).estado).toBe('pendiente');
      expect(
        (await prisma.cfdi.findUniqueOrThrow({ where: { id: sustituto.id } })).codigoId,
      ).toBeNull();
      // Una segunda refacturación del anterior sigue sin hacerse (F2-107).
      expect((await refacturar((await cfdiDe('C6')).id)).status).toBe(409);
    });

    it('O10: la 01 de una refacturación EN PROCESO; reintentar da `pendiente` sin volver a cancelar', async () => {
      const c7 = await cfdiDe('C7');
      en('2026-09-19T13:00:00-06:00');
      const res = await refacturar(c7.id);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        anterior: { id: c7.id, estado: 'vigente' },
        cancelacion: 'pendiente',
        mensaje: MENSAJE_CANCELACION_PENDIENTE,
      });
      const sustitutoId = res.body.nuevo.id as string;
      expect((await solicitudes(c7.id)).map((s) => [s.estado, s.motivo])).toEqual([
        ['en_proceso', '01'],
      ]);
      const cancelaciones = pac.cancelaciones.length;
      const emisiones = pac.emisiones.length;
      const otra = await refacturar(c7.id);
      expect(otra.status).toBe(201);
      expect(otra.body).toMatchObject({ cancelacion: 'pendiente', nuevo: { id: sustitutoId } });
      expect(pac.cancelaciones).toHaveLength(cancelaciones);
      expect(pac.emisiones).toHaveLength(emisiones);
      // Regla 3: el sustituto no se cancela mientras el anterior siga vigente.
      const sus = await cancelar(sustitutoId, { motivo: '02' });
      expect(sus.status).toBe(409);
      expect(sus.body.message).toBe(MENSAJE_ANTERIOR_VIGENTE);
      // Y el anterior tiene su solicitud abierta.
      expect((await cancelar(c7.id, { motivo: '02' })).body.message).toBe(
        MENSAJE_CANCELACION_ABIERTA,
      );
    });
  });

  it('SONDEO: dos vueltas a la vez resuelven cada solicitud UNA vez (un aviso, un cambio)', async () => {
    // El sondeo recorre TODAS las empresas (scope de sistema): la base de desarrollo puede traer
    // solicitudes del seed demo. Todo lo que se afirma aquí se mide SÓLO sobre las de los fixtures.
    const abiertasFixtures = () =>
      prisma.cfdiCancelacion.findMany({
        where: {
          empresaId: { in: [FX.empresaA, FX.empresaB] },
          estado: { in: ['solicitando', 'en_proceso'] },
        },
        select: { cfdiId: true },
      });
    const c7 = await cfdiDe('C7');
    const c4 = await cfdiDe('C4');
    // Abiertas: la 01 de C7 (en proceso) y la segunda de C4 (en proceso).
    expect((await abiertasFixtures()).map((x) => x.cfdiId).sort()).toEqual([c4.id, c7.id].sort());
    pac.falso.responderCancelacion(c7.uuid!, 'aceptar');
    en('2026-09-20T09:00:00-06:00');
    const antesAcepta = correo.deCancelacion(RECEPTORES.acepta.email).length;
    const antesTodos = correo.enviados.length;
    const servicio = app.get(CancelacionCfdiService);
    await Promise.all([servicio.vueltaAutomatica(), servicio.vueltaAutomatica()]);
    // C7 aceptada UNA vez (un aviso) y C4 rechazada UNA vez (el receptor que rechaza).
    expect(await cfdiDe('C7')).toMatchObject({ estado: 'cancelado', motivoCancelacion: '01' });
    expect((await solicitudes(c7.id)).map((x) => x.estado)).toEqual(['aceptada']);
    expect(correo.deCancelacion(RECEPTORES.acepta.email)).toHaveLength(antesAcepta + 1);
    expect(correo.enviados).toHaveLength(antesTodos + 1);
    expect((await solicitudes(c4.id)).map((x) => x.estado)).toEqual(['rechazada', 'rechazada']);
    expect(await abiertasFixtures()).toEqual([]);
    // Otra vuelta no vuelve a tocar nada de los fixtures.
    const antes = await prisma.cfdiCancelacion.findMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
      orderBy: { id: 'asc' },
    });
    await servicio.vueltaAutomatica();
    expect(
      await prisma.cfdiCancelacion.findMany({
        where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
        orderBy: { id: 'asc' },
      }),
    ).toEqual(antes);
    expect(correo.enviados).toHaveLength(antesTodos + 1);
  });

  describe('factura global (F2-108)', () => {
    const emitirGlobal = () =>
      post(ADMIN_A, '/facturacion/global', {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        periodicidad: 'mensual',
        clave: '2026-08-01',
      });
    const periodoAgosto = async () => {
      const res = await get(
        ADMIN_A,
        `/facturacion/global/periodos?empresaId=${FX.empresaA}&sucursalId=${FX.sucursalA1}`,
      );
      return (res.body.periodos as Array<{ clave: string }>).find((p) => p.clave === '2026-08-01');
    };

    it('cancelar la global (04) suelta sus tickets, guarda cuáles eran, y otra global los toma', async () => {
      en('2026-09-20T10:00:00-06:00');
      const emitida = await emitirGlobal();
      expect(emitida.status).toBe(201);
      const global = await prisma.cfdi.findFirstOrThrow({
        where: { empresaId: FX.empresaA, origen: 'global', estado: 'vigente' },
      });
      expect((await codigoDe('G1')).estado).toBe('en_global');
      const con01 = await cancelar(global.id, { motivo: '01', uuidSustitucion: global.uuid });
      expect(con01.status).toBe(409);
      expect(con01.body.message).toBe(MENSAJE_GLOBAL_SIN_SUSTITUCION);
      const avisos = correo.enviados.length;
      const res = await cancelar(global.id, { motivo: '04' });
      expect(res.status).toBe(201);
      expect(res.body.estado).toBe('cancelado');
      expect(await prisma.cfdiGlobalCodigo.count({ where: { cfdiId: global.id } })).toBe(0);
      for (const folioSr of ['G1', 'G2']) {
        expect((await codigoDe(folioSr)).estado).toBe('pendiente');
        expect(await estadoPublico(folioSr)).toBe('expirado');
      }
      // Lo que tenía, guardado con el total como TEXTO, centavo a centavo.
      const [s] = await solicitudes(global.id);
      const g1 = (await codigoDe('G1')).id;
      const g2 = (await codigoDe('G2')).id;
      expect(s.ticketsGlobal).toEqual(
        [
          { codigoId: g1, total: '30.00' },
          { codigoId: g2, total: '45.50' },
        ].sort((x, y) => (x.codigoId < y.codigoId ? -1 : 1)),
      );
      // La global no tiene correo del receptor: no se avisa a nadie.
      expect(correo.enviados).toHaveLength(avisos);
      expect(await periodoAgosto()).toMatchObject({
        estado: 'lista',
        tickets: 2,
        total: '75.50',
        globalesPrevias: 0,
        globalesCanceladas: 1,
      });
    });

    it('la emisión AUTOMÁTICA no re-emite un periodo con global cancelada; a mano, sí', async () => {
      await prisma.configuracionFacturacion.update({
        where: { empresaId: FX.empresaA },
        data: {
          globalAutomatica: true,
          globalAutomaticaDesde: new Date('2026-08-01T06:00:00Z'),
        },
      });
      try {
        expect(await app.get(FacturaGlobalService).vueltaAutomatica()).toEqual({
          emitidas: 0,
          fallidas: 0,
        });
      } finally {
        await prisma.configuracionFacturacion.update({
          where: { empresaId: FX.empresaA },
          data: { globalAutomatica: false, globalAutomaticaDesde: null },
        });
      }
      en('2026-09-20T11:00:00-06:00');
      const otra = await emitirGlobal();
      expect(otra.status).toBe(201);
      const nueva = await prisma.cfdi.findFirstOrThrow({
        where: { empresaId: FX.empresaA, origen: 'global', estado: 'vigente' },
      });
      expect(await prisma.cfdiGlobalCodigo.count({ where: { cfdiId: nueva.id } })).toBe(2);
      expect((await codigoDe('G1')).estado).toBe('en_global');
    });
  });

  describe('aviso por correo', () => {
    it('sin correo del receptor no se manda nada; si el correo falla, la cancelación igual procede', async () => {
      en('2026-09-21T10:00:00-06:00');
      const manual = await post(ADMIN_A, '/facturacion/cfdis/manual', {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        solicitudId: SOLICITUD_MANUAL,
        total: '500.00',
        formaPago: 'tarjeta',
        receptor: { ...RECEPTORES.eku, email: undefined },
      });
      expect(manual.status).toBe(201);
      const enviados = correo.enviados.length;
      expect((await cancelar(manual.body.id, { motivo: '02' })).body.estado).toBe('cancelado');
      expect(correo.enviados).toHaveLength(enviados);
      expect((await solicitudes(manual.body.id))[0]).toMatchObject({
        avisoEnviadoAt: null,
        avisoError: null,
      });

      // La re-emisión de C1 (receptor xia) con el correo caído.
      const reemision = await prisma.cfdi.findFirstOrThrow({
        where: { cheque: { folioSr: 'C1' }, estado: 'vigente' },
      });
      correo.falla = true;
      try {
        const res = await cancelar(reemision.id, { motivo: '02' });
        expect(res.status).toBe(201);
        expect(res.body.estado).toBe('cancelado');
      } finally {
        correo.falla = false;
      }
      expect((await solicitudes(reemision.id))[0]).toMatchObject({
        estado: 'aceptada',
        avisoEnviadoAt: null,
        avisoError: 'el servicio de correo no contestó (prueba)',
      });
    });
  });

  it('doble clic en cancelar: un 201 y un 409, una sola llamada al PAC', async () => {
    const c4 = await cfdiDe('C4');
    en('2026-09-22T10:00:00-06:00');
    const antes = pac.cancelaciones.length;
    const [a, b] = await Promise.all([
      cancelar(c4.id, { motivo: '03' }),
      cancelar(c4.id, { motivo: '03' }),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(pac.cancelaciones).toHaveLength(antes + 1);
  });

  it('cierre (a mano): lo facturado, lo cancelado y la tasa de septiembre', async () => {
    // Vigentes que cuentan: sólo el sustituto de C7 (300.00): C4 quedó `en_proceso` otra vez
    // (el receptor que rechaza) y sigue contando: 80.00. Total 380.00 en 2; tasa 380 / 2300.
    // Cancelados emitidos en septiembre: C1 1000 + C2 400 + C3 250 + C5 60 + C8 90 + C6 120 +
    // sustituto de C6 120 + C7 300 + manual 500 + re-emisión de C1 1000 + global 75.50.
    const c4 = await cfdiDe('C4');
    expect((await solicitudes(c4.id)).map((s) => s.estado)).toEqual([
      'rechazada',
      'rechazada',
      'en_proceso',
    ]);
    const t = await tablero();
    expect(t.body.facturado).toEqual({ monto: '380.00', cfdis: 2 });
    expect(t.body.tasa).toBe('0.1652');
    expect(t.body.cancelados).toEqual({ monto: '3915.50', cfdis: 11 });
    expect(t.body.global).toEqual({ monto: '75.50', cfdis: 1 });
  });
});
