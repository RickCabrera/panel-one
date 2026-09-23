import { PrismaClient } from '@prisma/client';

import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import type { PuertoArchivos } from '../src/adaptadores/archivos/puerto';
import { formaPagoSat } from '../src/facturacion/cfdi';
import { VIGENCIA_DEFAULT } from '../src/facturacion/codigo';
import {
  archivosDe,
  generarCfdisSeed,
  PORCENTAJE_CANCELADO,
  sembrarCfdis,
  type CodigoParaCfdi,
  type OpcionesCfdis,
} from './seed-cfdis';
import { generarCodigosSeed } from './seed-codigos';
import {
  CATALOGO_FORMAS_SEED,
  generarVentas,
  PREFIJO_SEED,
  sembrarVentas,
  type OpcionesVentas,
} from './seed-ventas';

// Los CFDI del seed (F2-106): puros y deterministas, uno por código `facturado`, y persistidos por
// `sembrarCfdis` en las sucursales de FIXTURES (nunca en las de la base de desarrollo).

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
const CODIGOS: CodigoParaCfdi[] = codigosSeed.map((k) => ({
  id: k.id,
  estado: k.estado,
  expiraAt: k.expiraAt,
  cheque: deCheque.get(k.chequeId)!,
}));
const PERFIL = {
  id: 'f2106000-0000-4000-8000-0000000000aa',
  serie: 'A',
  rfc: 'EKU9003173C9',
  razonSocial: 'ESCUELA KEMPER URGATE',
  regimenFiscal: '601',
  cp: '06700',
};
const OPCIONES: OpcionesCfdis = {
  perfil: PERFIL,
  zonas: ZONAS,
  catalogoFormas: CATALOGO_FORMAS_SEED,
  ahora: AHORA,
  folioInicial: 1,
};

describe('generarCfdisSeed()', () => {
  const cfdis = generarCfdisSeed(CODIGOS, OPCIONES);
  const facturados = codigosSeed.filter((k) => k.estado === 'facturado');

  it('uno por código `facturado` y ninguno más: ningún facturado queda huérfano', () => {
    expect(facturados.length).toBeGreaterThan(100);
    expect(cfdis.map((c) => c.codigoId).sort()).toEqual(facturados.map((k) => k.id).sort());
  });

  it('el total es el del cheque y subtotal + IVA = total (misma regla que la emisión)', () => {
    for (const c of cfdis) {
      const cheque = deCheque.get(c.chequeId)!;
      expect(c.total.toFixed(2)).toBe(cheque.total.toFixed(2));
      expect(c.subtotal.plus(c.iva).toFixed(2)).toBe(c.total.toFixed(2));
      expect(c.formaPago).toBe(formaPagoSat(cheque.pagos, CATALOGO_FORMAS_SEED));
      expect(c.sucursalId).toBe(cheque.sucursalId);
    }
  });

  it('se emite después del cierre, antes de que venza el código y nunca en el futuro', () => {
    const vence = new Map(codigosSeed.map((k) => [k.id, k.expiraAt.getTime()]));
    for (const c of cfdis) {
      const cierre = deCheque.get(c.chequeId)!.cerradoAt!.getTime();
      expect(c.emitidoAt.getTime()).toBeGreaterThanOrEqual(cierre);
      expect(c.emitidoAt.getTime()).toBeLessThan(vence.get(c.codigoId)!);
      expect(c.emitidoAt.getTime()).toBeLessThanOrEqual(AHORA.getTime());
    }
  });

  it('folios consecutivos desde `folioInicial` en orden de emisión; UUID únicos', () => {
    const conOtroInicio = generarCfdisSeed(CODIGOS, { ...OPCIONES, folioInicial: 101 });
    expect(conOtroInicio.map((c) => c.folio)).toEqual(cfdis.map((_, i) => 101 + i));
    for (let i = 1; i < cfdis.length; i++) {
      expect(cfdis[i].emitidoAt.getTime()).toBeGreaterThanOrEqual(cfdis[i - 1].emitidoAt.getTime());
    }
    expect(new Set(cfdis.map((c) => c.uuid)).size).toBe(cfdis.length);
    expect(new Set(cfdis.map((c) => c.id)).size).toBe(cfdis.length);
  });

  it(`~${PORCENTAJE_CANCELADO} % cancelados, el resto vigentes, ninguno en timbrando`, () => {
    const cancelados = cfdis.filter((c) => c.estado === 'cancelado').length;
    expect(cancelados).toBeGreaterThan(0);
    expect(cancelados / cfdis.length).toBeLessThan(0.16);
    expect(cfdis.every((c) => c.estado === 'vigente' || c.estado === 'cancelado')).toBe(true);
  });

  it('determinista: la misma entrada da exactamente lo mismo', () => {
    expect(generarCfdisSeed(CODIGOS, OPCIONES)).toEqual(cfdis);
  });

  it('truena si un código facturado no tiene forma de pago SAT (seed-codigos lo impide)', () => {
    const malo = CODIGOS.find((k) => k.estado === 'facturado')!;
    const sinPagos = { ...malo, cheque: { ...malo.cheque, pagos: [] } };
    expect(() => generarCfdisSeed([sinPagos], OPCIONES)).toThrow(/sin forma de pago SAT/);
  });

  it('archivos: XML y PDF del PAC falso en la clave de F2-105, con el UUID', () => {
    const c = cfdis[0];
    const cheque = deCheque.get(c.chequeId)!;
    const [xml, pdf] = archivosDe(c, {
      perfil: PERFIL,
      zona: ZONAS.get(c.sucursalId)!,
      folioTicket: cheque.folio,
      totalCheque: cheque.total,
    });
    expect(xml.clave).toMatch(new RegExp(`^cfdi/${FX.empresaA}/\\d{4}/\\d{2}/${c.uuid}\\.xml$`));
    expect(pdf.clave).toBe(xml.clave.replace(/\.xml$/, '.pdf'));
    expect(xml.contenido.toString('utf8')).toContain(`UUID="${c.uuid}"`);
    expect(pdf.contenido.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });
});

/** Almacenamiento en memoria, con falla a la carta. */
class ArchivosMemoria implements PuertoArchivos {
  readonly guardados = new Map<string, Buffer>();
  falla = false;
  guardar(clave: string, contenido: Buffer): Promise<void> {
    if (this.falla) return Promise.reject(new Error('disco lleno (prueba)'));
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

describe('sembrarCfdis() (contra Postgres)', () => {
  const prisma = new PrismaClient();
  const OP = { ...VENTAS, ejemploFacturacion: { sucursalId: FX.sucursalA1, codigo: 'PRUEBACFD' } };

  beforeAll(async () => {
    await prisma.$connect();
    await crearFixtures(prisma);
    await sembrarVentas(prisma, OP);
  }, 120_000);

  afterAll(async () => {
    await limpiarFixtures(prisma);
    await prisma.$disconnect();
  });

  const leer = () =>
    prisma.cfdi.findMany({ where: { empresaId: FX.empresaA }, orderBy: { id: 'asc' } });

  it('sin perfil fiscal no siembra nada y lo dice', async () => {
    const r = await sembrarCfdis(prisma, {
      empresaId: FX.empresaA,
      prefijo: PREFIJO_SEED,
      ahora: AHORA,
      catalogoFormas: CATALOGO_FORMAS_SEED,
      archivos: null,
    });
    expect(r).toEqual({ cfdis: 0, cancelados: 0, sinArchivos: 0, sinPerfil: true });
    expect(await leer()).toEqual([]);
  });

  it('uno por código facturado, con archivos; re-sembrar deja las filas IDÉNTICAS y folio_actual al día', async () => {
    await prisma.perfilFiscal.create({
      data: { ...PERFIL, empresaId: FX.empresaA, folioActual: 0, updatedAt: AHORA },
    });
    const archivos = new ArchivosMemoria();
    const op = {
      empresaId: FX.empresaA,
      prefijo: PREFIJO_SEED,
      ahora: AHORA,
      catalogoFormas: CATALOGO_FORMAS_SEED,
      archivos,
    };
    const r = await sembrarCfdis(prisma, op);
    const facturados = await prisma.codigoFacturacion.count({
      where: { empresaId: FX.empresaA, estado: 'facturado' },
    });
    expect(r.cfdis).toBe(facturados);
    expect(r.sinArchivos).toBe(0);
    const primera = await leer();
    expect(primera).toHaveLength(facturados);
    // Cada código facturado tiene su CFDI, y cada CFDI su XML y PDF guardados.
    const conCfdi = await prisma.codigoFacturacion.count({
      where: { empresaId: FX.empresaA, estado: 'facturado', cfdi: { isNot: null } },
    });
    expect(conCfdi).toBe(facturados);
    for (const c of primera) {
      expect(archivos.guardados.has(c.xmlClave!)).toBe(true);
      expect(archivos.guardados.has(c.pdfClave!)).toBe(true);
    }
    const folioMax = Math.max(...primera.map((c) => c.folio));
    const perfil = () =>
      prisma.perfilFiscal.findFirstOrThrow({ where: { empresaId: FX.empresaA } });
    expect((await perfil()).folioActual).toBe(folioMax);

    await sembrarCfdis(prisma, op);
    expect(await leer()).toEqual(primera);
    expect((await perfil()).folioActual).toBe(folioMax);
  }, 120_000);

  it('si el almacenamiento falla, los CFDI quedan sin clave y se cuentan', async () => {
    const archivos = new ArchivosMemoria();
    archivos.falla = true;
    const r = await sembrarCfdis(prisma, {
      empresaId: FX.empresaA,
      prefijo: PREFIJO_SEED,
      ahora: AHORA,
      catalogoFormas: CATALOGO_FORMAS_SEED,
      archivos,
    });
    expect(r.sinArchivos).toBe(r.cfdis);
    const filas = await leer();
    expect(filas.every((c) => c.xmlClave === null && c.pdfClave === null)).toBe(true);
  }, 120_000);
});
