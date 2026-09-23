import { Prisma } from '@prisma/client';

import type { CfdiRelacionados, SolicitudCfdi } from '../adaptadores/timbrado/puerto';

/**
 * Reglas puras de la emisión de un CFDI de consumo (F2-104): de un cheque de Fase 1 a la
 * `SolicitudCfdi` que se le manda al PAC. Sin base y sin red. Dinero en decimal siempre.
 */

const D = (v: Prisma.Decimal.Value) => new Prisma.Decimal(v);

/**
 * Tasa de IVA del consumo.
 * DECISION PROVISIONAL (nocturno): 16 % fija. El backlog la pide "configurable por empresa" (zona
 * fronteriza = 8 %), pero no hay dónde guardarla todavía; queda anotado en docs/esquema-sr.md §2.
 */
export const TASA_IVA = D('0.16');

export const CONCEPTO_CONSUMO = {
  claveProdServ: '90101500',
  claveUnidad: 'E48',
  unidad: 'Servicio',
  descripcion: 'Consumo de alimentos y bebidas',
} as const;

export interface ImportesCfdi {
  subtotal: Prisma.Decimal;
  iva: Prisma.Decimal;
  total: Prisma.Decimal;
}

/**
 * Subtotal e IVA desde el TOTAL del cheque: `subtotal = total / (1 + tasa)` redondeado a centavos
 * (mitad hacia arriba) e `iva = total − subtotal`, así que suman el total al centavo por
 * construcción.
 *
 * DECISION PROVISIONAL (nocturno): la base es `cheques.total` (lo que el cliente pagó; sin propina,
 * según el supuesto de docs/esquema-sr.md §2), NO `subtotal`/`impuestos` del cheque: no se sabe si
 * el subtotal de SR es antes o después del descuento ni si `impuestos` incluye IEPS.
 */
export function importesDeTotal(
  total: Prisma.Decimal,
  tasa: Prisma.Decimal = TASA_IVA,
): ImportesCfdi {
  if (total.lte(0)) throw new Error('Un CFDI de consumo necesita un total mayor que cero.');
  const t = total.toDecimalPlaces(2);
  const subtotal = t.div(tasa.add(1)).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return { subtotal, iva: t.sub(subtotal), total: t };
}

export type FormaPagoEnum = 'efectivo' | 'tarjeta' | 'transferencia' | 'otro';

/**
 * c_FormaPago de las formas de nuestro ENUM que se pueden facturar en línea con `PUE`.
 * DECISION PROVISIONAL (nocturno): `tarjeta` → 04 (crédito). El ENUM no distingue débito (28); se
 * valida con el piloto (F2-190). `otro` no tiene clave: `99` (por definir) no se admite con PUE.
 */
export const FORMA_PAGO_SAT: Readonly<Record<Exclude<FormaPagoEnum, 'otro'>, string>> = {
  efectivo: '01',
  tarjeta: '04',
  transferencia: '03',
};

/** Desempate de la forma dominante: el orden en que se lista el ENUM. */
const ORDEN_FORMAS: readonly FormaPagoEnum[] = ['efectivo', 'tarjeta', 'transferencia', 'otro'];

/**
 * La forma de pago DOMINANTE de un cheque (la de mayor monto sumado), con el catálogo de la empresa
 * (`formas_pago_catalogo`, el mismo criterio que los agregados: texto sin catálogo = `otro`).
 * Empate → el orden del ENUM. Null si el cheque no trae pagos con monto positivo.
 */
export function formaDominante(
  pagos: ReadonlyArray<{ formaRaw: string; monto: Prisma.Decimal }>,
  catalogo: ReadonlyMap<string, FormaPagoEnum>,
): FormaPagoEnum | null {
  const suma = new Map<FormaPagoEnum, Prisma.Decimal>();
  for (const p of pagos) {
    const forma = catalogo.get(p.formaRaw) ?? 'otro';
    suma.set(forma, (suma.get(forma) ?? D(0)).add(p.monto));
  }
  let mejor: FormaPagoEnum | null = null;
  for (const forma of ORDEN_FORMAS) {
    const monto = suma.get(forma);
    if (!monto || monto.lte(0)) continue;
    if (mejor === null || monto.gt(suma.get(mejor)!)) mejor = forma;
  }
  return mejor;
}

/** La clave c_FormaPago del cheque, o null si no se puede facturar en línea (`otro` o sin pagos). */
export function formaPagoSat(
  pagos: ReadonlyArray<{ formaRaw: string; monto: Prisma.Decimal }>,
  catalogo: ReadonlyMap<string, FormaPagoEnum>,
): string | null {
  const forma = formaDominante(pagos, catalogo);
  return forma === null || forma === 'otro' ? null : FORMA_PAGO_SAT[forma];
}

export interface DatosEmision {
  /** Id de la reserva (`cfdis.id`): el PAC falso deriva de aquí el UUID. */
  reservaId: string;
  serie: string;
  folio: number;
  fecha: Date;
  emisor: { rfc: string; razonSocial: string; regimenFiscal: string; cp: string };
  sucursal: { zonaHoraria: string };
  cheque: { folio: string; total: Prisma.Decimal };
  receptor: {
    rfc: string;
    razonSocial: string;
    regimenFiscal: string;
    cp: string;
    usoCfdi: string;
  };
  formaPago: string;
}

/**
 * La solicitud al PAC de un CFDI de consumo: un solo concepto "Consumo de alimentos y bebidas"
 * (90101500, E48) por el subtotal, IVA trasladado a la tasa, `PUE`, MXN, lugar de expedición = CP
 * del perfil fiscal. Es la base de las tres emisiones: ticket (F2-104), sin ticket y sustituto
 * (F2-107).
 */
export interface DatosConsumo {
  /** Id de la reserva (`cfdis.id`): el PAC falso deriva de aquí el UUID. */
  reservaId: string;
  serie: string;
  folio: number;
  fecha: Date;
  emisor: DatosEmision['emisor'];
  sucursal: { zonaHoraria: string };
  total: Prisma.Decimal;
  /** El folio del ticket; ausente en una factura sin ticket. */
  noIdentificacion?: string;
  receptor: DatosEmision['receptor'];
  formaPago: string;
  relacionados?: CfdiRelacionados;
}

export function solicitudDeConsumo(d: DatosConsumo): SolicitudCfdi {
  const { subtotal, iva, total } = importesDeTotal(d.total);
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
      rfc: d.receptor.rfc,
      nombre: d.receptor.razonSocial,
      usoCfdi: d.receptor.usoCfdi,
      regimenFiscal: d.receptor.regimenFiscal,
      domicilioFiscal: d.receptor.cp,
    },
    conceptos: [
      {
        ...CONCEPTO_CONSUMO,
        ...(d.noIdentificacion !== undefined ? { noIdentificacion: d.noIdentificacion } : {}),
        cantidad: D(1),
        valorUnitario: subtotal,
        importe: subtotal,
        objetoImp: '02',
        iva: { base: subtotal, tasa: TASA_IVA, importe: iva },
      },
    ],
    subtotal,
    totalImpuestosTrasladados: iva,
    total,
    ...(d.relacionados
      ? {
          relacionados: {
            tipoRelacion: d.relacionados.tipoRelacion,
            uuids: [...d.relacionados.uuids],
          },
        }
      : {}),
  };
}

/**
 * La solicitud del CFDI de un ticket (F2-104). `noIdentificacion` = el folio del ticket (el que ve
 * el cliente), para que la factura se pueda cruzar con el ticket impreso.
 */
export function solicitudDesdeCheque(d: DatosEmision): SolicitudCfdi {
  return solicitudDeConsumo({
    reservaId: d.reservaId,
    serie: d.serie,
    folio: d.folio,
    fecha: d.fecha,
    emisor: d.emisor,
    sucursal: d.sucursal,
    total: d.cheque.total,
    noIdentificacion: d.cheque.folio,
    receptor: d.receptor,
    formaPago: d.formaPago,
  });
}

/**
 * Un total capturado a mano (F2-107), como TEXTO: hasta 6 enteros y 2 decimales, mayor que cero.
 * Nunca pasa por `number`. Null si no es válido.
 */
export const TOTAL_MANUAL = /^\d{1,6}(\.\d{1,2})?$/;
export const MENSAJE_TOTAL_MANUAL =
  'El total va en pesos con hasta dos decimales (p. ej. 1234.50), mayor que cero y menor que ' +
  '1,000,000.';

export function totalManual(texto: string): Prisma.Decimal | null {
  const t = texto.trim();
  if (!TOTAL_MANUAL.test(t)) return null;
  const total = D(t);
  return total.gt(0) ? total : null;
}
