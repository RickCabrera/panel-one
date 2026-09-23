import { Prisma, PrismaClient } from '@prisma/client';

import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import type { PuertoArchivos } from '../src/adaptadores/archivos/puerto';
import { estadoPublico, VIGENCIA_DEFAULT } from '../src/facturacion/codigo';
import { importesGlobal, periodoDe } from '../src/facturacion/global';
import { sembrarCfdis } from './seed-cfdis';
import { generarCodigosSeed } from './seed-codigos';
import {
  generarGlobalesSeed,
  RETRASO_EMISION_H,
  sembrarGlobales,
  whereGlobalesSeed,
  type SucursalParaGlobal,
} from './seed-globales';
import {
  CATALOGO_FORMAS_SEED,
  generarVentas,
  PREFIJO_SEED,
  sembrarVentas,
  type OpcionesVentas,
} from './seed-ventas';

// Las facturas globales del seed (F2-108): puras y deterministas, una por mes `lista` salvo el más
// reciente, y persistidas por `sembrarGlobales` en las sucursales de FIXTURES. El seed de 90 días
// hasta el 15 de noviembre cubre agosto (parcial), septiembre, octubre y noviembre (en curso).

const VENTAS: OpcionesVentas = {
  empresaId: FX.empresaA,
  sucursales: [
    { id: FX.sucursalA1, clave: 'A1', zonaHoraria: 'America/Mexico_City' },
    { id: FX.sucursalA2, clave: 'A2', zonaHoraria: 'America/Tijuana' },
  ],
  hoy: '2026-11-15',
  ahora: new Date('2026-11-15T20:00:00Z'),
};
const AHORA = VENTAS.ahora!;
const ZONAS = new Map(VENTAS.sucursales.map((s) => [s.id, s.zonaHoraria]));
const cheques = generarVentas(VENTAS);
const codigosSeed = generarCodigosSeed(cheques, {
  zonas: ZONAS,
  vigencia: VIGENCIA_DEFAULT,
  ahora: AHORA,
  catalogoFormas: CATALOGO_FORMAS_SEED,
});
const deCheque = new Map(cheques.map((c) => [c.id, c]));
const SUCURSALES: SucursalParaGlobal[] = VENTAS.sucursales.map((s) => ({
  id: s.id,
  empresaId: FX.empresaA,
  zonaHoraria: s.zonaHoraria,
  codigos: codigosSeed
    .filter((k) => k.sucursalId === s.id)
    .map((k) => ({ ...k, cfdi: null, cheque: deCheque.get(k.chequeId)! })),
}));
const OP = { ahora: AHORA, catalogoFormas: CATALOGO_FORMAS_SEED };

describe('generarGlobalesSeed()', () => {
  const globales = generarGlobalesSeed(SUCURSALES, OP);

  it('por sucursal, agosto y septiembre; octubre (el último listo) se queda para la vista previa', () => {
    expect(globales.map((g) => [g.sucursalId, g.periodo.clave]).sort()).toEqual(
      [
        [FX.sucursalA1, '2026-08-01'],
        [FX.sucursalA1, '2026-09-01'],
        [FX.sucursalA2, '2026-08-01'],
        [FX.sucursalA2, '2026-09-01'],
      ].sort(),
    );
    expect(globales.every((g) => g.periodo.informacion.periodicidad === '04')).toBe(true);
  });

  it('sólo tickets EXPIRADOS del mes, en la zona de su sucursal; importes = suma de los tickets', () => {
    const suc = new Map(SUCURSALES.map((s) => [s.id, s]));
    for (const g of globales) {
      const codigos = new Map(suc.get(g.sucursalId)!.codigos.map((c) => [c.id, c]));
      expect(g.tickets.length).toBeGreaterThan(0);
      for (const t of g.tickets) {
        const c = codigos.get(t.codigoId)!;
        expect(estadoPublico({ ...c, global: null }, c.cheque, AHORA.getTime())).toBe('expirado');
        expect(periodoDe(c.cheque.cerradoAt!, g.zona, 'mensual').clave).toBe(g.periodo.clave);
        expect(t.total.equals(c.cheque.total)).toBe(true);
      }
      const i = importesGlobal(g.tickets);
      expect(g.importes.total.equals(i.total)).toBe(true);
      expect(g.importes.subtotal.add(g.importes.iva).equals(g.importes.total)).toBe(true);
      // Emitida después de que termina el mes, sin inventar futuro.
      expect(g.emitidoAt.getTime()).toBe(g.periodo.hasta.getTime() + RETRASO_EMISION_H * 3_600_000);
      expect(g.emitidoAt.getTime()).toBeLessThanOrEqual(AHORA.getTime());
    }
    // Un ticket entra a UNA global como mucho.
    const ids = globales.flatMap((g) => g.tickets.map((t) => t.codigoId));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('ningún ticket facturado entra, y el mes con un ticket todavía facturable tampoco', () => {
    const facturados = new Set(
      codigosSeed.filter((k) => k.estado === 'facturado').map((k) => k.id),
    );
    for (const g of globales) {
      for (const t of g.tickets) expect(facturados.has(t.codigoId)).toBe(false);
    }
    // Noviembre está en curso: ninguna global de noviembre.
    expect(globales.some((g) => g.periodo.clave === '2026-11-01')).toBe(false);
  });

  it('determinista: la misma entrada da exactamente lo mismo', () => {
    expect(generarGlobalesSeed(SUCURSALES, OP)).toEqual(globales);
  });

  it('el filtro de borrado sólo toca globales que amparan tickets DEL SEED de esas sucursales', () => {
    expect(whereGlobalesSeed([FX.sucursalA1], PREFIJO_SEED)).toEqual({
      origen: 'global',
      sucursalId: { in: [FX.sucursalA1] },
      globalCodigos: {
        some: {
          sucursalId: { in: [FX.sucursalA1] },
          codigo: {
            cheque: { sucursalId: { in: [FX.sucursalA1] }, folioSr: { startsWith: PREFIJO_SEED } },
          },
        },
      },
    });
  });
});

/** Almacenamiento en memoria. */
class ArchivosMemoria implements PuertoArchivos {
  readonly guardados = new Map<string, Buffer>();
  guardar(clave: string, contenido: Buffer): Promise<void> {
    this.guardados.set(clave, contenido);
    return Promise.resolve();
  }
  leer(clave: string): Promise<Buffer> {
    return Promise.resolve(this.guardados.get(clave)!);
  }
  urlFirmada(): Promise<string> {
    return Promise.resolve('');
  }
  verificarUrl(): boolean {
    return false;
  }
}

describe('sembrarGlobales() (contra Postgres, secuencia completa del seed)', () => {
  const prisma = new PrismaClient();
  const OPV = { ...VENTAS, ejemploFacturacion: { sucursalId: FX.sucursalA1, codigo: 'PRUEBAGLB' } };
  const archivos = new ArchivosMemoria();
  const opSiembra = {
    empresaId: FX.empresaA,
    prefijo: PREFIJO_SEED,
    ahora: AHORA,
    catalogoFormas: CATALOGO_FORMAS_SEED,
    archivos,
  };

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await prisma.perfilFiscal.create({
      data: {
        empresaId: FX.empresaA,
        rfc: 'EKU9003173C9',
        razonSocial: 'ESCUELA KEMPER URGATE',
        regimenFiscal: '601',
        cp: '06700',
        serie: 'A',
        folioActual: 0,
        updatedAt: AHORA,
      },
    });
  }, 120_000);

  afterAll(async () => {
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  /** `sembrarVentas` → `sembrarCfdis` → `sembrarGlobales`, como `seed-ventas.ts#main`. */
  const sembrarTodo = async () => {
    await sembrarVentas(prisma, OPV);
    await sembrarCfdis(prisma, opSiembra);
    return sembrarGlobales(prisma, opSiembra);
  };
  const foto = async () => ({
    globales: await prisma.cfdi.findMany({
      where: { empresaId: FX.empresaA, origen: 'global' },
      orderBy: { id: 'asc' },
    }),
    filas: await prisma.cfdiGlobalCodigo.findMany({
      where: { empresaId: FX.empresaA },
      orderBy: { id: 'asc' },
    }),
    // Los códigos se recrean en cada corrida (sus ids son deterministas): se comparan por id.
    enGlobal: (
      await prisma.codigoFacturacion.findMany({
        where: { empresaId: FX.empresaA, estado: 'en_global' },
        select: { id: true },
        orderBy: { id: 'asc' },
      })
    ).map((c) => c.id),
    folioActual: (await prisma.perfilFiscal.findFirstOrThrow({ where: { empresaId: FX.empresaA } }))
      .folioActual,
  });

  it('siembra las globales, sus filas y los códigos en_global; dos corridas dejan TODO idéntico', async () => {
    const r = await sembrarTodo();
    expect(r).toMatchObject({ globales: 4, sinArchivos: 0, sinPerfil: false });
    const primera = await foto();
    expect(primera.globales).toHaveLength(4);
    expect(primera.filas).toHaveLength(r.tickets);
    expect(primera.enGlobal).toHaveLength(r.tickets);
    expect(new Set(primera.filas.map((f) => f.codigoId))).toEqual(new Set(primera.enGlobal));
    for (const g of primera.globales) {
      expect(g).toMatchObject({
        estado: 'vigente',
        chequeId: null,
        codigoId: null,
        globalPeriodicidad: '04',
      });
      expect(archivos.guardados.has(g.xmlClave!)).toBe(true);
      const xml = archivos.guardados.get(g.xmlClave!)!.toString('utf8');
      expect(xml).toContain(`<cfdi:InformacionGlobal Periodicidad="04" Meses="${g.globalMeses}"`);
      const filas = primera.filas.filter((f) => f.cfdiId === g.id);
      expect(filas.every((f) => f.sucursalId === g.sucursalId)).toBe(true);
      expect(filas.reduce((s, f) => s.add(f.total), new Prisma.Decimal(0)).equals(g.total)).toBe(
        true,
      );
    }
    // Las globales toman folios DESPUÉS de los CFDI del seed y `folio_actual` sube.
    const maxOtros = await prisma.cfdi.aggregate({
      where: { empresaId: FX.empresaA, origen: { not: 'global' } },
      _max: { folio: true },
    });
    expect(Math.min(...primera.globales.map((g) => g.folio))).toBe(maxOtros._max.folio! + 1);
    expect(primera.folioActual).toBe(Math.max(...primera.globales.map((g) => g.folio)));

    await sembrarTodo();
    expect(await foto()).toEqual(primera);
  }, 240_000);

  it('re-sembrar NO borra una global que no ampara tickets del seed', async () => {
    const otro = await prisma.cheque.create({
      data: {
        sucursalId: FX.sucursalA1,
        empresaId: FX.empresaA,
        folio: 'AJENO-1',
        folioSr: 'AJENO-1',
        abiertoAt: new Date('2026-09-10T18:00:00Z'),
        cerradoAt: new Date('2026-09-10T19:00:00Z'),
        subtotal: '10.00',
        impuestos: '0',
        descuentos: '0',
        propina: '0',
        total: '10.00',
      },
    });
    const codigo = await prisma.codigoFacturacion.create({
      data: {
        codigo: 'AJENXGLB2',
        chequeId: otro.id,
        sucursalId: FX.sucursalA1,
        empresaId: FX.empresaA,
        estado: 'en_global',
        expiraAt: new Date('2026-10-01T06:00:00Z'),
        updatedAt: AHORA,
      },
    });
    const perfil = await prisma.perfilFiscal.findFirstOrThrow({
      where: { empresaId: FX.empresaA },
    });
    const ajena = await prisma.cfdi.create({
      data: {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        perfilFiscalId: perfil.id,
        serie: 'Z',
        folio: 1,
        uuid: 'F2108000-0000-4000-8000-00000000A1E0',
        idPac: 'F2108000-0000-4000-8000-00000000A1E0',
        receptor: {},
        formaPago: '01',
        subtotal: '8.62',
        iva: '1.38',
        total: '10.00',
        estado: 'vigente',
        emitidoAt: AHORA,
        origen: 'global',
        globalPeriodicidad: '01',
        globalMeses: '09',
        globalAnio: 2026,
        globalDesde: new Date('2026-09-10T06:00:00Z'),
        globalHasta: new Date('2026-09-11T06:00:00Z'),
        updatedAt: AHORA,
      },
    });
    await prisma.cfdiGlobalCodigo.create({
      data: {
        empresaId: FX.empresaA,
        sucursalId: FX.sucursalA1,
        cfdiId: ajena.id,
        codigoId: codigo.id,
        total: '10.00',
      },
    });
    await sembrarTodo();
    expect(await prisma.cfdi.findUnique({ where: { id: ajena.id } })).not.toBeNull();
    expect(
      await prisma.cfdiGlobalCodigo.count({ where: { cfdiId: ajena.id, codigoId: codigo.id } }),
    ).toBe(1);
    // Limpieza: la global ajena, su código y su cheque.
    await prisma.cfdi.delete({ where: { id: ajena.id } });
    await prisma.codigoFacturacion.delete({ where: { id: codigo.id } });
    await prisma.cheque.delete({ where: { id: otro.id } });
  }, 240_000);
});
