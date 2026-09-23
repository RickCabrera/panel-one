import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient, RolUsuario } from '@prisma/client';
import request from 'supertest';

import { codigoDeterminista } from '../../prisma/seed-codigos';
import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import {
  ErrorTimbrado,
  type CfdiTimbrado,
  type PuertoTimbrado,
  type SolicitudCfdi,
} from '../adaptadores/timbrado/puerto';
import { TimbradoFalso } from '../adaptadores/timbrado/timbrado-falso';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import {
  MENSAJE_CLAVE_PERIODO,
  MENSAJE_GLOBAL_EN_CURSO,
  MENSAJE_GLOBAL_FUERA_DE_PLAZO,
  MENSAJE_GLOBAL_NO_SE_REFACTURA,
  MENSAJE_GLOBAL_SIN_TICKETS,
} from '../scope/escritura-facturacion';
import { Espera } from './cfdi.service';
import { estadoPublico } from './codigo';
import { MENSAJE_GLOBAL_INCIERTA, FacturaGlobalService } from './global.service';
import { periodoDe } from './global';

// E2E de F2-108 (factura global) sobre la app REAL contra Postgres REAL, con el PAC FALSO detrás de
// un doble con compuerta y fallas a la carta. Las pruebas corren EN ORDEN y comparten estado. Las
// cifras están ESCRITAS A MANO desde la fixture:
//
// A1 = CDMX (UTC−6), vigencia de códigos fin de mes, catálogo EFECTIVO→efectivo, VISA→tarjeta.
//   Agosto: G1 116.00 (efectivo) · G2 58.00 (VISA) · G3 100.01 · G9 20.00 (con un CFDI propio YA
//     cancelado) → entran a la global; G4 200.00 facturado por el portal; G5 300.00 con una
//     reserva `timbrando` propia (NO entra); G8 40.00 cancelado después de tener código (NO entra).
//     Global de agosto: 116.00 → 100.00+16.00 · 58.00 → 50.00+8.00 · 100.01 → 86.22+13.79 ·
//     20.00 → 17.24+2.76 = subtotal 253.46, IVA 40.55, total 294.01; forma 01 (efectivo 236.01 >
//     tarjeta 58.00).
//   Septiembre: S1 50.00 (su código vence el 1 de octubre).
// A2 = Tijuana (UTC−7 en agosto): T1 80.00 cerrado el 31 de agosto 23:30 LOCAL (en CDMX ya sería
//   septiembre): cae en AGOSTO de A2.

const KEY_A1 = 'msr_sintetica-factura-global-F2-108-sucursal-a1-000001';
const KEY_A2 = 'msr_sintetica-factura-global-F2-108-sucursal-a2-000002';
const SLUG_A1 = 'f2108-a1';

class RelojControlado extends Reloj {
  t: number | null = null;
  ahora(): number {
    return this.t ?? Date.now();
  }
}

/** El PAC falso con compuerta y fallas a la carta en la emisión. */
class PacControlado implements PuertoTimbrado {
  readonly emisiones: SolicitudCfdi[] = [];
  readonly xmlDe = new Map<string, string>();
  fallasEmitir: Error[] = [];
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
    const falla = this.fallasEmitir.shift();
    if (falla) throw falla;
    const t = await this.falso.emitir(s);
    this.xmlDe.set(t.uuid, t.xml);
    return t;
  }

  cancelar: PuertoTimbrado['cancelar'] = (s) => this.falso.cancelar(s);
  consultarEstado: PuertoTimbrado['consultarEstado'] = (s) => this.falso.consultarEstado(s);
}

const RECEPTOR = {
  rfc: 'EKU9003173C9',
  razonSocial: 'ESCUELA KEMPER URGATE',
  regimenFiscal: '601',
  cp: '42501',
  usoCfdi: 'G03',
  email: 'kemper@ejemplo.test',
};

function cheque(folioSr: string, cerradoAt: string, total: string, formaRaw = 'EFECTIVO') {
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
      pagos: [{ formaRaw, monto: total }],
    },
  };
}

const CHEQUES_A1 = [
  cheque('G1', '2026-08-05T13:00:00-06:00', '116.00'),
  cheque('G2', '2026-08-10T13:00:00-06:00', '58.00', 'VISA'),
  cheque('G3', '2026-08-20T13:00:00-06:00', '100.01'),
  cheque('G4', '2026-08-25T13:00:00-06:00', '200.00'),
  cheque('G5', '2026-08-28T13:00:00-06:00', '300.00'),
  cheque('G8', '2026-08-12T13:00:00-06:00', '40.00'),
  cheque('G9', '2026-08-22T13:00:00-06:00', '20.00'),
  cheque('S1', '2026-09-10T13:00:00-06:00', '50.00'),
];
const CHEQUES_A2 = [cheque('T1', '2026-08-31T23:30:00-07:00', '80.00')];

const HOY = Date.parse('2026-09-23T12:00:00-06:00');
const OCTUBRE = Date.parse('2026-10-01T12:00:00-06:00');

type Usuario = { id: string; rol: RolUsuario; empresaId: string | null };
const ADMIN_A: Usuario = USUARIOS.adminEmpresaA;
const ADMIN_B: Usuario = {
  id: 'f2108000-0000-4000-8000-0000000000b0',
  rol: RolUsuario.admin_empresa,
  empresaId: FX.empresaB,
};
const VISOR_A: Usuario = USUARIOS.visorA;

describe('Factura global (e2e, F2-108)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojControlado();
  const pac = new PacControlado(new TimbradoFalso({ ahora: () => reloj.ahora() }));
  let app: NestExpressApplication;
  let url: string;
  let ips = 0;
  const ip = () => `10.8.${Math.floor(++ips / 250)}.${ips % 250}`;

  const token = (u: Usuario) => app.get(TokensService).firmarAccess(u);
  const get = async (u: Usuario, ruta: string) =>
    request(url)
      .get(ruta)
      .set('Authorization', `Bearer ${await token(u)}`);
  const enviar = async (u: Usuario, metodo: 'post' | 'put', ruta: string, cuerpo: object) =>
    request(url)
      [metodo](ruta)
      .set('Authorization', `Bearer ${await token(u)}`)
      .send(cuerpo);
  const periodos = (sucursalId: string, extra = '', u: Usuario = ADMIN_A) =>
    get(
      u,
      `/facturacion/global/periodos?empresaId=${FX.empresaA}&sucursalId=${sucursalId}${extra}`,
    );
  const vistaPrevia = (
    clave: string,
    sucursalId: string = FX.sucursalA1,
    periodicidad = 'mensual',
  ) =>
    get(
      ADMIN_A,
      `/facturacion/global/periodos/${clave}?empresaId=${FX.empresaA}&sucursalId=${sucursalId}` +
        `&periodicidad=${periodicidad}`,
    );
  const emitir = (cuerpo: Record<string, unknown> = {}, u: Usuario = ADMIN_A) =>
    enviar(u, 'post', '/facturacion/global', {
      empresaId: FX.empresaA,
      sucursalId: FX.sucursalA1,
      periodicidad: 'mensual',
      clave: '2026-08-01',
      ...cuerpo,
    });
  const configurar = (automatica: boolean) =>
    enviar(ADMIN_A, 'put', '/facturacion/global/configuracion', {
      empresaId: FX.empresaA,
      periodicidad: 'mensual',
      automatica,
    });
  const codigoDe = async (folioSr: string) =>
    (
      await prisma.codigoFacturacion.findFirstOrThrow({
        where: { cheque: { folioSr, empresaId: FX.empresaA } },
      })
    ).codigo;
  const folioActual = async () =>
    (await prisma.perfilFiscal.findFirstOrThrow({ where: { empresaId: FX.empresaA } })).folioActual;
  const globales = (sucursalId: string) =>
    prisma.cfdi.findMany({
      where: { empresaId: FX.empresaA, sucursalId, origen: 'global' },
      include: { globalCodigos: { include: { codigo: { include: { cheque: true } } } } },
      orderBy: { folio: 'asc' },
    });
  const esperar = async (condicion: () => boolean) => {
    for (let i = 0; i < 300 && !condicion(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(condicion()).toBe(true);
  };
  const periodo = (cuerpo: { periodos: Array<{ clave: string }> }, clave: string) =>
    cuerpo.periodos.find((p) => p.clave === clave);

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.configuracionFacturacion.deleteMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
    });
    await crearFixtures(prisma);
    await prisma.sucursal.update({
      where: { id: FX.sucursalA2 },
      data: { zonaHoraria: 'America/Tijuana', apiKeyHash: hashApiKey(KEY_A2) },
    });
    await prisma.sucursal.update({
      where: { id: FX.sucursalA1 },
      data: { apiKeyHash: hashApiKey(KEY_A1) },
    });
    const alta = new Date('2026-07-01T00:00:00Z');
    for (const empresaId of [FX.empresaA, FX.empresaB]) {
      await prisma.configuracionFacturacion.create({
        data: { empresaId, vigenciaCodigos: 'fin_de_mes', updatedAt: alta },
      });
      await prisma.formaPagoCatalogo.createMany({
        data: [
          { empresaId, formaRaw: 'EFECTIVO', forma: 'efectivo' },
          { empresaId, formaRaw: 'VISA', forma: 'tarjeta' },
        ],
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
      .overrideProvider(Espera)
      .useValue({ esperar: () => Promise.resolve() })
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>(), {
      TRUST_PROXY_SALTOS: '1',
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    for (const [key, eventos] of [
      [KEY_A1, CHEQUES_A1],
      [KEY_A2, CHEQUES_A2],
    ] as const) {
      const lote = await request(url)
        .post('/ingesta/eventos')
        .set('X-Api-Key', key)
        .send({ eventos });
      expect(lote.status).toBe(200);
    }
    // G4 se factura por el portal el 25 de agosto.
    reloj.t = Date.parse('2026-08-25T14:00:00-06:00');
    const res = await request(url)
      .post(`/facturacion/portal/${SLUG_A1}/facturas`)
      .set('X-Forwarded-For', ip())
      .send({ codigo: await codigoDe('G4'), receptor: RECEPTOR });
    expect(res.status).toBe(201);
    // G5: una reserva propia colgada en `timbrando` (el "Y además (de F2-104)").
    const perfil = await prisma.perfilFiscal.findFirstOrThrow({
      where: { empresaId: FX.empresaA },
    });
    const g5 = await prisma.codigoFacturacion.findFirstOrThrow({
      where: { cheque: { folioSr: 'G5', empresaId: FX.empresaA } },
    });
    const g9 = await prisma.codigoFacturacion.findFirstOrThrow({
      where: { cheque: { folioSr: 'G9', empresaId: FX.empresaA } },
    });
    const base = {
      empresaId: FX.empresaA,
      sucursalId: FX.sucursalA1,
      perfilFiscalId: perfil.id,
      serie: 'Z',
      receptor: RECEPTOR,
      formaPago: '01',
      updatedAt: alta,
    };
    await prisma.cfdi.create({
      data: {
        ...base,
        chequeId: g5.chequeId,
        codigoId: g5.id,
        folio: 1,
        subtotal: '258.62',
        iva: '41.38',
        total: '300.00',
        estado: 'timbrando',
      },
    });
    // G9: tuvo un CFDI que después se canceló (vuelve a ser facturable, y ya expiró).
    await prisma.cfdi.create({
      data: {
        ...base,
        chequeId: g9.chequeId,
        codigoId: g9.id,
        folio: 2,
        subtotal: '17.24',
        iva: '2.76',
        total: '20.00',
        estado: 'cancelado',
        uuid: 'F2108000-0000-4000-8000-0000000000C9',
        idPac: 'F2108000-0000-4000-8000-0000000000C9',
        emitidoAt: new Date('2026-08-22T15:00:00-06:00'),
        canceladoAt: new Date('2026-08-23T15:00:00-06:00'),
      },
    });
    // G8: SR cancela la cuenta DESPUÉS de que tuvo código.
    await prisma.cheque.updateMany({
      where: { folioSr: 'G8', empresaId: FX.empresaA },
      data: { cancelado: true },
    });
    reloj.t = HOY;
  }, 120_000);

  afterAll(async () => {
    await app?.close();
    await prisma.configuracionFacturacion.deleteMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
    });
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  // ---------------------------------------------------------------------------------------------
  describe('periodos y vista previa', () => {
    it('A1 mensual: agosto `lista` con 4 tickets por 294.01; septiembre `en_curso`', async () => {
      const res = await periodos(FX.sucursalA1);
      expect(res.status).toBe(200);
      expect(res.body.periodicidad).toBe('mensual');
      expect(res.body.sucursal).toEqual({
        id: FX.sucursalA1,
        nombre: 'A1',
        zonaHoraria: 'America/Mexico_City',
      });
      expect(res.body.periodos).toEqual([
        {
          clave: '2026-09-01',
          ultimoDia: '2026-09-30',
          periodicidad: 'mensual',
          etiqueta: 'septiembre de 2026',
          desde: '2026-09-01T06:00:00.000Z',
          hasta: '2026-10-01T06:00:00.000Z',
          periodicidadSat: '04',
          meses: '09',
          anio: 2026,
          estado: 'en_curso',
          tickets: 0,
          total: '0.00',
          vigentes: 1,
          vigentesHasta: '2026-10-01T06:00:00.000Z',
          globalesPrevias: 0,
        },
        {
          clave: '2026-08-01',
          ultimoDia: '2026-08-31',
          periodicidad: 'mensual',
          etiqueta: 'agosto de 2026',
          desde: '2026-08-01T06:00:00.000Z',
          hasta: '2026-09-01T06:00:00.000Z',
          periodicidadSat: '04',
          meses: '08',
          anio: 2026,
          estado: 'lista',
          tickets: 4,
          total: '294.01',
          vigentes: 0,
          vigentesHasta: null,
          globalesPrevias: 0,
        },
      ]);
      expect(res.body.emitidas).toEqual([]);
    });

    it('A2 (Tijuana): el ticket del 31 de agosto 23:30 local cae en AGOSTO de A2', async () => {
      const res = await periodos(FX.sucursalA2);
      expect(res.status).toBe(200);
      expect(
        res.body.periodos.map((p: Record<string, unknown>) => [
          p.clave,
          p.desde,
          p.hasta,
          p.estado,
          p.tickets,
          p.total,
        ]),
      ).toEqual([
        ['2026-08-01', '2026-08-01T07:00:00.000Z', '2026-09-01T07:00:00.000Z', 'lista', 1, '80.00'],
      ]);
    });

    it('diaria: el 10 de septiembre ya terminó pero S1 todavía se puede facturar → `esperando`', async () => {
      const res = await periodos(FX.sucursalA1, '&periodicidad=diaria');
      expect(res.status).toBe(200);
      expect(periodo(res.body, '2026-09-10')).toMatchObject({
        estado: 'esperando',
        tickets: 0,
        vigentes: 1,
        vigentesHasta: '2026-10-01T06:00:00.000Z',
        etiqueta: '10 de septiembre de 2026',
        periodicidadSat: '01',
      });
      expect(periodo(res.body, '2026-08-05')).toMatchObject({ estado: 'lista', tickets: 1 });
    });

    it('el SQL de periodos dice lo mismo que `estadoPublico`, rama por rama', async () => {
      // Todas las ramas están en agosto de A1: expirado (G1–G3), facturado (G4), reserva propia en
      // timbrando (G5), cuenta cancelada (G8), CFDI propio cancelado (G9), y S1 pendiente.
      const codigos = await prisma.codigoFacturacion.findMany({
        where: { empresaId: FX.empresaA, sucursalId: FX.sucursalA1 },
        include: {
          cfdi: { select: { estado: true } },
          global: { select: { cfdi: { select: { estado: true } } } },
          cheque: true,
        },
      });
      expect(codigos).toHaveLength(8);
      const esperado = new Map<
        string,
        { tickets: number; vigentes: number; total: Prisma.Decimal }
      >();
      const ramas: Record<string, string> = {};
      for (const c of codigos) {
        const estado = estadoPublico(c, c.cheque, reloj.t!);
        ramas[c.cheque.folioSr] = estado;
        const clave = periodoDe(c.cheque.cerradoAt!, 'America/Mexico_City', 'mensual').clave;
        const e = esperado.get(clave) ?? { tickets: 0, vigentes: 0, total: new Prisma.Decimal(0) };
        if (estado === 'expirado' && c.global === null) {
          e.tickets++;
          e.total = e.total.add(c.cheque.total);
        }
        if (estado === 'pendiente') e.vigentes++;
        esperado.set(clave, e);
      }
      expect(ramas).toEqual({
        G1: 'expirado',
        G2: 'expirado',
        G3: 'expirado',
        G4: 'facturado',
        G5: 'en_proceso',
        G8: 'cancelado',
        G9: 'expirado',
        S1: 'pendiente',
      });
      const res = await periodos(FX.sucursalA1);
      for (const [clave, e] of esperado) {
        expect([clave, periodo(res.body, clave)]).toMatchObject([
          clave,
          { tickets: e.tickets, vigentes: e.vigentes, total: e.total.toFixed(2) },
        ]);
      }
    });

    it('vista previa de agosto: 4 tickets, 253.46 + 40.55 = 294.01, forma 01, InformacionGlobal 04/08/2026', async () => {
      const res = await vistaPrevia('2026-08-01');
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        sucursal: { id: FX.sucursalA1, nombre: 'A1', zonaHoraria: 'America/Mexico_City' },
        periodo: {
          clave: '2026-08-01',
          ultimoDia: '2026-08-31',
          periodicidad: 'mensual',
          etiqueta: 'agosto de 2026',
          desde: '2026-08-01T06:00:00.000Z',
          hasta: '2026-09-01T06:00:00.000Z',
          periodicidadSat: '04',
          meses: '08',
          anio: 2026,
        },
        estado: 'lista',
        tickets: [
          { folio: 'T-G1', cerradoAt: '2026-08-05T19:00:00.000Z', total: '116.00' },
          { folio: 'T-G2', cerradoAt: '2026-08-10T19:00:00.000Z', total: '58.00' },
          { folio: 'T-G3', cerradoAt: '2026-08-20T19:00:00.000Z', total: '100.01' },
          { folio: 'T-G9', cerradoAt: '2026-08-22T19:00:00.000Z', total: '20.00' },
        ],
        vigentes: 0,
        vigentesHasta: null,
        formaPago: '01',
        subtotal: '253.46',
        iva: '40.55',
        total: '294.01',
        globalesPrevias: 0,
      });
    });

    it('una clave que no es inicio de periodo es 400', async () => {
      const res = await vistaPrevia('2026-08-02');
      expect(res.status).toBe(400);
      expect(res.body.message).toEqual([MENSAJE_CLAVE_PERIODO]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('alcance', () => {
    it('visor 403; admin de otra empresa 404; sucursal de otra empresa 404', async () => {
      expect((await periodos(FX.sucursalA1, '', VISOR_A)).status).toBe(403);
      expect((await emitir({}, VISOR_A)).status).toBe(403);
      expect(
        (await get(VISOR_A, `/facturacion/global/configuracion?empresaId=${FX.empresaA}`)).status,
      ).toBe(403);
      expect((await periodos(FX.sucursalA1, '', ADMIN_B)).status).toBe(404);
      expect((await emitir({}, ADMIN_B)).status).toBe(404);
      expect(
        (await get(ADMIN_B, `/facturacion/global/configuracion?empresaId=${FX.empresaA}`)).status,
      ).toBe(404);
      expect((await periodos(FX.sucursalB1)).status).toBe(404);
      expect((await emitir({ sucursalId: FX.sucursalB1 })).status).toBe(404);
      expect((await vistaPrevia('2026-08-01', FX.sucursalB1)).status).toBe(404);
      expect(await folioActual()).toBe(101);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('emisión', () => {
    it('no se emite lo que no se debe, y ninguno de esos rechazos toma folio', async () => {
      const casos: Array<[Record<string, unknown>, number, string | string[]]> = [
        [{ clave: '2026-09-01' }, 409, MENSAJE_GLOBAL_EN_CURSO],
        [{ clave: '2024-08-01' }, 422, MENSAJE_GLOBAL_FUERA_DE_PLAZO],
        [{ clave: '2026-08-02' }, 400, [MENSAJE_CLAVE_PERIODO]],
      ];
      for (const [cuerpo, status, mensaje] of casos) {
        const res = await emitir(cuerpo);
        expect([cuerpo, res.status, res.body.message]).toEqual([cuerpo, status, mensaje]);
      }
      const esperando = await emitir({ periodicidad: 'diaria', clave: '2026-09-10' });
      expect(esperando.status).toBe(409);
      expect(esperando.body.message).toMatch(/un ticket todavía se puede facturar/);
      expect(await folioActual()).toBe(101);
      expect(await globales(FX.sucursalA1)).toEqual([]);
    });

    it('doble clic: dos POST a la vez → 201 + 409 y UNA sola global; mientras timbra, el ticket dice en_proceso', async () => {
      pac.cerrar();
      const primero = emitir();
      await esperar(() => pac.emisiones.some((s) => s.informacionGlobal !== undefined));
      const segundo = await emitir();
      expect(segundo.status).toBe(409);
      expect(segundo.body.message).toBe(MENSAJE_GLOBAL_SIN_TICKETS);
      const enProceso = await request(url)
        .get(`/facturacion/portal/${SLUG_A1}/codigo/${await codigoDe('G1')}`)
        .set('X-Forwarded-For', ip());
      expect(enProceso.body.estado).toBe('en_proceso');
      pac.abrir();
      const res = await primero;
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        serieFolio: 'A-102',
        total: '294.01',
        tickets: 4,
        etiqueta: 'agosto de 2026',
      });
      expect(res.body.descargas.xml).toEqual(expect.any(String));
      expect(await folioActual()).toBe(102);

      const [global] = await globales(FX.sucursalA1);
      expect(global).toMatchObject({
        origen: 'global',
        estado: 'vigente',
        chequeId: null,
        codigoId: null,
        formaPago: '01',
        globalPeriodicidad: '04',
        globalMeses: '08',
        globalAnio: 2026,
        globalDesde: new Date('2026-08-01T06:00:00.000Z'),
        globalHasta: new Date('2026-09-01T06:00:00.000Z'),
        receptor: {
          rfc: 'XAXX010101000',
          razonSocial: 'PUBLICO EN GENERAL',
          regimenFiscal: '616',
          cp: '06700',
          usoCfdi: 'S01',
          email: null,
        },
      });
      expect([global.subtotal.toFixed(2), global.iva.toFixed(2), global.total.toFixed(2)]).toEqual([
        '253.46',
        '40.55',
        '294.01',
      ]);
      expect(
        global.globalCodigos
          .map((g) => [g.codigo.cheque.folioSr, g.total.toFixed(2), g.codigo.estado, g.sucursalId])
          .sort(),
      ).toEqual([
        ['G1', '116.00', 'en_global', FX.sucursalA1],
        ['G2', '58.00', 'en_global', FX.sucursalA1],
        ['G3', '100.01', 'en_global', FX.sucursalA1],
        ['G9', '20.00', 'en_global', FX.sucursalA1],
      ]);
      // El XML del PAC: InformacionGlobal, público en general y un concepto por ticket.
      const xml = pac.xmlDe.get(global.uuid!)!;
      expect(xml).toContain('<cfdi:InformacionGlobal Periodicidad="04" Meses="08" Año="2026"/>');
      expect(xml).toContain('Rfc="XAXX010101000"');
      expect(xml.match(/ClaveProdServ="01010101"/g)).toHaveLength(4);
      // Nada de correo: la global no tiene a quién enviarse.
      expect(await prisma.cfdiEnvio.count({ where: { cfdiId: global.id } })).toBe(0);
      // G5 (reserva propia) y G4 (facturado) NO entraron.
      for (const folioSr of ['G4', 'G5', 'G8']) {
        const c = await prisma.codigoFacturacion.findFirstOrThrow({
          where: { cheque: { folioSr, empresaId: FX.empresaA } },
          include: { global: true },
        });
        expect([folioSr, c.global]).toEqual([folioSr, null]);
      }
    });

    it('el portal ya no factura un ticket de la global y lo explica con su periodo', async () => {
      const codigo = await codigoDe('G1');
      const mensaje =
        'Este ticket se incluyó en la factura global del periodo agosto de 2026 y ya no se puede ' +
        'facturar aquí. Si necesitas aclararlo, contacta al restaurante.';
      const consulta = await request(url)
        .get(`/facturacion/portal/${SLUG_A1}/codigo/${codigo}`)
        .set('X-Forwarded-For', ip());
      expect(consulta.status).toBe(200);
      expect(consulta.body).toEqual({
        codigo,
        estado: 'en_global',
        mensaje,
        periodoGlobal: 'agosto de 2026',
        ticket: null,
      });
      const post = await request(url)
        .post(`/facturacion/portal/${SLUG_A1}/facturas`)
        .set('X-Forwarded-For', ip())
        .send({ codigo, receptor: RECEPTOR });
      expect(post.status).toBe(409);
      expect(post.body).toMatchObject({ estado: 'en_global', message: mensaje });
      const publica = await request(url)
        .get(`/facturacion/codigo/${codigo}`)
        .set('X-Forwarded-For', ip());
      expect(publica.body).toMatchObject({
        estado: 'en_global',
        mensaje,
        periodoGlobal: 'agosto de 2026',
      });
      const tickets = await get(
        VISOR_A,
        `/ventas/tickets?empresaId=${FX.empresaA}&desde=2026-08-05&hasta=2026-08-05`,
      );
      expect(tickets.status).toBe(200);
      expect(
        (tickets.body.items as Array<{ folio: string; codigoFacturacion: unknown }>).find(
          (t) => t.folio === 'T-G1',
        )?.codigoFacturacion,
      ).toEqual({ codigo, estado: 'en_global', mensaje, periodoGlobal: 'agosto de 2026' });
    });

    it('la global emitida sale en la lista y agosto ya no tiene tickets; una global no se refactura', async () => {
      const res = await periodos(FX.sucursalA1);
      expect(periodo(res.body, '2026-08-01')).toBeUndefined();
      expect(res.body.emitidas).toEqual([
        expect.objectContaining({
          serieFolio: 'A-102',
          estado: 'vigente',
          total: '294.01',
          etiqueta: 'agosto de 2026',
          periodicidad: 'mensual',
          tickets: 4,
          conArchivos: true,
        }),
      ]);
      const [global] = await globales(FX.sucursalA1);
      const refacturar = await enviar(
        ADMIN_A,
        'post',
        `/facturacion/cfdis/${global.id}/refacturar`,
        {
          receptor: RECEPTOR,
        },
      );
      expect(refacturar.status).toBe(409);
      expect(refacturar.body.message).toBe(MENSAJE_GLOBAL_NO_SE_REFACTURA);
      expect(await folioActual()).toBe(102);
    });

    it('un ticket que llega TARDE a un periodo con global: `lista` como complementaria', async () => {
      const lote = await request(url)
        .post('/ingesta/eventos')
        .set('X-Api-Key', KEY_A1)
        .send({ eventos: [cheque('G10', '2026-08-27T13:00:00-06:00', '30.00')] });
      expect(lote.status).toBe(200);
      const res = await periodos(FX.sucursalA1);
      expect(periodo(res.body, '2026-08-01')).toMatchObject({
        estado: 'lista',
        tickets: 1,
        total: '30.00',
        globalesPrevias: 1,
      });
      expect((await vistaPrevia('2026-08-01')).body).toMatchObject({
        globalesPrevias: 1,
        total: '30.00',
      });
    });

    it('un ticket de otra sucursal NO puede colgar de la global (FK con sucursal)', async () => {
      const [global] = await globales(FX.sucursalA1);
      const t1 = await prisma.codigoFacturacion.findFirstOrThrow({
        where: { cheque: { folioSr: 'T1', empresaId: FX.empresaA } },
      });
      for (const sucursal of [FX.sucursalA1, FX.sucursalA2]) {
        await expect(
          prisma.$executeRaw`INSERT INTO cfdi_global_codigos
            (id, empresa_id, sucursal_id, cfdi_id, codigo_id, total)
            VALUES (gen_random_uuid(), ${FX.empresaA}::uuid, ${sucursal}::uuid,
                    ${global.id}::uuid, ${t1.id}::uuid, 80.00)`,
        ).rejects.toThrow(/cfdi_global_codigos_(cfdi|codigo)_fkey/);
      }
    });

    it('PAC rechaza: se libera (los tickets vuelven a estar disponibles); ambiguo: 502 y se quedan amarrados', async () => {
      pac.fallasEmitir.push(new ErrorTimbrado('RECHAZADO_POR_PAC', 'rechazo sintético'));
      const rechazo = await emitir({ sucursalId: FX.sucursalA2 });
      expect(rechazo.status).toBe(422);
      expect(await globales(FX.sucursalA2)).toEqual([]);
      expect(periodo((await periodos(FX.sucursalA2)).body, '2026-08-01')).toMatchObject({
        estado: 'lista',
        tickets: 1,
      });
      // El folio tomado queda como hueco (el CFDI 4.0 no exige consecutivos).
      expect(await folioActual()).toBe(103);

      pac.fallasEmitir.push(new ErrorTimbrado('PAC_SIN_RESPUESTA', 'timeout sintético'));
      const ambiguo = await emitir({ sucursalId: FX.sucursalA2 });
      expect(ambiguo.status).toBe(502);
      expect(ambiguo.body.message).toBe(MENSAJE_GLOBAL_INCIERTA);
      const [reserva] = await globales(FX.sucursalA2);
      expect(reserva).toMatchObject({ estado: 'timbrando' });
      expect(reserva.globalCodigos).toHaveLength(1);
      const t1 = await codigoDe('T1');
      const publica = await request(url)
        .get(`/facturacion/codigo/${t1}`)
        .set('X-Forwarded-For', ip());
      expect(publica.body.estado).toBe('en_proceso');
      const otra = await emitir({ sucursalId: FX.sucursalA2 });
      expect(otra.status).toBe(409);
      expect(otra.body.message).toBe(MENSAJE_GLOBAL_SIN_TICKETS);
      const lista = (await periodos(FX.sucursalA2)).body;
      expect(periodo(lista, '2026-08-01')).toBeUndefined();
      expect(lista.emitidas).toEqual([
        expect.objectContaining({ estado: 'timbrando', tickets: 1 }),
      ]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('tablero', () => {
    it('la global va APARTE: clientes 200.00 + global 294.01 = los CFDI vigentes del rango', async () => {
      const res = await get(
        ADMIN_A,
        `/facturacion/tablero?empresaId=${FX.empresaA}&desde=2026-08-01&hasta=2026-09-30`,
      );
      expect(res.status).toBe(200);
      const t = res.body;
      // Venta: G1 116 + G2 58 + G3 100.01 + G4 200 + G5 300 + G9 20 + G10 30 + S1 50 + T1 80
      // (G8 está cancelada) = 954.01 en 9 cuentas.
      expect(t.ventas).toEqual({ venta: '954.01', cuentas: 9 });
      expect(t.facturado).toEqual({ monto: '200.00', cfdis: 1 });
      expect(t.global).toEqual({ monto: '294.01', cfdis: 1 });
      expect(t.cancelados).toEqual({ monto: '20.00', cfdis: 1 });
      // Tasa = clientes / venta: 200.00 / 954.01 = 0.2096.
      expect(t.tasa).toBe('0.2096');
      const porSucursal = Object.fromEntries(
        (t.porSucursal as Array<{ sucursalId: string }>).map((s) => [s.sucursalId, s]),
      );
      expect(porSucursal[FX.sucursalA1]).toMatchObject({
        venta: '874.01',
        facturado: '200.00',
        cfdis: 1,
        global: { monto: '294.01', cfdis: 1 },
        tasa: '0.2288',
      });
      // La reserva ambigua de A2 no cuenta en nada.
      expect(porSucursal[FX.sucursalA2]).toMatchObject({
        venta: '80.00',
        facturado: '0.00',
        global: { monto: '0.00', cfdis: 0 },
      });
      // porMes sólo cuenta lo facturado a clientes (la global de septiembre no aparece).
      expect(t.porMes).toEqual([
        { mes: '2026-08', facturado: '200.00', cfdis: 1 },
        { mes: '2026-09', facturado: '0.00', cfdis: 0 },
      ]);
      // Clientes + global = TODOS los CFDI vigentes de la empresa emitidos en el rango, y el PAC
      // falso los tiene vigentes.
      const vigentes = await prisma.cfdi.findMany({
        where: {
          empresaId: FX.empresaA,
          estado: 'vigente',
          emitidoAt: {
            gte: new Date('2026-08-01T06:00:00.000Z'),
            lt: new Date('2026-10-01T06:00:00.000Z'),
          },
        },
      });
      expect(vigentes.reduce((s, c) => s.add(c.total), new Prisma.Decimal(0)).toFixed(2)).toBe(
        '494.01',
      );
      for (const c of vigentes) {
        expect((await pac.falso.consultarEstado({ uuid: c.uuid!, idPac: c.idPac! })).estado).toBe(
          'vigente',
        );
      }
      // La tabla la lista con su origen y el filtro la encuentra.
      const tabla = await get(
        ADMIN_A,
        `/facturacion/cfdis?empresaId=${FX.empresaA}&desde=2026-08-01&hasta=2026-09-30&origen=global`,
      );
      expect(tabla.status).toBe(200);
      expect(tabla.body.cfdis).toEqual([
        expect.objectContaining({
          serieFolio: 'A-102',
          origen: 'global',
          receptorRfc: 'XAXX010101000',
          folioTicket: null,
          total: '294.01',
        }),
      ]);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('volumen', () => {
    it('un mes de 600 tickets entra en los timeouts: vista previa y emisión', async () => {
      const N = 600;
      const cheques = Array.from({ length: N }, (_, i) => ({
        id: `f2108a00-0000-4000-8000-${String(i).padStart(12, '0')}`,
        cerradoAt: new Date(Date.UTC(2026, 6, 1 + (i % 30), 18, i % 60)),
      }));
      await prisma.cheque.createMany({
        data: cheques.map((c, i) => ({
          id: c.id,
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          folio: `V-${i}`,
          folioSr: `V-${i}`,
          abiertoAt: c.cerradoAt,
          cerradoAt: c.cerradoAt,
          subtotal: '10.00',
          impuestos: '0',
          descuentos: '0',
          propina: '0',
          total: '10.00',
        })),
      });
      await prisma.chequePago.createMany({
        data: cheques.map((c) => ({
          chequeId: c.id,
          empresaId: FX.empresaA,
          formaRaw: 'EFECTIVO',
          forma: 'otro',
          monto: '10.00',
        })),
      });
      await prisma.codigoFacturacion.createMany({
        data: cheques.map((c) => ({
          codigo: codigoDeterminista(c.id, 0),
          chequeId: c.id,
          sucursalId: FX.sucursalA1,
          empresaId: FX.empresaA,
          estado: 'pendiente',
          expiraAt: new Date('2026-08-01T06:00:00.000Z'),
          updatedAt: c.cerradoAt,
        })),
      });
      const inicio = Date.now();
      const previa = await vistaPrevia('2026-07-01');
      expect(previa.status).toBe(200);
      expect(previa.body).toMatchObject({ estado: 'lista', total: '6000.00', subtotal: '5172.00' });
      expect(previa.body.tickets).toHaveLength(N);
      const res = await emitir({ clave: '2026-07-01' });
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ tickets: N, total: '6000.00', etiqueta: 'julio de 2026' });
      // Holgado frente a los timeouts de la transacción (15 s) y de cada sentencia (5 s).
      expect(Date.now() - inicio).toBeLessThan(15_000);
    }, 60_000);
  });

  // ---------------------------------------------------------------------------------------------
  describe('emisión automática (programador)', () => {
    const servicio = () => app.get(FacturaGlobalService);
    const deSeptiembre = async () =>
      (await globales(FX.sucursalA1)).filter((g) => g.globalMeses === '09');

    it('apagada (default) no emite nada', async () => {
      reloj.t = OCTUBRE;
      const conf = await get(ADMIN_A, `/facturacion/global/configuracion?empresaId=${FX.empresaA}`);
      expect(conf.body).toMatchObject({ periodicidad: 'mensual', automatica: false, aviso: null });
      expect(await servicio().vueltaAutomatica()).toEqual({ emitidas: 0, fallidas: 0 });
      expect(await deSeptiembre()).toEqual([]);
    });

    it('encendida DESPUÉS de que terminó septiembre: no lo timbra de golpe (se emite a mano)', async () => {
      const res = await configurar(true);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        automatica: true,
        automaticaDesde: new Date(OCTUBRE).toISOString(),
      });
      expect(await servicio().vueltaAutomatica()).toEqual({ emitidas: 0, fallidas: 0 });
      expect(await deSeptiembre()).toEqual([]);
    });

    it('encendida ANTES: dos vueltas a la vez emiten UNA global de septiembre; la complementaria de agosto NO', async () => {
      expect((await configurar(false)).body).toMatchObject({ automaticaDesde: null });
      reloj.t = Date.parse('2026-09-30T12:00:00-06:00');
      expect((await configurar(true)).body.automaticaDesde).toBe('2026-09-30T18:00:00.000Z');
      reloj.t = OCTUBRE;
      const [a, b] = await Promise.all([
        servicio().vueltaAutomatica(),
        servicio().vueltaAutomatica(),
      ]);
      expect(a.emitidas + b.emitidas).toBe(1);
      const septiembre = await deSeptiembre();
      expect(septiembre).toHaveLength(1);
      expect(septiembre[0]).toMatchObject({ estado: 'vigente', globalPeriodicidad: '04' });
      expect(septiembre[0].total.toFixed(2)).toBe('50.00');
      expect(septiembre[0].globalCodigos.map((g) => g.codigo.cheque.folioSr)).toEqual(['S1']);
      // La complementaria de agosto (G10) sigue sin global: es a mano.
      const g10 = await prisma.codigoFacturacion.findFirstOrThrow({
        where: { cheque: { folioSr: 'G10', empresaId: FX.empresaA } },
        include: { global: true },
      });
      expect(g10.global).toBeNull();
      // Una tercera vuelta ya no encuentra nada.
      expect(await servicio().vueltaAutomatica()).toEqual({ emitidas: 0, fallidas: 0 });
    });

    it('la configuración avisa cuando la vigencia retrasa la global', async () => {
      const res = await enviar(ADMIN_A, 'put', '/facturacion/global/configuracion', {
        empresaId: FX.empresaA,
        periodicidad: 'semanal',
        automatica: false,
      });
      expect(res.status).toBe(200);
      expect(res.body.aviso).toMatch(/espera al fin de mes/);
      const malo = await enviar(ADMIN_A, 'put', '/facturacion/global/configuracion', {
        empresaId: FX.empresaA,
        periodicidad: 'quincenal',
        automatica: false,
      });
      expect(malo.status).toBe(400);
    });
  });
});
