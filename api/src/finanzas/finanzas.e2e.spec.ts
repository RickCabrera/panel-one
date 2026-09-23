import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { hashApiKey } from '../agentes/api-key';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';

// E2E de compras, gastos y utilidad (F2-126) sobre la app REAL contra Postgres REAL, con las
// fixtures sintéticas de F1-011. Lo de SR entra por las ingestas del agente (catálogos, cheques,
// recetas, pólizas, compras) y los gastos por el panel. Los valores esperados están ESCRITOS A MANO
// (bloque de abajo), no se recalculan con la fórmula del API. La prueba de conservación contra el
// seed es `prisma/seed-utilidad.spec.ts`.
//
// Los `it` van en orden y comparten estado: córrelo completo y con `--runInBand`.

const KEYS = {
  a1: 'msr_sintetica-finanzas-F2-126-sucursal-a1-00000000000001',
  a2: 'msr_sintetica-finanzas-F2-126-sucursal-a2-00000000000002',
  b1: 'msr_sintetica-finanzas-F2-126-sucursal-b1-00000000000003',
} as const;

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];
type Registro = Record<string, unknown>;

const sinc = (n: number) => `f2126000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = '2026-09-04T00:00:00.000Z';

/*
 * Rango: el día local 2026-09-02. A1 y B1 en America/Mexico_City (UTC−6).
 *
 * A1. Recetas: P1 Taco = I1 0.1 + I2 2. P2 Refresco sin receta (sin cabecera).
 * Cheques:
 * - C1 09-02 13:00: 10 Taco ($290.00 en partidas) · subtotal 250.00 · total 290.00
 * - C2 09-02 23:30 local (09-03 05:30Z, SIGUE siendo 09-02): 2 Refresco ($46.40) · subtotal
 *   40.00 · total 46.40
 * - C3 CANCELADO 09-02: 100 tacos, subtotal 9999 → no cuenta
 * - C4 09-03 00:30 local: 5 tacos, subtotal 125 → otro día, no cuenta
 * Venta 336.40 · venta neta 290.00 · 2 cuentas.
 * Teórico: I1 = 10 × 0.1 = 1.000 · I2 = 10 × 2 = 20.000.
 * Póliza K consumo 09-02 22:00 local: I1 −1 @ 80 → costo I1 80.00 · importe teórico 80.00.
 * I2: sin salidas ni existencias → SIN COSTO. Refresco vendido sin receta → producto sin costo,
 * con $46.40 de partidas (con IVA, antes de descuento).
 * Costo 80.00, INCOMPLETO (1 insumo sin costo, 1 producto sin costo).
 * Gastos A1 (panel): Renta 09-02 100.00 · Luz 09-02 20.00 · Luz 09-02 30.00 ANULADO · Luz 09-01
 * 50.00 (otro día) → gastos 120.00.
 * Utilidad bruta 290 − 80 = 210.00 (72.4 %) · operación 210 − 120 = 90.00 (31.0 %), SOBRESTIMADA.
 * Compras A1: OC-1 09-02 10:00 local, PR1 "Carnes del Norte": 10 × 20 + 5.5 × 3.33 (18.32) = 218.32
 * · OC-2 09-02 23:30 local, PR9 (sin catálogo): 1 × 10 = 10.00 · OC-3 CANCELADA 09-02: 50.00 ·
 * OC-4 09-03 01:00 local: 7.00 → compras 228.32 (no entran a la utilidad).
 *
 * A2 (empresa A): catálogo y una venta (subtotal 150.00, total 174.00), SIN recetas → costo nulo
 * con motivo `sin_recetas`; gasto 09-02 10.00. Total de la empresa A: costo y utilidades nulos
 * (`sucursalesSinCalculo` = ['A2']); venta neta 440.00, gastos 130.00.
 *
 * B1 (empresa B): P1 Taco = I1 1; 1 taco subtotal 20.00 total 23.20; póliza consumo I1 −1 @ 5 →
 * costo 5.00 COMPLETO · bruta 15.00 (75.0 %) · operación 15.00.
 */

const partida = (producto: string, cantidad: string, total: string) => ({
  producto,
  cantidad,
  precioUnit: '1',
  total,
});
const cheque = (
  folio: string,
  cerradoAt: string,
  partidas: Registro[],
  montos: { subtotal: string; total: string },
  cancelado = false,
): Registro => ({
  id: folio,
  tipo: 'cheque',
  datos: {
    folioSr: folio,
    folio,
    abiertoAt: '2026-09-02T12:00:00.000-06:00',
    cerradoAt,
    subtotal: montos.subtotal,
    impuestos: '0',
    descuentos: '0',
    propina: '0',
    total: montos.total,
    cancelado,
    partidas,
    pagos: [],
  },
});
const compra = (
  origen: string,
  fecha: string,
  proveedor: string | null,
  partidas: Array<[string, string, string]>,
  cancelada = false,
) => ({
  origenSrId: origen,
  folio: `OC-${origen}`,
  proveedorOrigenSrId: proveedor,
  almacenOrigenSrId: 'ALM1',
  fecha,
  cancelada,
  partidas: partidas.map(([insumoOrigenSrId, cantidad, costoUnitario]) => ({
    insumoOrigenSrId,
    cantidad,
    costoUnitario,
  })),
});

describe('Compras, gastos y utilidad (e2e, F2-126)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  const conToken = async (u: Usuario, r: request.Test) =>
    r.set('Authorization', `Bearer ${await token(u)}`);
  const get = async (u: Usuario, ruta: string, query: Record<string, string>) =>
    conToken(u, request(url).get(ruta).query(query));
  const enviar = async (
    u: Usuario,
    metodo: 'post' | 'patch',
    ruta: string,
    body: Registro,
    query: Record<string, string> = {},
  ) => conToken(u, request(url)[metodo](ruta).query(query).send(body));
  const estado = (u: Usuario, query: Record<string, string> = {}) =>
    get(u, '/finanzas/estado-resultados', {
      empresaId: FX.empresaA,
      desde: '2026-09-02',
      hasta: '2026-09-02',
      ...query,
    });

  const post = async (key: string, ruta: string, body: Registro) => {
    const r = await request(url).post(ruta).set('X-Api-Key', key).send(body);
    expect(r.status).toBe(200);
    return r.body as Registro;
  };
  let n = 0;
  const catalogo = async (key: string, cat: string, registros: Registro[]) => {
    n++;
    const base = { catalogo: cat, sincronizacionId: sinc(n), capturadoAt: T };
    expect(
      ((await post(key, '/ingesta/catalogos', { ...base, registros })) as { rechazados: [] })
        .rechazados,
    ).toEqual([]);
    await post(key, '/ingesta/catalogos/cierre', {
      ...base,
      total: registros.length,
      rechazados: 0,
    });
  };
  const cheques = async (key: string, eventos: Registro[]) => {
    const r = (await post(key, '/ingesta/eventos', { eventos })) as { rechazados?: unknown[] };
    expect(r.rechazados ?? []).toEqual([]);
  };

  const ids: Record<string, string> = {};
  const nuevoGasto = async (u: Usuario, body: Registro) =>
    enviar(u, 'post', '/finanzas/gastos', { empresaId: FX.empresaA, ...body });

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
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);

    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();

    // A1.
    await catalogo(KEYS.a1, 'productos', [
      { origenSrId: 'P1', clave: 'P1', nombre: 'Taco', precio: '29' },
      { origenSrId: 'P2', clave: 'P2', nombre: 'Refresco', precio: '23.20' },
    ]);
    await catalogo(KEYS.a1, 'unidades', [{ origenSrId: 'KG', nombre: 'Kilogramo' }]);
    await catalogo(KEYS.a1, 'insumos', [
      { origenSrId: 'I1', nombre: 'Carne', unidadOrigenSrId: 'KG' },
      { origenSrId: 'I2', nombre: 'Tortilla' },
    ]);
    await catalogo(KEYS.a1, 'almacenes', [{ origenSrId: 'ALM1', nombre: 'Almacén general' }]);
    await catalogo(KEYS.a1, 'proveedores', [{ origenSrId: 'PR1', nombre: 'Carnes del Norte' }]);
    const rec = await post(KEYS.a1, '/ingesta/recetas', {
      leidoAt: T,
      recetas: [
        {
          productoOrigenSrId: 'P1',
          renglones: [
            { insumoOrigenSrId: 'I1', cantidad: '0.1' },
            { insumoOrigenSrId: 'I2', cantidad: '2' },
          ],
        },
      ],
    });
    expect(rec.rechazadas).toEqual([]);
    await cheques(KEYS.a1, [
      cheque('C1', '2026-09-02T13:00:00.000-06:00', [partida('Taco', '10', '290.00')], {
        subtotal: '250.00',
        total: '290.00',
      }),
      cheque('C2', '2026-09-02T23:30:00.000-06:00', [partida('Refresco', '2', '46.40')], {
        subtotal: '40.00',
        total: '46.40',
      }),
      cheque(
        'C3',
        '2026-09-02T14:00:00.000-06:00',
        [partida('Taco', '100', '2900.00')],
        { subtotal: '9999.00', total: '9999.00' },
        true,
      ),
      cheque('C4', '2026-09-03T00:30:00.000-06:00', [partida('Taco', '5', '145.00')], {
        subtotal: '125.00',
        total: '145.00',
      }),
    ]);
    const pol = await post(KEYS.a1, '/ingesta/movimientos', {
      leidoAt: T,
      polizas: [
        {
          origenSrId: 'K',
          folio: 'POL-K',
          tipo: 'consumo',
          almacenOrigenSrId: 'ALM1',
          fecha: '2026-09-03T04:00:00.000Z',
          referencia: null,
          cancelada: false,
          partidas: [{ insumoOrigenSrId: 'I1', cantidad: '-1', costoUnitario: '80' }],
        },
      ],
    });
    expect(pol.rechazadas).toEqual([]);
    const comp = await post(KEYS.a1, '/ingesta/compras', {
      leidoAt: T,
      compras: [
        compra('1', '2026-09-02T10:00:00.000-06:00', 'PR1', [
          ['I1', '10', '20'],
          ['I2', '5.5', '3.33'],
        ]),
        compra('2', '2026-09-02T23:30:00.000-06:00', 'PR9', [['I1', '1', '10']]),
        compra('3', '2026-09-02T12:00:00.000-06:00', 'PR1', [['I1', '1', '50']], true),
        compra('4', '2026-09-03T01:00:00.000-06:00', 'PR1', [['I1', '1', '7']]),
      ],
    });
    expect(comp.rechazadas).toEqual([]);

    // A2: catálogo y una venta, sin recetas.
    await catalogo(KEYS.a2, 'productos', [{ origenSrId: 'P1', nombre: 'Taco' }]);
    await cheques(KEYS.a2, [
      cheque('A2-1', '2026-09-02T13:00:00.000-06:00', [partida('Taco', '7', '174.00')], {
        subtotal: '150.00',
        total: '174.00',
      }),
    ]);

    // B1 (otra empresa): todo completo.
    await catalogo(KEYS.b1, 'productos', [{ origenSrId: 'P1', nombre: 'Taco' }]);
    await post(KEYS.b1, '/ingesta/recetas', {
      leidoAt: T,
      recetas: [
        { productoOrigenSrId: 'P1', renglones: [{ insumoOrigenSrId: 'I1', cantidad: '1' }] },
      ],
    });
    await cheques(KEYS.b1, [
      cheque('B-1', '2026-09-02T13:00:00.000-06:00', [partida('Taco', '1', '23.20')], {
        subtotal: '20.00',
        total: '23.20',
      }),
    ]);
    await post(KEYS.b1, '/ingesta/movimientos', {
      leidoAt: T,
      polizas: [
        {
          origenSrId: 'KB',
          folio: 'POL-KB',
          tipo: 'consumo',
          almacenOrigenSrId: 'ALM1',
          fecha: '2026-09-02T20:00:00.000Z',
          referencia: null,
          cancelada: false,
          partidas: [{ insumoOrigenSrId: 'I1', cantidad: '-1', costoUnitario: '5' }],
        },
      ],
    });
    await post(KEYS.b1, '/ingesta/compras', {
      leidoAt: T,
      compras: [compra('B1', '2026-09-02T10:00:00.000-06:00', null, [['I1', '1', '5']])],
    });
  }, 60_000);

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  describe('categorías y gastos (dato del panel)', () => {
    it('el admin crea categorías; el nombre es único sin distinguir mayúsculas ni espacios', async () => {
      for (const nombre of ['Renta', 'Luz', 'Publicidad']) {
        const r = await enviar(USUARIOS.adminEmpresaA, 'post', '/finanzas/categorias-gasto', {
          empresaId: FX.empresaA,
          nombre,
        });
        expect(r.status).toBe(201);
        ids[nombre] = r.body.id as string;
      }
      const dup = await enviar(USUARIOS.adminEmpresaA, 'post', '/finanzas/categorias-gasto', {
        empresaId: FX.empresaA,
        nombre: '  renta ',
      });
      expect(dup.status).toBe(409);
      const b = await enviar(USUARIOS.adminGlobal, 'post', '/finanzas/categorias-gasto', {
        empresaId: FX.empresaB,
        nombre: 'Renta',
      });
      expect(b.status).toBe(201);
      ids.rentaB = b.body.id as string;
      const lista = await get(USUARIOS.visorA, '/finanzas/categorias-gasto', {
        empresaId: FX.empresaA,
      });
      expect(lista.body.categorias.map((c: Registro) => c.nombre)).toEqual([
        'Luz',
        'Publicidad',
        'Renta',
      ]);
    });

    it('registra gastos; el día contable no puede ser futuro ni inexistente; monto > 0', async () => {
      const casos: Array<[string, string, string, string, string]> = [
        ['renta', FX.sucursalA1, 'Renta', '2026-09-02', '100.00'],
        ['luz', FX.sucursalA1, 'Luz', '2026-09-02', '20'],
        ['luzAnulada', FX.sucursalA1, 'Luz', '2026-09-02', '30.00'],
        ['luzOtroDia', FX.sucursalA1, 'Luz', '2026-09-01', '50.00'],
        ['a2', FX.sucursalA2, 'Renta', '2026-09-02', '10.00'],
        ['sinVentas', FX.sucursalA1, 'Publicidad', '2026-09-05', '70.00'],
      ];
      for (const [clave, sucursalId, cat, dia, monto] of casos) {
        const r = await nuevoGasto(USUARIOS.adminEmpresaA, {
          sucursalId,
          categoriaId: ids[cat],
          dia,
          concepto: `Gasto ${clave}`,
          monto,
        });
        expect(r.status).toBe(201);
        ids[clave] = r.body.id as string;
      }
      const g = await prisma.gasto.findUniqueOrThrow({ where: { id: ids.luz } });
      expect([g.monto.toFixed(2), g.dia.toISOString(), g.creadoPor, g.empresaId]).toEqual([
        '20.00',
        '2026-09-02T00:00:00.000Z',
        USUARIOS.adminEmpresaA.id,
        FX.empresaA,
      ]);
      const valido = { sucursalId: FX.sucursalA1, categoriaId: ids.Renta, concepto: 'x' };
      for (const malo of [
        { ...valido, dia: '2099-01-01', monto: '1' },
        { ...valido, dia: '2026-02-30', monto: '1' },
        { ...valido, dia: '2026-09-02', monto: '0' },
        { ...valido, dia: '2026-09-02', monto: '0.00' },
        { ...valido, dia: '2026-09-02', monto: '-5' },
        { ...valido, dia: '2026-09-02', monto: '1.005' },
        { ...valido, dia: '2026-09-02', monto: '1', concepto: '   ' },
        { ...valido, dia: '2026-09-02', monto: '1', folio: 'X-1' },
      ]) {
        expect((await nuevoGasto(USUARIOS.adminEmpresaA, malo)).status).toBe(400);
      }
    });

    it('anular es baja lógica; anulado no se edita ni se anula otra vez (409)', async () => {
      const anular = (id: string) =>
        enviar(
          USUARIOS.adminEmpresaA,
          'post',
          `/finanzas/gastos/${id}/anular`,
          {},
          {
            empresaId: FX.empresaA,
          },
        );
      expect((await anular(ids.luzAnulada)).status).toBe(204);
      expect((await anular(ids.luzAnulada)).status).toBe(409);
      const editar = await enviar(
        USUARIOS.adminEmpresaA,
        'patch',
        `/finanzas/gastos/${ids.luzAnulada}`,
        {
          empresaId: FX.empresaA,
          monto: '1',
        },
      );
      expect(editar.status).toBe(409);
      const g = await prisma.gasto.findUniqueOrThrow({ where: { id: ids.luzAnulada } });
      expect([g.anuladoAt !== null, g.anuladoPor, g.monto.toFixed(2)]).toEqual([
        true,
        USUARIOS.adminEmpresaA.id,
        '30.00',
      ]);
    });

    it('editar cambia el gasto; una categoría inactiva no admite gastos nuevos (400)', async () => {
      const r = await enviar(
        USUARIOS.adminEmpresaA,
        'patch',
        `/finanzas/gastos/${ids.luzOtroDia}`,
        {
          empresaId: FX.empresaA,
          concepto: 'Luz de agosto',
        },
      );
      expect(r.status).toBe(204);
      expect(
        (await prisma.gasto.findUniqueOrThrow({ where: { id: ids.luzOtroDia } })).concepto,
      ).toBe('Luz de agosto');
      const futuro = await enviar(
        USUARIOS.adminEmpresaA,
        'patch',
        `/finanzas/gastos/${ids.luzOtroDia}`,
        {
          empresaId: FX.empresaA,
          dia: '2099-01-01',
        },
      );
      expect(futuro.status).toBe(400);
      const nueva = await enviar(USUARIOS.adminEmpresaA, 'post', '/finanzas/categorias-gasto', {
        empresaId: FX.empresaA,
        nombre: 'Temporal',
      });
      const off = await enviar(
        USUARIOS.adminEmpresaA,
        'patch',
        `/finanzas/categorias-gasto/${nueva.body.id as string}`,
        { empresaId: FX.empresaA, activa: false },
      );
      expect(off.status).toBe(204);
      const r2 = await nuevoGasto(USUARIOS.adminEmpresaA, {
        sucursalId: FX.sucursalA1,
        categoriaId: nueva.body.id,
        dia: '2026-09-02',
        concepto: 'x',
        monto: '1',
      });
      expect(r2.status).toBe(400);
    });

    it('la lista del periodo: sin anulados (salvo que se pidan), total y desglose por categoría', async () => {
      const r = await get(USUARIOS.visorA, '/finanzas/gastos', {
        empresaId: FX.empresaA,
        desde: '2026-09-02',
        hasta: '2026-09-02',
      });
      expect(r.status).toBe(200);
      expect(r.body.total).toBe('130.00');
      expect(r.body.porCategoria).toEqual([
        { categoriaId: ids.Renta, categoria: 'Renta', monto: '110.00' },
        { categoriaId: ids.Luz, categoria: 'Luz', monto: '20.00' },
      ]);
      expect(r.body.gastos).toHaveLength(3);
      expect(r.body.truncado).toBe(false);
      const con = await get(USUARIOS.visorA, '/finanzas/gastos', {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        desde: '2026-09-02',
        hasta: '2026-09-02',
        incluirAnulados: 'true',
      });
      expect(con.body.gastos.map((g: Registro) => [g.monto, g.anulado]).sort()).toEqual([
        ['100.00', false],
        ['20.00', false],
        ['30.00', true],
      ]);
      expect(con.body.total).toBe('120.00');
    });

    it('visor = 403 por rol al escribir; otra empresa = 404 en todo; agente o sin token = 401', async () => {
      const valido = {
        sucursalId: FX.sucursalA1,
        categoriaId: ids.Renta,
        dia: '2026-09-02',
        concepto: 'x',
        monto: '1',
      };
      expect((await nuevoGasto(USUARIOS.visorA, valido)).status).toBe(403);
      // Admin de A contra la empresa B, contra una sucursal de B o una categoría de B.
      expect(
        (
          await enviar(USUARIOS.adminEmpresaA, 'post', '/finanzas/gastos', {
            ...valido,
            empresaId: FX.empresaB,
            sucursalId: FX.sucursalB1,
            categoriaId: ids.rentaB,
          })
        ).status,
      ).toBe(404);
      expect(
        (await nuevoGasto(USUARIOS.adminEmpresaA, { ...valido, sucursalId: FX.sucursalB1 })).status,
      ).toBe(404);
      expect(
        (await nuevoGasto(USUARIOS.adminEmpresaA, { ...valido, categoriaId: ids.rentaB })).status,
      ).toBe(404);
      // Un gasto de A editado o anulado "desde" la empresa B.
      const gB = await enviar(USUARIOS.adminGlobal, 'post', '/finanzas/gastos', {
        ...valido,
        empresaId: FX.empresaB,
        sucursalId: FX.sucursalB1,
        categoriaId: ids.rentaB,
      });
      expect(gB.status).toBe(201);
      expect(
        (
          await enviar(
            USUARIOS.adminEmpresaA,
            'patch',
            `/finanzas/gastos/${gB.body.id as string}`,
            {
              empresaId: FX.empresaA,
              monto: '2',
            },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await enviar(
            USUARIOS.adminEmpresaA,
            'post',
            `/finanzas/gastos/${gB.body.id as string}/anular`,
            {},
            {
              empresaId: FX.empresaA,
            },
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await enviar(
            USUARIOS.adminEmpresaA,
            'patch',
            `/finanzas/categorias-gasto/${ids.rentaB}`,
            {
              empresaId: FX.empresaA,
              activa: false,
            },
          )
        ).status,
      ).toBe(404);
      for (const [ruta, q] of [
        ['/finanzas/gastos', { empresaId: FX.empresaB, desde: '2026-09-02', hasta: '2026-09-02' }],
        ['/finanzas/categorias-gasto', { empresaId: FX.empresaB }],
        [
          '/finanzas/estado-resultados',
          { empresaId: FX.empresaB, desde: '2026-09-02', hasta: '2026-09-02' },
        ],
        ['/finanzas/compras', { empresaId: FX.empresaB, desde: '2026-09-02', hasta: '2026-09-02' }],
        [
          '/finanzas/estado-resultados',
          {
            empresaId: FX.empresaA,
            sucursalId: FX.sucursalB1,
            desde: '2026-09-02',
            hasta: '2026-09-02',
          },
        ],
      ] as const) {
        expect((await get(USUARIOS.visorA, ruta, { ...q })).status).toBe(404);
      }
      for (const ruta of [
        '/finanzas/gastos',
        '/finanzas/categorias-gasto',
        '/finanzas/estado-resultados',
        '/finanzas/compras',
      ]) {
        const q = { empresaId: FX.empresaA, desde: '2026-09-02', hasta: '2026-09-02' };
        expect((await request(url).get(ruta).query(q)).status).toBe(401);
        expect((await request(url).get(ruta).query(q).set('X-Api-Key', KEYS.a1)).status).toBe(401);
      }
      expect(
        (
          await request(url)
            .post('/finanzas/gastos')
            .set('X-Api-Key', KEYS.a1)
            .send({ ...valido, empresaId: FX.empresaA })
        ).status,
      ).toBe(401);
    });
  });

  describe('GET /finanzas/compras', () => {
    it('lista las del periodo (corte en la zona local), resume por proveedor y no suma canceladas', async () => {
      const r = await get(USUARIOS.visorA, '/finanzas/compras', {
        empresaId: FX.empresaA,
        desde: '2026-09-02',
        hasta: '2026-09-02',
      });
      expect(r.status).toBe(200);
      expect(r.body.total).toBe('228.32');
      expect(r.body.totalCompras).toBe(3);
      expect(r.body.truncado).toBe(false);
      expect(
        r.body.compras.map((c: Registro) => [
          c.folio,
          c.total,
          c.cancelada,
          c.proveedor,
          c.almacen,
        ]),
      ).toEqual([
        ['OC-2', '10.00', false, null, 'Almacén general'],
        ['OC-3', '50.00', true, 'Carnes del Norte', 'Almacén general'],
        ['OC-1', '218.32', false, 'Carnes del Norte', 'Almacén general'],
      ]);
      expect(r.body.porProveedor).toEqual([
        {
          sucursalId: FX.sucursalA1,
          proveedorOrigenSrId: 'PR1',
          proveedor: 'Carnes del Norte',
          compras: 1,
          total: '218.32',
        },
        {
          sucursalId: FX.sucursalA1,
          proveedorOrigenSrId: 'PR9',
          proveedor: null,
          compras: 1,
          total: '10.00',
        },
      ]);
      expect(r.body.sucursales).toEqual([
        { sucursalId: FX.sucursalA1, sucursal: 'A1', comprasRecibidas: 4 },
        { sucursalId: FX.sucursalA2, sucursal: 'A2', comprasRecibidas: 0 },
      ]);
    });

    it('filtra por proveedor (exige sucursal) y da el detalle con nombres; ajena = 404', async () => {
      const sinSuc = await get(USUARIOS.visorA, '/finanzas/compras', {
        empresaId: FX.empresaA,
        desde: '2026-09-02',
        hasta: '2026-09-02',
        proveedorOrigenSrId: 'PR1',
      });
      expect(sinSuc.status).toBe(400);
      const r = await get(USUARIOS.visorA, '/finanzas/compras', {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        desde: '2026-09-01',
        hasta: '2026-09-03',
        proveedorOrigenSrId: 'PR1',
      });
      expect(r.body.compras.map((c: Registro) => c.folio)).toEqual(['OC-4', 'OC-3', 'OC-1']);
      const id = r.body.compras[2].id as string;
      const d = await get(USUARIOS.visorA, `/finanzas/compras/${id}`, { empresaId: FX.empresaA });
      expect(d.status).toBe(200);
      expect(d.body).toMatchObject({ folio: 'OC-1', sucursal: 'A1', total: '218.32' });
      expect(d.body.detalle).toEqual([
        {
          renglon: 0,
          insumoOrigenSrId: 'I1',
          insumo: 'Carne',
          unidad: 'Kilogramo',
          cantidad: '10.000',
          costoUnitario: '20.00',
          importe: '200.00',
        },
        {
          renglon: 1,
          insumoOrigenSrId: 'I2',
          insumo: 'Tortilla',
          unidad: null,
          cantidad: '5.500',
          costoUnitario: '3.33',
          importe: '18.32',
        },
      ]);
      const deB = await prisma.compra.findFirstOrThrow({ where: { sucursalId: FX.sucursalB1 } });
      for (const [u, empresaId] of [
        [USUARIOS.visorA, FX.empresaA],
        [USUARIOS.visorA, FX.empresaB],
        [USUARIOS.visorB, FX.empresaA],
      ] as const) {
        expect((await get(u, `/finanzas/compras/${deB.id}`, { empresaId })).status).toBe(404);
      }
      expect(
        (await get(USUARIOS.visorA, '/finanzas/compras/no-uuid', { empresaId: FX.empresaA }))
          .status,
      ).toBe(400);
    });
  });

  describe('GET /finanzas/estado-resultados', () => {
    it('A1 cuadra con el cálculo a mano y sale SOBRESTIMADA por el insumo y el producto sin costo', async () => {
      const r = await estado(USUARIOS.visorA, { sucursalId: FX.sucursalA1 });
      expect(r.status).toBe(200);
      expect(r.body.sucursales).toEqual([
        {
          sucursalId: FX.sucursalA1,
          sucursal: 'A1',
          motivo: null,
          cuentas: 2,
          venta: '336.40',
          ventaNeta: '290.00',
          costo: {
            importe: '80.00',
            completo: false,
            insumosSinCosto: 1,
            productosSinCosto: 1,
            ventaSinCosto: '46.40',
          },
          gastos: '120.00',
          compras: '228.32',
          utilidadBruta: '210.00',
          utilidadOperacion: '90.00',
          margenBruto: '72.4',
          margenOperacion: '31.0',
          utilidadSobrestimada: true,
          sinVentas: false,
        },
      ]);
      expect(r.body.gastosPorCategoria).toEqual([
        { categoriaId: ids.Renta, categoria: 'Renta', monto: '100.00' },
        { categoriaId: ids.Luz, categoria: 'Luz', monto: '20.00' },
      ]);
    });

    it('la empresa: A2 sin recetas deja costo y utilidades NULOS con motivo, y el total también', async () => {
      const r = await estado(USUARIOS.adminGlobal);
      const a2 = r.body.sucursales.find((s: Registro) => s.sucursal === 'A2');
      expect(a2).toMatchObject({
        motivo: 'sin_recetas',
        ventaNeta: '150.00',
        venta: '174.00',
        gastos: '10.00',
        utilidadBruta: null,
        utilidadOperacion: null,
        margenBruto: null,
        utilidadSobrestimada: false,
      });
      expect(a2.costo.importe).toBeNull();
      expect(r.body.total).toMatchObject({
        sucursalesSinCalculo: ['A2'],
        cuentas: 3,
        ventaNeta: '440.00',
        venta: '510.40',
        gastos: '130.00',
        compras: '228.32',
        utilidadBruta: null,
        utilidadOperacion: null,
      });
      expect(r.body.total.costo.importe).toBeNull();
    });

    it('sin ventas en el periodo: costo 0 y utilidad de operación = −gastos, marcada sinVentas', async () => {
      const r = await estado(USUARIOS.visorA, {
        sucursalId: FX.sucursalA1,
        desde: '2026-09-05',
        hasta: '2026-09-05',
      });
      expect(r.body.sucursales[0]).toMatchObject({
        cuentas: 0,
        ventaNeta: '0.00',
        gastos: '70.00',
        utilidadBruta: '0.00',
        utilidadOperacion: '-70.00',
        margenOperacion: null,
        sinVentas: true,
        utilidadSobrestimada: false,
      });
    });

    it('B1 con costo completo: la utilidad sale limpia; el visor de B no ve A ni A ve B', async () => {
      const r = await estado(USUARIOS.visorB, { empresaId: FX.empresaB });
      expect(r.status).toBe(200);
      expect(r.body.total).toMatchObject({
        ventaNeta: '20.00',
        costo: { importe: '5.00', completo: true, insumosSinCosto: 0, productosSinCosto: 0 },
        utilidadBruta: '15.00',
        utilidadOperacion: '14.00',
        margenBruto: '75.0',
        utilidadSobrestimada: false,
        compras: '5.00',
      });
      expect((await estado(USUARIOS.visorB)).status).toBe(404);
    });

    it('rango inválido = 400', async () => {
      for (const q of [
        { desde: '2026-09-03', hasta: '2026-09-02' },
        { desde: '2025-01-01', hasta: '2026-09-02' },
        { desde: '2026-02-30', hasta: '2026-03-01' },
        { desde: 'ayer', hasta: '2026-09-02' },
      ]) {
        expect((await estado(USUARIOS.visorA, q)).status).toBe(400);
      }
    });
  });
});
