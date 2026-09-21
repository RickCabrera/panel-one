import { FormaPago, Prisma } from '@prisma/client';

/**
 * Conversión de lo que manda el agente (texto) a lo que se guarda. Todo
 * importe viaja como STRING decimal y se maneja como `Prisma.Decimal`: nunca
 * pasa por un `number` (float), ni al validar ni al redondear.
 */

/**
 * ISO-8601 con zona OBLIGATORIA (`Z` u offset `±hh:mm`). Una fecha sin zona es
 * hora local de quién sabe dónde: se rechaza. Hasta 7 decimales de segundo
 * (lo que serializa .NET); se guardan milisegundos (`timestamptz(3)`).
 */
export const ISO_CON_ZONA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,7})?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Dinero: hasta 10 enteros (lo que cabe en NUMERIC(12,2)) y hasta 4 decimales,
 * porque el `money` de SQL Server lleva 4 (supuesto, esquema-sr.md §3). Puede
 * ser negativo (sin CHECK de signo, decisión de F1-030).
 */
export const DINERO = /^-?\d{1,10}(\.\d{1,4})?$/;

/** Cantidad: NUMERIC(12,3). Hasta 9 enteros y 3 decimales: cabe siempre, no se redondea. */
export const CANTIDAD = /^-?\d{1,9}(\.\d{1,3})?$/;

/** El primer valor que ya no cabe en NUMERIC(12,2). */
const TOPE_NUMERIC_12_2 = new Prisma.Decimal('1e10');

/**
 * Un importe redondeado a centavos, o `null` si al redondear ya no cabe en
 * NUMERIC(12,2) (`9999999999.9999` → `10000000000.00`).
 *
 * El redondeo se hace AQUÍ, en código, con `ROUND_HALF_UP` de decimal.js, que
 * es mitad-lejos-de-cero: el mismo que aplicaría NUMERIC de Postgres
 * (`0.125` → `0.13`, `-0.125` → `-0.13`). Así lo guardado es exactamente lo que
 * se comparó, y el atajo "sin cambios" de la ingesta no falla por un redondeo.
 */
export function dinero(texto: string): Prisma.Decimal | null {
  const valor = new Prisma.Decimal(texto).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
  return valor.abs().lessThan(TOPE_NUMERIC_12_2) ? valor : null;
}

/** Una cantidad ya validada con `CANTIDAD`: cabe en NUMERIC(12,3) tal cual. */
export function cantidad(texto: string): Prisma.Decimal {
  return new Prisma.Decimal(texto);
}

/**
 * La forma de pago de nuestro ENUM a partir del texto crudo de SR.
 *
 * DECISION PROVISIONAL (nocturno): siempre `otro`. No hay catálogo de formas
 * de pago de ninguna instalación real (esquema-sr.md §4); adivinar por el texto
 * ("EFECTIVO", "TARJETA") metería errores silenciosos en el desglose. El crudo
 * se guarda SIEMPRE en `forma_raw`, así que F1-032 puede derivar el ENUM con su
 * catálogo sin perder nada.
 */
export function derivarFormaPago(formaRaw: string): FormaPago {
  void formaRaw; // el catálogo de F1-032 lo va a leer; hoy no se usa a propósito
  return FormaPago.otro;
}

/** Una fecha con zona, ya validada con `ISO_CON_ZONA`, al instante UTC que representa. */
export function fechaUtc(iso: string): Date {
  return new Date(iso);
}

/**
 * JSON con las llaves ordenadas, para comparar lo que llega contra lo que
 * devuelve un `jsonb` (que reordena las llaves).
 */
export function jsonCanonico(valor: unknown): string {
  return JSON.stringify(ordenarLlaves(valor));
}

function ordenarLlaves(valor: unknown): unknown {
  if (Array.isArray(valor)) {
    return valor.map(ordenarLlaves);
  }
  if (valor !== null && typeof valor === 'object') {
    const obj = valor as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(obj)
        .sort()
        .map((k) => [k, ordenarLlaves(obj[k])]),
    );
  }
  return valor;
}
