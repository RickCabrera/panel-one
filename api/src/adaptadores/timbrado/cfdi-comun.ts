import type { Prisma } from '@prisma/client';

/** Dinero a 2 decimales como texto (XML del CFDI). */
export const dinero = (d: Prisma.Decimal): string => d.toFixed(2);
/** Cantidad y tasa: el SAT admite hasta 6 decimales. */
export const seis = (d: Prisma.Decimal): string => d.toFixed(6);

/**
 * La fecha local sin offset (`AAAA-MM-DDThh:mm:ss`) y su inverso viven en `comun/fechas.ts`
 * desde F2-101 (también las usan los códigos de facturación y el kardex); aquí se re-exportan con
 * su nombre de siempre.
 */
export { fechaLocal as fechaLocalCfdi, instanteDesdeLocal } from '../../comun/fechas';
