import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { NotificacionesService } from './notificaciones.service';

/**
 * Segundos entre vueltas del resumen de cierre del día. 0 = apagado; sin variable, 300 (y 0
 * con `NODE_ENV=test`, como los demás programadores: los tests llaman `vuelta()` a mano).
 */
export function intervaloNotificacionesS(entorno: NodeJS.ProcessEnv = process.env): number {
  const valor = entorno.NOTIFICACIONES_INTERVALO_S;
  if (valor === undefined || valor.trim() === '') return entorno.NODE_ENV === 'test' ? 0 : 300;
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`NOTIFICACIONES_INTERVALO_S="${valor}" no es un entero >= 0.`);
  }
  return n;
}

/**
 * Revisa cada `NOTIFICACIONES_INTERVALO_S` (default 300) qué resúmenes de cierre tocan
 * (F2-146), con un primer tick al arrancar. Mismo patrón que `ReportesProgramador`: sin
 * ticks solapados, y dos réplicas no duplican porque cada resumen se reclama en base.
 */
@Injectable()
export class NotificacionesProgramador implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Notificaciones');
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private corriendo = false;
  private readonly intervaloS = intervaloNotificacionesS();

  constructor(private readonly notificaciones: NotificacionesService) {}

  onApplicationBootstrap(): void {
    if (this.intervaloS === 0) {
      return;
    }
    void this.vuelta();
    this.temporizador = setInterval(() => void this.vuelta(), this.intervaloS * 1000);
    this.temporizador.unref();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.temporizador !== null) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
    // Los push de alertas encadenados terminan antes de apagar.
    await this.notificaciones.esperarPendientes();
  }

  /** Una vuelta. Pública para los tests. */
  async vuelta(): Promise<void> {
    if (this.corriendo) {
      return;
    }
    this.corriendo = true;
    try {
      const r = await this.notificaciones.vueltaResumen();
      if (r.entregados + r.fallidos + r.descartados > 0) {
        this.logger.log(
          `Resumen de cierre: ${r.entregados} entregados, ${r.fallidos} fallidos, ` +
            `${r.descartados} navegadores dados de baja.`,
        );
      }
    } catch (error) {
      this.logger.warn(`Vuelta de notificaciones fallida: ${String(error)}`);
    } finally {
      this.corriendo = false;
    }
  }
}
