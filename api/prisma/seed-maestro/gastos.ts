import { Prisma } from '@prisma/client';

import { diaSemana, dinero, prng } from './azar';

/**
 * Gastos de operación SINTÉTICOS del seed maestro (F2-201), por sucursal y
 * categoría, para "Gastos y utilidad" (F2-126). Las compras de insumos NO van
 * aquí: salen de las pólizas de compra del inventario.
 */

export const CATEGORIAS_GASTO = [
  'Renta',
  'Nómina',
  'Luz',
  'Agua',
  'Gas',
  'Mantenimiento',
  'Publicidad',
] as const;

export type CategoriaGasto = (typeof CATEGORIAS_GASTO)[number];

export interface GastoSeed {
  folio: string;
  sucursalId: string;
  dia: string;
  categoria: CategoriaGasto;
  concepto: string;
  monto: Prisma.Decimal;
}

/** Último día del mes de un `YYYY-MM-DD`. */
function esFinDeMes(dia: string): boolean {
  const siguiente = new Date(Date.parse(`${dia}T00:00:00Z`) + 86_400_000);
  return siguiente.getUTCDate() === 1;
}

export function generarGastos(op: {
  sucursales: ReadonlyArray<{ id: string; clave: string }>;
  dias: readonly string[];
  semilla?: number;
}): GastoSeed[] {
  const r = prng(op.semilla ?? 20260922);
  const gastos: GastoSeed[] = [];
  op.sucursales.forEach((s, i) => {
    // La segunda sucursal es más chica: paga menos renta y menos nómina.
    const escala = i % 2 === 0 ? 1 : 0.8;
    let n = 0;
    const gasto = (dia: string, categoria: CategoriaGasto, concepto: string, monto: number) =>
      gastos.push({
        folio: `${s.clave}-G-${String(++n).padStart(4, '0')}`,
        sucursalId: s.id,
        dia,
        categoria,
        concepto,
        monto: dinero(monto),
      });
    for (const dia of op.dias) {
      const d = Number(dia.slice(8, 10));
      const mes = dia.slice(0, 7);
      if (d === 1) gasto(dia, 'Renta', `Renta del local ${mes}`, 45000 * escala);
      if (d === 15 || esFinDeMes(dia)) {
        gasto(dia, 'Nómina', `Nómina quincenal ${dia}`, Math.round((52000 + r() * 6000) * escala));
      }
      if (d === 10) {
        gasto(dia, 'Luz', `Recibo de luz ${mes}`, 8000 + Math.round(r() * 3000));
        gasto(dia, 'Agua', `Recibo de agua ${mes}`, 1200 + Math.round(r() * 600));
      }
      if (d === 20) gasto(dia, 'Publicidad', `Redes sociales ${mes}`, 5000);
      if (diaSemana(dia) === 1)
        gasto(dia, 'Gas', 'Recarga de gas LP', 2500 + Math.round(r() * 1000));
      if (r() < 0.08) {
        gasto(dia, 'Mantenimiento', 'Reparación y mantenimiento', 800 + Math.round(r() * 3200));
      }
    }
  });
  return gastos;
}
