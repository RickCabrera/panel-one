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
 * **grupos, productos (con su precio por sucursal, F2-145), meseros, clientes, áreas y canales
 * (F2-233)**, y el mapeo demo área → canal de negocio (F2-233, `areas_canal`).
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
 * - Áreas: las de SU sucursal (`origenSrId` = `clave` A01…). Canales: los tres tipos de servicio
 *   del universo (S01…), en cada sucursal; no intervienen en el cálculo del canal de negocio.
 * - Mapeo demo: el `canal` de cada área del universo, sólo donde el área NO tiene mapeo todavía
 *   (`skipDuplicates`): re-sembrar no pisa lo que alguien cambió en el panel. La `empresa_id` sale
 *   de la fila espejo, no de una constante.
 * - Idempotente: con el mismo `capturadoAt` (el reloj del seed; `SEED_AHORA` lo fija) N
 *   corridas dejan la misma foto. Con un reloj posterior sólo se mueven `visto_at` y
 *   `sincronizacion_id`, nunca `updated_at`.
 */

export const CATALOGOS_SEMBRADOS: readonly CatalogoSr[] = [
  'grupos',
  'productos',
  'meseros',
  'clientes',
  'areas',
  'canales',
];

/** `actualizado_por` del mapeo demo: no es un usuario (la columna no tiene FK). */
export const ACTOR_SEED = '00000000-0000-4000-8000-00000000f233';

const nombreCanal = (c: string) => c.charAt(0).toUpperCase() + c.slice(1);

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
        // F2-145: el precio de ESTA sucursal, del universo (P009 y P021 difieren entre la
        // sucursal par y la impar a propósito).
        precio: p.precios.find((x) => x.sucursalId === sucursalId)?.precio ?? null,
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
    case 'areas':
      return u.areas
        .filter((a) => a.sucursalId === sucursalId)
        .map((a) => ({ origenSrId: a.clave, clave: a.clave, nombre: a.nombre }));
    case 'canales':
      return u.canales.map((c, i) => {
        const clave = `S${String(i + 1).padStart(2, '0')}`;
        return { origenSrId: clave, clave, nombre: nombreCanal(c) };
      });
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
  await sembrarMapeoAreas(prisma, op.sucursales, op.universo, op.capturadoAt);
  return conteo;
}

/** El mapeo demo área → canal (F2-233), sólo para las áreas que todavía no tienen uno. */
export async function sembrarMapeoAreas(
  prisma: PrismaClient,
  sucursales: ReadonlyArray<{ id: string }>,
  u: Universo,
  ahora: Date,
): Promise<number> {
  const espejo = await prisma.areaCatalogo.findMany({
    where: { sucursalId: { in: sucursales.map((s) => s.id) } },
    select: { id: true, empresaId: true, sucursalId: true, origenSrId: true },
  });
  const filas = espejo.flatMap((a) => {
    const del = u.areas.find((x) => x.sucursalId === a.sucursalId && x.clave === a.origenSrId);
    return del
      ? [
          {
            areaId: a.id,
            empresaId: a.empresaId,
            canal: del.canal,
            actualizadoPor: ACTOR_SEED,
            updatedAt: ahora,
          },
        ]
      : [];
  });
  const r = await prisma.areaCanal.createMany({ data: filas, skipDuplicates: true });
  return r.count;
}
