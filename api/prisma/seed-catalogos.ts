import { createHash } from 'node:crypto';

import type { CatalogoSr, PrismaClient } from '@prisma/client';

import type { Reloj } from '../src/comun/reloj';
import { CatalogosIngestaService } from '../src/ingesta/catalogos-ingesta.service';
import { MAX_REGISTROS_POR_PAGINA } from '../src/ingesta/dto/catalogos.dto';
import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import type { Universo } from './seed-maestro';

/**
 * Persiste los catálogos del seed maestro (F2-201) en las tablas espejo de F2-230:
 * **grupos, productos, meseros y clientes** (el reparto del backlog; áreas y canales los
 * siembra F2-233).
 *
 * No escribe directo: hace, por cada sucursal y catálogo, una sincronización COMPLETA
 * (páginas + cierre) por el MISMO servicio de la ingesta del agente
 * (`CatalogosIngestaService`). Así la base queda exactamente como la dejaría el agente, con
 * su hash, sus marcas y su idempotencia.
 *
 * - `origenSrId` = `clave` = la clave del universo (en SR podrían ser distintos; el seed no
 *   lo sabe).
 * - DECISION del seed: los dados de baja del universo van PRESENTES con `activoPos=false`:
 *   en un POS un producto o mesero dado de baja sigue existiendo, no desaparece.
 * - Grupos, productos y clientes en cada sucursal (cada una es su propio POS); cada mesero
 *   en la suya.
 * - Idempotente: con el mismo `capturadoAt` (el reloj del seed; `SEED_AHORA` lo fija) N
 *   corridas dejan la misma foto. Con un reloj posterior sólo se mueven `visto_at` y
 *   `sincronizacion_id`, nunca `updated_at`.
 */

export const CATALOGOS_SEMBRADOS: readonly CatalogoSr[] = [
  'grupos',
  'productos',
  'meseros',
  'clientes',
];

type Registro = Record<string, string | boolean | null>;

/** Los registros que el "agente" del seed manda de cada catálogo para una sucursal. */
export function registrosDe(u: Universo, sucursalId: string, catalogo: CatalogoSr): Registro[] {
  switch (catalogo) {
    case 'grupos':
      return u.grupos.map((g) => ({ origenSrId: g.clave, clave: g.clave, nombre: g.nombre }));
    case 'productos':
      return u.productos.map((p) => ({
        origenSrId: p.clave,
        clave: p.clave,
        nombre: p.nombre,
        grupoOrigenSrId: p.grupo,
        activoPos: p.activo,
      }));
    case 'meseros':
      return u.meseros
        .filter((m) => m.sucursalId === sucursalId)
        .map((m) => ({
          origenSrId: m.clave,
          clave: m.clave,
          nombre: m.nombre,
          activoPos: m.activo,
        }));
    case 'clientes':
      return u.clientes.map((c) => ({
        origenSrId: c.clave,
        clave: c.clave,
        nombre: c.nombre,
        telefono: c.telefono,
        correo: c.correo,
        rfc: c.rfc,
      }));
    default:
      return [];
  }
}

/** Un uuid determinista: la misma sucursal, catálogo e instante dan la misma sincronización. */
export function sincronizacionDelSeed(sucursalId: string, catalogo: CatalogoSr, t: Date): string {
  const h = createHash('sha256')
    .update(`seed-catalogos:${sucursalId}:${catalogo}:${t.toISOString()}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export async function sembrarCatalogos(
  prisma: PrismaClient,
  op: {
    empresaId: string;
    sucursales: ReadonlyArray<{ id: string }>;
    universo: Universo;
    capturadoAt: Date;
  },
): Promise<Record<string, number>> {
  const reloj: Reloj = { ahora: () => op.capturadoAt.getTime() };
  const servicio = new CatalogosIngestaService(
    new ScopedPrismaService(prisma as unknown as PrismaService),
    reloj,
  );
  const conteo: Record<string, number> = {};
  for (const s of op.sucursales) {
    const agente = { sucursalId: s.id, empresaId: op.empresaId };
    for (const catalogo of CATALOGOS_SEMBRADOS) {
      const registros = registrosDe(op.universo, s.id, catalogo);
      const sincronizacionId = sincronizacionDelSeed(s.id, catalogo, op.capturadoAt);
      const capturadoAt = op.capturadoAt.toISOString();
      for (let i = 0; i < registros.length; i += MAX_REGISTROS_POR_PAGINA) {
        const r = await servicio.pagina(agente, {
          catalogo,
          sincronizacionId,
          capturadoAt,
          registros: registros.slice(i, i + MAX_REGISTROS_POR_PAGINA),
        });
        if (r.rechazados.length > 0) {
          throw new Error(
            `El seed de catálogos mandó registros inválidos de ${catalogo}: ` +
              r.rechazados.map((x) => x.motivo).join('; '),
          );
        }
      }
      await servicio.cierre(agente, {
        catalogo,
        sincronizacionId,
        capturadoAt,
        total: registros.length,
        rechazados: 0,
      });
      conteo[catalogo] = (conteo[catalogo] ?? 0) + registros.length;
    }
  }
  return conteo;
}
