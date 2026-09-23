import { Injectable } from '@nestjs/common';
import type { MotivoFallaActualizacion } from '@prisma/client';

import { Reloj } from '../comun/reloj';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';

export interface EstadoAgenteSucursal {
  sucursalId: string;
  nombre: string;
  zonaHoraria: string;
  /** Último lote aceptado de este agente (reloj del servidor), UTC. Null = nunca reportó. */
  ultimoContactoAt: string | null;
  /** Ahora − ultimoContactoAt, en segundos, ≥ 0. No depende del reloj del agente. */
  edadContactoSegundos: number | null;
  /** Última lectura exitosa de SR que reportó el heartbeat (reloj de la PC del POS), UTC. */
  ultimaLecturaAt: string | null;
  /** Ahora − ultimaLecturaAt, en segundos, recortado a ≥ 0 (un reloj del POS adelantado daría negativo). */
  edadLecturaSegundos: number | null;
  versionAgente: string | null;
  versionSr: string | null;
  tamanoCola: number | null;
  /** Latencia de la consulta a SR del último heartbeat, en ms (F1-025). */
  latenciaQueryMs: number | null;
  ultimoError: string | null;
  /** F2-143: la bandera de rollout de la sucursal. */
  actualizacionAutomatica: boolean;
  /** F2-143: la versión vigente del canal si la bandera está encendida; si no, null. */
  versionObjetivo: string | null;
  /** F2-143: el último reporte de auto-actualización del agente; null = nunca reportó. */
  actualizacion: {
    resultado: 'aplicada' | 'fallida';
    version: string;
    motivo: MotivoFallaActualizacion | null;
    detalle: string | null;
    primeraFallaAt: string | null;
    reportadaAt: string;
  } | null;
}

function reporte(
  r:
    | {
        resultado: 'aplicada' | 'fallida';
        version: string;
        motivo: MotivoFallaActualizacion | null;
        detalle: string | null;
        primeraFallaAt: Date | null;
        reportadaAt: Date;
      }
    | undefined,
): EstadoAgenteSucursal['actualizacion'] {
  if (!r) return null;
  return {
    resultado: r.resultado,
    version: r.version,
    motivo: r.motivo,
    detalle: r.detalle,
    primeraFallaAt: r.primeraFallaAt?.toISOString() ?? null,
    reportadaAt: r.reportadaAt.toISOString(),
  };
}

function segundosDesde(ahora: number, t: Date | null | undefined): number | null {
  return t ? Math.max(0, Math.floor((ahora - t.getTime()) / 1000)) : null;
}

/**
 * Estado de los agentes (F1-061): una fila por sucursal ACTIVA de la empresa,
 * con el último contacto y lo último que reportó su heartbeat. El API devuelve
 * edades, no decide "conectado/desconectado": ese umbral vive en la web (igual
 * que `/mesas/abiertas`). Sin cache: es el dato en vivo.
 */
@Injectable()
export class EstadoAgentesService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly reloj: Reloj,
  ) {}

  async deEmpresa(scope: EmpresaScope, empresaId: string): Promise<EstadoAgenteSucursal[]> {
    const datos = this.datos.para(scope);
    await verificarAlcance(datos, empresaId);
    const sucursales = await datos.sucursal.findMany({
      where: { empresaId, activo: true },
      select: { id: true, nombre: true, zonaHoraria: true, actualizacionAutomatica: true },
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
    const ids = sucursales.map((s) => s.id);
    const [estados, contactos, reportes, vigente] = await Promise.all([
      datos.agenteEstado.findMany({ where: { empresaId, sucursalId: { in: ids } } }),
      datos.agenteContacto.findMany({ where: { empresaId, sucursalId: { in: ids } } }),
      datos.agenteActualizacion.findMany({ where: { empresaId, sucursalId: { in: ids } } }),
      this.datos.versionesAgente().vigente(),
    ]);
    const reporteDe = new Map(reportes.map((r) => [r.sucursalId, r]));
    const estadoDe = new Map(estados.map((e) => [e.sucursalId, e]));
    const contactoDe = new Map(contactos.map((c) => [c.sucursalId, c.ultimoContactoAt]));
    const ahora = this.reloj.ahora();

    return sucursales.map((s) => {
      const estado = estadoDe.get(s.id);
      const contacto = contactoDe.get(s.id) ?? null;
      return {
        sucursalId: s.id,
        nombre: s.nombre,
        zonaHoraria: s.zonaHoraria,
        ultimoContactoAt: contacto?.toISOString() ?? null,
        edadContactoSegundos: segundosDesde(ahora, contacto),
        ultimaLecturaAt: estado?.ultimaLecturaAt?.toISOString() ?? null,
        edadLecturaSegundos: segundosDesde(ahora, estado?.ultimaLecturaAt),
        versionAgente: estado?.versionAgente ?? null,
        versionSr: estado?.versionSr ?? null,
        tamanoCola: estado?.tamanoCola ?? null,
        latenciaQueryMs: estado?.latenciaQueryMs ?? null,
        ultimoError: estado?.ultimoError ?? null,
        actualizacionAutomatica: s.actualizacionAutomatica,
        versionObjetivo: s.actualizacionAutomatica ? (vigente?.version ?? null) : null,
        actualizacion: reporte(reporteDe.get(s.id)),
      };
    });
  }
}
