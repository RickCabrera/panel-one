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
  solicitudDeConsumo,
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
 * - ~8 % quedan `cancelado` con motivo 02 y, como lo deja la cancelación real (F2-109), el código
 *   SUELTO: el CFDI sin `codigo_id` y el código de vuelta en `pendiente` (el ticket se puede volver
 *   a facturar, o entra a una global si ya venció). Ninguno en `timbrando`: una reserva colgada no
 *   es un dato de demo.
 * - F2-109: cada cancelado lleva su solicitud `aceptada` en `cfdi_cancelaciones`, y ~1 de cada
 *   `CADA_SOLICITUD_ABIERTA` vigentes de ticket lleva una solicitud 02 `en_proceso` o `rechazada`,
 *   para que la tabla del tablero tenga qué mostrar. Como la cancelación real, una `en_proceso` NO
 *   cambia el CFDI (sigue vigente).
 * - Receptores: RFC de PRUEBA publicados por el SAT, con correos `@ejemplo.test`. No son de nadie.
 * - Serie del perfil fiscal y folios consecutivos por orden de emisión, desde el mayor folio de un
 *   CFDI que NO es del seed + 1; al final `folio_actual` del perfil sube a lo usado, para que una
 *   emisión real en desarrollo no choque con el único `(empresa, serie, folio)`.
 * - Importes con la MISMA regla que la emisión (`importesDeTotal`): el total del CFDI es el del
 *   cheque.
 * - XML y PDF: los del PAC falso (`xmlCfdiFalso`/`pdfCfdiFalso`), guardados por `PuertoArchivos` en
 *   la clave de F2-105. Si el puerto falla, el CFDI queda sin clave (como en producción) y se avisa.
 *
 * F2-107, para que el tablero tenga qué distinguir:
 * - ~1 de cada `CADA_REFACTURACION` facturados (por hash, de los que no salieron cancelados) se
 *   siembra como REFACTURACIÓN: el anterior `cancelado` con motivo 01, `cancelado_at` y SIN código;
 *   el sustituto `vigente` `RETRASO_SUSTITUTO_MIN` después, relación 04, receptor corregido, y el
 *   código del ticket (como lo deja la refacturación real). Si el sustituto caería en el futuro, no
 *   hay par.
 * - `MANUALES_POR_SUCURSAL` facturas SIN TICKET por sucursal (`origen = manual`, sin cheque), con su
 *   `solicitud_id` determinista, días antes de `ahora`.
 * - OJO en modo demo: el PAC falso guarda su estado en memoria y no conoce estos CFDI; refacturar uno
 *   del seed da 409 (`no_encontrado`). Sí se pueden refacturar los que se emitan en la corrida.
 */

export const PORCENTAJE_CANCELADO = 8;
/** F2-109: 1 de cada tantos vigentes de ticket lleva una solicitud de cancelación sin resolver. */
export const CADA_SOLICITUD_ABIERTA = 40;
/** F2-107: 1 de cada tantos facturados vigentes se siembra refacturado. */
export const CADA_REFACTURACION = 30;
export const RETRASO_SUSTITUTO_MIN = 90;
export const MANUALES_POR_SUCURSAL = 2;
/** Días antes de `ahora` en que se emite cada factura manual del seed (a las 13:00 UTC − horas). */
const DIAS_MANUALES = [2, 9] as const;
const FORMAS_MANUALES = ['01', '04', '03'] as const;
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
  chequeId: string | null;
  codigoId: string | null;
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
  origen: 'ticket' | 'manual';
  solicitudId: string | null;
  sustituyeAId: string | null;
  tipoRelacion: '04' | null;
  motivoCancelacion: '01' | '02' | null;
  canceladoAt: Date | null;
}

/** F2-109: la solicitud de cancelación que acompaña a un CFDI del seed. */
export interface CancelacionSeed {
  id: string;
  estado: 'aceptada' | 'en_proceso' | 'rechazada';
  motivo: '01' | '02';
  uuidSustitucion: string | null;
  solicitadaAt: Date;
  resueltaAt: Date | null;
}

/**
 * Un CFDI del seed con lo que hace falta para su XML (el UUID relacionado no es columna) y, desde
 * F2-109, su solicitud de cancelación (tampoco es columna: va a `cfdi_cancelaciones`).
 */
export interface CfdiSeedConRelacion extends CfdiSeed {
  relacionadoUuid: string | null;
  cancelacion: CancelacionSeed | null;
}

/** Lo que `generarCfdisSeed` necesita de cada sucursal para las facturas manuales (F2-107). */
export interface SucursalParaCfdi {
  id: string;
  empresaId: string;
}

function hash(texto: string): Buffer {
  return createHash('sha256').update(texto).digest();
}

/** Un monto determinista de $150.00 a $2,999.99 para una factura manual del seed. */
function totalManualSeed(h: Buffer): Prisma.Decimal {
  const centavos = 15_000 + (h.readUInt32BE(8) % 285_000);
  return new Prisma.Decimal(centavos).div(100);
}

type SinFolio = Omit<CfdiSeedConRelacion, 'folio' | 'createdAt' | 'updatedAt'>;

export function generarCfdisSeed(
  codigos: readonly CodigoParaCfdi[],
  op: OpcionesCfdis,
  sucursales: readonly SucursalParaCfdi[] = [],
): CfdiSeedConRelacion[] {
  const sinFolio: SinFolio[] = [];
  for (const c of codigos.filter((k) => k.estado === 'facturado')) {
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
    const cancelado = h[5] % 100 < PORCENTAJE_CANCELADO;
    const receptor = RECEPTORES_CFDI_SEED[h[4] % RECEPTORES_CFDI_SEED.length];
    // F2-109: cuándo se canceló (1 a 48 h después de emitir, sin pasar de `ahora`).
    const canceladoAt = new Date(
      Math.min(emitido + (1 + (h[10] % 48)) * 3_600_000, op.ahora.getTime()),
    );
    const base: SinFolio = {
      id,
      empresaId: c.cheque.empresaId,
      sucursalId: c.cheque.sucursalId,
      chequeId: c.cheque.id,
      // F2-109: el cancelado (02) suelta el código, como la cancelación real.
      codigoId: cancelado ? null : c.id,
      perfilFiscalId: op.perfil.id,
      serie: op.perfil.serie,
      uuid,
      idPac: uuid,
      receptor,
      formaPago,
      ...importesDeTotal(c.cheque.total),
      estado: cancelado ? 'cancelado' : 'vigente',
      emitidoAt: new Date(emitido),
      origen: 'ticket',
      solicitudId: null,
      sustituyeAId: null,
      tipoRelacion: null,
      motivoCancelacion: cancelado ? '02' : null,
      canceladoAt: cancelado ? canceladoAt : null,
      relacionadoUuid: null,
      cancelacion: cancelado
        ? {
            id: uuidDe(`cfdi-cancelacion-seed:${c.id}`),
            estado: 'aceptada',
            motivo: '02',
            uuidSustitucion: null,
            solicitadaAt: canceladoAt,
            resueltaAt: canceladoAt,
          }
        : null,
    };
    const sustitucion = new Date(emitido + RETRASO_SUSTITUTO_MIN * 60_000);
    const refacturado =
      !cancelado &&
      h.readUInt16BE(6) % CADA_REFACTURACION === 0 &&
      sustitucion.getTime() <= op.ahora.getTime();
    if (!refacturado) {
      // F2-109: algunos vigentes con una solicitud 02 sin resolver (en proceso o rechazada).
      const abierta = !cancelado && h.readUInt16BE(11) % CADA_SOLICITUD_ABIERTA;
      if (abierta === 0 || abierta === 1) {
        const solicitadaAt = new Date(
          Math.max(emitido, op.ahora.getTime() - (2 + (h[13] % 20)) * 3_600_000),
        );
        base.cancelacion = {
          id: uuidDe(`cfdi-cancelacion-seed:${c.id}`),
          estado: abierta === 0 ? 'en_proceso' : 'rechazada',
          motivo: '02',
          uuidSustitucion: null,
          solicitadaAt,
          resueltaAt: abierta === 0 ? null : solicitadaAt,
        };
      }
      sinFolio.push(base);
      continue;
    }
    // F2-107: el anterior queda cancelado (motivo 01) y SIN código; el sustituto se lo queda.
    const idSustituto = uuidDe(`cfdi-seed-sustituto:${c.id}`);
    const uuidSustituto = uuidDeterminista(idSustituto);
    sinFolio.push({
      ...base,
      codigoId: null,
      estado: 'cancelado',
      motivoCancelacion: '01',
      canceladoAt: sustitucion,
      // F2-109: la solicitud 01 aceptada, con el UUID del sustituto.
      cancelacion: {
        id: uuidDe(`cfdi-cancelacion-seed:${c.id}`),
        estado: 'aceptada',
        motivo: '01',
        uuidSustitucion: uuidSustituto,
        solicitadaAt: sustitucion,
        resueltaAt: sustitucion,
      },
    });
    sinFolio.push({
      ...base,
      id: idSustituto,
      uuid: uuidSustituto,
      idPac: uuidSustituto,
      receptor: RECEPTORES_CFDI_SEED[(h[4] + 1) % RECEPTORES_CFDI_SEED.length],
      emitidoAt: sustitucion,
      sustituyeAId: id,
      tipoRelacion: '04',
      relacionadoUuid: uuid,
      cancelacion: null,
    });
  }

  // F2-107: facturas SIN ticket, por sucursal (en orden de id: determinista).
  for (const suc of [...sucursales].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    for (let i = 0; i < MANUALES_POR_SUCURSAL; i++) {
      const h = hash(`cfdi-manual-seed:${suc.id}:${i}`);
      const id = uuidDe(`cfdi-manual-seed:${suc.id}:${i}`);
      const uuid = uuidDeterminista(id);
      const dias = DIAS_MANUALES[i % DIAS_MANUALES.length];
      const emitido = new Date(
        op.ahora.getTime() - dias * 86_400_000 - (1 + (h[0] % 8)) * 3_600_000,
      );
      sinFolio.push({
        id,
        empresaId: suc.empresaId,
        sucursalId: suc.id,
        chequeId: null,
        codigoId: null,
        perfilFiscalId: op.perfil.id,
        serie: op.perfil.serie,
        uuid,
        idPac: uuid,
        receptor: RECEPTORES_CFDI_SEED[h[4] % RECEPTORES_CFDI_SEED.length],
        formaPago: FORMAS_MANUALES[h[5] % FORMAS_MANUALES.length],
        ...importesDeTotal(totalManualSeed(h)),
        estado: 'vigente',
        emitidoAt: emitido,
        origen: 'manual',
        solicitudId: solicitudManualSeed(suc.id, i),
        sustituyeAId: null,
        tipoRelacion: null,
        motivoCancelacion: null,
        canceladoAt: null,
        relacionadoUuid: null,
        cancelacion: null,
      });
    }
  }

  sinFolio.sort((a, b) => a.emitidoAt.getTime() - b.emitidoAt.getTime() || (a.id < b.id ? -1 : 1));
  return sinFolio.map((c, i) => ({
    ...c,
    folio: op.folioInicial + i,
    createdAt: c.emitidoAt,
    updatedAt: c.canceladoAt ?? c.emitidoAt,
  }));
}

/**
 * La fila tal cual va a la tabla: el UUID relacionado sólo sirve para el XML y la cancelación va a
 * su propia tabla (F2-109).
 */
function sinRelacion(c: CfdiSeedConRelacion): CfdiSeed {
  const fila: Partial<CfdiSeedConRelacion> = { ...c };
  delete fila.relacionadoUuid;
  delete fila.cancelacion;
  return fila as CfdiSeed;
}

/** La llave de solicitud de la factura manual `i` del seed de una sucursal (determinista). */
export function solicitudManualSeed(sucursalId: string, i: number): string {
  return uuidDe(`cfdi-manual-seed-solicitud:${sucursalId}:${i}`);
}

/** El XML y el PDF del PAC falso de un CFDI del seed, con sus claves de F2-105. */
export function archivosDe(
  c: CfdiSeedConRelacion,
  op: { perfil: PerfilParaCfdi; zona: string; folioTicket: string | null },
): Array<{ clave: string; contenido: Buffer; tipo: string }> {
  const solicitud = solicitudDeConsumo({
    reservaId: c.id,
    serie: c.serie,
    folio: c.folio,
    fecha: c.emitidoAt,
    emisor: op.perfil,
    sucursal: { zonaHoraria: op.zona },
    total: c.total,
    ...(op.folioTicket !== null ? { noIdentificacion: op.folioTicket } : {}),
    receptor: c.receptor,
    formaPago: c.formaPago,
    ...(c.relacionadoUuid
      ? { relacionados: { tipoRelacion: '04' as const, uuids: [c.relacionadoUuid] } }
      : {}),
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
  /** F2-109: vigentes con una solicitud de cancelación en proceso / rechazada. */
  enProceso: number;
  rechazadas: number;
  /** F2-107: pares de refacturación y facturas sin ticket sembrados. */
  refacturados: number;
  manuales: number;
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
  if (!perfil) {
    return {
      cfdis: 0,
      cancelados: 0,
      enProceso: 0,
      rechazadas: 0,
      refacturados: 0,
      manuales: 0,
      sinArchivos: 0,
      sinPerfil: true,
    };
  }

  const sucursales = await prisma.sucursal.findMany({
    where: { empresaId: op.empresaId },
    select: { id: true, empresaId: true, zonaHoraria: true },
  });
  const solicitudesSeed = sucursales.flatMap((suc) =>
    Array.from({ length: MANUALES_POR_SUCURSAL }, (_, i) => solicitudManualSeed(suc.id, i)),
  );
  // Del seed: los de sus cheques (sustitutos incluidos) y sus facturas manuales.
  const delSeed: Prisma.CfdiWhereInput = {
    OR: [
      { cheque: { folioSr: { startsWith: op.prefijo } } },
      { origen: 'manual', solicitudId: { in: solicitudesSeed } },
    ],
  };
  const deChequesSeed = { cheque: { folioSr: { startsWith: op.prefijo } } };
  // F2-109: re-sembrar sin volver a sembrar las ventas (como el spec) encuentra SUELTOS los códigos
  // que la corrida anterior soltó al cancelar con 02. Se regresan a `facturado` ANTES de leer, para
  // que la entrada sea la misma y el resultado idéntico. En el seed completo `sembrarVentas` ya
  // recrea los códigos y esto no encuentra nada.
  const soltados = await prisma.cfdi.findMany({
    where: {
      empresaId: op.empresaId,
      ...deChequesSeed,
      origen: 'ticket',
      estado: 'cancelado',
      motivoCancelacion: '02',
      codigoId: null,
    },
    select: { chequeId: true },
  });
  if (soltados.length > 0) {
    await prisma.codigoFacturacion.updateMany({
      where: {
        empresaId: op.empresaId,
        estado: 'pendiente',
        chequeId: { in: soltados.map((c) => c.chequeId!) },
      },
      data: { estado: 'facturado' },
    });
  }
  const codigos = await prisma.codigoFacturacion.findMany({
    where: { empresaId: op.empresaId, estado: 'facturado', ...deChequesSeed },
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
  const zonas = new Map(sucursales.map((s) => [s.id, s.zonaHoraria]));
  const otros = await prisma.cfdi.aggregate({
    where: { empresaId: op.empresaId, serie: perfil.serie, NOT: delSeed },
    _max: { folio: true },
  });
  const cfdis = generarCfdisSeed(
    codigos,
    {
      perfil,
      zonas,
      catalogoFormas: op.catalogoFormas,
      ahora: op.ahora,
      folioInicial: (otros._max.folio ?? 0) + 1,
    },
    sucursales,
  );

  // Archivos ANTES de las filas: así cada fila nace con las claves que SÍ se guardaron.
  const cheques = new Map(codigos.map((c) => [c.cheque.id, c.cheque]));
  const claves = new Map<string, { xml: string | null; pdf: string | null }>();
  let sinArchivos = 0;
  for (const c of cfdis) {
    const [xml, pdf] = archivosDe(c, {
      perfil,
      zona: zonas.get(c.sucursalId)!,
      folioTicket: c.chequeId === null ? null : cheques.get(c.chequeId)!.folio,
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
      // Un solo DELETE: la FK del sustituto (NO ACTION) se revisa al final de la sentencia.
      await tx.cfdi.deleteMany({ where: { empresaId: op.empresaId, ...delSeed } });
      await tx.cfdi.createMany({
        data: cfdis.map((c) => ({
          ...sinRelacion(c),
          receptor: { ...c.receptor },
          xmlClave: claves.get(c.id)!.xml,
          pdfClave: claves.get(c.id)!.pdf,
        })),
      });
      // F2-109: sus solicitudes de cancelación (las anteriores cayeron por CASCADE con sus CFDI).
      const conCancelacion = cfdis.filter((c) => c.cancelacion !== null);
      await tx.cfdiCancelacion.createMany({
        data: conCancelacion.map((c) => ({
          id: c.cancelacion!.id,
          empresaId: c.empresaId,
          cfdiId: c.id,
          motivo: c.cancelacion!.motivo,
          uuidSustitucion: c.cancelacion!.uuidSustitucion,
          estado: c.cancelacion!.estado,
          solicitadaAt: c.cancelacion!.solicitadaAt,
          resueltaAt: c.cancelacion!.resueltaAt,
          createdAt: c.cancelacion!.solicitadaAt,
          updatedAt: c.cancelacion!.resueltaAt ?? c.cancelacion!.solicitadaAt,
        })),
      });
      // Y los códigos que sus cancelaciones 02 soltaron vuelven a `pendiente`.
      const sueltos = cfdis
        .filter((c) => c.estado === 'cancelado' && c.motivoCancelacion === '02' && c.chequeId)
        .map((c) => c.chequeId!);
      if (sueltos.length > 0) {
        await tx.codigoFacturacion.updateMany({
          where: { empresaId: op.empresaId, estado: 'facturado', chequeId: { in: sueltos } },
          data: { estado: 'pendiente' },
        });
      }
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
    enProceso: cfdis.filter((c) => c.cancelacion?.estado === 'en_proceso').length,
    rechazadas: cfdis.filter((c) => c.cancelacion?.estado === 'rechazada').length,
    refacturados: cfdis.filter((c) => c.sustituyeAId !== null).length,
    manuales: cfdis.filter((c) => c.origen === 'manual').length,
    sinArchivos,
    sinPerfil: false,
  };
}
