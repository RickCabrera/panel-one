import { Logger } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { Prisma, PrismaClient } from '@prisma/client';
import request from 'supertest';

import { sembrarCatalogos } from '../../prisma/seed-catalogos';
import { claveDeArea } from '../../prisma/seed-maestro/catalogos';
import {
  generarVentas,
  sembrarVentas,
  universoDe,
  type ChequeSeed,
  type OpcionesVentas,
} from '../../prisma/seed-ventas';
import { crearFixtures, FX, limpiarFixtures, USUARIOS } from '../../test/fixtures-auth';
import { AppModule } from '../app.module';
import { TokensService } from '../auth/tokens.service';
import { configurarApp } from '../configurar-app';

// Áreas y canales (F2-233) sobre el SEED (F2-201): ventas, catálogo de áreas y mapeo demo
// sembrados por los mismos generadores del seed de desarrollo, en las sucursales de FIXTURES de la
// empresa A (A1 en CDMX, A2 en Tijuana). Lo esperado sale A MANO del generador
// (`maestro.area` / `maestro.canal` de cada cheque y el día local de SU sucursal), y la venta
// total de `/ventas/resumen`, que es otro endpoint.
//
// OJO, honestidad del seed: aquí `origenSrId = clave` (A01…) y el mapeo demo es el canal del
// universo, así que esto prueba la PERSISTENCIA y la suma, no el cruce: el cruce por id del POS
// (clave ≠ id, otra sucursal, sin catálogo) se prueba a mano en `por-area.e2e.spec.ts` y
// `por-area.spec.ts`.

const CDMX = 'America/Mexico_City';
const TIJUANA = 'America/Tijuana';
const OP: OpcionesVentas = {
  empresaId: FX.empresaA,
  sucursales: [
    { id: FX.sucursalA1, clave: 'A1', zonaHoraria: CDMX },
    { id: FX.sucursalA2, clave: 'A2', zonaHoraria: TIJUANA },
  ],
  hoy: '2026-11-15',
};
const ZONA: Record<string, string> = { [FX.sucursalA1]: CDMX, [FX.sucursalA2]: TIJUANA };
const cheques = generarVentas(OP);
const universo = universoDe(OP, cheques);

const diaLocal = (t: Date, zona: string) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: zona,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(t);
const haceDias = (dia: string, n: number) =>
  new Date(Date.parse(`${dia}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);

/** Las ventas del periodo: no canceladas, por el día local del cierre en SU sucursal. */
const ventasDel = (desde: string, hasta: string) =>
  cheques.filter((c: ChequeSeed) => {
    if (c.cancelado || !c.cerradoAt) return false;
    const d = diaLocal(c.cerradoAt, ZONA[c.sucursalId]);
    return d >= desde && d <= hasta;
  });

function sumar<K>(xs: ChequeSeed[], llave: (c: ChequeSeed) => K) {
  const m = new Map<K, { venta: Prisma.Decimal; cuentas: number }>();
  for (const c of xs) {
    const k = llave(c);
    const e = m.get(k) ?? { venta: new Prisma.Decimal(0), cuentas: 0 };
    m.set(k, { venta: e.venta.plus(c.total), cuentas: e.cuentas + 1 });
  }
  return m;
}

interface Monto {
  venta: string;
  cuentas: number;
}
interface PorArea extends Monto {
  areas: Array<Monto & { sucursalId: string; areaOrigenSrId: string; nombre: string | null; cruce: string; canal: string | null }>;
  sinArea: Monto;
  canales: Array<Monto & { canal: string }>;
  sinCanal: Monto;
}

describe('Áreas y canales sobre el seed (e2e, F2-233)', () => {
  const prisma = new PrismaClient();
  let app: NestExpressApplication;
  let url: string;

  const get = async (ruta: string, query: Record<string, string>) => {
    const u = USUARIOS.visorA;
    const token = await app
      .get(TokensService)
      .firmarAccess({ id: u.id, rol: u.rol, empresaId: u.empresaId });
    const r = await request(url).get(ruta).query(query).set('Authorization', `Bearer ${token}`);
    expect(r.status).toBe(200);
    return r.body as Record<string, unknown>;
  };

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.sucursal.update({ where: { id: FX.sucursalA2 }, data: { zonaHoraria: TIJUANA } });
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    await sembrarVentas(prisma, OP);
    await sembrarCatalogos(prisma, {
      empresaId: FX.empresaA,
      sucursales: OP.sucursales,
      universo,
      capturadoAt: new Date('2026-11-15T20:00:00.000Z'),
    });
    const modulo = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = configurarApp(modulo.createNestApplication<NestExpressApplication>());
    await app.listen(0, '127.0.0.1');
    url = await app.getUrl();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await app.close();
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  const TODO = { empresaId: FX.empresaA, desde: haceDias(OP.hoy, 100), hasta: OP.hoy };

  it('guarda: el seed persiste el área de cada cuenta que la trae, y deja nulas las demás', async () => {
    const sinArea = cheques.filter((c) => c.maestro.area === null);
    expect(sinArea.length).toBeGreaterThan(0);
    expect(
      await prisma.cheque.count({ where: { empresaId: FX.empresaA, areaOrigenSrId: null } }),
    ).toBe(sinArea.length);
    const muestra = cheques.find((c) => c.maestro.area === 'Terraza')!;
    expect(
      (await prisma.cheque.findUniqueOrThrow({ where: { id: muestra.id } })).areaOrigenSrId,
    ).toBe('A02');
  });

  it('Σ canales + sin canal + sin clasificar = /ventas/resumen, y cada canal es el del generador', async () => {
    const r = (await get('/ventas/por-area', TODO)) as unknown as PorArea;
    const resumen = await get('/ventas/resumen', TODO);
    expect(r.venta).toBe(resumen.venta);
    const ventas = ventasDel(TODO.desde, TODO.hasta);
    const porCanal = sumar(ventas, (c) => c.maestro.canal);
    const sinArea = porCanal.get(null)!;
    expect(sinArea.cuentas).toBeGreaterThan(0);
    expect(r.sinArea).toEqual({ venta: sinArea.venta.toFixed(2), cuentas: sinArea.cuentas });
    // El mapeo demo cubre todas las áreas del seed: nada queda "sin canal".
    expect(r.sinCanal).toEqual({ venta: '0.00', cuentas: 0 });
    expect(r.canales).toEqual(
      (['comedor', 'mostrador', 'domicilio'] as const).map((canal) => ({
        canal,
        venta: porCanal.get(canal)!.venta.toFixed(2),
        cuentas: porCanal.get(canal)!.cuentas,
      })),
    );
  });

  it('cada (sucursal, área) cuadra con el generador, y Terraza sólo en la sucursal par', async () => {
    const r = (await get('/ventas/por-area', TODO)) as unknown as PorArea;
    const ventas = ventasDel(TODO.desde, TODO.hasta).filter((c) => c.maestro.area !== null);
    const esperado = sumar(ventas, (c) => `${c.sucursalId}|${claveDeArea(c.maestro.area)}`);
    expect(r.areas.map((a) => `${a.sucursalId}|${a.areaOrigenSrId}`).sort()).toEqual(
      [...esperado.keys()].sort(),
    );
    for (const a of r.areas) {
      const e = esperado.get(`${a.sucursalId}|${a.areaOrigenSrId}`)!;
      expect({ venta: a.venta, cuentas: a.cuentas, cruce: a.cruce }).toEqual({
        venta: e.venta.toFixed(2),
        cuentas: e.cuentas,
        cruce: 'catalogo',
      });
    }
    expect(r.areas.filter((a) => a.nombre === 'Terraza').map((a) => a.sucursalId)).toEqual([
      FX.sucursalA1,
    ]);
  });

  it('con una sucursal (Tijuana, días locales de allá) también cuadra con su resumen', async () => {
    const q = { ...TODO, sucursalId: FX.sucursalA2, desde: haceDias(OP.hoy, 7) };
    const r = (await get('/ventas/por-area', q)) as unknown as PorArea;
    expect(r.venta).toBe((await get('/ventas/resumen', q)).venta);
    const ventas = ventasDel(q.desde, q.hasta).filter((c) => c.sucursalId === FX.sucursalA2);
    const total = ventas.reduce((s, c) => s.plus(c.total), new Prisma.Decimal(0));
    expect(r.venta).toBe(total.toFixed(2));
    expect(r.areas.every((a) => a.sucursalId === FX.sucursalA2)).toBe(true);
  });
});
