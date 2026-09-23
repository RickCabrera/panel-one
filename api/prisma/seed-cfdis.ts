import { createHash } from 'node:crypto';

import { Prisma, type PrismaClient } from '@prisma/client';

import type { PuertoArchivos } from '../src/adaptadores/archivos/puerto';
import {
  pdfCfdiFalso,
  uuidDeterminista,
  xmlCfdiFalso,
} from '../src/adaptadores/timbrado/timbrado-falso';
import {
  formaPagoSat,
  importesDeTotal,
  solicitudDesdeCheque,
  type FormaPagoEnum,
} from '../src/facturacion/cfdi';
import { claveArchivoCfdi, TIPO_PDF, TIPO_XML } from '../src/facturacion/entrega';
import { uuidDe } from './seed-alertas';

/**
 * Los CFDI del seed (F2-106): uno por cada código `facturado` de los cheques SINTÉTICOS del seed,
 * como los habría dejado la emisión por el portal con el PAC FALSO. Sin ellos el tablero de
 * facturación mentiría (~15 % de códigos `facturado` sin factura detrás).
 *
 * - PURO y determinista (`generarCfdisSeed`): todo sale de hashes del id del código, nunca de azar.
 * - `emitido_at` = cierre + un retraso de 10 min a 3 días, acotado a ANTES de que venza el código y
 *   a no pasar de `ahora` (el seed no inventa futuro).
 * - ~8 % quedan `cancelado` (el código se queda `facturado`: qué le pasa al código al cancelar es de
 *   F2-109). Ninguno en `timbrando`: una reserva colgada no es un dato de demo.
 * - Receptores: RFC de PRUEBA publicados por el SAT, con correos `@ejemplo.test`. No son de nadie.
 * - Serie del perfil fiscal y folios consecutivos por orden de emisión, desde el mayor folio de un
 *   CFDI que NO es del seed + 1; al final `folio_actual` del perfil sube a lo usado, para que una
 *   emisión real en desarrollo no choque con el único `(empresa, serie, folio)`.
 * - Importes con la MISMA regla que la emisión (`importesDeTotal`): el total del CFDI es el del
 *   cheque.
 * - XML y PDF: los del PAC falso (`xmlCfdiFalso`/`pdfCfdiFalso`), guardados por `PuertoArchivos` en
 *   la clave de F2-105. Si el puerto falla, el CFDI queda sin clave (como en producción) y se avisa.
 */

export const PORCENTAJE_CANCELADO = 8;
const MIN_RETRASO_MIN = 10;
const MAX_RETRASO_MIN = 3 * 24 * 60;

export const RECEPTORES_CFDI_SEED = [
  {
    rfc: 'EKU9003173C9',
    razonSocial: 'ESCUELA KEMPER URGATE',
    regimenFiscal: '601',
    cp: '42501',
    usoCfdi: 'G03',
    email: 'facturas.kemper@ejemplo.test',
  },
  {
    rfc: 'XIA190128J61',
    razonSocial: 'XENON INDUSTRIAL ARTICLES',
    regimenFiscal: '601',
    cp: '76343',
    usoCfdi: 'G03',
    email: 'cuentas.xenon@ejemplo.test',
  },
  {
    rfc: 'IIA040805DZ4',
    razonSocial: 'INDISTRIA ILUMINADORA DE ALMACENES',
    regimenFiscal: '601',
    cp: '62661',
    usoCfdi: 'G03',
    email: 'pagos.iia@ejemplo.test',
  },
  {
    rfc: 'CACX7605101P8',
    razonSocial: 'XOCHILT CASAS CHAVEZ',
    regimenFiscal: '612',
    cp: '36257',
    usoCfdi: 'G03',
    email: 'xochilt.casas@ejemplo.test',
  },
  {
    rfc: 'URE180429TM6',
    razonSocial: 'UNIVERSIDAD ROBOTICA ESPAÑOLA',
    regimenFiscal: '601',
    cp: '86991',
    usoCfdi: 'G03',
    email: 'facturacion.ure@ejemplo.test',
  },
] as const;

export interface CodigoParaCfdi {
  id: string;
  estado: string;
  expiraAt: Date;
  cheque: {
    id: string;
    sucursalId: string;
    empresaId: string;
    folio: string;
    total: Prisma.Decimal;
    cerradoAt: Date | null;
    pagos: ReadonlyArray<{ formaRaw: string; monto: Prisma.Decimal }>;
  };
}

export interface PerfilParaCfdi {
  id: string;
  serie: string;
  rfc: string;
  razonSocial: string;
  regimenFiscal: string;
  cp: string;
}

export interface OpcionesCfdis {
  perfil: PerfilParaCfdi;
  zonas: ReadonlyMap<string, string>;
  catalogoFormas: ReadonlyMap<string, FormaPagoEnum>;
  ahora: Date;
  /** El primer folio que se puede usar (mayor folio de un CFDI que no es del seed + 1). */
  folioInicial: number;
}

export interface CfdiSeed {
  id: string;
  empresaId: string;
  sucursalId: string;
  chequeId: string;
  codigoId: string;
  perfilFiscalId: string;
  serie: string;
  folio: number;
  uuid: string;
  idPac: string;
  receptor: (typeof RECEPTORES_CFDI_SEED)[number];
  formaPago: string;
  subtotal: Prisma.Decimal;
  iva: Prisma.Decimal;
  total: Prisma.Decimal;
  estado: 'vigente' | 'cancelado';
  emitidoAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function hash(texto: string): Buffer {
  return createHash('sha256').update(texto).digest();
}

export function generarCfdisSeed(
  codigos: readonly CodigoParaCfdi[],
  op: OpcionesCfdis,
): CfdiSeed[] {
  const sinFolio = codigos
    .filter((c) => c.estado === 'facturado')
    .map((c) => {
      const cierre = c.cheque.cerradoAt;
      if (cierre === null) throw new Error(`Seed de CFDI: el cheque ${c.cheque.id} no tiene cierre.`);
      const formaPago = formaPagoSat(c.cheque.pagos, op.catalogoFormas);
      if (formaPago === null) {
        // `seed-codigos.ts` no marca `facturado` un cheque que no se factura en línea.
        throw new Error(`Seed de CFDI: el código ${c.id} está facturado sin forma de pago SAT.`);
      }
      const h = hash(`cfdi-seed:${c.id}`);
      const retrasoMin =
        MIN_RETRASO_MIN + (h.readUInt32BE(0) % (MAX_RETRASO_MIN - MIN_RETRASO_MIN + 1));
      const emitido = Math.max(
        cierre.getTime(),
        Math.min(
          cierre.getTime() + retrasoMin * 60_000,
          c.expiraAt.getTime() - 60_000,
          op.ahora.getTime(),
        ),
      );
      const id = uuidDe(`cfdi-seed:${c.id}`);
      const uuid = uuidDeterminista(id);
      return {
        id,
        empresaId: c.cheque.empresaId,
        sucursalId: c.cheque.sucursalId,
        chequeId: c.cheque.id,
        codigoId: c.id,
        perfilFiscalId: op.perfil.id,
        serie: op.perfil.serie,
        uuid,
        idPac: uuid,
        receptor: RECEPTORES_CFDI_SEED[h[4] % RECEPTORES_CFDI_SEED.length],
        formaPago,
        ...importesDeTotal(c.cheque.total),
        estado: h[5] % 100 < PORCENTAJE_CANCELADO ? ('cancelado' as const) : ('vigente' as const),
        emitidoAt: new Date(emitido),
      };
    })
    .sort((a, b) => a.emitidoAt.getTime() - b.emitidoAt.getTime() || (a.id < b.id ? -1 : 1));
  return sinFolio.map((c, i) => ({
    ...c,
    folio: op.folioInicial + i,
    createdAt: c.emitidoAt,
    updatedAt: c.emitidoAt,
  }));
}

/** El XML y el PDF del PAC falso de un CFDI del seed, con sus claves de F2-105. */
export function archivosDe(
  c: CfdiSeed,
  op: { perfil: PerfilParaCfdi; zona: string; folioTicket: string; totalCheque: Prisma.Decimal },
): Array<{ clave: string; contenido: Buffer; tipo: string }> {
  const solicitud = solicitudDesdeCheque({
    reservaId: c.id,
    serie: c.serie,
    folio: c.folio,
    fecha: c.emitidoAt,
    emisor: op.perfil,
    sucursal: { zonaHoraria: op.zona },
    cheque: { folio: op.folioTicket, total: op.totalCheque },
    receptor: c.receptor,
    formaPago: c.formaPago,
  });
  return [
    {
      clave: claveArchivoCfdi(c.empresaId, c.uuid, c.emitidoAt, op.zona, 'xml'),
      contenido: Buffer.from(xmlCfdiFalso(solicitud, c.uuid, c.emitidoAt), 'utf8'),
      tipo: TIPO_XML,
    },
    {
      clave: claveArchivoCfdi(c.empresaId, c.uuid, c.emitidoAt, op.zona, 'pdf'),
      contenido: pdfCfdiFalso(solicitud, c.uuid),
      tipo: TIPO_PDF,
    },
  ];
}

export interface ResultadoSembrarCfdis {
  cfdis: number;
  cancelados: number;
  sinArchivos: number;
  /** Sin perfil fiscal no hay emisor: no se siembra nada. */
  sinPerfil: boolean;
}

/**
 * Persiste los CFDI del seed de la empresa (sólo de cheques del seed, `folio_sr` con `prefijo`).
 * Corre DESPUÉS de `sembrarVentas` (códigos) y `sembrarFacturacion` (perfil). Idempotente: borra y
 * vuelve a crear los del seed con los mismos ids, folios, fechas y archivos.
 */
export async function sembrarCfdis(
  prisma: PrismaClient,
  op: {
    empresaId: string;
    prefijo: string;
    ahora: Date;
    catalogoFormas: ReadonlyMap<string, FormaPagoEnum>;
    archivos: PuertoArchivos | null;
  },
): Promise<ResultadoSembrarCfdis> {
  const perfil = await prisma.perfilFiscal.findFirst({
    where: { empresaId: op.empresaId },
    select: { id: true, serie: true, rfc: true, razonSocial: true, regimenFiscal: true, cp: true },
  });
  if (!perfil) return { cfdis: 0, cancelados: 0, sinArchivos: 0, sinPerfil: true };

  const delSeed = { cheque: { folioSr: { startsWith: op.prefijo } } };
  const codigos = await prisma.codigoFacturacion.findMany({
    where: { empresaId: op.empresaId, estado: 'facturado', ...delSeed },
    select: {
      id: true,
      estado: true,
      expiraAt: true,
      cheque: {
        select: {
          id: true,
          sucursalId: true,
          empresaId: true,
          folio: true,
          total: true,
          cerradoAt: true,
          pagos: { select: { formaRaw: true, monto: true } },
        },
      },
    },
  });
  const sucursales = await prisma.sucursal.findMany({
    where: { empresaId: op.empresaId },
    select: { id: true, zonaHoraria: true },
  });
  const zonas = new Map(sucursales.map((s) => [s.id, s.zonaHoraria]));
  const otros = await prisma.cfdi.aggregate({
    where: { empresaId: op.empresaId, serie: perfil.serie, NOT: delSeed },
    _max: { folio: true },
  });
  const cfdis = generarCfdisSeed(codigos, {
    perfil,
    zonas,
    catalogoFormas: op.catalogoFormas,
    ahora: op.ahora,
    folioInicial: (otros._max.folio ?? 0) + 1,
  });

  // Archivos ANTES de las filas: así cada fila nace con las claves que SÍ se guardaron.
  const cheques = new Map(codigos.map((c) => [c.cheque.id, c.cheque]));
  const claves = new Map<string, { xml: string | null; pdf: string | null }>();
  let sinArchivos = 0;
  for (const c of cfdis) {
    const cheque = cheques.get(c.chequeId)!;
    const [xml, pdf] = archivosDe(c, {
      perfil,
      zona: zonas.get(c.sucursalId)!,
      folioTicket: cheque.folio,
      totalCheque: cheque.total,
    });
    let guardadas: { xml: string | null; pdf: string | null } = { xml: null, pdf: null };
    if (op.archivos) {
      try {
        await op.archivos.guardar(xml.clave, xml.contenido, xml.tipo);
        await op.archivos.guardar(pdf.clave, pdf.contenido, pdf.tipo);
        guardadas = { xml: xml.clave, pdf: pdf.clave };
      } catch {
        guardadas = { xml: null, pdf: null };
      }
    }
    if (guardadas.xml === null) sinArchivos++;
    claves.set(c.id, guardadas);
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.cfdiEnvio.deleteMany({ where: { empresaId: op.empresaId, cfdi: delSeed } });
      await tx.cfdi.deleteMany({ where: { empresaId: op.empresaId, ...delSeed } });
      await tx.cfdi.createMany({
        data: cfdis.map((c) => ({
          ...c,
          receptor: { ...c.receptor },
          xmlClave: claves.get(c.id)!.xml,
          pdfClave: claves.get(c.id)!.pdf,
        })),
      });
      if (cfdis.length > 0) {
        const ultimo = cfdis[cfdis.length - 1].folio;
        await tx.perfilFiscal.updateMany({
          where: { id: perfil.id, folioActual: { lt: ultimo } },
          data: { folioActual: ultimo },
        });
      }
    },
    { timeout: 60_000 },
  );
  return {
    cfdis: cfdis.length,
    cancelados: cfdis.filter((c) => c.estado === 'cancelado').length,
    sinArchivos,
    sinPerfil: false,
  };
}
