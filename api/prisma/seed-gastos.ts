import type { PrismaClient } from '@prisma/client';

import type { PrismaService } from '../src/prisma/prisma.service';
import { nombreYClave } from '../src/scope/escritura-gastos';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import type { Universo } from './seed-maestro';

/**
 * Persiste los gastos del seed maestro (F2-201) en las tablas de F2-126. Los gastos son dato
 * PROPIO del panel (nunca de SR): se escriben por el mismo helper de escritura que usa la captura
 * (`ScopedPrismaService.gastos(scope)`), con el scope de la empresa demo.
 *
 * - Categorías: las de `CATEGORIAS_GASTO` en la empresa; sólo se crean las que falten. Si el
 *   usuario desactivó una, el seed NO la reactiva: sus gastos del seed se omiten (el panel manda
 *   sobre el seed). Un gasto del seed que el usuario anuló tampoco se revive.
 * - Cada gasto lleva su `folio` del seed (`<sucursal>-G-0001`): la llave de la idempotencia. El
 *   mismo folio se deja igual a lo generado sin cambiar su id; la ventana del universo se mueve con
 *   el reloj y renumera folios, así que antes se BORRAN los gastos sembrados antes (prefijo
 *   `<sucursal>-G-`) que ya no están. Los gastos capturados en el panel no tienen folio: nunca se
 *   tocan.
 * - Idempotente: con el mismo reloj N corridas dejan exactamente lo mismo. No mueve el PRNG.
 */

export const prefijoGastos = (claveSucursal: string) => `${claveSucursal}-G-`;

export interface ResultadoSembrarGastos {
  categorias: number;
  gastos: number;
  omitidos: number;
  borrados: number;
}

export async function sembrarGastos(
  prisma: PrismaClient,
  op: {
    empresaId: string;
    sucursales: ReadonlyArray<{ id: string; clave: string }>;
    universo: Universo;
    ahora: Date;
  },
): Promise<ResultadoSembrarGastos> {
  const escritura = new ScopedPrismaService(prisma as unknown as PrismaService).gastos({
    tipo: 'empresa',
    empresaId: op.empresaId,
  });
  const existentes = await prisma.categoriaGasto.findMany({
    where: { empresaId: op.empresaId },
    select: { id: true, nombreClave: true, activa: true },
  });
  const categoria = new Map(existentes.map((c) => [c.nombreClave, c]));
  let categorias = 0;
  for (const nombre of op.universo.categoriasGasto) {
    const { nombreClave } = nombreYClave(nombre);
    if (categoria.has(nombreClave)) continue;
    const id = await escritura.crearCategoria(op.empresaId, nombre, op.ahora);
    categoria.set(nombreClave, { id, nombreClave, activa: true });
    categorias++;
  }

  let gastos = 0;
  let omitidos = 0;
  let borrados = 0;
  for (const s of op.sucursales) {
    const suyos = op.universo.gastos.filter((g) => g.sucursalId === s.id);
    const { count } = await prisma.gasto.deleteMany({
      where: {
        empresaId: op.empresaId,
        sucursalId: s.id,
        folio: { startsWith: prefijoGastos(s.clave), notIn: suyos.map((g) => g.folio) },
      },
    });
    borrados += count;
    for (const g of suyos) {
      const c = categoria.get(nombreYClave(g.categoria).nombreClave)!;
      if (!c.activa) {
        omitidos++;
        continue;
      }
      await escritura.crear(
        {
          empresaId: op.empresaId,
          sucursalId: s.id,
          categoriaId: c.id,
          dia: g.dia,
          concepto: g.concepto,
          monto: g.monto,
          folio: g.folio,
        },
        null,
        op.ahora,
      );
      gastos++;
    }
  }
  return { categorias, gastos, omitidos, borrados };
}
