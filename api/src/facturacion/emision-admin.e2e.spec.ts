import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, RolUsuario } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import {
  ErrorTimbrado,
  type CfdiTimbrado,
  type EstadoCfdi,
  type PuertoTimbrado,
  type SolicitudCfdi,
} from '../adaptadores/timbrado/puerto';
import { TimbradoFalso } from '../adaptadores/timbrado/timbrado-falso';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import { Espera } from './cfdi.service';
import { MENSAJE_CANCELACION_PENDIENTE, MENSAJE_PAC_NO_VIGENTE } from './emision-admin.service';

// E2E de F2-107 (factura sin ticket y refacturación) sobre la app REAL contra Postgres REAL, con el
// PAC FALSO (que valida la relación 04 al cancelar con motivo 01). Las pruebas corren EN ORDEN y
// comparten estado: cada una deja la base como la necesita la siguiente. Las cifras del tablero
// están ESCRITAS A MANO desde los importes de la fixture, no recalculadas.

const KEY_A1 = 'msr_sintetica-refacturacion-F2-107-sucursal-a1-00000001';
const SLUG_A1 = 'f2107-a1';

class RelojControlado extends Reloj {
  t: number | null = null;
  ahora(): number {
    return this.t ?? Date.now();
  }
}

/** El PAC falso con fallas a la carta en la cancelación, un estado forzado y una compuerta. */
class PacControlado implements PuertoTimbrado {
  readonly emisiones: SolicitudCfdi[] = [];
  readonly xmlDe = new Map<string, string>();
  fallasCancelar: Error[] = [];
  estadoForzado: EstadoCfdi | null = null;
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
    const t = await this.falso.emitir(s);
    this.xmlDe.set(t.uuid, t.xml);
    return t;
  }

  cancelar: PuertoTimbrado['cancelar'] = (s) => {
    const falla = this.fallasCancelar.shift();
    if (falla) return Promise.reject(falla);
    return this.falso.cancelar(s);
  };

  consultarEstado: PuertoTimbrado['consultarEstado'] = (s) => {
    const forzado = this.estadoForzado;
    this.estadoForzado = null;
    if (forzado) return Promise.resolve({ uuid: s.uuid, estado: forzado });
    return this.falso.consultarEstado(s);
  };
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
const SIN_CORREO = { ...RECEPTORES.eku, email: undefined };

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

// A1 = CDMX (UTC−6), A2 = Tijuana (UTC−7 en septiembre y octubre).
const CHEQUES = [
  cheque('R1', '2026-09-05T13:00:00-06:00', '1000.00'),
  cheque('R2', '2026-09-06T13:00:00-06:00', '400.00'),
  cheque('R3', '2026-09-07T13:00:00-06:00', '250.00'),
  cheque('R4', '2026-09-08T13:00:00-06:00', '80.00'),
  cheque('R5', '2026-09-09T13:00:00-06:00', '60.00'),
];
const SEPTIEMBRE = 'desde=2026-09-01&hasta=2026-09-30';
const OCTUBRE = 'desde=2026-10-01&hasta=2026-10-31';
const SOLICITUD_1 = 'f2107000-0000-4000-8000-000000000001';
const SOLICITUD_2 = 'f2107000-0000-4000-8000-000000000002';

type Usuario = { id: string; rol: RolUsuario; empresaId: string | null };
const ADMIN_A: Usuario = USUARIOS.adminEmpresaA;
const ADMIN_B: Usuario = {
  id: 'f2107000-0000-4000-8000-0000000000b0',
  rol: RolUsuario.admin_empresa,
  empresaId: FX.empresaB,
};
const VISOR_A: Usuario = USUARIOS.visorA;

describe('Factura sin ticket y refacturación (e2e, F2-107)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojControlado();
  const pac = new PacControlado(new TimbradoFalso({ ahora: () => reloj.ahora() }));
  let app: NestExpressApplication;
  let url: string;
  let ips = 0;
  const ip = () => `10.7.${Math.floor(++ips / 250)}.${ips % 250}`;

  const token = (u: Usuario) => app.get(TokensService).firmarAccess(u);
  const get = async (u: Usuario, ruta: string) =>
    request(url)
      .get(ruta)
      .set('Authorization', `Bearer ${await token(u)}`);
  const post = async (u: Usuario, ruta: string, cuerpo: object) =>
    request(url)
      .post(ruta)
      .set('Authorization', `Bearer ${await token(u)}`)
      .send(cuerpo);
  const refacturar = (id: string, receptor: object = RECEPTORES.xia, u: Usuario = ADMIN_A) =>
    post(u, `/facturacion/cfdis/${id}/refacturar`, { receptor });
  const manual = (cuerpo: Record<string, unknown>, u: Usuario = ADMIN_A) =>
    post(u, '/facturacion/cfdis/manual', {
      empresaId: FX.empresaA,
      sucursalId: FX.sucursalA2,
      solicitudId: SOLICITUD_1,
      total: '580.00',
      formaPago: 'tarjeta',
      receptor: SIN_CORREO,
      ...cuerpo,
    });
  const tablero = (rango: string) =>
    get(ADMIN_A, `/facturacion/tablero?empresaId=${FX.empresaA}&${rango}`);
  const tabla = (extra: string) =>
    get(ADMIN_A, `/facturacion/cfdis?empresaId=${FX.empresaA}&${SEPTIEMBRE}&porPagina=200${extra}`);
  const cfdiDe = (folioSr: string) =>
    prisma.cfdi.findFirstOrThrow({
      where: { cheque: { folioSr }, sustituyeAId: null },
      include: { sustituidoPor: true },
    });
  const folioActual = async () =>
    (await prisma.perfilFiscal.findFirstOrThrow({ where: { empresaId: FX.empresaA } })).folioActual;
  const esperar = async (condicion: () => boolean) => {
    for (let i = 0; i < 200 && !condicion(); i++) await new Promise((r) => setTimeout(r, 10));
    expect(condicion()).toBe(true);
  };
  const sucursalDe = (cuerpo: { porSucursal: Array<{ sucursalId: string }> }, id: string) =>
    cuerpo.porSucursal.find((s) => s.sucursalId === id);

  beforeAll(async () => {
    await prisma.$connect();
    await prisma.configuracionFacturacion.deleteMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
    });
    await crearFixtures(prisma);
    await prisma.sucursal.update({
      where: { id: FX.sucursalA2 },
      data: { zonaHoraria: 'America/Tijuana' },
    });
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
    // Emisiones REALES por el portal, a las 14:00 locales del día del cierre.
    for (const [folioSr, dia] of [
      ['R1', '05'],
      ['R2', '06'],
      ['R3', '07'],
      ['R4', '08'],
      ['R5', '09'],
    ] as const) {
      reloj.t = Date.parse(`2026-09-${dia}T14:00:00-06:00`);
      const { codigo } = await prisma.codigoFacturacion.findFirstOrThrow({
        where: { cheque: { folioSr } },
      });
      const res = await request(url)
        .post(`/facturacion/portal/${SLUG_A1}/facturas`)
        .set('X-Forwarded-For', ip())
        .send({ codigo, receptor: RECEPTORES.eku });
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

  describe('refacturación', () => {
    it('R1: sustituto 04 vigente + anterior cancelado 01 con relación, verificado en el PAC falso', async () => {
      const viejo = await cfdiDe('R1');
      const emisiones = pac.emisiones.length;
      reloj.t = Date.parse('2026-09-12T10:00:00-06:00');
      const res = await refacturar(viejo.id);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        anterior: { id: viejo.id, uuid: viejo.uuid, estado: 'cancelado' },
        nuevo: { total: '1000.00', serieFolio: 'A-106' },
        cancelacion: 'cancelado',
        mensaje: null,
      });
      expect(pac.emisiones).toHaveLength(emisiones + 1);

      const antes = await prisma.cfdi.findUniqueOrThrow({ where: { id: viejo.id } });
      const nuevo = await prisma.cfdi.findUniqueOrThrow({ where: { id: res.body.nuevo.id } });
      // El anterior: cancelado con motivo 01, fecha del PAC, y SIN el código (pasó al sustituto).
      expect(antes).toMatchObject({
        estado: 'cancelado',
        motivoCancelacion: '01',
        canceladoAt: new Date('2026-09-12T16:00:00Z'),
        codigoId: null,
      });
      // El sustituto: vigente, relación 04 con el anterior, mismo cheque, importes y origen.
      expect(nuevo).toMatchObject({
        estado: 'vigente',
        sustituyeAId: viejo.id,
        tipoRelacion: '04',
        chequeId: viejo.chequeId,
        codigoId: viejo.codigoId,
        origen: 'ticket',
        formaPago: '01',
        emitidoAt: new Date('2026-09-12T16:00:00Z'),
      });
      expect(nuevo.total.toFixed(2)).toBe('1000.00');
      expect(nuevo.subtotal.toFixed(2)).toBe(viejo.subtotal.toFixed(2));
      expect(nuevo.iva.toFixed(2)).toBe(viejo.iva.toFixed(2));
      expect((nuevo.receptor as { rfc: string }).rfc).toBe('XIA190128J61');
      // El código sigue facturado (ahora con el CFDI válido).
      const codigo = await prisma.codigoFacturacion.findUniqueOrThrow({
        where: { id: viejo.codigoId! },
        include: { cfdi: true },
      });
      expect(codigo.estado).toBe('facturado');
      expect(codigo.cfdi?.id).toBe(nuevo.id);

      // Lo que vio el PAC: la solicitud con la relación, el XML con el nodo, y la cancelación 01
      // con el UUID del sustituto como folio de sustitución.
      expect(pac.emisiones.at(-1)?.relacionados).toEqual({
        tipoRelacion: '04',
        uuids: [viejo.uuid],
      });
      expect(pac.xmlDe.get(nuevo.uuid!)).toContain(
        `<cfdi:CfdiRelacionados TipoRelacion="04"><cfdi:CfdiRelacionado UUID="${viejo.uuid}"/>`,
      );
      expect(pac.falso.relacionadosDe(nuevo.uuid!)).toEqual({
        tipoRelacion: '04',
        uuids: [viejo.uuid],
      });
      expect(pac.falso.cancelacionDe(viejo.uuid!)).toEqual({
        motivo: '01',
        folioSustitucion: nuevo.uuid,
      });
      await expect(
        pac.falso.consultarEstado({ uuid: viejo.uuid!, idPac: viejo.idPac! }),
      ).resolves.toMatchObject({ estado: 'cancelado' });

      // Ya cancelado: 409 sin emitir nada.
      const otra = await refacturar(viejo.id);
      expect(otra.status).toBe(409);
      expect(pac.emisiones).toHaveLength(emisiones + 1);
    });

    it('R2: si la cancelación falla queda PENDIENTE, no cuenta doble, y el reintento sólo cancela', async () => {
      const viejo = await cfdiDe('R2');
      pac.fallasCancelar = [
        new ErrorTimbrado('PAC_SIN_RESPUESTA', 'no hubo respuesta (prueba)', false),
      ];
      reloj.t = Date.parse('2026-09-13T10:00:00-06:00');
      const emisiones = pac.emisiones.length;
      const res = await refacturar(viejo.id);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        anterior: { id: viejo.id, estado: 'vigente' },
        cancelacion: 'pendiente',
        mensaje: MENSAJE_CANCELACION_PENDIENTE,
      });
      expect(pac.emisiones).toHaveLength(emisiones + 1);
      const sustitutoId = res.body.nuevo.id as string;
      expect((await prisma.cfdi.findUniqueOrThrow({ where: { id: viejo.id } })).estado).toBe(
        'vigente',
      );

      // Tablero de septiembre, A1, a mano: R1 sustituto 1000.00 + R2 sustituto 400.00 + R3 250.00
      // + R4 80.00 + R5 60.00 = 1790.00 en 5 CFDI. El R2 anterior (vigente, sustituido) NO cuenta.
      // Cancelados: R1 anterior, 1000.00.
      const t = await tablero(SEPTIEMBRE);
      expect(t.status).toBe(200);
      expect(t.body.facturado).toEqual({ monto: '1790.00', cfdis: 5 });
      expect(t.body.cancelados).toEqual({ monto: '1000.00', cfdis: 1 });
      expect(sucursalDe(t.body, FX.sucursalA1)).toMatchObject({ facturado: '1790.00', cfdis: 5 });
      // Barras por mes y por hora: la misma regla (el R2 anterior se emitió a las 14:00).
      expect(t.body.porMes).toEqual([{ mes: '2026-09', facturado: '1790.00', cfdis: 5 }]);
      const h14 = t.body.porHora.find((h: { hora: number }) => h.hora === 14);
      // A las 14:00 locales: R3, R4, R5 (y los anteriores de R1 y R2, que no cuentan).
      expect(h14).toEqual({ hora: 14, facturado: '390.00', cfdis: 3 });

      // La tabla SÍ lista al anterior como vigente, marcado: el filtro `estado=vigente` no es el KPI.
      const vigentes = await tabla('&estado=vigente');
      expect(vigentes.body.total).toBe(6);
      const fila = vigentes.body.cfdis.find((c: { id: string }) => c.id === viejo.id);
      expect(fila).toMatchObject({
        sustitucionPendiente: true,
        sustituidoPor: res.body.nuevo.uuid,
        sustituyeA: null,
        origen: 'ticket',
        motivoCancelacion: null,
      });
      expect(vigentes.body.cfdis.find((c: { id: string }) => c.id === sustitutoId)).toMatchObject({
        sustituyeA: viejo.uuid,
        sustitucionPendiente: false,
      });

      // Reintento: NO emite otro sustituto; sólo cancela y anota.
      reloj.t = Date.parse('2026-09-13T11:00:00-06:00');
      const reintento = await refacturar(viejo.id);
      expect(reintento.status).toBe(201);
      expect(reintento.body).toMatchObject({
        anterior: { id: viejo.id, estado: 'cancelado' },
        nuevo: { id: sustitutoId },
        cancelacion: 'cancelado',
      });
      expect(pac.emisiones).toHaveLength(emisiones + 1);
      expect(await prisma.cfdi.count({ where: { sustituyeAId: viejo.id } })).toBe(1);
      expect(await prisma.cfdi.findUniqueOrThrow({ where: { id: viejo.id } })).toMatchObject({
        estado: 'cancelado',
        motivoCancelacion: '01',
      });
      const despues = await tablero(SEPTIEMBRE);
      expect(despues.body.facturado).toEqual({ monto: '1790.00', cfdis: 5 });
      expect(despues.body.cancelados).toEqual({ monto: '1400.00', cfdis: 2 });
    });

    it('R3: dos refacturaciones a la vez → un solo sustituto (201 + 409)', async () => {
      const viejo = await cfdiDe('R3');
      reloj.t = Date.parse('2026-09-14T10:00:00-06:00');
      const emisiones = pac.emisiones.length;
      pac.cerrar();
      const primera = refacturar(viejo.id).then((r) => r);
      await esperar(() => pac.emisiones.length === emisiones + 1);
      const segunda = await refacturar(viejo.id);
      expect(segunda.status).toBe(409);
      pac.abrir();
      expect((await primera).status).toBe(201);
      expect(pac.emisiones).toHaveLength(emisiones + 1);
      expect(await prisma.cfdi.count({ where: { sustituyeAId: viejo.id } })).toBe(1);
    });

    it('R5: el PAC no lo ve vigente (no_encontrado) → 409 sin emitir ni gastar folio', async () => {
      const viejo = await cfdiDe('R5');
      const folio = await folioActual();
      const emisiones = pac.emisiones.length;
      pac.estadoForzado = 'no_encontrado';
      const res = await refacturar(viejo.id);
      expect(res.status).toBe(409);
      expect(res.body.message).toBe(MENSAJE_PAC_NO_VIGENTE.no_encontrado);
      expect(pac.emisiones).toHaveLength(emisiones);
      expect(await folioActual()).toBe(folio);
      expect(await prisma.cfdi.count({ where: { sustituyeAId: viejo.id } })).toBe(0);
    });

    it('R4: sustituto en OCTUBRE con la cancelación pendiente → lo facturado se mueve de mes', async () => {
      const viejo = await cfdiDe('R4');
      pac.fallasCancelar = [new ErrorTimbrado('PAC_NO_DISPONIBLE', 'no disponible (prueba)', true)];
      reloj.t = Date.parse('2026-10-02T10:00:00-06:00');
      const res = await refacturar(viejo.id);
      expect(res.status).toBe(201);
      expect(res.body.cancelacion).toBe('pendiente');
      // Septiembre ya no cuenta el R4 anterior (su sustituto vigente existe, aunque en octubre).
      const sep = await tablero(SEPTIEMBRE);
      expect(sep.body.facturado).toEqual({ monto: '1710.00', cfdis: 4 });
      const oct = await tablero(OCTUBRE);
      expect(oct.body.facturado).toEqual({ monto: '80.00', cfdis: 1 });
    });

    it('alcance: admin de B → 404; visor → 403; id no UUID → 400; receptor inválido → 400 por campo', async () => {
      const viejo = await cfdiDe('R5');
      expect((await refacturar(viejo.id, RECEPTORES.xia, ADMIN_B)).status).toBe(404);
      expect((await refacturar(viejo.id, RECEPTORES.xia, VISOR_A)).status).toBe(403);
      expect((await refacturar('no-es-uuid')).status).toBe(400);
      const malo = await refacturar(viejo.id, { ...RECEPTORES.xia, rfc: 'XAXX010101000' });
      expect(malo.status).toBe(400);
      expect(malo.body.campos).toHaveProperty('rfc');
      expect(await prisma.cfdi.count({ where: { sustituyeAId: viejo.id } })).toBe(0);
    });
  });

  describe('factura sin ticket', () => {
    it('201 `origen=manual`, sin cheque ni código, importes desde el total; sin correo no se envía', async () => {
      reloj.t = Date.parse('2026-09-20T12:00:00-07:00');
      const folio = await folioActual();
      const res = await manual({});
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        origen: 'manual',
        total: '580.00',
        email: null,
        serieFolio: `A-${folio + 1}`,
      });
      const fila = await prisma.cfdi.findUniqueOrThrow({ where: { id: res.body.id } });
      expect(fila).toMatchObject({
        origen: 'manual',
        chequeId: null,
        codigoId: null,
        solicitudId: SOLICITUD_1,
        sucursalId: FX.sucursalA2,
        formaPago: '04',
        estado: 'vigente',
      });
      expect(fila.subtotal.toFixed(2)).toBe('500.00');
      expect(fila.iva.toFixed(2)).toBe('80.00');
      expect(pac.emisiones.at(-1)?.conceptos[0]).not.toHaveProperty('noIdentificacion');
      expect(await prisma.cfdiEnvio.count({ where: { cfdiId: fila.id } })).toBe(0);
    });

    it('la misma solicitudId otra vez → 409 con el CFDI que ya salió, sin folio ni emisión', async () => {
      const folio = await folioActual();
      const emisiones = pac.emisiones.length;
      const res = await manual({});
      expect(res.status).toBe(409);
      const primero = await prisma.cfdi.findFirstOrThrow({ where: { solicitudId: SOLICITUD_1 } });
      expect(res.body).toMatchObject({ cfdiId: primero.id, estado: 'vigente' });
      expect(await folioActual()).toBe(folio);
      expect(pac.emisiones).toHaveLength(emisiones);
    });

    it('dos envíos simultáneos con la misma llave → un solo CFDI (201 + 409)', async () => {
      reloj.t = Date.parse('2026-09-22T12:00:00-07:00');
      const emisiones = pac.emisiones.length;
      pac.cerrar();
      const primera = manual({ solicitudId: SOLICITUD_2, total: '99.99', formaPago: 'efectivo' });
      await esperar(() => pac.emisiones.length === emisiones + 1);
      const segunda = await manual({
        solicitudId: SOLICITUD_2,
        total: '99.99',
        formaPago: 'efectivo',
      });
      expect(segunda.status).toBe(409);
      expect(segunda.body.estado).toBe('timbrando');
      pac.abrir();
      expect((await primera).status).toBe(201);
      expect(await prisma.cfdi.count({ where: { solicitudId: SOLICITUD_2 } })).toBe(1);
    });

    it('una factura manual también se refactura: el sustituto sigue siendo manual', async () => {
      const viejo = await prisma.cfdi.findFirstOrThrow({ where: { solicitudId: SOLICITUD_1 } });
      reloj.t = Date.parse('2026-09-21T12:00:00-07:00');
      const res = await refacturar(viejo.id, RECEPTORES.xia);
      expect(res.status).toBe(201);
      expect(res.body.cancelacion).toBe('cancelado');
      const nuevo = await prisma.cfdi.findUniqueOrThrow({ where: { id: res.body.nuevo.id } });
      expect(nuevo).toMatchObject({
        origen: 'manual',
        chequeId: null,
        solicitudId: null,
        sustituyeAId: viejo.id,
        tipoRelacion: '04',
      });
    });

    it('validación: total y receptor por campo; empresa o sucursal fuera del alcance → 404; visor → 403', async () => {
      const folio = await folioActual();
      const nueva = (n: number) =>
        `f2107000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
      for (const total of ['0', '12.345', '-3', '1e3', '1000000']) {
        const r = await manual({ solicitudId: nueva(1), total });
        expect(r.status).toBe(400);
        expect(Object.keys(r.body.campos)).toEqual(['total']);
      }
      const ambos = await manual({
        solicitudId: nueva(2),
        total: 'abc',
        receptor: { ...SIN_CORREO, rfc: 'NO-ES-RFC', cp: '123' },
      });
      expect(ambos.status).toBe(400);
      expect(Object.keys(ambos.body.campos).sort()).toEqual(['cp', 'rfc', 'total']);
      expect((await manual({ solicitudId: nueva(3), formaPago: 'otro' })).status).toBe(400);
      expect((await manual({ solicitudId: nueva(4), sucursalId: FX.sucursalB1 })).status).toBe(404);
      expect(
        (await manual({ solicitudId: nueva(5), empresaId: FX.empresaB, sucursalId: FX.sucursalB1 }))
          .status,
      ).toBe(404);
      expect(
        (
          await manual(
            { solicitudId: nueva(6), empresaId: FX.empresaB, sucursalId: FX.sucursalB1 },
            ADMIN_B,
          )
        ).status,
      ).toBe(201);
      expect((await manual({ solicitudId: nueva(7) }, VISOR_A)).status).toBe(403);
      expect(await folioActual()).toBe(folio);
    });
  });

  describe('tablero (F2-106) con lo de F2-107', () => {
    it('septiembre, cifras a mano: manuales cuentan en su sucursal, sustituidos no, cancelados sí', async () => {
      // A1: R1 1000.00 + R2 400.00 + R3 250.00 (sustitutos) + R5 60.00 = 1710.00 en 4; el R4
      //     anterior no cuenta (sustituto vigente en octubre). Cancelados: R1, R2, R3 = 1650.00 en 3.
      // A2: manual 1 sustituto 580.00 + manual 2 99.99 = 679.99 en 2. Cancelado: manual 1 anterior
      //     580.00.
      const t = await tablero(SEPTIEMBRE);
      expect(t.body.facturado).toEqual({ monto: '2389.99', cfdis: 6 });
      expect(t.body.cancelados).toEqual({ monto: '2230.00', cfdis: 4 });
      expect(sucursalDe(t.body, FX.sucursalA1)).toMatchObject({
        facturado: '1710.00',
        cfdis: 4,
        cancelados: { monto: '1650.00', cfdis: 3 },
      });
      expect(sucursalDe(t.body, FX.sucursalA2)).toMatchObject({
        facturado: '679.99',
        cfdis: 2,
        cancelados: { monto: '580.00', cfdis: 1 },
      });
    });

    it('la tabla distingue las manuales (`origen`, sin ticket) y filtra por origen', async () => {
      const manuales = await tabla('&origen=manual');
      expect(manuales.status).toBe(200);
      expect(manuales.body.total).toBe(3);
      for (const c of manuales.body.cfdis) {
        expect(c).toMatchObject({ origen: 'manual', folioTicket: null, sucursalId: FX.sucursalA2 });
      }
      const sustituto = manuales.body.cfdis.find(
        (c: { sustituyeA: string | null }) => c.sustituyeA !== null,
      );
      expect(sustituto.receptor).toEqual({
        rfc: 'XIA190128J61',
        razonSocial: 'XENON INDUSTRIAL ARTICLES',
        regimenFiscal: '601',
        cp: '76343',
        usoCfdi: 'G03',
        email: 'xenon@ejemplo.test',
      });
      const anterior = manuales.body.cfdis.find(
        (c: { uuid: string }) => c.uuid === sustituto.sustituyeA,
      );
      expect(anterior).toMatchObject({
        estado: 'cancelado',
        motivoCancelacion: '01',
        sustituidoPor: sustituto.uuid,
        sustitucionPendiente: false,
      });
      const deTicket = await tabla('&origen=ticket');
      expect(deTicket.body.cfdis.every((c: { origen: string }) => c.origen === 'ticket')).toBe(
        true,
      );
      expect(deTicket.body.total + manuales.body.total).toBe((await tabla('')).body.total);
      expect((await tabla('&origen=otro')).status).toBe(400);
    });
  });
});
