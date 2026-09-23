import { Prisma } from '@prisma/client';

import type { InformacionGlobal, SolicitudCfdi } from '../adaptadores/timbrado/puerto';
import { fechaLocal, instanteDesdeLocal } from '../comun/fechas';
import { FORMA_PAGO_SAT, formaDominante, importesDeTotal, TASA_IVA, type FormaPagoEnum } from './cfdi';
import type { DatosEmision } from './cfdi';

/**
 * Reglas puras de la FACTURA GLOBAL (F2-108): el CFDI a público en general que ampara los tickets
 * que nadie facturó en su plazo. Sin base y sin red. Dinero en decimal siempre.
 *
 * - Un periodo se corta en la zona de la SUCURSAL (días locales), nunca en la del servidor.
 * - `diaria` = el día local; `mensual` = el mes local; `semanal` = lunes a domingo, CORTADA en el
 *   cambio de mes: una semana que cruza meses son dos periodos, cada uno con su `Meses`.
 *   DECISION PROVISIONAL (nocturno): el Anexo 20 pide UN `Meses` por global; no se ha visto cómo
 *   lo resuelve un contador con SR (docs/esquema-sr.md §2, F2-190).
 * - Un ticket entra a la global SÓLO cuando su código ya no se puede autofacturar (expiró): la
 *   global de un periodo espera a que venzan TODOS sus códigos (`estadoPeriodo`).
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

export type PeriodicidadGlobalEnum = 'diaria' | 'semanal' | 'mensual';
export const PERIODICIDADES_GLOBAL: readonly PeriodicidadGlobalEnum[] = [
  'diaria',
  'semanal',
  'mensual',
];

/** c_Periodicidad del SAT: 01 diario, 02 semanal, 04 mensual. */
export const PERIODICIDAD_SAT: Readonly<
  Record<PeriodicidadGlobalEnum, InformacionGlobal['periodicidad']>
> = {
  diaria: '01',
  semanal: '02',
  mensual: '04',
};

export const PERIODICIDAD_DE_SAT: Readonly<Record<string, PeriodicidadGlobalEnum>> = {
  '01': 'diaria',
  '02': 'semanal',
  '04': 'mensual',
};

/** El receptor de toda global: público en general (RFC genérico, régimen 616, uso S01). */
export const RFC_PUBLICO_GENERAL = 'XAXX010101000';
export const NOMBRE_PUBLICO_GENERAL = 'PUBLICO EN GENERAL';
export const REGIMEN_PUBLICO_GENERAL = '616';
export const USO_PUBLICO_GENERAL = 'S01';

/** Concepto de cada ticket dentro de la global (guía de llenado del SAT para CFDI global). */
export const CONCEPTO_GLOBAL = {
  claveProdServ: '01010101',
  claveUnidad: 'ACT',
  unidad: 'Actividad',
  descripcion: 'Venta',
} as const;

const DIA = /^(\d{4})-(\d{2})-(\d{2})$/;

const MESES_ES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
] as const;

function partes(dia: string): [number, number, number] {
  const m = DIA.exec(dia);
  if (!m) throw new RangeError(`Día inválido: ${dia}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** `dia` + `n` días de calendario (sin zona: aritmética de fechas civiles). */
export function sumarDias(dia: string, n: number): string {
  const [a, m, d] = partes(dia);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Día de la semana ISO: 1 lunes … 7 domingo. */
function diaIso(dia: string): number {
  const [a, m, d] = partes(dia);
  const w = new Date(Date.UTC(a, m - 1, d)).getUTCDay();
  return w === 0 ? 7 : w;
}

function primeroDelMes(dia: string): string {
  return `${dia.slice(0, 7)}-01`;
}

function primeroDelMesSiguiente(dia: string): string {
  const [a, m] = partes(dia);
  return m === 12 ? `${a + 1}-01-01` : `${a}-${String(m + 1).padStart(2, '0')}-01`;
}

/** El primer día (local) del periodo que contiene `dia`. */
export function inicioDePeriodo(dia: string, periodicidad: PeriodicidadGlobalEnum): string {
  partes(dia);
  if (periodicidad === 'diaria') return dia;
  if (periodicidad === 'mensual') return primeroDelMes(dia);
  const lunes = sumarDias(dia, 1 - diaIso(dia));
  const mes = primeroDelMes(dia);
  return lunes < mes ? mes : lunes;
}

/** El primer día DESPUÉS del periodo que empieza en `clave` (exclusivo). */
function finDePeriodo(clave: string, periodicidad: PeriodicidadGlobalEnum): string {
  if (periodicidad === 'diaria') return sumarDias(clave, 1);
  const mesSiguiente = primeroDelMesSiguiente(clave);
  if (periodicidad === 'mensual') return mesSiguiente;
  const lunesSiguiente = sumarDias(clave, 8 - diaIso(clave));
  return lunesSiguiente < mesSiguiente ? lunesSiguiente : mesSiguiente;
}

function fechaEs(dia: string, conAnio = true): string {
  const [a, m, d] = partes(dia);
  return `${d} de ${MESES_ES[m - 1]}${conAnio ? ` de ${a}` : ''}`;
}

export interface PeriodoGlobal {
  periodicidad: PeriodicidadGlobalEnum;
  /** Primer día local del periodo (`AAAA-MM-DD`): lo identifica dentro de la sucursal. */
  clave: string;
  /** Último día local del periodo (inclusive). */
  ultimoDia: string;
  /** Instantes UTC del periodo en la zona de la sucursal; `hasta` es exclusivo. */
  desde: Date;
  hasta: Date;
  /** `InformacionGlobal` del CFDI. */
  informacion: InformacionGlobal;
  /** En español, para personas: "septiembre de 2026", "del 7 al 13 de septiembre de 2026". */
  etiqueta: string;
}

/** Cómo se dice un periodo en español. */
export function etiquetaPeriodo(
  periodicidad: PeriodicidadGlobalEnum,
  clave: string,
  ultimoDia: string,
): string {
  if (periodicidad === 'mensual') {
    const [a, m] = partes(clave);
    return `${MESES_ES[m - 1]} de ${a}`;
  }
  if (clave === ultimoDia) return fechaEs(clave);
  return `del ${partes(clave)[2]} al ${fechaEs(ultimoDia)}`;
}

/**
 * El periodo que EMPIEZA en `clave`, o null si `clave` no es el primer día de un periodo de esa
 * periodicidad (o no se puede ubicar en la zona).
 */
export function periodoDeClave(
  clave: string,
  zona: string,
  periodicidad: PeriodicidadGlobalEnum,
): PeriodoGlobal | null {
  if (!DIA.test(clave)) return null;
  const [a, m, d] = partes(clave);
  // Un día que no existe (31 de febrero) no sobrevive la vuelta por Date.
  if (sumarDias(clave, 0) !== clave || d < 1) return null;
  if (inicioDePeriodo(clave, periodicidad) !== clave) return null;
  const fin = finDePeriodo(clave, periodicidad);
  let desde: Date | null;
  let hasta: Date | null;
  try {
    desde = instanteDesdeLocal(`${clave}T00:00:00`, zona);
    hasta = instanteDesdeLocal(`${fin}T00:00:00`, zona);
  } catch {
    // Una zona que `Intl` no conoce: no hay periodo que ubicar.
    return null;
  }
  if (desde === null || hasta === null) return null;
  const ultimoDia = sumarDias(fin, -1);
  return {
    periodicidad,
    clave,
    ultimoDia,
    desde,
    hasta,
    informacion: {
      periodicidad: PERIODICIDAD_SAT[periodicidad],
      meses: String(m).padStart(2, '0'),
      anio: a,
    },
    etiqueta: etiquetaPeriodo(periodicidad, clave, ultimoDia),
  };
}

/** El día local (`AAAA-MM-DD`) de un instante en la zona. */
export function diaLocal(instante: Date, zona: string): string {
  return fechaLocal(instante, zona).slice(0, 10);
}

/** El periodo que contiene `instante` en la zona de la sucursal. */
export function periodoDe(
  instante: Date,
  zona: string,
  periodicidad: PeriodicidadGlobalEnum,
): PeriodoGlobal {
  const clave = inicioDePeriodo(diaLocal(instante, zona), periodicidad);
  const periodo = periodoDeClave(clave, zona, periodicidad);
  if (periodo === null) throw new RangeError(`No se pudo ubicar el periodo en la zona ${zona}`);
  return periodo;
}

/**
 * El periodo de una global YA emitida, a partir de lo que guarda `cfdis` (periodicidad SAT y
 * `desde`), en la zona de su sucursal. Null si los datos no alcanzan (no debería: hay un CHECK).
 */
export function periodoGuardado(
  global: { globalPeriodicidad: string | null; globalDesde: Date | null },
  zona: string,
): PeriodoGlobal | null {
  const periodicidad =
    global.globalPeriodicidad === null ? undefined : PERIODICIDAD_DE_SAT[global.globalPeriodicidad];
  if (periodicidad === undefined || global.globalDesde === null) return null;
  try {
    return periodoDeClave(diaLocal(global.globalDesde, zona), zona, periodicidad);
  } catch {
    return null;
  }
}

/**
 * El SAT acepta en `InformacionGlobal:Año` el año en curso o el inmediato anterior (se mide en la
 * zona de la sucursal). Un periodo más viejo ya no se puede amparar con una global.
 */
export function anioPermitido(periodo: PeriodoGlobal, ahora: Date, zona: string): boolean {
  const anioActual = Number(diaLocal(ahora, zona).slice(0, 4));
  return periodo.informacion.anio >= anioActual - 1 && periodo.informacion.anio <= anioActual;
}

/** Lo que el SQL de periodos devuelve por DÍA local de cierre (ver `EscrituraFacturacion`). */
export interface DiaGlobal {
  dia: string;
  /** Tickets cuyo código ya expiró (entran a la global). */
  nListos: number;
  totalListos: Prisma.Decimal;
  /** Tickets que el cliente TODAVÍA puede autofacturar (detienen la global del periodo). */
  nVigentes: number;
  /** Hasta cuándo, el último de ellos. */
  vigentesHasta: Date | null;
}

export type EstadoPeriodoGlobal = 'lista' | 'esperando' | 'en_curso' | 'fuera_de_plazo';

export interface ResumenPeriodo {
  periodo: PeriodoGlobal;
  estado: EstadoPeriodoGlobal;
  nListos: number;
  totalListos: Prisma.Decimal;
  nVigentes: number;
  vigentesHasta: Date | null;
  /** Cuántas globales VIGENTES ya tiene este periodo (> 0 = la siguiente es complementaria). */
  globalesPrevias: number;
}

/**
 * El estado de un periodo:
 * - `en_curso`: todavía no termina.
 * - `fuera_de_plazo`: el SAT ya no acepta su año.
 * - `esperando`: terminó, pero hay tickets que el cliente todavía puede autofacturar.
 * - `lista`: terminó, todos sus tickets pendientes ya expiraron y hay al menos uno.
 */
export function estadoPeriodo(
  periodo: PeriodoGlobal,
  cifras: { nListos: number; nVigentes: number },
  ahora: Date,
  zona: string,
): EstadoPeriodoGlobal {
  if (ahora.getTime() < periodo.hasta.getTime()) return 'en_curso';
  if (!anioPermitido(periodo, ahora, zona)) return 'fuera_de_plazo';
  if (cifras.nVigentes > 0) return 'esperando';
  return 'lista';
}

/**
 * Enrolla los días en periodos (más reciente primero). `previas` = cuántas globales vigentes tiene
 * ya cada clave de periodo (para marcar la complementaria).
 */
export function enrollarPeriodos(
  dias: readonly DiaGlobal[],
  zona: string,
  periodicidad: PeriodicidadGlobalEnum,
  ahora: Date,
  previas: ReadonlyMap<string, number> = new Map(),
): ResumenPeriodo[] {
  const porClave = new Map<string, Omit<ResumenPeriodo, 'estado' | 'globalesPrevias'>>();
  for (const d of dias) {
    const clave = inicioDePeriodo(d.dia, periodicidad);
    let r = porClave.get(clave);
    if (!r) {
      const periodo = periodoDeClave(clave, zona, periodicidad);
      if (periodo === null) continue;
      r = { periodo, nListos: 0, totalListos: D(0), nVigentes: 0, vigentesHasta: null };
      porClave.set(clave, r);
    }
    r.nListos += d.nListos;
    r.totalListos = r.totalListos.add(d.totalListos);
    r.nVigentes += d.nVigentes;
    if (d.vigentesHasta && (!r.vigentesHasta || d.vigentesHasta > r.vigentesHasta)) {
      r.vigentesHasta = d.vigentesHasta;
    }
  }
  return [...porClave.values()]
    .map((r) => ({
      ...r,
      estado: estadoPeriodo(r.periodo, r, ahora, zona),
      globalesPrevias: previas.get(r.periodo.clave) ?? 0,
    }))
    .sort((a, b) => (a.periodo.clave < b.periodo.clave ? 1 : -1));
}

/**
 * La c_FormaPago de la global: la forma (efectivo, tarjeta o transferencia) con MAYOR monto sumado
 * entre los pagos de TODOS los tickets incluidos; `otro` no cuenta. Null si ningún pago tiene clave.
 * DECISION PROVISIONAL (nocturno): docs/esquema-sr.md §2 (F2-190).
 */
export function formaPagoGlobal(
  pagos: ReadonlyArray<{ formaRaw: string; monto: Prisma.Decimal }>,
  catalogo: ReadonlyMap<string, FormaPagoEnum>,
): string | null {
  const conClave = pagos.filter((p) => (catalogo.get(p.formaRaw) ?? 'otro') !== 'otro');
  const forma = formaDominante(conClave, catalogo);
  return forma === null || forma === 'otro' ? null : FORMA_PAGO_SAT[forma];
}

export interface TicketGlobal {
  /** El folio que ve el cliente en su ticket: va en `NoIdentificacion`. */
  folio: string;
  total: Prisma.Decimal;
}

/** Subtotal, IVA y total de la global: la SUMA de lo de cada ticket (misma regla que el portal). */
export function importesGlobal(tickets: readonly TicketGlobal[]): {
  subtotal: Prisma.Decimal;
  iva: Prisma.Decimal;
  total: Prisma.Decimal;
} {
  if (tickets.length === 0) throw new Error('Una factura global necesita al menos un ticket.');
  return tickets.reduce(
    (acc, t) => {
      const i = importesDeTotal(t.total);
      return {
        subtotal: acc.subtotal.add(i.subtotal),
        iva: acc.iva.add(i.iva),
        total: acc.total.add(i.total),
      };
    },
    { subtotal: D(0), iva: D(0), total: D(0) },
  );
}

export interface DatosGlobal {
  /** Id de la reserva (`cfdis.id`): el PAC falso deriva de aquí el UUID. */
  reservaId: string;
  serie: string;
  folio: number;
  fecha: Date;
  emisor: DatosEmision['emisor'];
  sucursal: { zonaHoraria: string };
  informacion: InformacionGlobal;
  tickets: readonly TicketGlobal[];
  formaPago: string;
}

/**
 * La solicitud al PAC de una factura global: receptor público en general (domicilio = CP del lugar
 * de expedición), un concepto por ticket (`01010101`, `ACT`, "Venta", `NoIdentificacion` = folio),
 * IVA por concepto a la tasa, `PUE`, MXN e `InformacionGlobal`.
 */
export function solicitudGlobal(d: DatosGlobal): SolicitudCfdi {
  const { subtotal, iva, total } = importesGlobal(d.tickets);
  return {
    referencia: d.reservaId,
    serie: d.serie,
    folio: String(d.folio),
    fecha: d.fecha,
    zonaHoraria: d.sucursal.zonaHoraria,
    formaPago: d.formaPago,
    metodoPago: 'PUE',
    moneda: 'MXN',
    lugarExpedicion: d.emisor.cp,
    emisor: {
      rfc: d.emisor.rfc,
      nombre: d.emisor.razonSocial,
      regimenFiscal: d.emisor.regimenFiscal,
    },
    receptor: {
      rfc: RFC_PUBLICO_GENERAL,
      nombre: NOMBRE_PUBLICO_GENERAL,
      usoCfdi: USO_PUBLICO_GENERAL,
      regimenFiscal: REGIMEN_PUBLICO_GENERAL,
      domicilioFiscal: d.emisor.cp,
    },
    conceptos: d.tickets.map((t) => {
      const i = importesDeTotal(t.total);
      return {
        ...CONCEPTO_GLOBAL,
        noIdentificacion: t.folio,
        cantidad: D(1),
        valorUnitario: i.subtotal,
        importe: i.subtotal,
        objetoImp: '02',
        iva: { base: i.subtotal, tasa: TASA_IVA, importe: i.iva },
      };
    }),
    subtotal,
    totalImpuestosTrasladados: iva,
    total,
    informacionGlobal: { ...d.informacion },
  };
}

/** El receptor que se GUARDA en `cfdis.receptor` de una global (sin correo: no se envía a nadie). */
export function receptorPublicoGeneral(cp: string) {
  return {
    rfc: RFC_PUBLICO_GENERAL,
    razonSocial: NOMBRE_PUBLICO_GENERAL,
    regimenFiscal: REGIMEN_PUBLICO_GENERAL,
    cp,
    usoCfdi: USO_PUBLICO_GENERAL,
    email: null,
  };
}

/** El mensaje público de un ticket que entró a una global, con su periodo. */
export function mensajeEnGlobal(etiqueta: string): string {
  return (
    `Este ticket se incluyó en la factura global del periodo ${etiqueta} y ya no se puede ` +
    'facturar aquí. Si necesitas aclararlo, contacta al restaurante.'
  );
}
