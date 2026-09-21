import { Injectable } from '@nestjs/common';

import { Reloj } from '../comun/reloj';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';

export interface SnapshotMesas {
  /** Cuándo leyó el agente las mesas (reloj de la PC del restaurante), UTC. */
  capturadoAt: string;
  /** Cuándo lo recibió el API por primera vez (reloj nuestro), UTC. */
  recibidoAt: string;
  /** Ahora − capturadoAt, en segundos, recortado a ≥ 0 (un reloj del agente adelantado daría negativo). */
  edadSegundos: number;
  /** Ahora − recibidoAt, en segundos, ≥ 0. No depende del reloj del agente. */
  edadRecepcionSegundos: number;
  /** Las cuentas abiertas tal como las mandó el agente; su forma es SUPUESTO (esquema-sr.md §5). */
  mesas: Record<string, unknown>[];
}

export interface MesasSucursal {
  sucursalId: string;
  nombre: string;
  zonaHoraria: string;
  /** El último snapshot de la sucursal, o null si nunca ha llegado uno. */
  snapshot: SnapshotMesas | null;
}

function segundosDesde(ahora: number, t: Date): number {
  return Math.max(0, Math.floor((ahora - t.getTime()) / 1000));
}

/**
 * Mesas abiertas (F1-033): el ÚLTIMO snapshot de cada sucursal en alcance, más
 * la edad del dato. El dato en vivo no se cachea. Qué es "desconectada" (cuántos
 * intervalos del agente) lo decide F1-050: el API no conoce ese intervalo.
 */
@Injectable()
export class MesasService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
  ) {}

  async abiertas(
    scope: EmpresaScope,
    empresaId: string,
    sucursalId?: string,
  ): Promise<MesasSucursal[]> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId, sucursalId);
    const sucursales = await datos.sucursal.findMany({
      where: { empresaId, ...(sucursalId === undefined ? {} : { id: sucursalId }) },
      select: { id: true, nombre: true, zonaHoraria: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
    const ahora = this.reloj.ahora();
    return Promise.all(
      sucursales.map(async (s) => {
        // El único `(sucursal_id, capturado_at)` resuelve el último con un index scan.
        const ultimo = await datos.mesaSnapshot.findFirst({
          where: { sucursalId: s.id },
          orderBy: { capturadoAt: 'desc' },
          select: { capturadoAt: true, recibidoAt: true, payload: true },
        });
        return {
          sucursalId: s.id,
          nombre: s.nombre,
          zonaHoraria: s.zonaHoraria,
          snapshot:
            ultimo === null
              ? null
              : {
                  capturadoAt: ultimo.capturadoAt.toISOString(),
                  recibidoAt: ultimo.recibidoAt.toISOString(),
                  edadSegundos: segundosDesde(ahora, ultimo.capturadoAt),
                  edadRecepcionSegundos: segundosDesde(ahora, ultimo.recibidoAt),
                  mesas: mesasDe(ultimo.payload),
                },
        };
      }),
    );
  }
}

/** La ingesta guarda `{ mesas: object[] }`; cualquier otra cosa se lee como sin mesas. */
function mesasDe(payload: unknown): Record<string, unknown>[] {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }
  const mesas = (payload as { mesas?: unknown }).mesas;
  if (!Array.isArray(mesas)) {
    return [];
  }
  return mesas.filter(
    (m): m is Record<string, unknown> => m !== null && typeof m === 'object' && !Array.isArray(m),
  );
}
