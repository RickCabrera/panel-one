import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';

// E2E de Clientes (F2-232) sobre la app REAL contra Postgres REAL, con las fixtures sintéticas
// de F1-011 (A1 y A2 de la empresa A, B1 de la B; zona CDMX). Cuentas y catálogo van ESCRITOS A
// MANO: las cifras esperadas se calcularon aquí, no con otra consulta.
//
// OJO: el id del cliente en el POS (`origenSrId`) y su clave visible son DISTINTOS a propósito
// (en el seed son iguales y un cruce por clave pasaría). "Carla Trampa" tiene la CLAVE "SR-20" y
// otro id: la cuenta que trae el id "SR-20" NO es suya.
//
// Los tests de "sin sincronizar" → "vacío" de A2 van en ese orden: el segundo cierra el catálogo.

const KEYS = {
  a1: 'msr_sintetica-clientes-F2-232-sucursal-a1-00000000001',
  a2: 'msr_sintetica-clientes-F2-232-sucursal-a2-00000000002',
  b1: 'msr_sintetica-clientes-F2-232-sucursal-b1-00000000003',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

const DIA = '2026-09-10';
const RANGO = { desde: DIA, hasta: DIA };
/** 12:00 de CDMX del 10-sep. */
const MEDIODIA = Date.parse('2026-09-10T18:00:00Z');
const HORA = 3_600_000;
const NO_EXISTE = '00000000-0000-4000-8000-000000000999';
const sinc = (n: number) => `f2232000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Datos personales de las fixtures: no pueden aparecer en ningún log. */
const PII = [
  'Ana Cliente',
  '555-010-9901',
  'ana.cliente@ejemplo.test',
  'XAXX010101000',
  'Beto Cliente',
  'beto@ejemplo.test',
  'Carla Trampa',
  'Bruno Otro',
];

const ANA = {
  origenSrId: 'SR-17',
  clave: 'C001',
  nombre: 'Ana Cliente',
  telefono: '555-010-9901',
  correo: 'ana.cliente@ejemplo.test',
  rfc: 'XAXX010101000',
};
const BETO = {
  origenSrId: 'SR-18',
  clave: 'C002',
  nombre: 'Beto Cliente',
  telefono: null,
  correo: 'beto@ejemplo.test',
  rfc: null,
};
const CARLA = { origenSrId: 'SR-19', clave: 'SR-20', nombre: 'Carla Trampa' };
const BRUNO = { origenSrId: 'SR-17', clave: 'B1', nombre: 'Bruno Otro' };

interface Cifras {
  visitas: number;
  venta: string;
  ticketPromedio: string | null;
  ultimaVisita: string | null;
  canceladas: { cuentas: number; monto: string };
}
interface Fila extends Cifras {
  id: string | null;
  sucursalId: string;
  cruce: string;
  origenSrId: string;
  clave: string | null;
  nombre: string | null;
  telefono?: string | null;
  correo?: string | null;
  rfc?: string | null;
}
interface Resumen {
  usaClientes: boolean;
  catalogoTruncado: boolean;
  cuentas: number;
  cuentasConCliente: number;
  ventaConCliente: string;
  sucursales: Array<{
    sucursalId: string;
    catalogo: string;
    clientesActivos: number;
    cuentas: number;
    cuentasConCliente: number;
  }>;
  filas: Fila[];
  total: number;
}
interface Ficha {
  cliente: Record<string, unknown> & { id: string; nombre: string };
  periodo: Cifras;
  productos: Array<{ producto: string; cantidad: string; importe: string; cuentas: number }>;
}

describe('Clientes (e2e, F2-232)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;
  const logs: unknown[][] = [];
  let idAna: string;
  let idBruno: string;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const get = async (ruta: string, u: Usuario, query: Record<string, string> = {}) =>
    request(url)
      .get(ruta)
      .query(query)
      .set('Authorization', `Bearer ${await token(u)}`);
  const resumen = async (u: Usuario, query: Record<string, string>) => {
    const r = await get('/catalogos/clientes/resumen', u, query);
    expect(r.status).toBe(200);
    return r.body as Resumen;
  };

  async function sincronizar(key: string, n: number, registros: object[]) {
    const capturadoAt = '2026-09-01T10:00:00.000Z';
    if (registros.length > 0) {
      const p = await request(url)
        .post('/ingesta/catalogos')
        .set('X-Api-Key', key)
        .send({ catalogo: 'clientes', sincronizacionId: sinc(n), capturadoAt, registros });
      expect(p.status).toBe(200);
      expect(p.body.rechazados).toEqual([]);
    }
    const c = await request(url)
      .post('/ingesta/catalogos/cierre')
      .set('X-Api-Key', key)
      .send({
        catalogo: 'clientes',
        sincronizacionId: sinc(n),
        capturadoAt,
        total: registros.length,
        rechazados: 0,
      });
    expect(c.status).toBe(200);
    expect(c.body.aplicado).toBe(true);
  }

  let folio = 0;
  async function cuenta(
    sucursalId: string,
    empresaId: string,
    cliente: string | null,
    total: string,
    extra: { cancelado?: boolean; cerradoAt?: number; partidas?: Array<[string, string, string]> } = {},
  ) {
    folio++;
    const cerrado = extra.cerradoAt ?? MEDIODIA;
    const c = await prisma.cheque.create({
      data: {
        sucursalId,
        empresaId,
        folio: `K${folio}`,
        folioSr: `K${folio}`,
        clienteOrigenSrId: cliente,
        abiertoAt: new Date(cerrado - HORA),
        cerradoAt: new Date(cerrado),
        subtotal: total,
        impuestos: '0.00',
        descuentos: '0.00',
        propina: '0.00',
        total,
        cancelado: extra.cancelado ?? false,
      },
    });
    for (const [orden, [producto, cantidad, importe]] of (extra.partidas ?? []).entries()) {
      await prisma.chequePartida.create({
        data: {
          chequeId: c.id,
          empresaId,
          orden,
          producto,
          cantidad,
          precioUnit: importe,
          total: importe,
        },
      });
    }
  }

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    for (const [id, key] of [
      [FX.sucursalA1, KEYS.a1],
      [FX.sucursalA2, KEYS.a2],
      [FX.sucursalB1, KEYS.b1],
    ] as const) {
      await prisma.sucursal.update({ where: { id }, data: { apiKeyHash: hashApiKey(key) } });
    }
    // Todo lo que se loguee en el archivo se guarda: al final no puede traer datos personales.
    for (const nivel of ['log', 'error', 'warn', 'debug', 'verbose'] as const) {
      jest.spyOn(Logger.prototype, nivel).mockImplementation((...a: unknown[]) => {
        logs.push(a);
      });
    }
    for (const nivel of ['log', 'error', 'warn', 'info', 'debug'] as const) {
      jest.spyOn(console, nivel).mockImplementation((...a: unknown[]) => {
        logs.push(a);
      });
    }

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    // A1: tres clientes. A2: sin sincronizar (hasta su test). B1: un cliente con el MISMO id
    // del POS que Ana ("SR-17"), otra empresa.
    await sincronizar(KEYS.a1, 1, [ANA, BETO, CARLA]);
    await sincronizar(KEYS.b1, 2, [BRUNO]);
    idAna = (await prisma.clienteCatalogo.findFirstOrThrow({
      where: { sucursalId: FX.sucursalA1, origenSrId: 'SR-17' },
    })).id;
    idBruno = (await prisma.clienteCatalogo.findFirstOrThrow({
      where: { sucursalId: FX.sucursalB1 },
    })).id;

    // A1, el 10-sep (días locales CDMX).
    await cuenta(FX.sucursalA1, FX.empresaA, 'SR-17', '100.00', {
      partidas: [
        ['Taco', '2', '50.00'],
        ['Agua', '1', '50.00'],
      ],
    });
    // 23:30 local del 10-sep = 05:30Z del 11: DENTRO.
    await cuenta(FX.sucursalA1, FX.empresaA, 'SR-17', '50.01', {
      cerradoAt: Date.parse('2026-09-11T05:30:00Z'),
      partidas: [['Taco', '3', '50.01']],
    });
    await cuenta(FX.sucursalA1, FX.empresaA, 'SR-17', '33.33');
    await cuenta(FX.sucursalA1, FX.empresaA, 'SR-17', '80.00', { cancelado: true });
    // 00:30 local del 11-sep: FUERA.
    await cuenta(FX.sucursalA1, FX.empresaA, 'SR-17', '999.00', {
      cerradoAt: Date.parse('2026-09-11T06:30:00Z'),
    });
    await cuenta(FX.sucursalA1, FX.empresaA, 'SR-18', '20.00');
    // El id "SR-20" es la CLAVE de Carla, no su id: no es suya.
    await cuenta(FX.sucursalA1, FX.empresaA, 'SR-20', '45.00');
    await cuenta(FX.sucursalA1, FX.empresaA, null, '70.00');
    // A2 (sin catálogo) y B1 (otra empresa), mismo id del POS que Ana.
    await cuenta(FX.sucursalA2, FX.empresaA, 'SR-17', '40.00');
    await cuenta(FX.sucursalA2, FX.empresaA, null, '10.00');
    await cuenta(FX.sucursalB1, FX.empresaB, 'SR-17', '500.00');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  const deA = { empresaId: FX.empresaA, ...RANGO };

  describe('Listo cuando', () => {
    it('AC vacío: una sucursal sin catálogo sale "sin-sincronizar" y sin filas inventadas', async () => {
      const r = await resumen(USUARIOS.visorA, { ...deA, sucursalId: FX.sucursalA2 });
      expect(r.sucursales).toEqual([
        {
          sucursalId: FX.sucursalA2,
          sucursal: 'A2',
          catalogo: 'sin-sincronizar',
          clientesActivos: 0,
          cuentas: 2,
          cuentasConCliente: 1,
        },
      ]);
      // La cuenta con cliente sí sale, pero sin afirmar que falta su ficha.
      expect(r.filas).toEqual([
        expect.objectContaining({ id: null, cruce: 'sin-sincronizar', origenSrId: 'SR-17' }),
      ]);
    });

    it('AC vacío: catálogo que llegó vacío y ninguna cuenta con cliente → usaClientes=false, 0 filas', async () => {
      await sincronizar(KEYS.a2, 3, []);
      // Otro día en A2: sólo la cuenta sin cliente... el 10-sep A2 tiene una con cliente, así que
      // se mide con una cuenta sin cliente en un día aparte.
      await cuenta(FX.sucursalA2, FX.empresaA, null, '15.00', {
        cerradoAt: Date.parse('2026-09-05T18:00:00Z'),
      });
      const r = await resumen(USUARIOS.visorA, {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA2,
        desde: '2026-09-05',
        hasta: '2026-09-05',
      });
      expect(r).toMatchObject({
        usaClientes: false,
        cuentas: 1,
        cuentasConCliente: 0,
        ventaConCliente: '0.00',
        filas: [],
        total: 0,
      });
      expect(r.sucursales[0]).toMatchObject({ catalogo: 'vacio', clientesActivos: 0 });
      // Y el 10-sep, con el catálogo ya cerrado, la cuenta con id pasa a "sin ficha".
      const d10 = await resumen(USUARIOS.visorA, { ...deA, sucursalId: FX.sucursalA2 });
      expect(d10.usaClientes).toBe(true);
      expect(d10.filas[0]).toMatchObject({ cruce: 'sin-ficha', origenSrId: 'SR-17' });
    });

    it('AC cuadre: la ficha cuadra visitas y ticket promedio contra Tickets filtrado por ese cliente', async () => {
      const f = await get(`/catalogos/clientes/${idAna}/ficha`, USUARIOS.visorA, deA);
      expect(f.status).toBe(200);
      const ficha = f.body as Ficha;
      // 100.00 + 50.01 + 33.33 = 183.34 en 3 visitas; 183.34 / 3 = 61.1133… → 61.11. La
      // cancelada (80) va aparte; la de 999 cae el 11 local.
      expect(ficha.periodo).toEqual({
        visitas: 3,
        venta: '183.34',
        ticketPromedio: '61.11',
        ultimaVisita: '2026-09-11T05:30:00.000Z',
        canceladas: { cuentas: 1, monto: '80.00' },
      });

      const t = await get('/ventas/tickets', USUARIOS.visorA, {
        ...deA,
        clienteId: idAna,
        canceladas: 'excluir',
      });
      expect(t.status).toBe(200);
      expect(t.body.total).toBe(ficha.periodo.visitas);
      const suma = (t.body.items as Array<{ total: string }>).reduce(
        (s, x) => s.plus(x.total),
        new Prisma.Decimal(0),
      );
      expect(suma.toFixed(2)).toBe(ficha.periodo.venta);
      expect(suma.div(t.body.total).toFixed(2, Prisma.Decimal.ROUND_HALF_UP)).toBe(
        ficha.periodo.ticketPromedio,
      );
      // Sin excluir, Tickets también trae su cancelada: 3 + 1.
      const todas = await get('/ventas/tickets', USUARIOS.visorA, { ...deA, clienteId: idAna });
      expect(todas.body.total).toBe(4);
    });

    it('la ficha trae los datos del POS y lo que más pide (por cantidad)', async () => {
      const ficha = (await get(`/catalogos/clientes/${idAna}/ficha`, USUARIOS.visorA, deA))
        .body as Ficha;
      expect(ficha.cliente).toMatchObject({
        id: idAna,
        sucursalId: FX.sucursalA1,
        origenSrId: 'SR-17',
        clave: 'C001',
        nombre: 'Ana Cliente',
        telefono: '555-010-9901',
        correo: 'ana.cliente@ejemplo.test',
        rfc: 'XAXX010101000',
        activo: true,
      });
      expect(ficha.productos).toEqual([
        { producto: 'Taco', cantidad: '5.000', importe: '100.01', cuentas: 2 },
        { producto: 'Agua', cantidad: '1.000', importe: '50.00', cuentas: 1 },
      ]);
    });

    it('la lista: liga por el id del POS, "sin ficha" para el que no está, y sin contacto', async () => {
      const r = await resumen(USUARIOS.visorA, deA);
      expect(r).toMatchObject({
        usaClientes: true,
        catalogoTruncado: false,
        // A1: 100, 50.01, 33.33, 20, 45, 70; A2: 40, 10.
        cuentas: 8,
        cuentasConCliente: 6,
        ventaConCliente: '288.34',
      });
      const resumida = r.filas.map((f) => [f.sucursalId, f.nombre ?? f.origenSrId, f.cruce, f.visitas]);
      expect(resumida).toEqual([
        [FX.sucursalA1, 'Ana Cliente', 'ficha', 3],
        [FX.sucursalA1, 'SR-20', 'sin-ficha', 1],
        [FX.sucursalA2, 'SR-17', 'sin-ficha', 1],
        [FX.sucursalA1, 'Beto Cliente', 'ficha', 1],
        [FX.sucursalA1, 'Carla Trampa', 'ficha', 0],
      ]);
      // Nada de B, y ni teléfono, ni correo, ni RFC sin pedirlos.
      expect(JSON.stringify(r)).not.toMatch(/555-010|ejemplo\.test|XAXX|Bruno/);
      const conContacto = await resumen(USUARIOS.visorA, { ...deA, contacto: 'true' });
      expect(conContacto.filas[0]).toMatchObject({
        telefono: '555-010-9901',
        correo: 'ana.cliente@ejemplo.test',
        rfc: 'XAXX010101000',
      });
    });

    it('q filtra en el servidor sin distinguir mayúsculas', async () => {
      const r = await resumen(USUARIOS.visorA, { ...deA, q: 'beto' });
      expect(r.filas.map((f) => f.nombre)).toEqual(['Beto Cliente']);
      expect(r.total).toBe(1);
    });
  });

  describe('filtro de Tickets por cliente', () => {
    it('clienteId de A1 con sucursalId=A2: vacío (el cliente es de UNA sucursal)', async () => {
      const t = await get('/ventas/tickets', USUARIOS.visorA, {
        ...deA,
        sucursalId: FX.sucursalA2,
        clienteId: idAna,
      });
      expect(t.status).toBe(200);
      expect(t.body.total).toBe(0);
    });

    it('no trae las cuentas del MISMO id del POS en otra sucursal ni en otra empresa', async () => {
      const t = await get('/ventas/tickets', USUARIOS.adminGlobal, {
        ...deA,
        clienteId: idAna,
        canceladas: 'excluir',
      });
      expect((t.body.items as Array<{ sucursalId: string }>).map((x) => x.sucursalId)).toEqual([
        FX.sucursalA1,
        FX.sucursalA1,
        FX.sucursalA1,
      ]);
    });
  });

  describe('ingesta del cliente de la cuenta (POST /ingesta/eventos)', () => {
    const evento = (id: string, folioSr: string, cambios: Record<string, unknown> = {}) => ({
      id,
      tipo: 'cheque',
      datos: {
        folioSr,
        folio: folioSr,
        abiertoAt: '2026-08-01T12:00:00.000-06:00',
        cerradoAt: '2026-08-01T13:00:00.000-06:00',
        subtotal: '10.00',
        impuestos: '0',
        descuentos: '0',
        propina: '0',
        total: '10.00',
        cancelado: false,
        partidas: [],
        pagos: [],
        ...cambios,
      },
    });
    const lote = async (eventos: object[]) => {
      const r = await request(url).post('/ingesta/eventos').set('X-Api-Key', KEYS.a1).send({ eventos });
      expect(r.status).toBe(200);
      return r.body as { procesados: string[]; rechazados: Array<{ indice: number; motivo: string }> };
    };
    const leer = (folioSr: string) =>
      prisma.cheque.findFirstOrThrow({ where: { sucursalId: FX.sucursalA1, folioSr } });

    it('se guarda tal cual, y el mismo lote 3 veces deja la misma fila (updated_at incluido)', async () => {
      const eventos = [evento('e1', 'ING-1', { clienteOrigenSrId: 'SR-17' })];
      expect((await lote(eventos)).rechazados).toEqual([]);
      const primera = await leer('ING-1');
      expect(primera.clienteOrigenSrId).toBe('SR-17');
      for (let i = 0; i < 2; i++) await lote(eventos);
      expect(await leer('ING-1')).toEqual(primera);
    });

    it('cambiarlo lo reescribe; omitirlo o mandar sólo espacios lo deja nulo (sin 500)', async () => {
      await lote([evento('e2', 'ING-2', { clienteOrigenSrId: 'SR-17' })]);
      await lote([evento('e2', 'ING-2', { clienteOrigenSrId: 'SR-18' })]);
      expect((await leer('ING-2')).clienteOrigenSrId).toBe('SR-18');
      await lote([evento('e2', 'ING-2')]);
      expect((await leer('ING-2')).clienteOrigenSrId).toBeNull();
      const r = await lote([evento('e3', 'ING-3', { clienteOrigenSrId: '   ' })]);
      expect(r.rechazados).toEqual([]);
      expect((await leer('ING-3')).clienteOrigenSrId).toBeNull();
    });

    it('uno de más de 64 se rechaza SOLO (sin repetir el valor) y los demás del lote entran', async () => {
      const largo = `CLIENTE-${'x'.repeat(60)}`;
      const r = await lote([
        evento('ok', 'ING-4', { clienteOrigenSrId: 'SR-18' }),
        evento('largo', 'ING-5', { clienteOrigenSrId: largo }),
      ]);
      expect(r.procesados).toEqual(['ok']);
      expect(r.rechazados.map((x) => x.indice)).toEqual([1]);
      expect(r.rechazados[0].motivo).toContain('clienteOrigenSrId');
      expect(r.rechazados[0].motivo).not.toContain(largo);
      expect((await leer('ING-4')).clienteOrigenSrId).toBe('SR-18');
      expect(await prisma.cheque.count({ where: { folioSr: 'ING-5' } })).toBe(0);
    });
  });

  describe('scope por rol (404, nunca 403)', () => {
    /** Status y cuerpo: un recurso ajeno no se distingue de uno que no existe. */
    const igual = (a: request.Response, b: request.Response) => {
      expect(a.status).toBe(404);
      expect({ status: a.status, body: a.body }).toEqual({ status: b.status, body: b.body });
    };

    it('resumen: visor y admin de A ven A; admin global ve A y B', async () => {
      for (const u of [USUARIOS.visorA, USUARIOS.adminEmpresaA, USUARIOS.adminGlobal]) {
        const r = await resumen(u, deA);
        expect(r.filas.some((f) => f.nombre === 'Ana Cliente')).toBe(true);
        expect(r.filas.every((f) => f.sucursalId !== FX.sucursalB1)).toBe(true);
      }
      const b = await resumen(USUARIOS.adminGlobal, { ...RANGO, empresaId: FX.empresaB });
      expect(b.filas.map((f) => f.nombre)).toEqual(['Bruno Otro']);
    });

    it('resumen: empresa ajena = el mismo 404 que una empresa que no existe', async () => {
      const inexistente = { ...RANGO, empresaId: NO_EXISTE };
      igual(
        await get('/catalogos/clientes/resumen', USUARIOS.visorB, deA),
        await get('/catalogos/clientes/resumen', USUARIOS.visorB, inexistente),
      );
      igual(
        await get('/catalogos/clientes/resumen', USUARIOS.adminEmpresaA, {
          ...RANGO,
          empresaId: FX.empresaB,
        }),
        await get('/catalogos/clientes/resumen', USUARIOS.adminEmpresaA, inexistente),
      );
    });

    it('ficha: A la ve visor y admin de A y el global; el global ve la de B', async () => {
      for (const u of [USUARIOS.visorA, USUARIOS.adminEmpresaA, USUARIOS.adminGlobal]) {
        const f = await get(`/catalogos/clientes/${idAna}/ficha`, u, deA);
        expect(f.status).toBe(200);
      }
      const b = await get(`/catalogos/clientes/${idBruno}/ficha`, USUARIOS.adminGlobal, {
        ...RANGO,
        empresaId: FX.empresaB,
      });
      expect(b.status).toBe(200);
      expect(b.body.periodo).toMatchObject({ visitas: 1, venta: '500.00' });
    });

    it('ficha: cliente ajeno = el mismo 404 que uno que no existe (con empresa propia o ajena)', async () => {
      const deB = { ...RANGO, empresaId: FX.empresaB };
      // visorB pide a Ana (de A) con SU empresa y con la de A.
      igual(
        await get(`/catalogos/clientes/${idAna}/ficha`, USUARIOS.visorB, deB),
        await get(`/catalogos/clientes/${NO_EXISTE}/ficha`, USUARIOS.visorB, deB),
      );
      igual(
        await get(`/catalogos/clientes/${idAna}/ficha`, USUARIOS.visorB, deA),
        await get(`/catalogos/clientes/${NO_EXISTE}/ficha`, USUARIOS.visorB, deA),
      );
      // adminEmpresaA pide a Bruno (de B) con la empresa A: tampoco se filtra por el id.
      igual(
        await get(`/catalogos/clientes/${idBruno}/ficha`, USUARIOS.adminEmpresaA, deA),
        await get(`/catalogos/clientes/${NO_EXISTE}/ficha`, USUARIOS.adminEmpresaA, deA),
      );
      // Ni el global puede pedir a Bruno "como de A".
      igual(
        await get(`/catalogos/clientes/${idBruno}/ficha`, USUARIOS.adminGlobal, deA),
        await get(`/catalogos/clientes/${NO_EXISTE}/ficha`, USUARIOS.adminGlobal, deA),
      );
    });

    it('tickets: clienteId ajeno = el mismo 404 que uno que no existe', async () => {
      const deB = { ...RANGO, empresaId: FX.empresaB };
      igual(
        await get('/ventas/tickets', USUARIOS.visorB, { ...deB, clienteId: idAna }),
        await get('/ventas/tickets', USUARIOS.visorB, { ...deB, clienteId: NO_EXISTE }),
      );
      igual(
        await get('/ventas/tickets', USUARIOS.adminEmpresaA, { ...deA, clienteId: idBruno }),
        await get('/ventas/tickets', USUARIOS.adminEmpresaA, { ...deA, clienteId: NO_EXISTE }),
      );
      igual(
        await get('/ventas/tickets', USUARIOS.visorB, { ...deA, clienteId: idAna }),
        await get('/ventas/tickets', USUARIOS.visorB, { ...deA, clienteId: NO_EXISTE }),
      );
      const global = await get('/ventas/tickets', USUARIOS.adminGlobal, { ...deB, clienteId: idBruno });
      expect(global.status).toBe(200);
      expect(global.body.total).toBe(1);
    });

    it('ids que no son UUID y fechas inválidas = 400 (nunca 500); sin token = 401', async () => {
      expect((await get('/catalogos/clientes/abc/ficha', USUARIOS.visorA, deA)).status).toBe(400);
      expect(
        (await get('/ventas/tickets', USUARIOS.visorA, { ...deA, clienteId: 'SR-17' })).status,
      ).toBe(400);
      expect(
        (await get('/catalogos/clientes/resumen', USUARIOS.visorA, { ...deA, desde: '2026-02-30' }))
          .status,
      ).toBe(400);
      expect(
        (await get(`/catalogos/clientes/${idAna}/ficha`, USUARIOS.visorA, { ...deA, hasta: 'x' }))
          .status,
      ).toBe(400);
      expect(
        (await get('/catalogos/clientes/resumen', USUARIOS.visorA, { ...deA, porPagina: '501' }))
          .status,
      ).toBe(400);
      expect((await request(url).get('/catalogos/clientes/resumen').query(deA)).status).toBe(401);
      expect((await request(url).get(`/catalogos/clientes/${idAna}/ficha`).query(deA)).status).toBe(
        401,
      );
    });
  });

  it('AC datos personales: nada de lo logueado en todo el archivo trae un dato personal', () => {
    // Lo corre al final (jest respeta el orden del archivo): cubre la ingesta de catálogos y de
    // cuentas, la lista con y sin contacto, la ficha, Tickets y los 400/404 de arriba.
    const texto = JSON.stringify(logs, (_k, v: unknown) =>
      v instanceof Error ? `${v.name}: ${v.message} ${v.stack ?? ''}` : v,
    );
    for (const dato of PII) {
      expect(texto).not.toContain(dato);
    }
  });
});
