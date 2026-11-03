import { FormaPago, Prisma } from '@prisma/client';

import { instanteDesdeLocal } from '../comun/fechas';

/**
 * Lo puro de los cortes (MVP de cortes): sin base, para probarlo sin Postgres. El servicio
 * (`cortes.service.ts`) lee con scope y arma la respuesta con esto.
 */

const MS_DIA = 86_400_000;
const CERO = new Prisma.Decimal(0);

/** El día siguiente a `dia` (`YYYY-MM-DD`), en aritmética de calendario (sin zona). */
export function diaSiguiente(dia: string): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) + MS_DIA).toISOString().slice(0, 10);
}

/**
 * Inicio (inclusivo) y fin (exclusivo) de los días locales `desde..hasta` en la zona de UNA
 * sucursal, como instantes UTC. Es el mismo corte que usan los agregados de ventas (medianoche
 * local de la sucursal), hecho en código porque aquí se consulta con el cliente con scope y no
 * con las CTEs de `consulta-ventas.ts`.
 */
export function limitesLocales(
  desde: string,
  hasta: string,
  zona: string,
): { inicio: Date; fin: Date } {
  const inicio = instanteDesdeLocal(`${desde}T00:00:00`, zona);
  const fin = instanteDesdeLocal(`${diaSiguiente(hasta)}T00:00:00`, zona);
  if (inicio === null || fin === null) {
    // `validarFiltro` ya exigió días reales: llegar aquí es un bug, no un 400.
    throw new Error(`Rango local inválido: ${desde}..${hasta} en ${zona}`);
  }
  return { inicio, fin };
}

export function pesos(d: Prisma.Decimal): string {
  return d.toFixed(2, Prisma.Decimal.ROUND_HALF_UP);
}

export function dec(valor: Prisma.Decimal | null | undefined): Prisma.Decimal {
  return valor ?? CERO;
}

/** `a / b` a 2 decimales (mitad lejos de cero); null sin divisor, nunca "0.00". */
export function promedio(a: Prisma.Decimal, b: number): string | null {
  return b === 0 ? null : pesos(a.div(b));
}

export const FORMAS_CORTE: readonly FormaPago[] = [
  FormaPago.efectivo,
  FormaPago.tarjeta,
  FormaPago.transferencia,
  FormaPago.otro,
];

/**
 * Desglose por forma de pago con el catálogo de la empresa aplicado AL LEER, con la misma regla
 * que `/ventas/formas-pago`: match exacto de `forma_raw`; lo que no está en el catálogo suma en
 * `otro` y además se lista en `sinCatalogo`.
 */
export function desglosarFormas(
  montos: ReadonlyArray<{ formaRaw: string; monto: Prisma.Decimal }>,
  catalogo: ReadonlyMap<string, FormaPago>,
): {
  formas: Array<{ forma: FormaPago; monto: string }>;
  sinCatalogo: Array<{ formaRaw: string; monto: string }>;
  total: Prisma.Decimal;
} {
  const totales = new Map<FormaPago, Prisma.Decimal>(FORMAS_CORTE.map((f) => [f, CERO]));
  const sinCatalogo: Array<{ formaRaw: string; monto: Prisma.Decimal }> = [];
  let total = CERO;
  for (const { formaRaw, monto } of montos) {
    const forma = catalogo.get(formaRaw);
    const destino = forma ?? FormaPago.otro;
    totales.set(destino, totales.get(destino)!.plus(monto));
    total = total.plus(monto);
    if (forma === undefined) sinCatalogo.push({ formaRaw, monto });
  }
  sinCatalogo.sort((a, b) => b.monto.comparedTo(a.monto) || (a.formaRaw < b.formaRaw ? -1 : 1));
  return {
    formas: FORMAS_CORTE.map((forma) => ({ forma, monto: pesos(totales.get(forma)!) })),
    sinCatalogo: sinCatalogo.map((s) => ({ formaRaw: s.formaRaw, monto: pesos(s.monto) })),
    total,
  };
}
