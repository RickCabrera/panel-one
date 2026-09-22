import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { FormaPago, PrismaClient } from '@prisma/client';
import request from 'supertest';

import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { Reloj } from '../comun/reloj';
import { configurarApp } from '../configurar-app';

// E2E de los filtros y el orden de `GET /ventas/tickets` (F2-222) sobre la app REAL contra
// Postgres REAL. Las cuentas se insertan A MANO y cada resultado esperado está escrito a mano
// aquí abajo (una lista de alias), no calculado con la misma lógica que el servicio.
//
// A1 está en CDMX (UTC−6) y A2 en Tijuana (UTC−7 en septiembre). Rango: 14 y 15 de septiembre.
// Catálogo de formas de A: EFECTIVO → efectivo, TARJETA VISA → tarjeta, TRANSFER SPEI →
// transferencia. "VALES" no está en el catálogo → `otro` (y su columna `forma` guardada dice
// `efectivo` A PROPÓSITO: el filtro tiene que usar el catálogo, como el detalle).
//
// | alias | folio | suc | mesero    | mesa | apertura → cierre (UTC)    | min  | total  | prop | com  | cancel | partidas                        | pagos                    |
// |-------|-------|-----|-----------|------|----------------------------|------|--------|------|------|--------|---------------------------------|--------------------------|
// | K1    | 1000  | A1  | Ana       | 5    | 14T19:00 → 14T20:00        | 60   | 222.00 | 20   | 2    |        | Taco al Pastor, Agua 100% natural | EFECTIVO 100, TARJETA VISA 122 |
// | K2    | 999   | A1  | Ana María | 12   | 15T02:00 → 15T03:30        | 90   | 100.00 | 0    | null |        | Taco de Jamón                   | EFECTIVO 100             |
// | K3    | 1001  | A1  | null      | null | 15T15:15 → 15T15:15        | 0    | 50.00  | 0    | null |        | Café                            | VALES 50                 |
// | K4    | 20    | A2  | Ana       | 5    | 16T05:30 → 16T06:30 (15 local Tijuana) | 60 | 300.00 | 30 | 4 |     | TACO AL PASTOR                  | TARJETA VISA 300         |
// | K5    | 1002  | A1  | Ana       | 9    | 14T20:30 → 14T21:00        | 30   | 70.00  | 0    | null | SÍ     | Pastel                          | —                        |
// | K6    | 1003  | A1  | Luis      | 9    | 15T16:00 → sin cierre      | —    | 100.00 | 0    | null | SÍ     | Refresco 50%_x                  | —                        |
// | K7    | 1004  | A1  | Luis      | 7    | 15T17:00 → 15T18:40        | 100  | 100.01 | 5    | 0    |        | Agua                            | TRANSFER SPEI 100.01     |
// | F1    | 1005  | A1  | Ana       | 5    | 16T06:00 → 16T06:30 (mié 00:30 CDMX: FUERA) | | 150.00 | |  |        | Taco al pastor                  | EFECTIVO 150             |
// | B1    | 1006  | B1  | Ana       | 5    | 14T19:00 → 14T20:00 (otra EMPRESA) |   | 555.00 |      |      |        | Pozole de B                     | EFECTIVO 555             |
//
// Momento (cierre, o apertura del cancelado sin cierre), de más nuevo a más viejo:
// K4 16T06:30, K7 15T18:40, K6 15T16:00, K3 15T15:15, K2 15T03:30, K5 14T21:00, K1 14T20:00.

const CDMX = 'America/Mexico_City';
const TIJUANA = 'America/Tijuana';
const RANGO = { desde: '2026-09-14', hasta: '2026-09-15' };

class RelojFijo extends Reloj {
  t = Date.parse('2026-09-21T20:30:00Z');
  override ahora(): number {
    return this.t;
  }
}

interface Cuenta {
  alias: string;
  folio: string;
  empresa?: string;
  sucursal: string;
  mesero: string | null;
  mesa: string | null;
  abierto: string;
  cerrado: string | null;
  total: string;
  propina?: string;
  comensales?: number | null;
  cancelado?: boolean;
  partidas: string[];
  pagos: Array<[formaRaw: string, monto: string, formaGuardada: FormaPago]>;
}

const CUENTAS: Cuenta[] = [
  {
    alias: 'K1',
    folio: '1000',
    sucursal: FX.sucursalA1,
    mesero: 'Ana',
    mesa: '5',
    abierto: '2026-09-14T19:00:00Z',
    cerrado: '2026-09-14T20:00:00Z',
    total: '222.00',
    propina: '20.00',
    comensales: 2,
    partidas: ['Taco al Pastor', 'Agua 100% natural'],
    pagos: [
      ['EFECTIVO', '100.00', FormaPago.efectivo],
      ['TARJETA VISA', '122.00', FormaPago.tarjeta],
    ],
  },
  {
    alias: 'K2',
    folio: '999',
    sucursal: FX.sucursalA1,
    mesero: 'Ana María',
    mesa: '12',
    abierto: '2026-09-15T02:00:00Z',
    cerrado: '2026-09-15T03:30:00Z',
    total: '100.00',
    comensales: null,
    partidas: ['Taco de Jamón'],
    pagos: [['EFECTIVO', '100.00', FormaPago.efectivo]],
  },
  {
    alias: 'K3',
    folio: '1001',
    sucursal: FX.sucursalA1,
    mesero: null,
    mesa: null,
    abierto: '2026-09-15T15:15:00Z',
    cerrado: '2026-09-15T15:15:00Z',
    total: '50.00',
    comensales: null,
    partidas: ['Café'],
    // Guardada como `efectivo`, pero sin catálogo: vale `otro`.
    pagos: [['VALES', '50.00', FormaPago.efectivo]],
  },
  {
    alias: 'K4',
    folio: '20',
    sucursal: FX.sucursalA2,
    mesero: 'Ana',
    mesa: '5',
    abierto: '2026-09-16T05:30:00Z',
    cerrado: '2026-09-16T06:30:00Z',
    total: '300.00',
    propina: '30.00',
    comensales: 4,
    partidas: ['TACO AL PASTOR'],
    pagos: [['TARJETA VISA', '300.00', FormaPago.tarjeta]],
  },
  {
    alias: 'K5',
    folio: '1002',
    sucursal: FX.sucursalA1,
    mesero: 'Ana',
    mesa: '9',
    abierto: '2026-09-14T20:30:00Z',
    cerrado: '2026-09-14T21:00:00Z',
    total: '70.00',
    cancelado: true,
    partidas: ['Pastel'],
    pagos: [],
  },
  {
    alias: 'K6',
    folio: '1003',
    sucursal: FX.sucursalA1,
    mesero: 'Luis',
    mesa: '9',
    abierto: '2026-09-15T16:00:00Z',
    cerrado: null,
    total: '100.00',
    cancelado: true,
    partidas: ['Refresco 50%_x'],
    pagos: [],
  },
  {
    alias: 'K7',
    folio: '1004',
    sucursal: FX.sucursalA1,
    mesero: 'Luis',
    mesa: '7',
    abierto: '2026-09-15T17:00:00Z',
    cerrado: '2026-09-15T18:40:00Z',
    total: '100.01',
    propina: '5.00',
    comensales: 0,
    partidas: ['Agua'],
    pagos: [['TRANSFER SPEI', '100.01', FormaPago.transferencia]],
  },
  {
    alias: 'F1',
    folio: '1005',
    sucursal: FX.sucursalA1,
    mesero: 'Ana',
    mesa: '5',
    abierto: '2026-09-16T06:00:00Z',
    cerrado: '2026-09-16T06:30:00Z',
    total: '150.00',
    partidas: ['Taco al pastor'],
    pagos: [['EFECTIVO', '150.00', FormaPago.efectivo]],
  },
  {
    alias: 'B1',
    folio: '1006',
    empresa: FX.empresaB,
    sucursal: FX.sucursalB1,
    mesero: 'Ana',
    mesa: '5',
    abierto: '2026-09-14T19:00:00Z',
    cerrado: '2026-09-14T20:00:00Z',
    total: '555.00',
    partidas: ['Pozole de B'],
    pagos: [['EFECTIVO', '555.00', FormaPago.efectivo]],
  },
];

const Q = (o: Record<string, string | number | undefined>) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
    .join('&');

type Usuario = (typeof USUARIOS)[keyof typeof USUARIOS];

describe('Tickets: filtros y orden (e2e, F2-222)', () => {
  const prisma = new PrismaClient();
  const reloj = new RelojFijo();
  let app: INestApplication;
  /** alias → id del cheque, y al revés. */
  const idDe = new Map<string, string>();
  const aliasDe = new Map<string, string>();

  const token = (u: Usuario) =>
    app.get(TokensService).firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
  async function get(
    query: Record<string, string | number | undefined>,
    u: Usuario = USUARIOS.visorA,
  ) {
    return request(app.getHttpServer())
      .get(`/ventas/tickets?${Q(query)}`)
      .set('Authorization', `Bearer ${await token(u)}`);
  }

  const base = { empresaId: FX.empresaA, ...RANGO, porPagina: 100 };

  /** Los alias de la página, en el orden de la respuesta. */
  async function alias(extra: Record<string, string | number | undefined>): Promise<string[]> {
    const r = await get({ ...base, ...extra });
    expect(r.status).toBe(200);
    const items = r.body.items as Array<{ id: string }>;
    expect(r.body.total).toBe(items.length);
    return items.map((i) => aliasDe.get(i.id)!);
  }

  /** Empates: el desempate es por id en la MISMA dirección del orden. */
  const porId = (dir: 'asc' | 'desc', ...a: string[]) =>
    [...a].sort((x, y) => {
      const [ix, iy] = [idDe.get(x)!, idDe.get(y)!];
      return dir === 'asc' ? (ix < iy ? -1 : 1) : ix < iy ? 1 : -1;
    });

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({ where: { id: FX.sucursalA1 }, data: { zonaHoraria: CDMX } });
    await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { zonaHoraria: TIJUANA } });
    await prisma.sucursal.update({ where: { id: FX.sucursalB1 }, data: { zonaHoraria: CDMX } });
    await prisma.formaPagoCatalogo.createMany({
      data: [
        { empresaId: FX.empresaA, formaRaw: 'EFECTIVO', forma: FormaPago.efectivo },
        { empresaId: FX.empresaA, formaRaw: 'TARJETA VISA', forma: FormaPago.tarjeta },
        { empresaId: FX.empresaA, formaRaw: 'TRANSFER SPEI', forma: FormaPago.transferencia },
      ],
    });
    for (const c of CUENTAS) {
      const empresaId = c.empresa ?? FX.empresaA;
      const cheque = await prisma.cheque.create({
        data: {
          empresaId,
          sucursalId: c.sucursal,
          folio: c.folio,
          folioSr: `TK-${c.alias}`,
          mesa: c.mesa,
          mesero: c.mesero,
          abiertoAt: new Date(c.abierto),
          cerradoAt: c.cerrado === null ? null : new Date(c.cerrado),
          comensales: c.comensales ?? null,
          subtotal: c.total,
          impuestos: '0',
          descuentos: '0',
          propina: c.propina ?? '0',
          total: c.total,
          cancelado: c.cancelado ?? false,
        },
      });
      idDe.set(c.alias, cheque.id);
      aliasDe.set(cheque.id, c.alias);
      for (const [orden, producto] of c.partidas.entries()) {
        await prisma.chequePartida.create({
          data: {
            chequeId: cheque.id,
            empresaId,
            orden,
            producto,
            cantidad: '1',
            precioUnit: c.total,
            total: c.total,
          },
        });
      }
      for (const [formaRaw, monto, forma] of c.pagos) {
        await prisma.chequePago.create({
          data: { chequeId: cheque.id, empresaId, formaRaw, monto, forma },
        });
      }
    }
    const modulo = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(Reloj)
      .useValue(reloj)
      .compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.init();
  });

  afterAll(async () => {
    await app?.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  it('sin filtros: los 7 del rango, del más nuevo al más viejo (el orden de siempre)', async () => {
    expect(await alias({})).toEqual(['K4', 'K7', 'K6', 'K3', 'K2', 'K5', 'K1']);
  });

  describe('cada filtro, solo', () => {
    it.each([
      // Exacto: "Ana" no trae a "Ana María"; la Ana de Tijuana sí entra.
      [{ mesero: 'Ana' }, ['K4', 'K5', 'K1']],
      [{ mesero: 'Ana María' }, ['K2']],
      [{ mesero: 'ana' }, []],
      [{ mesa: '9' }, ['K6', 'K5']],
      [{ mesa: '1' }, []],
      // Forma por CATÁLOGO: K1 pagó con dos y sale en las dos; VALES (sin catálogo) es `otro`
      // aunque su columna guardada diga efectivo.
      [{ forma: 'efectivo' }, ['K2', 'K1']],
      [{ forma: 'tarjeta' }, ['K4', 'K1']],
      [{ forma: 'transferencia' }, ['K7']],
      [{ forma: 'otro' }, ['K3']],
      // Importes inclusivos y con centavos exactos: 100.01 no es <= 100.
      [{ importeMin: '100' }, ['K4', 'K7', 'K6', 'K2', 'K1']],
      [{ importeMax: '100' }, ['K6', 'K3', 'K2', 'K5']],
      [{ importeMin: '100.00', importeMax: '100.00' }, ['K6', 'K2']],
      [{ importeMin: '100.01', importeMax: '100.01' }, ['K7']],
      [{ importeMin: '-5', importeMax: '49.99' }, []],
      [{ canceladas: 'incluir' }, ['K4', 'K7', 'K6', 'K3', 'K2', 'K5', 'K1']],
      [{ canceladas: 'excluir' }, ['K4', 'K7', 'K3', 'K2', 'K1']],
      [{ canceladas: 'solo' }, ['K6', 'K5']],
      // Producto: contiene, sin mayúsculas; un cancelado también se encuentra.
      [{ producto: 'pastor' }, ['K4', 'K1']],
      [{ producto: 'PASTEL' }, ['K5']],
      [{ producto: 'Jamón' }, ['K2']],
      // NO ignora acentos (documentado en el contrato).
      [{ producto: 'jamon' }, []],
      // Literal: `%` y `_` no son comodines (con LIKE, '%' traería los 7).
      [{ producto: '%' }, ['K6', 'K1']],
      [{ producto: '_' }, ['K6']],
      // Sólo existe en la empresa B.
      [{ producto: 'Pozole' }, []],
    ])('%j', async (filtro, esperado) => {
      expect(await alias(filtro)).toEqual(esperado);
    });
  });

  describe('combinados (AND)', () => {
    it.each([
      // tarjeta = K4, K1; pastor = K4, K1; >= 250 = K4.
      [{ forma: 'tarjeta', producto: 'pastor', importeMin: '250' }, ['K4']],
      // Ana = K4, K5, K1; sin cancelados = K4, K1; <= 250 = K1.
      [{ mesero: 'Ana', canceladas: 'excluir', importeMax: '250' }, ['K1']],
      // mesa 9 = K5, K6 (los dos cancelados); excluir cancelados = nada.
      [{ mesa: '9', canceladas: 'excluir' }, []],
      // Con folio (prefijo) también: 100x = K1, K3, K5, K6, K7; efectivo = K1.
      [{ folio: '100', forma: 'efectivo', canceladas: 'excluir' }, ['K1']],
    ])('%j', async (filtro, esperado) => {
      expect(await alias(filtro)).toEqual(esperado);
    });

    it('el total es el del filtro completo aunque la página sea chica', async () => {
      const r = await get({ ...base, porPagina: 1, importeMin: '100' });
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(5);
      expect(r.body.items).toHaveLength(1);
    });

    it('el corte por recepción se combina con los filtros', async () => {
      const r = await get({ ...base, forma: 'efectivo', corte: '2000-01-01T00:00:00Z' });
      expect(r.status).toBe(200);
      expect(r.body.total).toBe(0);
    });
  });

  describe('orden', () => {
    it.each([
      ['folio', 'asc', ['K4', 'K2', 'K1', 'K3', 'K5', 'K6', 'K7']], // 20, 999, 1000 … 1004
      ['folio', 'desc', ['K7', 'K6', 'K5', 'K3', 'K1', 'K2', 'K4']],
      ['momento', 'asc', ['K1', 'K5', 'K2', 'K3', 'K6', 'K7', 'K4']],
      // Texto byte a byte: "12" < "5" < "7" < "9"; los nulos al final en las dos direcciones.
      ['mesa', 'asc', ['K2', ...['K1', 'K4'], 'K7', ...['K5', 'K6'], 'K3']],
      ['mesero', 'desc', [...['K6', 'K7'], 'K2', ...['K1', 'K4', 'K5'], 'K3']],
      ['comensales', 'asc', ['K7', 'K1', 'K4', ...['K2', 'K3', 'K5', 'K6']]],
      // Sin cierre = sin duración: al final.
      ['duracion', 'desc', ['K7', 'K2', ...['K1', 'K4'], 'K5', 'K3', 'K6']],
    ] as const)('%s %s', async (orden, dir, grupos) => {
      const r = await alias({ orden, dir });
      expect(r).toHaveLength(7);
      // Los empates (mismo valor) van por id en la misma dirección.
      const empates: Record<string, string[][]> = {
        'mesa asc': [
          ['K1', 'K4'],
          ['K5', 'K6'],
        ],
        'mesero desc': [
          ['K6', 'K7'],
          ['K1', 'K4', 'K5'],
        ],
        'comensales asc': [['K2', 'K3', 'K5', 'K6']],
        'duracion desc': [['K1', 'K4']],
      };
      const esperado: string[] = [...grupos];
      for (const grupo of empates[`${orden} ${dir}`] ?? []) {
        const inicio = esperado.indexOf(grupo[0]);
        esperado.splice(inicio, grupo.length, ...porId(dir, ...grupo));
      }
      expect(r).toEqual(esperado);
    });

    it('total asc con empate en 100.00 y propina desc con cuatro en 0', async () => {
      expect(await alias({ orden: 'total', dir: 'asc' })).toEqual([
        'K3',
        'K5',
        ...porId('asc', 'K2', 'K6'),
        'K7',
        'K1',
        'K4',
      ]);
      expect(await alias({ orden: 'propina', dir: 'desc' })).toEqual([
        'K4',
        'K1',
        'K7',
        ...porId('desc', 'K2', 'K3', 'K5', 'K6'),
      ]);
    });

    it('recorrer las páginas con un orden con empates no repite ni salta tickets', async () => {
      const vistos: string[] = [];
      for (let pagina = 1; pagina <= 4; pagina++) {
        const r = await get({ ...base, porPagina: 2, pagina, orden: 'total', dir: 'desc' });
        vistos.push(...(r.body.items as Array<{ id: string }>).map((i) => aliasDe.get(i.id)!));
      }
      expect(vistos).toEqual(await alias({ orden: 'total', dir: 'desc' }));
      expect(new Set(vistos).size).toBe(7);
    });
  });

  it('el detalle de un ticket filtrado por `otro` dice `otro` en su pago (mismo criterio)', async () => {
    const r = await get({ ...base, forma: 'otro' });
    expect(r.body.items[0].pagos).toEqual([{ formaRaw: 'VALES', forma: 'otro', monto: '50.00' }]);
  });

  describe('400', () => {
    it.each([
      ['forma fuera del enum', { forma: 'cheque' }],
      ['importe con exponente', { importeMin: '1e3' }],
      ['importe con 3 decimales', { importeMax: '1.234' }],
      ['importe texto', { importeMin: 'mil' }],
      ['importe con coma', { importeMin: '1,000' }],
      ['min > max', { importeMin: '200', importeMax: '100.00' }],
      ['min > max por un centavo', { importeMin: '100.01', importeMax: '100' }],
      ['orden fuera de lista', { orden: 'id; DROP' }],
      ['orden de otra columna', { orden: 'recibido_at' }],
      ['dir inválida', { dir: 'up' }],
      ['canceladas inválido', { canceladas: 'todas' }],
      ['producto vacío', { producto: '' }],
      ['mesero vacío', { mesero: '' }],
      ['producto larguísimo', { producto: 'x'.repeat(81) }],
    ])('%s', async (_caso, filtro) => {
      const r = await get({ ...base, ...filtro });
      expect(r.status).toBe(400);
    });
  });

  describe('scope: 404, nunca 403, y nada de otra empresa', () => {
    it('visor de A pidiendo la empresa B con filtros = 404', async () => {
      const r = await get({ ...base, empresaId: FX.empresaB, producto: 'Pozole' });
      expect(r.status).toBe(404);
    });

    it('admin_global con una sucursal de B bajo la empresa A = 404', async () => {
      const r = await get(
        { ...base, sucursalId: FX.sucursalB1, forma: 'efectivo' },
        USUARIOS.adminGlobal,
      );
      expect(r.status).toBe(404);
    });

    it('el filtro por producto de B sí funciona en B (admin_global), y nunca cruza a A', async () => {
      const enB = await get(
        { ...base, empresaId: FX.empresaB, producto: 'Pozole' },
        USUARIOS.adminGlobal,
      );
      expect(enB.status).toBe(200);
      expect(enB.body.items.map((i: { id: string }) => aliasDe.get(i.id))).toEqual(['B1']);
      const enA = await get({ ...base, producto: 'Pozole' }, USUARIOS.adminGlobal);
      expect(enA.body.total).toBe(0);
    });

    it('con sucursal A2 sólo sus tickets, también filtrando', async () => {
      expect(await alias({ sucursalId: FX.sucursalA2, producto: 'pastor' })).toEqual(['K4']);
    });
  });
});
