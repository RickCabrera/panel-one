import { Prisma, type PrismaClient } from '@prisma/client';

import type { PrismaService } from '../src/prisma/prisma.service';
import type { Captura } from '../src/scope/escritura-conteos';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import type { Universo } from './seed-maestro';
import { entero, fnv, prng } from './seed-maestro/azar';

/**
 * Conteos físicos demo (F2-123). Un conteo es dato NUESTRO (no viene de SR), así que el universo
 * no los trae: se arman aquí, deterministas, sobre las existencias YA sembradas (F2-121), para
 * que la vista no quede vacía.
 *
 * - Por sucursal: uno CERRADO en el almacén general (todos los artículos) y uno EN CAPTURA a
 *   medias en la barra. Se crean, capturan y cierran por el MISMO `EscrituraConteos` que usa el
 *   panel (scope global): el teórico sale de la foto de existencias, como en producción.
 * - Lo contado sale de un PRNG con semilla fija por (sucursal, almacén): la mayoría igual al
 *   teórico, algunos con faltante o sobrante de medias unidades, y algunos sin contar.
 * - Se reconocen por su `nota` fija (`NOTA_SEED_CONTEOS`), nunca por folio: un conteo de un
 *   usuario no se toca. Idempotente: si los del seed ya están sobre la foto vigente, no se
 *   mueve nada; si la foto cambió (sembrar otro día), se borran SÓLO los del seed de esa
 *   sucursal y se vuelven a crear. Ese borrado vive aquí, no en el panel (ninguna ruta borra).
 */

export const NOTA_SEED_CONTEOS = 'Ejemplo del seed (F2-123)';
/** `creado_por`/`capturado_por`/`cerrado_por` de los conteos demo: no es un usuario (sin FK). */
export const ACTOR_SEED_CONTEOS = '00000000-0000-4000-8000-00000000f123';

export interface ResultadoSembrarConteos {
  creados: number;
  conservados: number;
  borrados: number;
}

const CERO = new Prisma.Decimal(0);
const MEDIO = new Prisma.Decimal('0.5');

/**
 * Lo contado de cada renglón, determinista. Un renglón que no sale en la lista queda sin contar.
 * Para que el ejemplo nunca sea una pantalla sin nada que ver: el primer renglón con teórico
 * sale con sobrante, el segundo con faltante, y el último (por clave) sin contar; el resto, por
 * el PRNG.
 */
export function capturasDemo(
  semilla: string,
  partidas: ReadonlyArray<{ insumoOrigenSrId: string; teorico: Prisma.Decimal | null }>,
  proporcionContada: number,
): Captura[] {
  const r = prng(parseInt(fnv(semilla), 16));
  const orden = [...partidas].sort((a, b) => a.insumoOrigenSrId.localeCompare(b.insumoOrigenSrId));
  const capturas: Captura[] = [];
  let conTeorico = 0;
  orden.forEach((p, i) => {
    const suerte = r();
    const delta = MEDIO.times(entero(r, 1, 4));
    const contar = r() < proporcionContada;
    const nuevo = new Prisma.Decimal(entero(r, 0, 3));
    if (i === orden.length - 1) return; // sin contar
    if (p.teorico === null) {
      if (contar) capturas.push({ insumoOrigenSrId: p.insumoOrigenSrId, contado: nuevo });
      return;
    }
    const base = p.teorico.lessThan(0) ? CERO : p.teorico;
    const faltante = base.minus(delta).lessThan(0) ? base.plus(delta) : base.minus(delta);
    conTeorico++;
    let contado: Prisma.Decimal;
    if (conTeorico === 1) contado = base.plus(delta);
    else if (conTeorico === 2) contado = faltante;
    else if (!contar) return;
    else if (suerte < 0.7) contado = base;
    else if (suerte < 0.88) contado = Prisma.Decimal.max(CERO, base.minus(delta));
    else contado = base.plus(delta);
    capturas.push({ insumoOrigenSrId: p.insumoOrigenSrId, contado });
  });
  return capturas;
}

export async function sembrarConteos(
  prisma: PrismaClient,
  op: {
    empresaId: string;
    sucursales: ReadonlyArray<{ id: string }>;
    universo: Universo;
    ahora: Date;
  },
): Promise<ResultadoSembrarConteos> {
  const escritura = new ScopedPrismaService(prisma as unknown as PrismaService).conteos({
    tipo: 'global',
  });
  const res: ResultadoSembrarConteos = { creados: 0, conservados: 0, borrados: 0 };
  for (const s of op.sucursales) {
    const almacenes = op.universo.almacenes.filter((a) => a.sucursalId === s.id);
    const planes = (
      [
        ['GEN', 'cerrado', 0.9],
        ['BAR', 'en_captura', 0.5],
      ] as const
    ).flatMap(([tipo, estado, proporcion]) => {
      const a = almacenes.find((x) => x.tipo === tipo);
      return a ? [{ almacen: a.clave, estado, proporcion }] : [];
    });
    if (planes.length === 0) continue;
    const deLaSucursal = { empresaId: op.empresaId, sucursalId: s.id };
    const [lecturas, previos] = await Promise.all([
      prisma.lecturaExistencias.findMany({
        where: { ...deLaSucursal, almacenOrigenSrId: { in: planes.map((p) => p.almacen) } },
        select: { almacenOrigenSrId: true, capturadoAt: true },
      }),
      prisma.conteoFisico.findMany({
        where: { ...deLaSucursal, nota: NOTA_SEED_CONTEOS },
        select: { almacenOrigenSrId: true, teoricoCapturadoAt: true, estado: true },
      }),
    ]);
    const corteDe = new Map(lecturas.map((l) => [l.almacenOrigenSrId, l.capturadoAt.getTime()]));
    const vigentes =
      previos.length === planes.length &&
      planes.every((p) =>
        previos.some(
          (c) =>
            c.almacenOrigenSrId === p.almacen &&
            c.estado === p.estado &&
            c.teoricoCapturadoAt.getTime() === corteDe.get(p.almacen),
        ),
      );
    if (vigentes) {
      res.conservados += previos.length;
      continue;
    }
    // Otra foto (otro día) o quedaron a medias: se rehacen SÓLO los del seed de esta sucursal.
    res.borrados += (
      await prisma.conteoFisico.deleteMany({ where: { ...deLaSucursal, nota: NOTA_SEED_CONTEOS } })
    ).count;
    for (const p of planes) {
      if (!corteDe.has(p.almacen)) continue; // sin foto no hay conteo (409 en el panel)
      const id = await escritura.crear(
        {
          ...deLaSucursal,
          almacenOrigenSrId: p.almacen,
          grupoOrigenSrId: null,
          nota: NOTA_SEED_CONTEOS,
        },
        ACTOR_SEED_CONTEOS,
        op.ahora,
      );
      const partidas = await prisma.partidaConteo.findMany({
        where: { ...deLaSucursal, conteoId: id },
        select: { insumoOrigenSrId: true, teorico: true },
      });
      const capturas = capturasDemo(`conteo:${s.id}:${p.almacen}`, partidas, p.proporcion);
      if (capturas.length > 0) {
        await escritura.capturar(op.empresaId, id, capturas, ACTOR_SEED_CONTEOS, op.ahora);
      }
      if (p.estado === 'cerrado') {
        await escritura.cerrar(op.empresaId, id, ACTOR_SEED_CONTEOS, op.ahora);
      }
      res.creados++;
    }
  }
  return res;
}
