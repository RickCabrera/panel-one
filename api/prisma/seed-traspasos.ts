import { Prisma, type EstadoTraspaso, type PrismaClient } from '@prisma/client';

import type { PrismaService } from '../src/prisma/prisma.service';
import { ScopedPrismaService } from '../src/scope/scoped-prisma.service';
import type { Universo } from './seed-maestro';

/**
 * Traspasos demo del panel (F2-124). Un traspaso del panel es dato NUESTRO (no viene de SR), así
 * que el universo no los trae: se arman aquí, deterministas, sobre las pólizas y existencias YA
 * sembradas (F2-122, F2-121), para que la vista no quede vacía y se vea cada estado.
 *
 * Con dos sucursales o más (la primera = origen, la segunda = destino), cuatro traspasos:
 * 1. ESPEJO del último traspaso de SR del seed (`TR-…`, de GEN a GEN): mismo insumo y cantidad,
 *    enviado 1 h antes de su póliza y recibido a la hora de la póliza → queda CONCILIADO;
 * 2. enviado hace 3 h, sin nada en SR → "pendiente de registrar en SR";
 * 3. enviado hace 3 días, sin nada en SR → EN ALERTA (más de 48 h);
 * 4. GEN → BAR de la primera sucursal, recibido, sin nada en SR → pendiente.
 *
 * - Se crean, reciben y concilian por el MISMO `EscrituraTraspasos` que usa el panel: el costo sale
 *   de la foto de existencias y la conciliación es la real (con el scope de la EMPRESA).
 * - Se reconocen por su `nota` fija (`NOTA_SEED_TRASPASOS`) Y su autor (`ACTOR_SEED_TRASPASOS`,
 *   que no es un usuario), nunca por folio: un traspaso de un usuario no se toca. Idempotente: si
 *   los del seed ya están como los pide el reloj, no se mueve nada (sólo se re-concilia, que sin
 *   datos nuevos no escribe); si no (sembrar otro día), se borran SÓLO los del seed y se rehacen.
 *   Ese borrado vive aquí, no en el panel (ninguna ruta borra traspasos).
 */

export const NOTA_SEED_TRASPASOS = 'Ejemplo del seed (F2-124)';
/** `enviado_por`/`recibido_por` de los traspasos demo: no es un usuario (sin FK). */
export const ACTOR_SEED_TRASPASOS = '00000000-0000-4000-8000-00000000f124';

const H = 3_600_000;
const CANTIDAD_DEMO = new Prisma.Decimal('1.5');

export interface ResultadoSembrarTraspasos {
  creados: number;
  conservados: number;
  borrados: number;
  conciliados: number;
}

interface Plan {
  clave: 'espejo' | 'pendiente' | 'alerta' | 'interno';
  sucursalOrigenId: string;
  almacenOrigenSrId: string;
  sucursalDestinoId: string;
  almacenDestinoSrId: string;
  insumo: string;
  cantidad: Prisma.Decimal;
  enviadoAt: Date;
  recibidoAt: Date | null;
}

export async function sembrarTraspasos(
  prisma: PrismaClient,
  op: {
    empresaId: string;
    sucursales: ReadonlyArray<{ id: string }>;
    universo: Universo;
    ahora: Date;
  },
): Promise<ResultadoSembrarTraspasos> {
  const res: ResultadoSembrarTraspasos = {
    creados: 0,
    conservados: 0,
    borrados: 0,
    conciliados: 0,
  };
  if (op.sucursales.length < 2) return res;
  const [origen, destino] = op.sucursales;
  const almacen = (sucursalId: string, tipo: 'GEN' | 'BAR') =>
    op.universo.almacenes.find((a) => a.sucursalId === sucursalId && a.tipo === tipo)?.clave;
  const genOrigen = almacen(origen.id, 'GEN');
  const barOrigen = almacen(origen.id, 'BAR');
  const genDestino = almacen(destino.id, 'GEN');
  if (!genOrigen || !barOrigen || !genDestino) return res;
  const ahora = op.ahora.getTime();

  const planes: Plan[] = [];
  // 1. El espejo: la última salida de traspaso de SR (el seed maestro las arma de GEN a GEN).
  const espejo = await prisma.polizaInventario.findFirst({
    where: {
      empresaId: op.empresaId,
      sucursalId: origen.id,
      tipo: 'traspaso_salida',
      cancelada: false,
      referencia: { startsWith: 'TR-' },
    },
    orderBy: [{ fecha: 'desc' }, { folio: 'desc' }],
    select: {
      fecha: true,
      almacenOrigenSrId: true,
      referencia: true,
      movimientos: {
        orderBy: { renglon: 'asc' },
        take: 1,
        select: { insumoOrigenSrId: true, cantidad: true },
      },
    },
  });
  const entradaEspejo = espejo
    ? await prisma.polizaInventario.findFirst({
        where: {
          empresaId: op.empresaId,
          sucursalId: destino.id,
          tipo: 'traspaso_entrada',
          referencia: espejo.referencia,
        },
        select: { almacenOrigenSrId: true },
      })
    : null;
  if (espejo && entradaEspejo && espejo.movimientos.length === 1) {
    planes.push({
      clave: 'espejo',
      sucursalOrigenId: origen.id,
      almacenOrigenSrId: espejo.almacenOrigenSrId,
      sucursalDestinoId: destino.id,
      almacenDestinoSrId: entradaEspejo.almacenOrigenSrId,
      insumo: espejo.movimientos[0].insumoOrigenSrId,
      cantidad: espejo.movimientos[0].cantidad.negated(),
      enviadoAt: new Date(espejo.fecha.getTime() - H),
      recibidoAt: espejo.fecha,
    });
  }
  // 2–4: un insumo con existencia en el general de origen (el primero por clave).
  const conExistencia = await prisma.existencia.findFirst({
    where: {
      empresaId: op.empresaId,
      sucursalId: origen.id,
      almacenOrigenSrId: genOrigen,
      cantidad: { gt: 2 },
    },
    orderBy: { insumoOrigenSrId: 'asc' },
    select: { insumoOrigenSrId: true },
  });
  if (conExistencia) {
    const insumo = conExistencia.insumoOrigenSrId;
    const aDestino = {
      sucursalOrigenId: origen.id,
      almacenOrigenSrId: genOrigen,
      sucursalDestinoId: destino.id,
      almacenDestinoSrId: genDestino,
      insumo,
      cantidad: CANTIDAD_DEMO,
    };
    planes.push(
      { clave: 'pendiente', ...aDestino, enviadoAt: new Date(ahora - 3 * H), recibidoAt: null },
      { clave: 'alerta', ...aDestino, enviadoAt: new Date(ahora - 72 * H), recibidoAt: null },
      {
        clave: 'interno',
        ...aDestino,
        sucursalDestinoId: origen.id,
        almacenDestinoSrId: barOrigen,
        enviadoAt: new Date(ahora - 5 * H),
        recibidoAt: new Date(ahora - 4 * H),
      },
    );
  }

  const delSeed = {
    empresaId: op.empresaId,
    nota: NOTA_SEED_TRASPASOS,
    enviadoPor: ACTOR_SEED_TRASPASOS,
  };
  const previos = await prisma.traspaso.findMany({
    where: delSeed,
    select: {
      sucursalId: true,
      almacenOrigenSrId: true,
      sucursalDestinoId: true,
      almacenDestinoSrId: true,
      enviadoAt: true,
      recibidoAt: true,
      estado: true,
      partidas: { select: { insumoOrigenSrId: true, cantidad: true } },
    },
  });
  const estadoDe = (p: Plan): EstadoTraspaso => (p.recibidoAt ? 'recibido' : 'enviado');
  const vigentes =
    previos.length === planes.length &&
    planes.every((p) =>
      previos.some(
        (t) =>
          t.sucursalId === p.sucursalOrigenId &&
          t.almacenOrigenSrId === p.almacenOrigenSrId &&
          t.sucursalDestinoId === p.sucursalDestinoId &&
          t.almacenDestinoSrId === p.almacenDestinoSrId &&
          t.enviadoAt.getTime() === p.enviadoAt.getTime() &&
          (t.recibidoAt?.getTime() ?? null) === (p.recibidoAt?.getTime() ?? null) &&
          t.estado === estadoDe(p) &&
          t.partidas.length === 1 &&
          t.partidas[0].insumoOrigenSrId === p.insumo &&
          t.partidas[0].cantidad.equals(p.cantidad),
      ),
    );

  const escritura = new ScopedPrismaService(prisma as unknown as PrismaService).traspasos({
    tipo: 'global',
  });
  if (vigentes) {
    res.conservados = previos.length;
  } else {
    // Otro reloj o quedaron a medias: se rehacen SÓLO los del seed (las partidas caen en cascada).
    res.borrados = (await prisma.traspaso.deleteMany({ where: delSeed })).count;
    for (const p of planes) {
      const id = await escritura.enviar(
        {
          empresaId: op.empresaId,
          sucursalOrigenId: p.sucursalOrigenId,
          almacenOrigenSrId: p.almacenOrigenSrId,
          sucursalDestinoId: p.sucursalDestinoId,
          almacenDestinoSrId: p.almacenDestinoSrId,
          nota: NOTA_SEED_TRASPASOS,
          partidas: [{ insumoOrigenSrId: p.insumo, cantidad: p.cantidad }],
        },
        ACTOR_SEED_TRASPASOS,
        p.enviadoAt,
      );
      if (p.recibidoAt) {
        await escritura.recibir(op.empresaId, id, ACTOR_SEED_TRASPASOS, p.recibidoAt);
      }
      res.creados++;
    }
  }
  // La conciliación real, con el scope de la EMPRESA (como la vuelta del centro de alertas).
  const conciliacion = await new ScopedPrismaService(prisma as unknown as PrismaService)
    .traspasos({ tipo: 'empresa', empresaId: op.empresaId })
    .conciliar(op.empresaId, op.ahora);
  res.conciliados = conciliacion.conciliados;
  return res;
}
