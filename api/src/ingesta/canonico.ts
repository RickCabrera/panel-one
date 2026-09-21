import type { FormaPago, Prisma } from '@prisma/client';

import { jsonCanonico } from './normalizar';

/**
 * Lo que se compara para decidir si un cheque reenviado cambió. Lo cumplen
 * tanto el cheque guardado (lo que devuelve Prisma) como el que llega ya
 * normalizado, así los dos pasan por la MISMA función.
 */
export interface ChequeComparable {
  folio: string;
  abiertoAt: Date;
  cerradoAt: Date | null;
  mesa: string | null;
  mesero: string | null;
  comensales: number | null;
  subtotal: Prisma.Decimal;
  impuestos: Prisma.Decimal;
  descuentos: Prisma.Decimal;
  propina: Prisma.Decimal;
  total: Prisma.Decimal;
  cancelado: boolean;
  partidas: ReadonlyArray<{
    producto: string;
    categoria: string | null;
    cantidad: Prisma.Decimal;
    precioUnit: Prisma.Decimal;
    total: Prisma.Decimal;
    modificadores: unknown;
  }>;
  pagos: ReadonlyArray<{ forma: FormaPago; formaRaw: string; monto: Prisma.Decimal }>;
}

/**
 * Forma canónica de un cheque, en texto:
 * - fechas a milisegundos en UTC (`timestamptz(3)`);
 * - importes con 2 decimales y cantidades con 3 (`"10.5"` y `"10.50"` son lo mismo);
 * - modificadores con las llaves ordenadas (`jsonb` las reordena);
 * - partidas en orden de ticket, y pagos ordenados, porque la tabla no guarda
 *   su orden y un cheque con los mismos pagos en otro orden es el mismo cheque.
 */
export function chequeCanonico(c: ChequeComparable): string {
  return jsonCanonico({
    folio: c.folio,
    abiertoAt: c.abiertoAt.toISOString(),
    cerradoAt: c.cerradoAt ? c.cerradoAt.toISOString() : null,
    mesa: c.mesa,
    mesero: c.mesero,
    comensales: c.comensales,
    subtotal: c.subtotal.toFixed(2),
    impuestos: c.impuestos.toFixed(2),
    descuentos: c.descuentos.toFixed(2),
    propina: c.propina.toFixed(2),
    total: c.total.toFixed(2),
    cancelado: c.cancelado,
    partidas: c.partidas.map((p) => ({
      producto: p.producto,
      categoria: p.categoria,
      cantidad: p.cantidad.toFixed(3),
      precioUnit: p.precioUnit.toFixed(2),
      total: p.total.toFixed(2),
      modificadores: p.modificadores,
    })),
    pagos: c.pagos
      .map((p) => jsonCanonico({ forma: p.forma, formaRaw: p.formaRaw, monto: p.monto.toFixed(2) }))
      .sort(),
  });
}
