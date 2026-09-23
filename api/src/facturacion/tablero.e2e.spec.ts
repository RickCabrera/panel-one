import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient, RolUsuario } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { PUERTO_TIMBRADO } from '../adaptadores/adaptadores.module';
import { TimbradoFalso } from '../adaptadores/timbrado/timbrado-falso';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { Espera } from './cfdi.service';
import { estadoPublico } from './codigo';

// E2E del tablero de facturación (F2-106) sobre la app REAL contra Postgres REAL. Las cifras
// esperadas están ESCRITAS A MANO desde la fixture (importes y horas conocidos), no recalculadas:
// así un corte en UTC en vez de en la zona de la sucursal, o un CFDI en la hora o el mes
// equivocados, rompe el test.
//
// Los CFDI salen del POST REAL del portal con el PAC falso. El reloj de la app y el del PAC son
// el mismo `RelojControlado`: `emitido_at` = `fechaTimbrado` = el `reloj.t` puesto antes de cada
// POST. Lo único que NO sale del flujo real: el CFDI `cancelado` (UPDATE en la fixture: cancelar
// es F2-109), la reserva `timbrando` (por `EscrituraFacturacion.reservarCfdi`, como en F2-104) y
// los estados de código `en_global`/`expirado` guardados de la prueba por ramas.

const KEYS = {
  a1: 'msr_sintetica-tablero-F2-106-sucursal-a1-0000000000001',
  a2: 'msr_sintetica-tablero-F2-106-sucursal-a2-0000000000002',
  b1: 'msr_sintetica-tablero-F2-106-sucursal-b1-0000000000003',
} as const;
const SLUGS = { a1: 'f2106-a1', a2: 'f2106-a2', b1: 'f2106-b1' } as const;

class RelojControlado extends Reloj {
  t: number | null = null;
  ahora(): number {
    return this.t ?? Date.now();
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

/** Un cheque sintético pagado en efectivo, cerrado a la hora LOCAL dada (con su offset). */
function cheque(folioSr: string, cerradoAt: string, total: string, cambios = {}) {
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
      ...cambios,
    },
  };
}

// CDMX = UTC−6 todo el año; Tijuana = UTC−7 en septiembre y octubre (horario de verano).
const CHEQUES_A1 = [
  cheque('A1-1', '2026-09-10T13:00:00-06:00', '1000.00'),
  cheque('A1-2', '2026-09-30T19:00:00-06:00', '500.00'),
  cheque('A1-3', '2026-09-15T12:00:00-06:00', '250.00'),
  cheque('A1-4', '2026-09-20T12:00:00-06:00', '333.33'),
  cheque('A1-5', '2026-09-21T12:00:00-06:00', '100.00', { cancelado: true }),
  cheque('A1-6', '2026-10-05T12:00:00-06:00', '200.00'),
  cheque('A1-7', '2026-08-31T23:30:00-06:00', '999.00'),
  cheque('A1-8', '2026-10-20T12:00:00-06:00', '123.45'),
];
const CHEQUES_A2 = [
  cheque('A2-1', '2026-09-10T13:00:00-07:00', '800.00'),
  cheque('A2-2', '2026-10-31T22:00:00-07:00', '150.00'),
  cheque('A2-3', '2026-09-10T12:00:00-07:00', '50.00'),
];
// Noviembre, sólo para la prueba por ramas contra `estadoPublico` (fuera del rango principal).
const RAMAS = [
  'PEND',
  'VENC-DERIV',
  'VENC-GUARD',
  'FACT',
  'GLOBAL',
  'TIMBR',
  'CFDI-CANC',
  'CHQ-CANC',
] as const;
const CHEQUES_RAMAS = RAMAS.map((r) => cheque(`N-${r}`, '2026-11-10T12:00:00-06:00', '10.00'));

const RANGO = 'desde=2026-09-01&hasta=2026-10-31';
const AHORA_CONSULTA = Date.parse('2026-11-01T05:30:00Z');

const cero = (hora: number) => ({ hora, facturado: '0.00', cfdis: 0 });

describe('Tablero de facturación (e2e, F2-106)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojControlado();
  let app: NestExpressApplication;
  let url: string;
  /** Lo que devolvió el 201 del portal, por cheque (la fuente independiente del monto). */
  const emitidos = new Map<string, { total: string; uuid: string; serieFolio: string }>();

  let ips = 0;
  const ip = () => `10.6.${Math.floor(++ips / 250)}.${ips % 250}`;
  type Usuario = { id: string; rol: RolUsuario; empresaId: string | null };
  const ADMIN_B: Usuario = {
    id: 'f2106000-0000-4000-8000-0000000000b0',
    rol: RolUsuario.admin_empresa,
    empresaId: FX.empresaB,
  };
  const como = async (u: Usuario, ruta: string) => {
    const t = await app.get(TokensService).firmarAccess(u);
    return request(url).get(ruta).set('Authorization', `Bearer ${t}`);
  };
  const tablero = (u: Usuario, extra = '', empresa: string = FX.empresaA) =>
    como(u, `/facturacion/tablero?empresaId=${empresa}&${RANGO}${extra}`);

  async function lote(key: string, eventos: object[]) {
    const res = await request(url).post('/ingesta/eventos').set('X-Api-Key', key).send({ eventos });
    expect(res.status).toBe(200);
    expect(res.body.rechazados).toEqual([]);
  }
  const codigoDe = (folioSr: string) =>
    prisma.codigoFacturacion.findFirstOrThrow({ where: { cheque: { folioSr } } });

  /** Emite por el POST REAL del portal en el instante `en` (ISO con offset). */
  async function emitir(folioSr: string, slug: string, en: string, receptor: object) {
    reloj.t = Date.parse(en);
    const { codigo } = await codigoDe(folioSr);
    const res = await request(url)
      .post(`/facturacion/portal/${slug}/facturas`)
      .set('X-Forwarded-For', ip())
      .send({ codigo, receptor });
    expect(res.status).toBe(201);
    emitidos.set(folioSr, res.body as { total: string; uuid: string; serieFolio: string });
  }

  async function reservar(folioSr: string, en: string) {
    const c = await codigoDe(folioSr);
    await app
      .get(ScopedPrismaService)
      .facturacion({ tipo: 'empresa', empresaId: FX.empresaA })
      .reservarCfdi(
        FX.empresaA,
        {
          codigoId: c.id,
          chequeId: c.chequeId,
          sucursalId: c.sucursalId,
          receptor: { ...RECEPTORES.eku },
        },
        new Date(en),
      );
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({
      where: { id: FX.sucursalA2 },
      data: { zonaHoraria: 'America/Tijuana' },
    });
    for (const [id, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalA2, KEYS.a2],
      [FX.sucursalB1, KEYS.b1],
    ]) {
      await prisma.sucursal.update({ where: { id }, data: { apiKeyHash: hashApiKey(key) } });
    }
    const alta = new Date('2026-08-01T00:00:00Z');
    for (const empresaId of [FX.empresaA, FX.empresaB]) {
      // Vigencia EXPLÍCITA (no depender del default): fin del mes del cierre.
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
    for (const [sucursalId, empresaId, slug] of [
      [FX.sucursalA1, FX.empresaA, SLUGS.a1],
      [FX.sucursalA2, FX.empresaA, SLUGS.a2],
      [FX.sucursalB1, FX.empresaB, SLUGS.b1],
    ]) {
      await prisma.portalFacturacion.create({
        data: { sucursalId, empresaId, slug, color: '#0f766e', updatedAt: alta },
      });
    }

    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .overrideProvider(PUERTO_TIMBRADO)
      .useValue(new TimbradoFalso({ ahora: () => reloj.ahora() }))
      .overrideProvider(Espera)
      .useValue({ esperar: () => Promise.resolve() })
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>(), {
      TRUST_PROXY_SALTOS: '1',
    });
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    await lote(KEYS.a1, [...CHEQUES_A1, ...CHEQUES_RAMAS]);
    await lote(KEYS.a2, CHEQUES_A2);
    await lote(KEYS.b1, [cheque('B-1', '2026-09-10T13:00:00-06:00', '700.00')]);

    // Emisiones REALES por el portal, en instantes conocidos.
    await emitir('A1-1', SLUGS.a1, '2026-09-10T14:30:00-06:00', RECEPTORES.eku); // 20:30Z
    await emitir('A2-1', SLUGS.a2, '2026-09-10T13:30:00-07:00', RECEPTORES.xia); // 20:30Z
    await emitir('A2-3', SLUGS.a2, '2026-09-10T14:10:00-07:00', RECEPTORES.eku); // 21:10Z
    await emitir('A1-3', SLUGS.a1, '2026-09-15T13:00:00-06:00', RECEPTORES.xia);
    await emitir('A1-2', SLUGS.a1, '2026-09-30T20:00:00-06:00', RECEPTORES.eku); // 10-01 02:00Z
    await emitir('A1-7', SLUGS.a1, '2026-08-31T23:40:00-06:00', RECEPTORES.eku); // 09-01 05:40Z
    await emitir('B-1', SLUGS.b1, '2026-09-10T14:30:00-06:00', RECEPTORES.eku);
    // Cancelar es F2-109: aquí se pasa a mano.
    const a13 = await codigoDe('A1-3');
    await prisma.cfdi.update({ where: { codigoId: a13.id }, data: { estado: 'cancelado' } });
    // Reserva colgada en `timbrando` (no es facturado ni por facturar).
    await reservar('A1-6', '2026-10-05T13:00:00-06:00');

    // Ramas de noviembre contra `estadoPublico`.
    await emitir('N-FACT', SLUGS.a1, '2026-11-12T12:00:00-06:00', RECEPTORES.eku);
    await emitir('N-CFDI-CANC', SLUGS.a1, '2026-11-12T12:05:00-06:00', RECEPTORES.eku);
    const canc = await codigoDe('N-CFDI-CANC');
    await prisma.cfdi.update({ where: { codigoId: canc.id }, data: { estado: 'cancelado' } });
    await prisma.codigoFacturacion.update({
      where: { id: canc.id },
      data: { estado: 'pendiente' },
    });
    await reservar('N-TIMBR', '2026-11-12T12:10:00-06:00');
    await prisma.codigoFacturacion.update({
      where: { id: (await codigoDe('N-VENC-DERIV')).id },
      data: { expiraAt: new Date('2026-11-15T06:00:00Z') },
    });
    await prisma.codigoFacturacion.update({
      where: { id: (await codigoDe('N-VENC-GUARD')).id },
      data: { estado: 'expirado' },
    });
    await prisma.codigoFacturacion.update({
      where: { id: (await codigoDe('N-GLOBAL')).id },
      data: { estado: 'en_global' },
    });
    // La cuenta se cancela en SR DESPUÉS de tener código: el código se queda, el cheque no.
    await lote(KEYS.a1, [
      cheque('N-CHQ-CANC', '2026-11-10T12:00:00-06:00', '10.00', { cancelado: true }),
    ]);
  }, 120_000);

  beforeEach(() => {
    reloj.t = AHORA_CONSULTA;
  });

  afterAll(async () => {
    await app.close();
    await prisma.configuracionFacturacion.deleteMany({
      where: { empresaId: { in: [FX.empresaA, FX.empresaB] } },
    });
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('cuadra contra las cifras de la fixture, escritas a mano (empresa A, sep–oct)', async () => {
    const res = await tablero(USUARIOS.adminEmpresaA);
    expect(res.status).toBe(200);
    const t = res.body;
    // Venta: sin A1-5 (cancelado) ni A1-7 (agosto LOCAL aunque en UTC ya es septiembre).
    expect(t.ventas).toEqual({ venta: '3406.78', cuentas: 9 });
    // Vigentes: A1-1, A1-2, A2-1, A2-3. Ni A1-7 (emitido en agosto local), ni B-1, ni la reserva.
    expect(t.facturado).toEqual({ monto: '2350.00', cfdis: 4 });
    expect(t.cancelados).toEqual({ monto: '250.00', cfdis: 1 });
    expect(t.tasa).toBe('0.6898');
    // A1-8 y A2-2 (A1-4 ya venció; A1-6 tiene reserva; A1-3 está facturado).
    expect(t.porFacturar).toEqual({ cuentas: 2, monto: '273.45' });
    expect(t.porSucursal).toEqual([
      {
        sucursalId: FX.sucursalA1,
        nombre: 'A1',
        venta: '2406.78',
        cuentas: 6,
        facturado: '1500.00',
        cfdis: 2,
        cancelados: { monto: '250.00', cfdis: 1 },
        tasa: '0.6232',
      },
      {
        sucursalId: FX.sucursalA2,
        nombre: 'A2',
        venta: '1000.00',
        cuentas: 3,
        facturado: '850.00',
        cfdis: 2,
        cancelados: { monto: '0.00', cfdis: 0 },
        tasa: '0.8500',
      },
    ]);
    // A1-2 se emitió el 30/09 20:00 CDMX = 01/10 02:00Z: se queda en septiembre LOCAL.
    expect(t.porMes).toEqual([
      { mes: '2026-09', facturado: '2350.00', cfdis: 4 },
      { mes: '2026-10', facturado: '0.00', cfdis: 0 },
    ]);
    // A1-1 y A2-1 son el MISMO instante (20:30Z): 14 en CDMX y 13 en Tijuana.
    const esperadas = Array.from({ length: 24 }, (_, h) => cero(h));
    esperadas[13] = { hora: 13, facturado: '800.00', cfdis: 1 };
    esperadas[14] = { hora: 14, facturado: '1050.00', cfdis: 2 };
    esperadas[20] = { hora: 20, facturado: '500.00', cfdis: 1 };
    expect(t.porHora).toEqual(esperadas);
  });

  it('verificación extra: la venta es la de /ventas y lo facturado, la suma de los 201 del portal', async () => {
    const t = (await tablero(USUARIOS.visorA)).body;
    const resumen = (
      await como(USUARIOS.visorA, `/ventas/resumen?empresaId=${FX.empresaA}&${RANGO}`)
    ).body;
    expect(t.ventas).toEqual({ venta: resumen.venta, cuentas: resumen.cuentas });
    const suma = ['A1-1', 'A1-2', 'A2-1', 'A2-3']
      .map((f) => Number(emitidos.get(f)!.total) * 100)
      .reduce((a, b) => a + b, 0);
    expect(t.facturado.monto).toBe((suma / 100).toFixed(2));
  });

  it('con sucursal: sólo la suya', async () => {
    const t = (await tablero(USUARIOS.adminEmpresaA, `&sucursalId=${FX.sucursalA2}`)).body;
    expect(t.ventas).toEqual({ venta: '1000.00', cuentas: 3 });
    expect(t.facturado).toEqual({ monto: '850.00', cfdis: 2 });
    expect(t.cancelados).toEqual({ monto: '0.00', cfdis: 0 });
    expect(t.tasa).toBe('0.8500');
    expect(t.porFacturar).toEqual({ cuentas: 1, monto: '150.00' });
    expect(t.porSucursal.map((s: { sucursalId: string }) => s.sucursalId)).toEqual([FX.sucursalA2]);
  });

  it('con alturaAl: corta a la hora local de cada sucursal; lo emitido después queda fuera', async () => {
    // 20:40Z = 14:40 CDMX / 13:40 Tijuana. A2-3 se emitió a las 21:10Z (14:10 Tijuana).
    const t = (
      await como(
        USUARIOS.adminEmpresaA,
        `/facturacion/tablero?empresaId=${FX.empresaA}&desde=2026-09-10&hasta=2026-09-10` +
          '&alturaAl=2026-09-10T20:40:00Z',
      )
    ).body;
    expect(t.ventas).toEqual({ venta: '1850.00', cuentas: 3 });
    expect(t.facturado).toEqual({ monto: '1800.00', cfdis: 2 });
    expect(t.porMes).toEqual([{ mes: '2026-09', facturado: '1800.00', cfdis: 2 }]);
  });

  it('periodo sin nada: ceros de verdad y tasa nula (no "0.0000")', async () => {
    const t = (
      await como(
        USUARIOS.adminEmpresaA,
        `/facturacion/tablero?empresaId=${FX.empresaA}&desde=2026-07-01&hasta=2026-07-31`,
      )
    ).body;
    expect(t.ventas).toEqual({ venta: '0.00', cuentas: 0 });
    expect(t.facturado).toEqual({ monto: '0.00', cfdis: 0 });
    expect(t.tasa).toBeNull();
    expect(t.porSucursal.every((s: { tasa: unknown }) => s.tasa === null)).toBe(true);
  });

  describe('tabla de CFDI', () => {
    const cfdis = (extra = '', u: Usuario = USUARIOS.adminEmpresaA) =>
      como(u, `/facturacion/cfdis?empresaId=${FX.empresaA}&${RANGO}${extra}`);

    it('lista vigentes y cancelados del periodo, del más reciente al más viejo; nunca la reserva', async () => {
      const res = await cfdis();
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(5);
      expect(res.body.cfdis.map((c: { folioTicket: string }) => c.folioTicket)).toEqual([
        'T-A1-2',
        'T-A1-3',
        'T-A2-3',
        // A1-1 y A2-1: mismo instante; desempate por id, así que sólo se fija que estén los dos.
        expect.stringMatching(/^T-A[12]-1$/),
        expect.stringMatching(/^T-A[12]-1$/),
      ]);
      const a12 = res.body.cfdis[0];
      expect(a12).toEqual({
        id: expect.any(String),
        uuid: emitidos.get('A1-2')!.uuid,
        serieFolio: emitidos.get('A1-2')!.serieFolio,
        sucursalId: FX.sucursalA1,
        sucursal: 'A1',
        receptorRfc: 'EKU9003173C9',
        receptorNombre: 'ESCUELA KEMPER URGATE',
        total: '500.00',
        estado: 'vigente',
        emitidoAt: '2026-10-01T02:00:00.000Z',
        folioTicket: 'T-A1-2',
        xml: true,
        pdf: true,
      });
      expect(res.body.cfdis[1].estado).toBe('cancelado');
    });

    it('busca por RFC, UUID, serie-folio y folio del ticket (literal, sin mayúsculas)', async () => {
      const folios = async (q: string) =>
        (await cfdis(`&q=${encodeURIComponent(q)}`)).body.cfdis
          .map((c: { folioTicket: string }) => c.folioTicket)
          .sort();
      expect(await folios('xia190128')).toEqual(['T-A1-3', 'T-A2-1']);
      const uuid = emitidos.get('A2-3')!.uuid;
      expect(await folios(uuid.slice(9, 18).toLowerCase())).toEqual(['T-A2-3']);
      const serieFolio = emitidos.get('A1-2')!.serieFolio; // p. ej. "A-105"
      expect(await folios(serieFolio)).toEqual(['T-A1-2']);
      expect(await folios(serieFolio.replace('-', ''))).toEqual(['T-A1-2']);
      expect(await folios('t-a2-3')).toEqual(['T-A2-3']);
      // `%` y `_` son literales: no son comodines.
      expect(await folios('%')).toEqual([]);
      expect(await folios('_')).toEqual([]);
      // Sólo dentro del rango: A1-7 (agosto local) no aparece aunque su RFC coincida.
      expect(await folios('T-A1-7')).toEqual([]);
    });

    it('filtra por estado y pagina con el total del filtro completo', async () => {
      const canc = (await cfdis('&estado=cancelado')).body;
      expect(canc.total).toBe(1);
      expect(canc.cfdis[0].folioTicket).toBe('T-A1-3');
      const p2 = (await cfdis('&porPagina=2&pagina=2')).body;
      expect(p2).toMatchObject({ total: 5, pagina: 2, porPagina: 2 });
      expect(p2.cfdis).toHaveLength(2);
      const fuera = (await cfdis('&porPagina=2&pagina=9')).body;
      expect(fuera).toMatchObject({ total: 5, cfdis: [] });
    });

    it('400 con parámetros inválidos', async () => {
      expect((await cfdis('&estado=timbrando')).status).toBe(400);
      expect((await cfdis('&porPagina=201')).status).toBe(400);
      expect((await cfdis(`&q=${'X'.repeat(65)}`)).status).toBe(400);
    });
  });

  it('por facturar (lista) = estadoPublico() === "pendiente", rama por rama (noviembre)', async () => {
    reloj.t = Date.parse('2026-11-20T12:00:00-06:00');
    const res = await como(
      USUARIOS.adminEmpresaA,
      `/facturacion/por-facturar?empresaId=${FX.empresaA}&desde=2026-11-01&hasta=2026-11-30`,
    );
    expect(res.status).toBe(200);
    const enLista = new Set(res.body.cuentas.map((c: { folio: string }) => c.folio));

    const codigos = await prisma.codigoFacturacion.findMany({
      where: { cheque: { folioSr: { startsWith: 'N-' } } },
      include: { cfdi: { select: { estado: true } }, cheque: true },
    });
    expect(codigos).toHaveLength(RAMAS.length);
    for (const c of codigos) {
      const pendiente = estadoPublico(c, c.cheque, reloj.t) === 'pendiente';
      expect([c.cheque.folio, enLista.has(c.cheque.folio)]).toEqual([c.cheque.folio, pendiente]);
    }
    expect([...enLista].sort()).toEqual(['T-N-CFDI-CANC', 'T-N-PEND']);
    expect(res.body).toMatchObject({ total: 2, monto: '20.00' });
    expect(res.body.cuentas[0]).toEqual({
      chequeId: expect.any(String),
      folio: expect.stringMatching(/^T-N-/),
      sucursalId: FX.sucursalA1,
      sucursal: 'A1',
      cerradoAt: '2026-11-10T18:00:00.000Z',
      total: '10.00',
      codigo: expect.stringMatching(/^[A-HJ-NP-Z2-9]{9}$/),
      expiraAt: '2026-12-01T06:00:00.000Z',
    });
  });

  describe('alcance', () => {
    const RUTAS = ['tablero', 'cfdis', 'por-facturar'] as const;
    const ruta = (r: string, extra = '', empresa: string = FX.empresaA) =>
      `/facturacion/${r}?empresaId=${empresa}&${RANGO}${extra}`;

    it.each(RUTAS)('%s: admin de B sobre A = 404 (nunca 403)', async (r) => {
      expect((await como(ADMIN_B, ruta(r))).status).toBe(404);
    });

    it.each(RUTAS)('%s: sucursal de otra empresa = 404', async (r) => {
      expect(
        (await como(USUARIOS.adminEmpresaA, ruta(r, `&sucursalId=${FX.sucursalB1}`))).status,
      ).toBe(404);
    });

    it.each(RUTAS)('%s: admin_global = 200', async (r) => {
      expect((await como(USUARIOS.adminGlobal, ruta(r))).status).toBe(200);
    });

    it('tablero: visor de A = 200; visor de B sobre A = 404', async () => {
      expect((await tablero(USUARIOS.visorA)).status).toBe(200);
      expect((await tablero(USUARIOS.visorB)).status).toBe(404);
    });

    it.each(['cfdis', 'por-facturar'])(
      '%s: visor = 403 por rol, en su empresa y en cualquier otra',
      async (r) => {
        expect((await como(USUARIOS.visorA, ruta(r))).status).toBe(403);
        expect((await como(USUARIOS.visorA, ruta(r, '', FX.empresaB))).status).toBe(403);
      },
    );

    it('la empresa B sólo ve su CFDI', async () => {
      const t = (await tablero(USUARIOS.adminGlobal, '', FX.empresaB)).body;
      expect(t.facturado).toEqual({ monto: '700.00', cfdis: 1 });
      expect(t.ventas).toEqual({ venta: '700.00', cuentas: 1 });
    });
  });
});
