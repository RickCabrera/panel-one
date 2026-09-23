import { Prisma, type PrismaClient } from '@prisma/client';

import type { PuertoArchivos } from '../src/adaptadores/archivos/puerto';
import {
  pdfCfdiFalso,
  uuidDeterminista,
  xmlCfdiFalso,
} from '../src/adaptadores/timbrado/timbrado-falso';
import type { FormaPagoEnum } from '../src/facturacion/cfdi';
import { esFacturable, estadoPublico } from '../src/facturacion/codigo';
import { claveArchivoCfdi, TIPO_PDF, TIPO_XML } from '../src/facturacion/entrega';
import {
  formaPagoGlobal,
  importesGlobal,
  periodoDe,
  receptorPublicoGeneral,
  solicitudGlobal,
  type PeriodoGlobal,
} from '../src/facturacion/global';
import { uuidDe } from './seed-alertas';

/**
 * Las FACTURAS GLOBALES del seed (F2-108), como las habría dejado la emisión con el PAC FALSO, para
 * que la pestaña de la global, el portal (`en_global` con su periodo) y el tablero (cifra `global`)
 * tengan qué mostrar.
 *
 * - PURO y determinista (`generarGlobalesSeed`): ids de hashes (sucursal + periodo), nunca azar.
 * - Por sucursal, MENSUALES: una global vigente por cada mes `lista` (terminado, con tickets
 *   expirados y NINGUNO todavía autofacturable) EXCEPTO el más reciente, que se queda `lista` para
 *   verlo en la vista previa y emitirlo en demo. El juez es `estadoPublico`, como en la emisión.
 * - Emitida `RETRASO_EMISION_H` horas después de que termina el mes (sin pasar de `ahora`).
 * - Folios DESPUÉS de todos los de la serie (el seed de CFDI ya corrió) y `folio_actual` sube.
 * - Sus tickets pasan a `en_global` y cada uno queda en `cfdi_global_codigos`.
 * - XML/PDF del PAC falso por `PuertoArchivos`, como en `seed-cfdis.ts`.
 *
 * Idempotencia: `sembrarVentas` BORRA las globales del seed (las que amparan tickets del seed de
 * esas sucursales) antes de recrear los códigos; aquí se vuelven a crear con los mismos ids.
 */

export const RETRASO_EMISION_H = 2;

export interface CodigoParaGlobal {
  id: string;
  estado: 'pendiente' | 'facturado' | 'en_global' | 'expirado';
  expiraAt: Date;
  cfdi: { estado: 'timbrando' | 'vigente' | 'cancelado' } | null;
  cheque: {
    folio: string;
    cerradoAt: Date | null;
    cancelado: boolean;
    total: Prisma.Decimal;
    pagos: ReadonlyArray<{ formaRaw: string; monto: Prisma.Decimal }>;
  };
}

export interface SucursalParaGlobal {
  id: string;
  empresaId: string;
  zonaHoraria: string;
  codigos: readonly CodigoParaGlobal[];
}

export interface GlobalSeed {
  id: string;
  empresaId: string;
  sucursalId: string;
  zona: string;
  periodo: PeriodoGlobal;
  uuid: string;
  emitidoAt: Date;
  formaPago: string;
  tickets: { codigoId: string; folio: string; total: Prisma.Decimal }[];
  importes: { subtotal: Prisma.Decimal; iva: Prisma.Decimal; total: Prisma.Decimal };
}

/** Los meses a globalizar de cada sucursal, en orden de emisión. */
export function generarGlobalesSeed(
  sucursales: readonly SucursalParaGlobal[],
  op: { ahora: Date; catalogoFormas: ReadonlyMap<string, FormaPagoEnum> },
): GlobalSeed[] {
  const salida: GlobalSeed[] = [];
  for (const suc of [...sucursales].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    const meses = new Map<
      string,
      { periodo: PeriodoGlobal; incluidos: CodigoParaGlobal[]; vigentes: number }
    >();
    for (const c of suc.codigos) {
      if (c.cheque.cerradoAt === null) continue;
      const periodo = periodoDe(c.cheque.cerradoAt, suc.zonaHoraria, 'mensual');
      let m = meses.get(periodo.clave);
      if (!m) {
        m = { periodo, incluidos: [], vigentes: 0 };
        meses.set(periodo.clave, m);
      }
      const estado = estadoPublico({ ...c, global: null }, c.cheque, op.ahora.getTime());
      if (estado === 'expirado' && esFacturable(c.cheque)) m.incluidos.push(c);
      else if (estado === 'pendiente') m.vigentes++;
    }
    const listos = [...meses.values()]
      .filter(
        (m) =>
          m.periodo.hasta.getTime() <= op.ahora.getTime() &&
          m.vigentes === 0 &&
          m.incluidos.length > 0,
      )
      .sort((a, b) => (a.periodo.clave < b.periodo.clave ? -1 : 1));
    // El mes `lista` más reciente se queda sin global: es el que se ve en la vista previa.
    for (const m of listos.slice(0, -1)) {
      const formaPago = formaPagoGlobal(
        m.incluidos.flatMap((c) => c.cheque.pagos),
        op.catalogoFormas,
      );
      if (formaPago === null) continue;
      const incluidos = [...m.incluidos].sort(
        (a, b) =>
          a.cheque.cerradoAt!.getTime() - b.cheque.cerradoAt!.getTime() || (a.id < b.id ? -1 : 1),
      );
      const tickets = incluidos.map((c) => ({
        codigoId: c.id,
        folio: c.cheque.folio,
        total: c.cheque.total,
      }));
      const id = uuidDe(`global-seed:${suc.id}:${m.periodo.clave}`);
      salida.push({
        id,
        empresaId: suc.empresaId,
        sucursalId: suc.id,
        zona: suc.zonaHoraria,
        periodo: m.periodo,
        uuid: uuidDeterminista(id),
        emitidoAt: new Date(
          Math.min(m.periodo.hasta.getTime() + RETRASO_EMISION_H * 3_600_000, op.ahora.getTime()),
        ),
        formaPago,
        tickets,
        importes: importesGlobal(tickets),
      });
    }
  }
  return salida.sort(
    (a, b) => a.emitidoAt.getTime() - b.emitidoAt.getTime() || (a.id < b.id ? -1 : 1),
  );
}

export interface ResultadoSembrarGlobales {
  globales: number;
  tickets: number;
  sinArchivos: number;
  sinPerfil: boolean;
}

/**
 * Persiste las globales del seed de la empresa. Corre DESPUÉS de `sembrarVentas` (que borró las
 * globales del seed y recreó los códigos), `sembrarFacturacion` (perfil) y `sembrarCfdis` (folios).
 */
export async function sembrarGlobales(
  prisma: PrismaClient,
  op: {
    empresaId: string;
    prefijo: string;
    ahora: Date;
    catalogoFormas: ReadonlyMap<string, FormaPagoEnum>;
    archivos: PuertoArchivos | null;
  },
): Promise<ResultadoSembrarGlobales> {
  const perfil = await prisma.perfilFiscal.findFirst({
    where: { empresaId: op.empresaId },
    select: { id: true, serie: true, rfc: true, razonSocial: true, regimenFiscal: true, cp: true },
  });
  if (!perfil) return { globales: 0, tickets: 0, sinArchivos: 0, sinPerfil: true };

  const sucursales = await prisma.sucursal.findMany({
    where: { empresaId: op.empresaId },
    select: { id: true, empresaId: true, zonaHoraria: true },
    orderBy: { id: 'asc' },
  });
  const conCodigos: SucursalParaGlobal[] = [];
  for (const s of sucursales) {
    const codigos = await prisma.codigoFacturacion.findMany({
      where: {
        empresaId: op.empresaId,
        sucursalId: s.id,
        global: null,
        cheque: { folioSr: { startsWith: op.prefijo } },
      },
      select: {
        id: true,
        estado: true,
        expiraAt: true,
        cfdi: { select: { estado: true } },
        cheque: {
          select: {
            folio: true,
            cerradoAt: true,
            cancelado: true,
            total: true,
            pagos: { select: { formaRaw: true, monto: true }, orderBy: { id: 'asc' } },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
    conCodigos.push({ ...s, codigos });
  }
  const globales = generarGlobalesSeed(conCodigos, {
    ahora: op.ahora,
    catalogoFormas: op.catalogoFormas,
  });
  if (globales.length === 0) return { globales: 0, tickets: 0, sinArchivos: 0, sinPerfil: false };

  const maximo = await prisma.cfdi.aggregate({
    where: { empresaId: op.empresaId, serie: perfil.serie },
    _max: { folio: true },
  });
  const folioInicial = (maximo._max.folio ?? 0) + 1;

  const claves = new Map<string, { xml: string | null; pdf: string | null }>();
  let sinArchivos = 0;
  for (const [i, g] of globales.entries()) {
    claves.set(g.id, { xml: null, pdf: null });
    const solicitud = solicitudGlobal({
      reservaId: g.id,
      serie: perfil.serie,
      folio: folioInicial + i,
      fecha: g.emitidoAt,
      emisor: perfil,
      sucursal: { zonaHoraria: g.zona },
      informacion: g.periodo.informacion,
      tickets: g.tickets,
      formaPago: g.formaPago,
    });
    const xml = claveArchivoCfdi(g.empresaId, g.uuid, g.emitidoAt, g.zona, 'xml');
    const pdf = claveArchivoCfdi(g.empresaId, g.uuid, g.emitidoAt, g.zona, 'pdf');
    if (op.archivos) {
      try {
        await op.archivos.guardar(
          xml,
          Buffer.from(xmlCfdiFalso(solicitud, g.uuid, g.emitidoAt), 'utf8'),
          TIPO_XML,
        );
        await op.archivos.guardar(pdf, pdfCfdiFalso(solicitud, g.uuid), TIPO_PDF);
        claves.set(g.id, { xml, pdf });
      } catch {
        claves.set(g.id, { xml: null, pdf: null });
      }
    }
    if (claves.get(g.id)!.xml === null) sinArchivos++;
  }

  await prisma.$transaction(
    async (tx) => {
      await tx.cfdi.createMany({
        data: globales.map((g, i) => ({
          id: g.id,
          empresaId: g.empresaId,
          sucursalId: g.sucursalId,
          chequeId: null,
          codigoId: null,
          perfilFiscalId: perfil.id,
          serie: perfil.serie,
          folio: folioInicial + i,
          uuid: g.uuid,
          idPac: g.uuid,
          receptor: receptorPublicoGeneral(perfil.cp),
          formaPago: g.formaPago,
          subtotal: g.importes.subtotal,
          iva: g.importes.iva,
          total: g.importes.total,
          estado: 'vigente' as const,
          emitidoAt: g.emitidoAt,
          origen: 'global' as const,
          globalPeriodicidad: g.periodo.informacion.periodicidad,
          globalMeses: g.periodo.informacion.meses,
          globalAnio: g.periodo.informacion.anio,
          globalDesde: g.periodo.desde,
          globalHasta: g.periodo.hasta,
          xmlClave: claves.get(g.id)!.xml,
          pdfClave: claves.get(g.id)!.pdf,
          createdAt: g.emitidoAt,
          updatedAt: g.emitidoAt,
        })),
      });
      await tx.cfdiGlobalCodigo.createMany({
        data: globales.flatMap((g) =>
          g.tickets.map((t) => ({
            id: uuidDe(`global-seed-ticket:${t.codigoId}`),
            empresaId: g.empresaId,
            sucursalId: g.sucursalId,
            cfdiId: g.id,
            codigoId: t.codigoId,
            total: t.total,
            createdAt: g.emitidoAt,
          })),
        ),
      });
      for (const g of globales) {
        await tx.codigoFacturacion.updateMany({
          where: {
            empresaId: g.empresaId,
            sucursalId: g.sucursalId,
            id: { in: g.tickets.map((t) => t.codigoId) },
          },
          data: { estado: 'en_global', updatedAt: g.emitidoAt },
        });
      }
      const ultimo = folioInicial + globales.length - 1;
      await tx.perfilFiscal.updateMany({
        where: { id: perfil.id, folioActual: { lt: ultimo } },
        data: { folioActual: ultimo },
      });
    },
    { timeout: 60_000 },
  );
  return {
    globales: globales.length,
    tickets: globales.reduce((n, g) => n + g.tickets.length, 0),
    sinArchivos,
    sinPerfil: false,
  };
}

/**
 * El filtro de las globales DEL SEED de unas sucursales: las `origen = global` de esas sucursales
 * que amparan al menos un ticket del seed. Lo usa `sembrarVentas` para borrarlas (con sus filas, por
 * CASCADE) ANTES de recrear los códigos. Nunca toca una global que no ampare tickets del seed.
 */
export function whereGlobalesSeed(
  sucursalIds: readonly string[],
  prefijo: string,
): Prisma.CfdiWhereInput {
  return {
    origen: 'global',
    sucursalId: { in: [...sucursalIds] },
    globalCodigos: {
      some: {
        sucursalId: { in: [...sucursalIds] },
        codigo: {
          cheque: { sucursalId: { in: [...sucursalIds] }, folioSr: { startsWith: prefijo } },
        },
      },
    },
  };
}
