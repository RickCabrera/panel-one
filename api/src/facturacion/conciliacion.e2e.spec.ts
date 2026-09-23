import { NotFoundException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, RolUsuario } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { PUERTO_ARCHIVOS, PUERTO_CORREO, PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import type { PuertoArchivos } from '../adaptadores/archivos/puerto';
import type {
  Adjunto,
  Destinatario,
  PlantillaCorreo,
  PuertoCorreo,
} from '../adaptadores/correo/puerto';
import {
  ErrorTimbrado,
  type CfdiTimbrado,
  type ConsultaFolio,
  type PuertoTimbrado,
  type SolicitudCancelacion,
  type SolicitudCfdi,
} from '../adaptadores/timbrado/puerto';
import { TimbradoFalso } from '../adaptadores/timbrado/timbrado-falso';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Auditoria } from '../comun/auditoria';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import {
  MENSAJE_CAPTURA_EN_CURSO,
  MENSAJE_SUSTITUCION_EN_CURSO,
} from '../scope/escritura-facturacion';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { NOMBRE_PLANTILLA_CANCELACION } from './cancelacion';
import { Espera, MENSAJE_EMISION_INCIERTA, MENSAJE_EMISION_INCIERTA_ADMIN } from './cfdi.service';
import { ConciliacionProgramador } from './conciliacion.programador';
import { NOMBRE_PLANTILLA_FACTURA } from './entrega';
import { MENSAJE_GLOBAL_INCIERTA } from './global.service';

// E2E de F2-110b (conciliación con el PAC) sobre la app REAL contra Postgres REAL, con el PAC FALSO
// (que puede "timbrar sin contestar"), reloj falso y un correo que captura. Fixtures PROPIAS en marzo
// de 2033 (lejos del seed y de las demás suites), con su paquete de folios de 2033: así los conteos
// de folios son exactos. Las pruebas corren EN ORDEN, con el reloj siempre hacia adelante.

const KEY_A1 = 'msr_sintetica-conciliacion-F2-110b-sucursal-a1-0001';
const SLUG_A1 = 'f2110b-a1';
const PAQUETE_2033 = 'f2110b00-0000-4000-8000-0000000000f1';

class RelojControlado extends Reloj {
  t: number | null = null;
  ahora(): number {
    return this.t ?? Date.now();
  }
}

/**
 * El PAC falso con: bitácora de búsquedas y cancelaciones, fallas a la carta al cancelar, y
 * folios "ocultos" (el PAC todavía no los lista: una búsqueda vacía aunque sí timbró).
 */
class PacControlado implements PuertoTimbrado {
  readonly busquedas: ConsultaFolio[] = [];
  readonly cancelaciones: SolicitudCancelacion[] = [];
  readonly ocultos = new Set<string>();
  fallasCancelar: Error[] = [];
  constructor(readonly falso: TimbradoFalso) {}

  registrarCsd: PuertoTimbrado['registrarCsd'] = (s) => this.falso.registrarCsd(s);
  emitir = (s: SolicitudCfdi): Promise<CfdiTimbrado> => this.falso.emitir(s);
  consultarEstado: PuertoTimbrado['consultarEstado'] = (s) => this.falso.consultarEstado(s);
  descargarArchivos: PuertoTimbrado['descargarArchivos'] = (c) => this.falso.descargarArchivos(c);
  buscarPorFolio: PuertoTimbrado['buscarPorFolio'] = (c) => {
    this.busquedas.push(c);
    if (this.ocultos.has(`${c.serie}-${c.folio}`)) return Promise.resolve(null);
    return this.falso.buscarPorFolio(c);
  };
  cancelar: PuertoTimbrado['cancelar'] = (s) => {
    this.cancelaciones.push(s);
    const falla = this.fallasCancelar.shift();
    if (falla) return Promise.reject(falla);
    return this.falso.cancelar(s);
  };
}

class CorreoCaptura implements PuertoCorreo {
  readonly enviados: Array<{ para: string; plantilla: PlantillaCorreo; adjuntos: Adjunto[] }> = [];
  enviar(d: Destinatario, plantilla: PlantillaCorreo, adjuntos: Adjunto[]) {
    this.enviados.push({ para: d.email, plantilla, adjuntos });
    return Promise.resolve({ id: `correo-${this.enviados.length}` });
  }
  de(nombre: string) {
    return this.enviados.filter((e) => e.plantilla.nombre === nombre);
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

// A1 (CDMX, UTC−6). Marzo de 2033: los tickets del portal (sus códigos vencen al fin de mes).
// Febrero: dos sin facturar para la global.
const TICKETS = Array.from({ length: 20 }, (_, i) => `T${i + 1}`);
const CHEQUES = [
  ...TICKETS.map((t, i) => cheque(t, '2033-03-01T13:00:00-06:00', `${100 + i}.00`)),
  cheque('G1', '2033-02-10T13:00:00-06:00', '30.00'),
  cheque('G2', '2033-02-11T13:00:00-06:00', '45.50'),
];
const MARZO = 'desde=2033-03-01&hasta=2033-03-31';

type Usuario = { id: string; rol: RolUsuario; empresaId: string | null };
const ADMIN_A: Usuario = USUARIOS.adminEmpresaA;
const ADMIN_B: Usuario = {
  id: 'f2110b00-0000-4000-8000-0000000000b0',
  rol: RolUsuario.admin_empresa,
  empresaId: FX.empresaB,
};
const VISOR_A: Usuario = USUARIOS.visorA;
const GLOBAL: Usuario = USUARIOS.adminGlobal;

interface Resumen {
  reservas: { revisadas: number; confirmadas: number; liberadas: number; enEspera: number };
  cancelaciones: { revisadas: number; canceladas: number; descartadas: number };
  sustituciones: { revisadas: number; cerradas: number };
  archivos: { revisados: number; recuperados: number };
  fallidas: number;
  requierenRevision: string[];
}
const NADA: Resumen = {
  reservas: { revisadas: 0, confirmadas: 0, liberadas: 0, enEspera: 0 },
  cancelaciones: { revisadas: 0, canceladas: 0, descartadas: 0 },
  sustituciones: { revisadas: 0, cerradas: 0 },
  archivos: { revisados: 0, recuperados: 0 },
  fallidas: 0,
  requierenRevision: [],
};
const con = (cambios: Partial<{ [K in keyof Resumen]: Partial<Resumen[K]> }>): Resumen => {
  const r = structuredClone(NADA) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(cambios)) {
    r[k] = typeof v === 'object' && !Array.isArray(v) ? { ...(r[k] as object), ...v } : v;
  }
  return r as unknown as Resumen;
};

describe('Conciliación con el PAC (e2e, F2-110b)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojControlado();
  const pac = new PacControlado(new TimbradoFalso({ ahora: () => reloj.ahora() }));
  const correo = new CorreoCaptura();
  let app: NestExpressApplication;
  let url: string;
  let ips = 0;
  const ip = () => `10.11.${Math.floor(++ips / 250)}.${ips % 250}`;

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
  const conciliar = async (u: Usuario = ADMIN_A): Promise<Resumen> => {
    const res = await post(u, '/facturacion/conciliacion');
    expect(res.status).toBe(200);
    return res.body as Resumen;
  };
  const en = (iso: string) => (reloj.t = Date.parse(iso));
  const codigoDe = (folioSr: string) =>
    prisma.codigoFacturacion.findFirstOrThrow({ where: { cheque: { folioSr } } });
  const estadoPublico = async (folioSr: string) =>
    (
      await request(url)
        .get(`/facturacion/codigo/${(await codigoDe(folioSr)).codigo}`)
        .set('X-Forwarded-For', ip())
    ).body.estado as string;
  const emitirPortal = async (folioSr: string, receptor: object = RECEPTORES.eku) =>
    request(url)
      .post(`/facturacion/portal/${SLUG_A1}/facturas`)
      .set('X-Forwarded-For', ip())
      .send({ codigo: (await codigoDe(folioSr)).codigo, receptor });
  const reservaDe = (folioSr: string) =>
    prisma.cfdi.findFirst({ where: { cheque: { folioSr }, estado: 'timbrando' } });
  const vigenteDe = (folioSr: string) =>
    prisma.cfdi.findFirstOrThrow({
      where: { cheque: { folioSr }, estado: 'vigente', sustituyeAId: null },
    });
  const folios = async () => {
    const res = await get(GLOBAL, '/facturacion/folios');
    expect(res.status).toBe(200);
    return res.body as { disponible: number; enEmision: number };
  };
  const solicitudes = (cfdiId: string) =>
    prisma.cfdiCancelacion.findMany({ where: { cfdiId }, orderBy: { solicitadaAt: 'asc' } });
  const fila = async (id: string) => {
    const res = await get(
      ADMIN_A,
      `/facturacion/cfdis?empresaId=${FX.empresaA}&${MARZO}&porPagina=200`,
    );
    expect(res.status).toBe(200);
    return (res.body.cfdis as Array<{ id: string }>).find((c) => c.id === id) as
      Record<string, unknown> | undefined;
  };
  /** Cancela de forma AMBIGUA y a los 11 min la consulta: queda `sin_confirmar`. */
  const dejarSinConfirmar = async (cfdiId: string, desde: string) => {
    en(desde);
    pac.fallasCancelar = [new ErrorTimbrado('PAC_SIN_RESPUESTA', 'sin respuesta (prueba)', false)];
    expect(
      (await post(ADMIN_A, `/facturacion/cfdis/${cfdiId}/cancelar`, { motivo: '02' })).status,
    ).toBe(502);
    reloj.t = Date.parse(desde) + 11 * 60 * 1000;
    const c = await post(ADMIN_A, `/facturacion/cfdis/${cfdiId}/cancelacion/consultar`);
    expect(c.body.estado).toBe('no_procedio');
    expect((await solicitudes(cfdiId)).map((s) => s.estado)).toEqual(['sin_confirmar']);
  };

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
    const alta = new Date('2033-01-01T00:00:00Z');
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
          csdVigenteDesde: new Date('2033-01-01T06:00:00Z'),
          csdVigenteHasta: new Date('2034-06-01T06:00:00Z'),
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
    // Paquete PROPIO de 2033: con el control prendido (base sembrada) las reservas de 2033 tienen
    // saldo, y en 2033 no vive ningún otro timbre: el disponible se mide exacto.
    await prisma.paqueteFolios.deleteMany({ where: { id: PAQUETE_2033 } });
    await prisma.paqueteFolios.create({
      data: {
        id: PAQUETE_2033,
        cantidad: 1000,
        compradoAt: new Date('2033-01-01T06:00:00Z'),
        venceAt: new Date('2034-01-01T06:00:00Z'),
        nota: 'Paquete sintético de la suite F2-110b',
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

    en('2033-03-02T09:00:00-06:00');
    const lote = await request(url)
      .post('/ingesta/eventos')
      .set('X-Api-Key', KEY_A1)
      .send({ eventos: CHEQUES });
    expect(lote.status).toBe(200);
  }, 120_000);

  // Un espía que no se restauró porque su test falló antes no contamina a los siguientes.
  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
    await prisma.paqueteFolios.deleteMany({ where: { id: PAQUETE_2033 } });
    await prisma.configuracionFacturacion.deleteMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
    });
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('sin token 401, visor 403; sin nada colgado, la vuelta no hace nada; el disparo se audita con su actor', async () => {
    en('2033-03-02T10:00:00-06:00');
    const auditoria = jest.spyOn(app.get(Auditoria), 'registrar');
    expect((await request(url).post('/facturacion/conciliacion')).status).toBe(401);
    expect((await post(VISOR_A, '/facturacion/conciliacion')).status).toBe(403);
    expect(await conciliar()).toEqual(NADA);
    expect(pac.busquedas).toHaveLength(0);
    expect(auditoria.mock.calls).toEqual([
      [
        { id: ADMIN_A.id, rol: ADMIN_A.rol },
        {
          accion: 'facturacion.conciliacion',
          recurso: 'conciliacion_pac',
          recursoId: FX.empresaA,
          empresaId: FX.empresaA,
          campos: [],
        },
      ],
    ]);
  });

  describe('AC1 · origen ticket (portal)', () => {
    it('el PAC SÍ timbró: a los 14:59 no se toca (AC8); a los 15:00 se confirma y se entrega; el saldo deja de contarla como en emisión (AC6)', async () => {
      const antes = await folios();
      en('2033-03-10T10:00:00-06:00');
      pac.falso.programarSinRespuesta(true);
      const res = await emitirPortal('T1');
      expect(res.status).toBe(502);
      expect(res.body.message).toBe(MENSAJE_EMISION_INCIERTA);
      const reserva = await reservaDe('T1');
      expect(reserva).not.toBeNull();
      expect(await estadoPublico('T1')).toBe('en_proceso');
      const colgada = await folios();
      expect(colgada.enEmision).toBe(antes.enEmision + 1);
      expect(colgada.disponible).toBe(antes.disponible - 1);

      // AC8: 14:59.999 después: puede haber una llamada en vuelo; no se toca ni se consulta.
      reloj.t = Date.parse('2033-03-10T10:15:00-06:00') - 1;
      expect(await conciliar()).toEqual(NADA);
      expect(pac.busquedas).toHaveLength(0);
      expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: reserva!.id } })).toMatchObject({
        estado: 'timbrando',
        conciliacionAt: null,
      });

      en('2033-03-10T10:15:00-06:00');
      const facturas = correo.de(NOMBRE_PLANTILLA_FACTURA).length;
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, confirmadas: 1 } }));
      expect(pac.busquedas).toEqual([
        {
          rfcEmisor: 'EKU9003173C9',
          serie: 'A',
          folio: String(reserva!.folio),
          zonaHoraria: 'America/Mexico_City',
        },
      ]);
      const enPac = await pac.falso.buscarPorFolio(pac.busquedas[0]);
      const cfdi = await prisma.cfdi.findUniqueOrThrow({ where: { id: reserva!.id } });
      expect(cfdi).toMatchObject({
        estado: 'vigente',
        uuid: enPac!.uuid,
        idPac: enPac!.idPac,
        // La fecha del timbre (la del PAC), no la de la conciliación.
        emitidoAt: new Date('2033-03-10T16:00:00.000Z'),
        busquedaVaciaAt: null,
      });
      expect((await codigoDe('T1')).estado).toBe('facturado');
      expect(await estadoPublico('T1')).toBe('facturado');
      // Entregado: archivos guardados (los mismos del PAC) y el correo que nunca salió.
      expect(cfdi.xmlClave).not.toBeNull();
      const xml = await app.get<PuertoArchivos>(PUERTO_ARCHIVOS).leer(cfdi.xmlClave!);
      expect(xml.toString('utf8')).toBe((await pac.falso.descargarArchivos(enPac!)).xml);
      const nuevas = correo.de(NOMBRE_PLANTILLA_FACTURA).slice(facturas);
      expect(nuevas.map((e) => e.para)).toEqual([RECEPTORES.eku.email]);
      // AC6: ya no está en emisión; pasó a consumido (el disponible no cambia).
      const despues = await folios();
      expect(despues.enEmision).toBe(antes.enEmision);
      expect(despues.disponible).toBe(antes.disponible - 1);
    });

    it('el PAC NO timbró: UNA búsqueda vacía no libera (B1); la segunda, 15 min después, sí; el ticket vuelve a ser facturable y el saldo lo recupera (AC6)', async () => {
      const antes = await folios();
      en('2033-03-11T10:00:00-06:00');
      pac.falso.programarSinRespuesta(false);
      expect((await emitirPortal('T2')).status).toBe(502);
      const reserva = await reservaDe('T2');
      expect((await folios()).enEmision).toBe(antes.enEmision + 1);

      en('2033-03-11T10:15:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, enEspera: 1 } }));
      expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: reserva!.id } })).toMatchObject({
        estado: 'timbrando',
        busquedaVaciaAt: new Date('2033-03-11T16:15:00.000Z'),
      });
      expect(await estadoPublico('T2')).toBe('en_proceso');
      // Sigue contando como en emisión mientras espera la segunda búsqueda.
      expect((await folios()).enEmision).toBe(antes.enEmision + 1);

      // Antes de 15 min desde la primera: ni siquiera se reclama.
      reloj.t = Date.parse('2033-03-11T10:30:00-06:00') - 1;
      expect(await conciliar()).toEqual(NADA);

      en('2033-03-11T10:30:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, liberadas: 1 } }));
      expect(await prisma.cfdi.findUnique({ where: { id: reserva!.id } })).toBeNull();
      expect((await codigoDe('T2')).estado).toBe('pendiente');
      expect(await estadoPublico('T2')).toBe('pendiente');
      const liberada = await folios();
      expect(liberada.enEmision).toBe(antes.enEmision);
      expect(liberada.disponible).toBe(antes.disponible);
      // De nuevo facturable.
      en('2033-03-11T10:31:00-06:00');
      expect((await emitirPortal('T2')).status).toBe(201);
    });

    it('vacía y DESPUÉS aparece (el PAC tardó en listarla): se confirma, no se libera', async () => {
      en('2033-03-11T11:00:00-06:00');
      pac.falso.programarSinRespuesta(true);
      expect((await emitirPortal('T3')).status).toBe(502);
      const reserva = await reservaDe('T3');
      const serieFolio = `${reserva!.serie}-${reserva!.folio}`;
      pac.ocultos.add(serieFolio);
      en('2033-03-11T11:15:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, enEspera: 1 } }));
      pac.ocultos.delete(serieFolio);
      en('2033-03-11T11:30:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, confirmadas: 1 } }));
      expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: reserva!.id } })).toMatchObject({
        estado: 'vigente',
        busquedaVaciaAt: null,
      });
      expect((await codigoDe('T3')).estado).toBe('facturado');
    });
  });

  describe('AC1 · origen manual (factura sin ticket)', () => {
    const manual = (solicitudId: string) =>
      post(ADMIN_A, '/facturacion/cfdis/manual', {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        solicitudId,
        total: '500.00',
        formaPago: 'tarjeta',
        receptor: RECEPTORES.xia,
      });

    it('el PAC SÍ timbró: su llave contesta 409 "en curso" y, conciliada, 409 con la factura vigente', async () => {
      const llave = 'f2110b00-0000-4000-8000-00000000c001';
      en('2033-03-12T10:00:00-06:00');
      pac.falso.programarSinRespuesta(true);
      const res = await manual(llave);
      expect(res.status).toBe(502);
      expect(res.body.message).toBe(MENSAJE_EMISION_INCIERTA_ADMIN);
      const otra = await manual(llave);
      expect(otra.status).toBe(409);
      expect(otra.body.message).toBe(MENSAJE_CAPTURA_EN_CURSO);
      en('2033-03-12T10:15:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, confirmadas: 1 } }));
      const cfdi = await prisma.cfdi.findFirstOrThrow({
        where: { empresaId: FX.empresaA, solicitudId: llave },
      });
      expect(cfdi).toMatchObject({ estado: 'vigente', origen: 'manual' });
      const repetida = await manual(llave);
      expect(repetida.status).toBe(409);
      expect(repetida.body).toMatchObject({ cfdiId: cfdi.id, estado: 'vigente' });
    });

    it('el PAC NO timbró: dos búsquedas vacías la liberan y la misma captura se puede volver a emitir', async () => {
      const llave = 'f2110b00-0000-4000-8000-00000000c002';
      en('2033-03-12T11:00:00-06:00');
      pac.falso.programarSinRespuesta(false);
      expect((await manual(llave)).status).toBe(502);
      en('2033-03-12T11:15:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, enEspera: 1 } }));
      en('2033-03-12T11:30:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, liberadas: 1 } }));
      expect(
        await prisma.cfdi.count({ where: { empresaId: FX.empresaA, solicitudId: llave } }),
      ).toBe(0);
      expect((await manual(llave)).status).toBe(201);
    });
  });

  describe('AC1 · origen sustituto (refacturación)', () => {
    const refacturar = (id: string) =>
      post(ADMIN_A, `/facturacion/cfdis/${id}/refacturar`, { receptor: RECEPTORES.xia });

    it('el PAC SÍ timbró: el sustituto se confirma con el código y, en la misma vuelta, la 01 pendiente cierra la refacturación', async () => {
      en('2033-03-13T09:00:00-06:00');
      expect((await emitirPortal('T4')).status).toBe(201);
      const anterior = await vigenteDe('T4');
      en('2033-03-13T10:00:00-06:00');
      pac.falso.programarSinRespuesta(true);
      expect((await refacturar(anterior.id)).status).toBe(502);
      const otra = await refacturar(anterior.id);
      expect(otra.status).toBe(409);
      expect(otra.body.message).toBe(MENSAJE_SUSTITUCION_EN_CURSO);

      en('2033-03-13T10:15:00-06:00');
      expect(await conciliar()).toEqual(
        con({
          reservas: { revisadas: 1, confirmadas: 1 },
          sustituciones: { revisadas: 1, cerradas: 1 },
        }),
      );
      const sustituto = await prisma.cfdi.findFirstOrThrow({
        where: { sustituyeAId: anterior.id },
      });
      expect(sustituto).toMatchObject({ estado: 'vigente', codigoId: anterior.codigoId });
      expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: anterior.id } })).toMatchObject({
        estado: 'cancelado',
        motivoCancelacion: '01',
        codigoId: null,
      });
      expect(pac.falso.cancelacionDe(anterior.uuid!)).toEqual({
        motivo: '01',
        folioSustitucion: sustituto.uuid,
      });
      expect((await codigoDe('T4')).estado).toBe('facturado');
    });

    it('el PAC NO timbró: se libera y el anterior se puede volver a refacturar', async () => {
      en('2033-03-14T09:00:00-06:00');
      expect((await emitirPortal('T5')).status).toBe(201);
      const anterior = await vigenteDe('T5');
      en('2033-03-14T10:00:00-06:00');
      pac.falso.programarSinRespuesta(false);
      expect((await refacturar(anterior.id)).status).toBe(502);
      en('2033-03-14T10:15:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, enEspera: 1 } }));
      en('2033-03-14T10:30:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, liberadas: 1 } }));
      expect(await prisma.cfdi.count({ where: { sustituyeAId: anterior.id } })).toBe(0);
      expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: anterior.id } })).toMatchObject({
        estado: 'vigente',
        codigoId: anterior.codigoId,
      });
      const otra = await refacturar(anterior.id);
      expect(otra.status).toBe(201);
      expect(otra.body.cancelacion).toBe('cancelado');
    });
  });

  describe('AC1 · origen factura global', () => {
    const emitirGlobal = () =>
      post(ADMIN_A, '/facturacion/global', {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        periodicidad: 'mensual',
        clave: '2033-02-01',
      });
    const amarrados = () => prisma.cfdiGlobalCodigo.count({ where: { empresaId: FX.empresaA } });

    it('el PAC NO timbró: sus tickets quedan amarrados hasta que se libera; luego se sueltan', async () => {
      en('2033-03-15T10:00:00-06:00');
      pac.falso.programarSinRespuesta(false);
      const res = await emitirGlobal();
      expect(res.status).toBe(502);
      expect(res.body.message).toBe(MENSAJE_GLOBAL_INCIERTA);
      expect(await amarrados()).toBe(2);
      en('2033-03-15T10:15:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, enEspera: 1 } }));
      expect(await amarrados()).toBe(2);
      en('2033-03-15T10:30:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, liberadas: 1 } }));
      expect(await amarrados()).toBe(0);
      for (const g of ['G1', 'G2']) expect((await codigoDe(g)).estado).not.toBe('en_global');
    });

    it('el PAC SÍ timbró: la global se confirma y sus tickets pasan a `en_global`', async () => {
      en('2033-03-15T11:00:00-06:00');
      pac.falso.programarSinRespuesta(true);
      expect((await emitirGlobal()).status).toBe(502);
      en('2033-03-15T11:15:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, confirmadas: 1 } }));
      const global = await prisma.cfdi.findFirstOrThrow({
        where: { empresaId: FX.empresaA, origen: 'global' },
      });
      expect(global.estado).toBe('vigente');
      expect(await amarrados()).toBe(2);
      for (const g of ['G1', 'G2']) expect((await codigoDe(g)).estado).toBe('en_global');
    });
  });

  describe('AC2 · cancelaciones sin confirmar', () => {
    it('el PAC la registró TARDE: queda cancelada con su fecha, el ticket suelto y UN aviso', async () => {
      en('2033-03-16T09:00:00-06:00');
      expect((await emitirPortal('T6')).status).toBe(201);
      const cfdi = await vigenteDe('T6');
      await dejarSinConfirmar(cfdi.id, '2033-03-16T10:00:00-06:00');
      expect(await fila(cfdi.id)).toMatchObject({
        estado: 'vigente',
        cancelacion: { estado: 'sin_confirmar' },
      });
      pac.falso.cancelarEnPac(cfdi.uuid!, '02');
      const avisos = correo.de(NOMBRE_PLANTILLA_CANCELACION).length;
      en('2033-03-16T10:12:00-06:00');
      expect(await conciliar()).toEqual(con({ cancelaciones: { revisadas: 1, canceladas: 1 } }));
      expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: cfdi.id } })).toMatchObject({
        estado: 'cancelado',
        motivoCancelacion: '02',
        canceladoAt: new Date('2033-03-16T16:12:00.000Z'),
        codigoId: null,
      });
      expect((await codigoDe('T6')).estado).toBe('pendiente');
      expect((await solicitudes(cfdi.id)).map((s) => s.estado)).toEqual(['aceptada']);
      expect(
        correo
          .de(NOMBRE_PLANTILLA_CANCELACION)
          .slice(avisos)
          .map((e) => e.para),
      ).toEqual([RECEPTORES.eku.email]);
      // Otra vuelta: nada que hacer, ningún aviso más.
      en('2033-03-16T10:13:00-06:00');
      expect(await conciliar()).toEqual(NADA);
      expect(correo.de(NOMBRE_PLANTILLA_CANCELACION)).toHaveLength(avisos + 1);
    });

    it('B2: una solicitud NUEVA descarta la `sin_confirmar`; si el PAC ya la tenía, sólo se anota (una aceptada, un aviso)', async () => {
      en('2033-03-17T09:00:00-06:00');
      expect((await emitirPortal('T7')).status).toBe(201);
      const cfdi = await vigenteDe('T7');
      await dejarSinConfirmar(cfdi.id, '2033-03-17T10:00:00-06:00');
      pac.falso.cancelarEnPac(cfdi.uuid!, '02');
      const avisos = correo.de(NOMBRE_PLANTILLA_CANCELACION).length;
      const deletes = pac.cancelaciones.length;
      en('2033-03-17T10:20:00-06:00');
      const res = await post(ADMIN_A, `/facturacion/cfdis/${cfdi.id}/cancelar`, { motivo: '02' });
      expect(res.status).toBe(201);
      expect(res.body.estado).toBe('cancelado');
      // La consulta previa lo vio cancelado: no se mandó otro DELETE al PAC.
      expect(pac.cancelaciones).toHaveLength(deletes);
      expect((await solicitudes(cfdi.id)).map((s) => s.estado)).toEqual(['aceptada']);
      expect(correo.de(NOMBRE_PLANTILLA_CANCELACION)).toHaveLength(avisos + 1);
      en('2033-03-17T10:21:00-06:00');
      expect(await conciliar()).toEqual(NADA);
      expect(correo.de(NOMBRE_PLANTILLA_CANCELACION)).toHaveLength(avisos + 1);
    });

    it('B2: abrir una solicitud nueva descarta la `sin_confirmar` aunque la nueva NO proceda', async () => {
      en('2033-03-17T11:00:00-06:00');
      expect((await emitirPortal('T16')).status).toBe(201);
      const cfdi = await vigenteDe('T16');
      await dejarSinConfirmar(cfdi.id, '2033-03-17T12:00:00-06:00');
      en('2033-03-17T12:20:00-06:00');
      pac.fallasCancelar = [new ErrorTimbrado('PAC_NO_DISPONIBLE', 'no disponible (prueba)', true)];
      const res = await post(ADMIN_A, `/facturacion/cfdis/${cfdi.id}/cancelar`, { motivo: '02' });
      expect(res.status).toBe(503);
      // Ni la nueva (no procedió) ni la vieja (descartada al abrir la nueva).
      expect(await solicitudes(cfdi.id)).toEqual([]);
      expect(await conciliar()).toEqual(NADA);
    });

    it('B2: una `sin_confirmar` de un CFDI que ya no está vigente se descarta sin efectos ni aviso', async () => {
      en('2033-03-18T09:00:00-06:00');
      expect((await emitirPortal('T8')).status).toBe(201);
      const cfdi = await vigenteDe('T8');
      await dejarSinConfirmar(cfdi.id, '2033-03-18T10:00:00-06:00');
      // Otro camino lo dejó cancelado (fixture directa: el guardia no depende de cuál).
      await prisma.cfdi.update({
        where: { id: cfdi.id },
        data: {
          estado: 'cancelado',
          motivoCancelacion: '03',
          canceladoAt: new Date('2033-03-18T16:15:00Z'),
        },
      });
      pac.falso.cancelarEnPac(cfdi.uuid!, '02');
      const avisos = correo.de(NOMBRE_PLANTILLA_CANCELACION).length;
      en('2033-03-18T10:20:00-06:00');
      expect(await conciliar()).toEqual(con({ cancelaciones: { revisadas: 1, descartadas: 1 } }));
      expect(await solicitudes(cfdi.id)).toEqual([]);
      expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: cfdi.id } })).toMatchObject({
        motivoCancelacion: '03',
        canceladoAt: new Date('2033-03-18T16:15:00Z'),
      });
      expect((await codigoDe('T8')).estado).toBe('facturado');
      expect(correo.de(NOMBRE_PLANTILLA_CANCELACION)).toHaveLength(avisos);
    });

    it('el PAC la sigue viendo vigente: se revisa hasta 7 días y luego se da por no registrada', async () => {
      en('2033-03-19T09:00:00-06:00');
      expect((await emitirPortal('T9')).status).toBe(201);
      const cfdi = await vigenteDe('T9');
      await dejarSinConfirmar(cfdi.id, '2033-03-19T10:00:00-06:00');
      en('2033-03-20T10:00:00-06:00');
      expect(await conciliar()).toEqual(con({ cancelaciones: { revisadas: 1 } }));
      expect((await solicitudes(cfdi.id)).map((s) => s.estado)).toEqual(['sin_confirmar']);
      reloj.t = Date.parse('2033-03-26T10:00:00-06:00') - 1;
      expect(await conciliar()).toEqual(con({ cancelaciones: { revisadas: 1 } }));
      en('2033-03-26T10:00:00-06:00');
      expect(await conciliar()).toEqual(con({ cancelaciones: { revisadas: 1, descartadas: 1 } }));
      expect(await solicitudes(cfdi.id)).toEqual([]);
      expect((await prisma.cfdi.findUniqueOrThrow({ where: { id: cfdi.id } })).estado).toBe(
        'vigente',
      );
    });
  });

  describe('AC3 · refacturación con la 01 pendiente', () => {
    const refacturarConPacCaido = async (folioSr: string, cuando: string) => {
      en(cuando);
      expect((await emitirPortal(folioSr)).status).toBe(201);
      const anterior = await vigenteDe(folioSr);
      pac.fallasCancelar = [new ErrorTimbrado('PAC_NO_DISPONIBLE', 'no disponible (prueba)', true)];
      const res = await post(ADMIN_A, `/facturacion/cfdis/${anterior.id}/refacturar`, {
        receptor: RECEPTORES.xia,
      });
      expect(res.status).toBe(201);
      expect(res.body.cancelacion).toBe('pendiente');
      return anterior;
    };

    it('la 01 que no se pudo pedir se cierra sola (con edad), y el tablero deja de marcarla pendiente', async () => {
      const anterior = await refacturarConPacCaido('T10', '2033-03-27T10:00:00-06:00');
      expect(await fila(anterior.id)).toMatchObject({ sustitucionPendiente: true });
      const deletes = pac.cancelaciones.length;
      reloj.t = Date.parse('2033-03-27T10:15:00-06:00') - 1;
      expect(await conciliar()).toEqual(NADA);
      en('2033-03-27T10:15:00-06:00');
      const auditoria = jest.spyOn(app.get(Auditoria), 'registrar');
      expect(await conciliar()).toEqual(con({ sustituciones: { revisadas: 1, cerradas: 1 } }));
      // La 01 la pidió el SISTEMA: no queda auditada como si la hubiera pedido una persona; sólo el
      // disparo de la vuelta, con su actor.
      expect(auditoria.mock.calls.map(([, e]) => e.accion)).toEqual(['facturacion.conciliacion']);
        expect(pac.cancelaciones).toHaveLength(deletes + 1);
      expect(pac.cancelaciones.at(-1)).toMatchObject({ uuid: anterior.uuid, motivo: '01' });
      expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: anterior.id } })).toMatchObject({
        estado: 'cancelado',
        motivoCancelacion: '01',
      });
      expect(await fila(anterior.id)).toMatchObject({
        estado: 'cancelado',
        sustitucionPendiente: false,
      });
    });

    it('si el PAC ya la había cancelado, sólo se ANOTA (no se manda otro DELETE)', async () => {
      const anterior = await refacturarConPacCaido('T11', '2033-03-27T11:00:00-06:00');
      const sustituto = await prisma.cfdi.findFirstOrThrow({
        where: { sustituyeAId: anterior.id },
      });
      pac.falso.cancelarEnPac(anterior.uuid!, '01');
      const deletes = pac.cancelaciones.length;
      en('2033-03-27T11:15:00-06:00');
      expect(await conciliar()).toEqual(con({ sustituciones: { revisadas: 1, cerradas: 1 } }));
      expect(pac.cancelaciones).toHaveLength(deletes);
      expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: anterior.id } })).toMatchObject({
        estado: 'cancelado',
        motivoCancelacion: '01',
      });
      expect((await solicitudes(anterior.id)).at(-1)).toMatchObject({
        estado: 'aceptada',
        motivo: '01',
        uuidSustitucion: sustituto.uuid,
      });
    });
  });

  it('AC4 · un CFDI vigente sin archivos los recupera del PAC (sin volver a mandar el correo)', async () => {
    en('2033-03-28T09:00:00-06:00');
    expect((await emitirPortal('T12')).status).toBe(201);
    const cfdi = await vigenteDe('T12');
    // Como si el disco hubiera fallado al timbrar (F2-105).
    await prisma.cfdi.update({ where: { id: cfdi.id }, data: { xmlClave: null, pdfClave: null } });
    const correos = correo.enviados.length;
    en('2033-03-28T09:14:00-06:00');
    expect(await conciliar()).toEqual(NADA);
    en('2033-03-28T09:15:00-06:00');
    expect(await conciliar()).toEqual(con({ archivos: { revisados: 1, recuperados: 1 } }));
    const despues = await prisma.cfdi.findUniqueOrThrow({ where: { id: cfdi.id } });
    expect(despues.xmlClave).not.toBeNull();
    expect(despues.pdfClave).not.toBeNull();
    const archivos = app.get<PuertoArchivos>(PUERTO_ARCHIVOS);
    const delPac = await pac.falso.descargarArchivos({ uuid: cfdi.uuid!, idPac: cfdi.idPac! });
    expect((await archivos.leer(despues.xmlClave!)).toString('utf8')).toBe(delPac.xml);
    expect((await archivos.leer(despues.pdfClave!)).equals(delPac.pdf)).toBe(true);
    expect(correo.enviados).toHaveLength(correos);
  });

  describe('AC5 · dos vueltas simultáneas (candado en base)', () => {
    it('confirmar: una sola búsqueda, una sola confirmación, un solo correo', async () => {
      en('2033-03-29T10:00:00-06:00');
      pac.falso.programarSinRespuesta(true);
      expect((await emitirPortal('T13')).status).toBe(502);
      const busquedas = pac.busquedas.length;
      const facturas = correo.de(NOMBRE_PLANTILLA_FACTURA).length;
      en('2033-03-29T10:15:00-06:00');
      const [a, b] = await Promise.all([conciliar(ADMIN_A), conciliar(GLOBAL)]);
      expect(a.reservas.confirmadas + b.reservas.confirmadas).toBe(1);
      expect(a.reservas.revisadas + b.reservas.revisadas).toBe(1);
      expect(pac.busquedas).toHaveLength(busquedas + 1);
      expect(correo.de(NOMBRE_PLANTILLA_FACTURA)).toHaveLength(facturas + 1);
      expect((await codigoDe('T13')).estado).toBe('facturado');
    });

    it('liberar: una sola búsqueda y una sola liberación', async () => {
      en('2033-03-29T11:00:00-06:00');
      pac.falso.programarSinRespuesta(false);
      expect((await emitirPortal('T14')).status).toBe(502);
      en('2033-03-29T11:15:00-06:00');
      expect(await conciliar()).toEqual(con({ reservas: { revisadas: 1, enEspera: 1 } }));
      const busquedas = pac.busquedas.length;
      en('2033-03-29T11:30:00-06:00');
      const [a, b] = await Promise.all([conciliar(ADMIN_A), conciliar(GLOBAL)]);
      expect(a.reservas.liberadas + b.reservas.liberadas).toBe(1);
      expect(a.reservas.revisadas + b.reservas.revisadas).toBe(1);
      expect(pac.busquedas).toHaveLength(busquedas + 1);
      expect((await codigoDe('T14')).estado).toBe('pendiente');
    });
  });

  it('una reserva que el PAC ya reporta CANCELADA se confirma (existe ante el SAT) y se pide revisarla a mano', async () => {
    en('2033-03-30T08:00:00-06:00');
    pac.falso.programarSinRespuesta(true);
    expect((await emitirPortal('T17')).status).toBe(502);
    const reserva = await reservaDe('T17');
    const serieFolio = `${reserva!.serie}-${reserva!.folio}`;
    const enPac = await pac.falso.buscarPorFolio({
      rfcEmisor: 'EKU9003173C9',
      serie: reserva!.serie,
      folio: String(reserva!.folio),
      zonaHoraria: 'America/Mexico_City',
    });
    pac.falso.cancelarEnPac(enPac!.uuid, '02');
    en('2033-03-30T08:15:00-06:00');
    expect(await conciliar()).toEqual(
      con({ reservas: { revisadas: 1, confirmadas: 1 }, requierenRevision: [serieFolio] }),
    );
    expect((await prisma.cfdi.findUniqueOrThrow({ where: { id: reserva!.id } })).estado).toBe(
      'vigente',
    );
  });

  it('alcance: un admin_empresa sólo concilia lo suyo; el programador (sistema) concilia todo', async () => {
    en('2033-03-30T10:00:00-06:00');
    pac.falso.programarSinRespuesta(true);
    const deB = await post(ADMIN_B, '/facturacion/cfdis/manual', {
      empresaId: FX.empresaB,
      sucursalId: FX.sucursalB1,
      solicitudId: 'f2110b00-0000-4000-8000-00000000b001',
      total: '250.00',
      formaPago: 'tarjeta',
      receptor: RECEPTORES.xia,
    });
    expect(deB.status).toBe(502);
    const reservaB = await prisma.cfdi.findFirstOrThrow({
      where: { empresaId: FX.empresaB, estado: 'timbrando' },
    });
    en('2033-03-30T10:15:00-06:00');
    // A no ve (ni reclama, ni consulta al PAC) la reserva de B.
    const busquedas = pac.busquedas.length;
    expect(await conciliar(ADMIN_A)).toEqual(NADA);
    expect(pac.busquedas).toHaveLength(busquedas);
    expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: reservaB.id } })).toMatchObject({
      estado: 'timbrando',
      conciliacionAt: null,
    });
    await app.get(ConciliacionProgramador).vuelta();
    expect((await prisma.cfdi.findUniqueOrThrow({ where: { id: reservaB.id } })).estado).toBe(
      'vigente',
    );
  });

  it('AC5 · `confirmarCfdi` a la vez desde dos caminos: uno gana, el otro es 404 (nada se mueve dos veces)', async () => {
    en('2033-03-31T10:00:00-06:00');
    pac.falso.programarSinRespuesta(true);
    expect((await emitirPortal('T15')).status).toBe(502);
    const reserva = await reservaDe('T15');
    const enPac = await pac.falso.buscarPorFolio({
      rfcEmisor: 'EKU9003173C9',
      serie: reserva!.serie,
      folio: String(reserva!.folio),
      zonaHoraria: 'America/Mexico_City',
    });
    const escritura = app
      .get(ScopedPrismaService)
      .facturacion({ tipo: 'empresa', empresaId: FX.empresaA });
    const confirmar = () =>
      escritura.confirmarCfdi(
        FX.empresaA,
        reserva!.id,
        { uuid: enPac!.uuid, idPac: enPac!.idPac, fechaTimbrado: enPac!.fechaTimbrado! },
        { ...RECEPTORES.eku },
        new Date(reloj.ahora()),
      );
    const r = await Promise.allSettled([confirmar(), confirmar()]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    const fallida = r.find((x) => x.status === 'rejected') as PromiseRejectedResult;
    expect(fallida.reason).toBeInstanceOf(NotFoundException);
    expect((await codigoDe('T15')).estado).toBe('facturado');
    expect((await prisma.cfdi.findUniqueOrThrow({ where: { id: reserva!.id } })).estado).toBe(
      'vigente',
    );
  });
});
