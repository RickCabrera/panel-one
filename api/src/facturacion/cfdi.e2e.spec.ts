import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures } from '../../test/fixtures-auth';
import { PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import { MENSAJES_SAT } from '../adaptadores/timbrado/errores-sat';
import {
  ErrorTimbrado,
  type CfdiTimbrado,
  type PuertoTimbrado,
  type SolicitudCfdi,
} from '../adaptadores/timbrado/puerto';
import { TimbradoFalso } from '../adaptadores/timbrado/timbrado-falso';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import {
  EscrituraFacturacion,
  MENSAJE_NO_FACTURABLE,
  MENSAJE_SIN_FORMA_PAGO,
  type PedidoReserva,
} from '../scope/escritura-facturacion';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { Espera, MENSAJE_EMISION_INCIERTA } from './cfdi.service';
import { MENSAJE_ESTADO } from './codigo';
import { MENSAJE_EMISION_NO_DISPONIBLE } from './emision-portal';

// E2E de la emisión de CFDI (F2-104) por el POST del portal, sobre la app REAL contra Postgres
// REAL, con las fixtures sintéticas de F1-011 y el PAC FALSO envuelto en uno "controlado" (una
// compuerta para congelar el timbrado a media emisión, y fallas a la carta). Cubre: el 201 con la
// forma que consume el web, el candado por código (doble clic), los errores del SAT en español, lo
// que NO se escribe cuando algo falla, lo ambiguo que se QUEDA, y el scope de las escrituras.

const KEYS = {
  a1: 'msr_sintetica-cfdi-F2-104-sucursal-a1-000000000000001',
  b1: 'msr_sintetica-cfdi-F2-104-sucursal-b1-000000000000003',
} as const;

class RelojControlado extends Reloj {
  t: number | null = null;
  ahora(): number {
    return this.t ?? Date.now();
  }
}

/** El PAC falso, con una compuerta para congelarlo y fallas preparadas. Cuenta las llamadas. */
class PacControlado implements PuertoTimbrado {
  readonly llamadas: SolicitudCfdi[] = [];
  fallas: Error[] = [];
  #compuerta: Promise<void> | null = null;
  #abrir: (() => void) | null = null;
  constructor(private readonly falso: TimbradoFalso) {}

  cerrar(): void {
    this.#compuerta = new Promise((listo) => (this.#abrir = listo));
  }
  abrir(): void {
    this.#abrir?.();
    this.#compuerta = null;
  }

  registrarCsd: PuertoTimbrado['registrarCsd'] = (s) => this.falso.registrarCsd(s);
  cancelar: PuertoTimbrado['cancelar'] = (s) => this.falso.cancelar(s);
  consultarEstado: PuertoTimbrado['consultarEstado'] = (s) => this.falso.consultarEstado(s);

  async emitir(s: SolicitudCfdi): Promise<CfdiTimbrado> {
    this.llamadas.push(s);
    if (this.#compuerta) await this.#compuerta;
    const falla = this.fallas.shift();
    if (falla) throw falla;
    return this.falso.emitir(s);
  }
}

const EN_PLAZO = Date.parse('2026-09-20T12:00:00Z');
const CIERRE = '2026-09-15T14:00:00.000-06:00';
const SLUG_A1 = 'f2104-a1';
const SLUG_B1 = 'f2104-b1';
const UUID = /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/;

/** La respuesta 201 que el web usa en su test (una sola fuente: la del web). */
const FIXTURE_WEB = JSON.parse(
  readFileSync(
    join(__dirname, '../../../web/src/paginas/portal/factura-portal.fixture.json'),
    'utf8',
  ),
) as Record<string, unknown>;

const RECEPTOR = {
  rfc: 'EKU9003173C9',
  razonSocial: 'ESCUELA KEMPER URGATE',
  regimenFiscal: '601',
  cp: '42501',
  usoCfdi: 'G03',
  email: 'facturas@ejemplo.test',
};

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

describe('Emisión de CFDI por el portal (e2e, F2-104)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojControlado();
  const pac = new PacControlado(new TimbradoFalso({ ahora: () => reloj.ahora() }));
  let app: NestExpressApplication;
  let url: string;

  let ips = 0;
  const ip = () => `10.4.${Math.floor(++ips / 250)}.${ips % 250}`;
  const pedirFactura = (codigo: string, receptor: object = RECEPTOR, slug = SLUG_A1) =>
    request(url)
      .post(`/facturacion/portal/${slug}/facturas`)
      .set('X-Forwarded-For', ip())
      .send({ codigo, receptor });
  const consultar = (codigo: string) =>
    request(url)
      .get(`/facturacion/portal/${SLUG_A1}/codigo/${codigo}`)
      .set('X-Forwarded-For', ip());

  async function lote(key: string, eventos: object[]) {
    const res = await request(url).post('/ingesta/eventos').set('X-Api-Key', key).send({ eventos });
    expect(res.status).toBe(200);
    expect(res.body.rechazados).toEqual([]);
  }

  const filaCodigo = (folioSr: string) =>
    prisma.codigoFacturacion.findFirstOrThrow({
      where: { cheque: { sucursalId: FX.sucursalA1, folioSr } },
      include: { cfdi: true },
    });
  const folioActual = async () =>
    (await prisma.perfilFiscal.findFirstOrThrow({ where: { empresaId: FX.empresaA } })).folioActual;
  const cfdisDe = (codigoId: string) => prisma.cfdi.findMany({ where: { codigoId } });

  /** Todo lo que una emisión fallida NO debe tocar. */
  const foto = async () =>
    JSON.stringify({
      cfdis: await prisma.cfdi.findMany({
        where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
        orderBy: { id: 'asc' },
      }),
      codigos: await prisma.codigoFacturacion.findMany({
        where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
        orderBy: { codigo: 'asc' },
        select: { codigo: true, estado: true, updatedAt: true },
      }),
      receptores: await prisma.receptorFrecuente.findMany({
        where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
        orderBy: { rfc: 'asc' },
      }),
      perfiles: await prisma.perfilFiscal.findMany({
        where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
      }),
    });

  const escrituraDe = (empresaId: string): EscrituraFacturacion =>
    app.get(ScopedPrismaService).facturacion({ tipo: 'empresa', empresaId });

  async function pedidoDe(folioSr: string): Promise<PedidoReserva> {
    const c = await filaCodigo(folioSr);
    return {
      codigoId: c.id,
      chequeId: c.chequeId,
      sucursalId: c.sucursalId,
      receptor: { ...RECEPTOR },
    };
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    for (const [id, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalB1, KEYS.b1],
    ]) {
      await prisma.sucursal.update({ where: { id }, data: { apiKeyHash: hashApiKey(key) } });
    }
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .overrideProvider(PUERTO_TIMBRADO)
      .useValue(pac)
      .overrideProvider(Espera)
      .useValue({ esperar: () => Promise.resolve() })
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>(), {
      TRUST_PROXY_SALTOS: '1',
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    const folios = [
      'OK',
      'NI',
      'VALES',
      'COMPUERTA',
      'SIMULTANEO',
      'AMBIGUO',
      'CONFIRMA',
      'REINTENTO',
      'EXPIRA',
      'CANCELA',
      'REABRE',
      'SCOPE',
    ];
    await lote(
      KEYS.a1,
      folios.map((f, i) =>
        cheque(
          `c${i}`,
          `F2104-${f}`,
          f === 'VALES' ? { pagos: [{ formaRaw: 'VALES DESPENSA', monto: '315.50' }] } : {},
        ),
      ),
    );
    await lote(KEYS.b1, [cheque('b1', 'F2104-B')]);

    const ahora = new Date(EN_PLAZO);
    await prisma.formaPagoCatalogo.create({
      data: { empresaId: FX.empresaA, formaRaw: 'EFECTIVO', forma: 'efectivo' },
    });
    await prisma.perfilFiscal.create({
      data: {
        empresaId: FX.empresaA,
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
        csdVigenteHasta: new Date('2027-01-01T06:00:00Z'),
        csdCargadoAt: ahora,
        updatedAt: ahora,
      },
    });
    for (const [sucursalId, empresaId, slug] of [
      [FX.sucursalA1, FX.empresaA, SLUG_A1],
      [FX.sucursalB1, FX.empresaB, SLUG_B1],
    ]) {
      await prisma.portalFacturacion.create({
        data: { sucursalId, empresaId, slug, color: '#0f766e', updatedAt: ahora },
      });
    }
  });

  beforeEach(() => {
    reloj.t = EN_PLAZO;
    pac.fallas = [];
    pac.llamadas.length = 0;
  });

  afterAll(async () => {
    pac.abrir();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('el portal dice que PUEDE emitir con perfil activo y CSD vigente; sin perfil, no', async () => {
    const a = await request(url).get(`/facturacion/portal/${SLUG_A1}`).set('X-Forwarded-For', ip());
    expect(a.body.emisionDisponible).toBe(true);
    const b = await request(url).get(`/facturacion/portal/${SLUG_B1}`).set('X-Forwarded-For', ip());
    expect(b.body.emisionDisponible).toBe(false);
    // Con el CSD vencido tampoco.
    reloj.t = Date.parse('2027-01-01T06:00:00Z');
    const vencido = await request(url)
      .get(`/facturacion/portal/${SLUG_A1}`)
      .set('X-Forwarded-For', ip());
    expect(vencido.body.emisionDisponible).toBe(false);
  });

  it('201 con la forma EXACTA que consume el web → el código queda facturado → otro POST es 409', async () => {
    const c = await filaCodigo('F2104-OK');
    const antes = await folioActual();
    const res = await pedirFactura(c.codigo.toLowerCase(), {
      ...RECEPTOR,
      rfc: ' eku9003173c9 ',
    });
    expect(res.status).toBe(201);

    // La fixture del web (su test del flujo) tiene EXACTAMENTE estas llaves y tipos.
    expect(Object.keys(res.body).sort()).toEqual(Object.keys(FIXTURE_WEB).sort());
    // F2-105: `descargas` son enlaces firmados a `cfdi/{empresa}/{AAAA}/{MM}/{UUID}.{xml|pdf}`.
    const enlace = (ext: string) =>
      expect.stringMatching(
        new RegExp(
          String.raw`^/api/archivos/cfdi/${FX.empresaA}/\d{4}/\d{2}/${res.body.uuid}\.${ext}\?expira=\d+&firma=[A-Za-z0-9_-]+$`,
        ),
      );
    expect(res.body).toEqual({
      ...FIXTURE_WEB,
      uuid: expect.stringMatching(UUID),
      serieFolio: `A-${antes + 1}`,
      descargas: { xml: enlace('xml'), pdf: enlace('pdf') },
    });
    expect(FIXTURE_WEB.uuid).toMatch(UUID);
    expect(FIXTURE_WEB.serieFolio).toMatch(/^[A-Z0-9]{1,25}-\d+$/);

    // En la base: CFDI vigente con el timbre, importes del total, código facturado, folio usado.
    const [cfdi] = await cfdisDe(c.id);
    expect(cfdi).toMatchObject({
      estado: 'vigente',
      uuid: res.body.uuid,
      serie: 'A',
      folio: antes + 1,
      formaPago: '01',
      empresaId: FX.empresaA,
      sucursalId: FX.sucursalA1,
      chequeId: c.chequeId,
    });
    expect([cfdi.subtotal, cfdi.iva, cfdi.total].map((d) => d.toFixed(2))).toEqual([
      '271.98',
      '43.52',
      '315.50',
    ]);
    expect(cfdi.receptor).toEqual(RECEPTOR);
    expect(cfdi.emitidoAt).not.toBeNull();
    expect(await folioActual()).toBe(antes + 1);
    expect((await filaCodigo('F2104-OK')).estado).toBe('facturado');
    expect(pac.llamadas).toHaveLength(1);

    // El receptor quedó como frecuente, en la misma operación.
    expect(
      await prisma.receptorFrecuente.findFirst({
        where: { empresaId: FX.empresaA, rfc: 'EKU9003173C9' },
        select: { razonSocial: true, cp: true, usoCfdi: true, email: true },
      }),
    ).toEqual({
      razonSocial: RECEPTOR.razonSocial,
      cp: RECEPTOR.cp,
      usoCfdi: RECEPTOR.usoCfdi,
      email: RECEPTOR.email,
    });

    const otra = await pedirFactura(c.codigo);
    expect(otra.status).toBe(409);
    expect(otra.body).toMatchObject({ estado: 'facturado', message: MENSAJE_ESTADO.facturado });
    expect((await consultar(c.codigo)).body.estado).toBe('facturado');
    expect(await cfdisDe(c.id)).toHaveLength(1);
  });

  it('RFC que el SAT no encuentra: 400 con el mensaje AMABLE en `campos.rfc`, y no se guarda nada', async () => {
    const c = await filaCodigo('F2104-NI');
    const folio = await folioActual();
    const res = await pedirFactura(c.codigo, {
      ...RECEPTOR,
      rfc: 'XFAL010101NI0',
      regimenFiscal: '612', // persona física (13 caracteres)
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      statusCode: 400,
      error: 'Bad Request',
      message: [MENSAJES_SAT.RFC_NO_INSCRITO],
      campos: { rfc: MENSAJES_SAT.RFC_NO_INSCRITO },
    });
    expect(await cfdisDe(c.id)).toEqual([]);
    expect((await filaCodigo('F2104-NI')).estado).toBe('pendiente');
    expect(
      await prisma.receptorFrecuente.count({
        where: { empresaId: FX.empresaA, rfc: 'XFAL010101NI0' },
      }),
    ).toBe(0);
    // El folio sí se consumió (la reserva ya lo había tomado): queda como hueco, a propósito.
    expect(await folioActual()).toBe(folio + 1);
    // Y se puede corregir y volver a pedir.
    expect((await consultar(c.codigo)).body.estado).toBe('pendiente');
  });

  it('forma de pago sin catálogo (`otro`): 422 y NADA cambia, ni el folio', async () => {
    const c = await filaCodigo('F2104-VALES');
    const antes = await foto();
    const res = await pedirFactura(c.codigo);
    expect(res.status).toBe(422);
    expect(res.body.message).toBe(MENSAJE_SIN_FORMA_PAGO);
    expect(await foto()).toBe(antes);
    expect(pac.llamadas).toHaveLength(0);
  });

  it('empresa que no puede emitir (sin perfil fiscal): 503 y nada escrito', async () => {
    const b = await prisma.codigoFacturacion.findFirstOrThrow({
      where: { sucursalId: FX.sucursalB1 },
    });
    const antes = await foto();
    const res = await pedirFactura(b.codigo, RECEPTOR, SLUG_B1);
    expect(res.status).toBe(503);
    expect(res.body.message).toBe(MENSAJE_EMISION_NO_DISPONIBLE);
    expect(await foto()).toBe(antes);
  });

  it('DOBLE CLIC: mientras el primero timbra, el segundo es 409 `en_proceso`; al final, UN CFDI', async () => {
    const c = await filaCodigo('F2104-COMPUERTA');
    pac.cerrar();
    const primero = pedirFactura(c.codigo).then((r) => r);
    for (let i = 0; i < 500 && pac.llamadas.length === 0; i++) {
      await new Promise((listo) => setTimeout(listo, 10));
    }
    expect(pac.llamadas).toHaveLength(1);

    expect((await consultar(c.codigo)).body).toMatchObject({
      estado: 'en_proceso',
      mensaje: MENSAJE_ESTADO.en_proceso,
      ticket: null,
    });
    const segundo = await pedirFactura(c.codigo);
    expect(segundo.status).toBe(409);
    expect(segundo.body).toMatchObject({ estado: 'en_proceso' });

    pac.abrir();
    expect((await primero).status).toBe(201);
    expect(pac.llamadas).toHaveLength(1);
    expect(await cfdisDe(c.id)).toHaveLength(1);
    expect((await consultar(c.codigo)).body.estado).toBe('facturado');
  });

  it('dos POST simultáneos con el PAC normal: un 201 y un 409, una sola fila', async () => {
    const c = await filaCodigo('F2104-SIMULTANEO');
    const [a, b] = await Promise.all([pedirFactura(c.codigo), pedirFactura(c.codigo)]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await cfdisDe(c.id)).toHaveLength(1);
    expect(pac.llamadas).toHaveLength(1);
  });

  it('respuesta AMBIGUA del PAC: 502 que no invita a reintentar, la reserva SE QUEDA (en_proceso)', async () => {
    const c = await filaCodigo('F2104-AMBIGUO');
    pac.fallas = [new ErrorTimbrado('PAC_SIN_RESPUESTA', 'timeout', true)];
    const res = await pedirFactura(c.codigo);
    expect(res.status).toBe(502);
    expect(res.body.message).toBe(MENSAJE_EMISION_INCIERTA);
    expect(pac.llamadas).toHaveLength(1);
    const [reserva] = await cfdisDe(c.id);
    expect(reserva).toMatchObject({ estado: 'timbrando', uuid: null });
    expect((await consultar(c.codigo)).body.estado).toBe('en_proceso');
    const otra = await pedirFactura(c.codigo);
    expect(otra.status).toBe(409);
    expect(otra.body.estado).toBe('en_proceso');
    expect(pac.llamadas).toHaveLength(1);
  });

  it('el PAC timbra y la confirmación falla: 502, una sola llamada, la reserva se queda', async () => {
    const c = await filaCodigo('F2104-CONFIRMA');
    const espia = jest
      .spyOn(EscrituraFacturacion.prototype, 'confirmarCfdi')
      .mockRejectedValueOnce(new Error('base caída a media confirmación'));
    try {
      const res = await pedirFactura(c.codigo);
      expect(res.status).toBe(502);
      expect(res.body.message).toBe(MENSAJE_EMISION_INCIERTA);
    } finally {
      espia.mockRestore();
    }
    expect(pac.llamadas).toHaveLength(1);
    expect(await cfdisDe(c.id)).toEqual([expect.objectContaining({ estado: 'timbrando' })]);
    expect((await filaCodigo('F2104-CONFIRMA')).estado).toBe('pendiente');
  });

  it('PAC no disponible dos veces y luego sí: 201 tras 3 llamadas, un CFDI', async () => {
    const c = await filaCodigo('F2104-REINTENTO');
    pac.fallas = [
      new ErrorTimbrado('PAC_NO_DISPONIBLE', 'x', true),
      new ErrorTimbrado('PAC_NO_DISPONIBLE', 'x', true),
    ];
    const res = await pedirFactura(c.codigo);
    expect(res.status).toBe(201);
    expect(pac.llamadas).toHaveLength(3);
    expect(await cfdisDe(c.id)).toHaveLength(1);
  });

  describe('la reserva vuelve a medir todo CON el candado (EscrituraFacturacion)', () => {
    it('el código venció entre la consulta del portal y la reserva: 409 `expirado`, nada escrito', async () => {
      const c = await filaCodigo('F2104-EXPIRA');
      expect((await consultar(c.codigo)).body.estado).toBe('pendiente');
      const antes = await foto();
      await expect(
        escrituraDe(FX.empresaA).reservarCfdi(
          FX.empresaA,
          await pedidoDe('F2104-EXPIRA'),
          new Date(c.expiraAt.getTime()),
        ),
      ).rejects.toMatchObject({ status: 409, response: { estado: 'expirado' } });
      expect(await foto()).toBe(antes);
    });

    it('SR canceló la cuenta después de la consulta: 409 `cancelado`, nada escrito', async () => {
      const c = await filaCodigo('F2104-CANCELA');
      expect((await consultar(c.codigo)).body.estado).toBe('pendiente');
      await lote(KEYS.a1, [cheque('c-canc', 'F2104-CANCELA', { cancelado: true })]);
      const antes = await foto();
      await expect(
        escrituraDe(FX.empresaA).reservarCfdi(
          FX.empresaA,
          await pedidoDe('F2104-CANCELA'),
          new Date(EN_PLAZO),
        ),
      ).rejects.toMatchObject({ status: 409, response: { estado: 'cancelado' } });
      expect(await foto()).toBe(antes);
    });

    it('SR reabrió la cuenta (cerrado_at nulo otra vez): 422, nada escrito', async () => {
      const c = await filaCodigo('F2104-REABRE');
      await lote(KEYS.a1, [cheque('c-reabre', 'F2104-REABRE', { cerradoAt: null })]);
      // El código se queda y el portal lo sigue viendo pendiente (esquema-sr §2, reapertura)…
      expect((await consultar(c.codigo)).body.estado).toBe('pendiente');
      const antes = await foto();
      // …pero la cuenta abierta no se factura.
      await expect(
        escrituraDe(FX.empresaA).reservarCfdi(
          FX.empresaA,
          await pedidoDe('F2104-REABRE'),
          new Date(EN_PLAZO),
        ),
      ).rejects.toMatchObject({ status: 422, message: MENSAJE_NO_FACTURABLE });
      expect(await foto()).toBe(antes);
    });

    it('ids que no casan (el cheque de otro código): 404, nada escrito', async () => {
      const pedido = await pedidoDe('F2104-SCOPE');
      const otro = await filaCodigo('F2104-EXPIRA');
      const antes = await foto();
      await expect(
        escrituraDe(FX.empresaA).reservarCfdi(
          FX.empresaA,
          { ...pedido, chequeId: otro.chequeId },
          new Date(EN_PLAZO),
        ),
      ).rejects.toMatchObject({ status: 404 });
      expect(await foto()).toBe(antes);
    });
  });

  describe('scope de las escrituras nuevas (nunca 403: 404)', () => {
    it('con el scope de B, reservar un código de A: 404 (por la empresa y por el código), nada escrito', async () => {
      const pedido = await pedidoDe('F2104-SCOPE');
      const antes = await foto();
      await expect(
        escrituraDe(FX.empresaB).reservarCfdi(FX.empresaA, pedido, new Date(EN_PLAZO)),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        escrituraDe(FX.empresaB).reservarCfdi(FX.empresaB, pedido, new Date(EN_PLAZO)),
      ).rejects.toMatchObject({ status: 404 });
      expect(await foto()).toBe(antes);
    });

    it('con el scope de B, confirmar o liberar una reserva de A: 404 / nada, y la reserva sigue', async () => {
      const c = await filaCodigo('F2104-AMBIGUO');
      const [reserva] = await cfdisDe(c.id);
      expect(reserva.estado).toBe('timbrando');
      const timbre = {
        uuid: '6F1C2A57-3B8E-4D2A-9C41-7E0B5D3A2F10',
        idPac: 'ajeno',
        fechaTimbrado: new Date(EN_PLAZO),
      };
      const antes = await foto();
      await expect(
        escrituraDe(FX.empresaB).confirmarCfdi(
          FX.empresaB,
          reserva.id,
          timbre,
          RECEPTOR,
          new Date(EN_PLAZO),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        escrituraDe(FX.empresaB).confirmarCfdi(
          FX.empresaA,
          reserva.id,
          timbre,
          RECEPTOR,
          new Date(EN_PLAZO),
        ),
      ).rejects.toMatchObject({ status: 404 });
      await escrituraDe(FX.empresaB).liberarReserva(FX.empresaB, reserva.id);
      await expect(
        escrituraDe(FX.empresaB).liberarReserva(FX.empresaA, reserva.id),
      ).rejects.toMatchObject({ status: 404 });
      expect(await foto()).toBe(antes);
    });
  });
});
