import { PrismaClient } from '@prisma/client';

import { crearFixtures, FX, limpiarFixtures } from '../test/fixtures-auth';
import type { PuertoArchivos } from '../src/adaptadores/archivos/puerto';
import { formaPagoSat } from '../src/facturacion/cfdi';
import { VIGENCIA_DEFAULT } from '../src/facturacion/codigo';
import {
  archivosDe,
  generarCfdisSeed,
  MANUALES_POR_SUCURSAL,
  PORCENTAJE_CANCELADO,
  RETRASO_SUSTITUTO_MIN,
  solicitudManualSeed,
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
// `sembrarCfdis` en las sucursales de FIXTURES (nunca en las de la base de desarrollo). F2-107: más
// pares de refacturación (anterior cancelado 01 + sustituto 04) y facturas sin ticket.

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

const SUCURSALES = VENTAS.sucursales.map((s) => ({ id: s.id, empresaId: FX.empresaA }));

describe('generarCfdisSeed()', () => {
  const todos = generarCfdisSeed(CODIGOS, OPCIONES, SUCURSALES);
  // Los de ticket (F2-106): los que tienen cheque.
  const cfdis = todos.filter((c) => c.chequeId !== null);
  const facturados = codigosSeed.filter((k) => k.estado === 'facturado');

  it('cada código `facturado` lo tiene EXACTAMENTE un CFDI; ningún facturado queda huérfano', () => {
    expect(facturados.length).toBeGreaterThan(100);
    const conCodigo = todos.filter((c) => c.codigoId !== null).map((c) => c.codigoId);
    expect(conCodigo.sort()).toEqual(facturados.map((k) => k.id).sort());
  });

  it('F2-107: refacturaciones = anterior cancelado 01 sin código + sustituto vigente 04 con él', () => {
    const sustitutos = todos.filter((c) => c.sustituyeAId !== null);
    expect(sustitutos.length).toBeGreaterThan(0);
    const porId = new Map(todos.map((c) => [c.id, c]));
    for (const n of sustitutos) {
      const a = porId.get(n.sustituyeAId!)!;
      expect(n.tipoRelacion).toBe('04');
      expect(n.estado).toBe('vigente');
      expect(n.relacionadoUuid).toBe(a.uuid);
      expect(n.chequeId).toBe(a.chequeId);
      expect(n.total.toFixed(2)).toBe(a.total.toFixed(2));
      expect(n.receptor.rfc).not.toBe(a.receptor.rfc);
      expect(n.codigoId).not.toBeNull();
      expect(a.codigoId).toBeNull();
      expect(a.estado).toBe('cancelado');
      expect(a.motivoCancelacion).toBe('01');
      expect(a.canceladoAt).toEqual(n.emitidoAt);
      expect(n.emitidoAt.getTime() - a.emitidoAt.getTime()).toBe(RETRASO_SUSTITUTO_MIN * 60_000);
      expect(n.emitidoAt.getTime()).toBeLessThanOrEqual(AHORA.getTime());
    }
    // Sólo los cancelados de una refacturación llevan motivo.
    const conMotivo = todos.filter((c) => c.motivoCancelacion !== null);
    expect(conMotivo).toHaveLength(sustitutos.length);
  });

  it('F2-107: facturas sin ticket por sucursal, sin cheque ni código, con su llave determinista', () => {
    const manuales = todos.filter((c) => c.origen === 'manual');
    expect(manuales).toHaveLength(SUCURSALES.length * MANUALES_POR_SUCURSAL);
    for (const m of manuales) {
      expect(m.chequeId).toBeNull();
      expect(m.codigoId).toBeNull();
      expect(m.estado).toBe('vigente');
      expect(m.subtotal.plus(m.iva).toFixed(2)).toBe(m.total.toFixed(2));
      expect(m.total.gte(150)).toBe(true);
      expect(m.total.lt(3000)).toBe(true);
      expect(m.emitidoAt.getTime()).toBeLessThan(AHORA.getTime());
    }
    expect(manuales.map((m) => m.solicitudId).sort()).toEqual(
      SUCURSALES.flatMap((s) =>
        Array.from({ length: MANUALES_POR_SUCURSAL }, (_, i) => solicitudManualSeed(s.id, i)),
      ).sort(),
    );
    expect(todos.filter((c) => c.origen === 'ticket')).toHaveLength(todos.length - manuales.length);
  });

  it('el total es el del cheque y subtotal + IVA = total (misma regla que la emisión)', () => {
    for (const c of cfdis) {
      const cheque = deCheque.get(c.chequeId!)!;
      expect(c.total.toFixed(2)).toBe(cheque.total.toFixed(2));
      expect(c.subtotal.plus(c.iva).toFixed(2)).toBe(c.total.toFixed(2));
      expect(c.formaPago).toBe(formaPagoSat(cheque.pagos, CATALOGO_FORMAS_SEED));
      expect(c.sucursalId).toBe(cheque.sucursalId);
    }
  });

  it('se emite después del cierre, antes de que venza el código y nunca en el futuro', () => {
    const vence = new Map(codigosSeed.map((k) => [k.id, k.expiraAt.getTime()]));
    for (const c of cfdis.filter((x) => x.sustituyeAId === null)) {
      const cierre = deCheque.get(c.chequeId!)!.cerradoAt!.getTime();
      expect(c.emitidoAt.getTime()).toBeGreaterThanOrEqual(cierre);
      // El anterior de una refacturación ya soltó el código: se mide contra el de su cheque.
      const codigo = codigosSeed.find((k) => k.chequeId === c.chequeId)!;
      expect(c.emitidoAt.getTime()).toBeLessThan(vence.get(codigo.id)!);
      expect(c.emitidoAt.getTime()).toBeLessThanOrEqual(AHORA.getTime());
    }
  });

  it('folios consecutivos desde `folioInicial` en orden de emisión; UUID únicos', () => {
    const conOtroInicio = generarCfdisSeed(CODIGOS, { ...OPCIONES, folioInicial: 101 }, SUCURSALES);
    expect(conOtroInicio.map((c) => c.folio)).toEqual(todos.map((_, i) => 101 + i));
    for (let i = 1; i < todos.length; i++) {
      expect(todos[i].emitidoAt.getTime()).toBeGreaterThanOrEqual(todos[i - 1].emitidoAt.getTime());
    }
    expect(new Set(todos.map((c) => c.uuid)).size).toBe(todos.length);
    expect(new Set(todos.map((c) => c.id)).size).toBe(todos.length);
  });

  it(`~${PORCENTAJE_CANCELADO} % cancelados, el resto vigentes, ninguno en timbrando`, () => {
    const cancelados = cfdis.filter((c) => c.estado === 'cancelado').length;
    expect(cancelados).toBeGreaterThan(0);
    expect(cancelados / cfdis.length).toBeLessThan(0.16);
    expect(cfdis.every((c) => c.estado === 'vigente' || c.estado === 'cancelado')).toBe(true);
  });

  it('determinista: la misma entrada da exactamente lo mismo', () => {
    expect(generarCfdisSeed(CODIGOS, OPCIONES, SUCURSALES)).toEqual(todos);
  });

  it('truena si un código facturado no tiene forma de pago SAT (seed-codigos lo impide)', () => {
    const malo = CODIGOS.find((k) => k.estado === 'facturado')!;
    const sinPagos = { ...malo, cheque: { ...malo.cheque, pagos: [] } };
    expect(() => generarCfdisSeed([sinPagos], OPCIONES)).toThrow(/sin forma de pago SAT/);
  });

  it('archivos: XML y PDF del PAC falso en la clave de F2-105, con el UUID', () => {
    const c = cfdis[0];
    const cheque = deCheque.get(c.chequeId!)!;
    const [xml, pdf] = archivosDe(c, {
      perfil: PERFIL,
      zona: ZONAS.get(c.sucursalId)!,
      folioTicket: cheque.folio,
    });
    expect(xml.clave).toMatch(new RegExp(`^cfdi/${FX.empresaA}/\\d{4}/\\d{2}/${c.uuid}\\.xml$`));
    expect(pdf.clave).toBe(xml.clave.replace(/\.xml$/, '.pdf'));
    expect(xml.contenido.toString('utf8')).toContain(`UUID="${c.uuid}"`);
    expect(xml.contenido.toString('utf8')).toContain(`NoIdentificacion="${cheque.folio}"`);
    expect(pdf.contenido.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  });

  it('F2-107: el XML del sustituto trae la relación 04 con el anterior; el manual, sin ticket', () => {
    const n = todos.find((c) => c.sustituyeAId !== null)!;
    const [xmlN] = archivosDe(n, {
      perfil: PERFIL,
      zona: ZONAS.get(n.sucursalId)!,
      folioTicket: 'T',
    });
    expect(xmlN.contenido.toString('utf8')).toContain(
      `<cfdi:CfdiRelacionados TipoRelacion="04"><cfdi:CfdiRelacionado UUID="${n.relacionadoUuid}"/>`,
    );
    const m = todos.find((c) => c.origen === 'manual')!;
    const [xmlM] = archivosDe(m, {
      perfil: PERFIL,
      zona: ZONAS.get(m.sucursalId)!,
      folioTicket: null,
    });
    expect(xmlM.contenido.toString('utf8')).not.toContain('NoIdentificacion');
    expect(xmlM.contenido.toString('utf8')).not.toContain('CfdiRelacionados');
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
    expect(r).toEqual({
      cfdis: 0,
      cancelados: 0,
      refacturados: 0,
      manuales: 0,
      sinArchivos: 0,
      sinPerfil: true,
    });
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
    const sucursalesA = await prisma.sucursal.count({ where: { empresaId: FX.empresaA } });
    // F2-107: uno por facturado + el anterior de cada refacturación + las manuales.
    expect(r.refacturados).toBeGreaterThan(0);
    expect(r.manuales).toBe(sucursalesA * MANUALES_POR_SUCURSAL);
    expect(r.cfdis).toBe(facturados + r.refacturados + r.manuales);
    expect(r.sinArchivos).toBe(0);
    const primera = await leer();
    expect(primera).toHaveLength(r.cfdis);
    expect(primera.filter((c) => c.origen === 'manual' && c.chequeId === null)).toHaveLength(
      r.manuales,
    );
    expect(primera.filter((c) => c.sustituyeAId !== null && c.tipoRelacion === '04')).toHaveLength(
      r.refacturados,
    );
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
