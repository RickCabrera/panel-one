import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';

import { FacturaGlobalService } from './global.service';

/**
 * Cada cuántos segundos revisa el programador de la factura global (F2-108):
 * `GLOBAL_INTERVALO_S`, 3600 por defecto, 0 lo apaga; en `NODE_ENV=test` va apagado (los tests
 * llaman la vuelta del servicio a mano).
 */
export function intervaloGlobalS(entorno: NodeJS.ProcessEnv): number {
  const crudo = entorno.GLOBAL_INTERVALO_S;
  if (crudo === undefined || crudo.trim() === '') {
    return entorno.NODE_ENV === 'test' ? 0 : 3600;
  }
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`GLOBAL_INTERVALO_S debe ser un entero ≥ 0 (segundos); llegó "${crudo}".`);
  }
  return n;
}

/**
 * Emite la factura global de las empresas que la tienen AUTOMÁTICA (F2-108), con el patrón de
 * `reportes/programador.ts`: un tick al arrancar y luego cada intervalo, sin vueltas solapadas en
 * el mismo proceso. Que dos réplicas corran a la vez no duplica globales: cada ticket entra a una
 * sola por el único de `cfdi_global_codigos.codigo_id`. Lo pedía el backlog con `node-cron`; el
 * repo ya resolvió los jobs programados así (F2-141, F2-224) y no se agrega dependencia.
 */
@Injectable()
export class FacturaGlobalProgramador implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('FacturaGlobal');
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private corriendo = false;
  private readonly intervaloS = intervaloGlobalS(process.env);

  constructor(private readonly global: FacturaGlobalService) {}

  onApplicationBootstrap(): void {
    if (this.intervaloS === 0) return;
    void this.vuelta();
    this.temporizador = setInterval(() => void this.vuelta(), this.intervaloS * 1000);
    this.temporizador.unref();
  }

  onModuleDestroy(): void {
    if (this.temporizador !== null) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
  }

  /** Una vuelta. Pública para los tests. */
  async vuelta(): Promise<void> {
    if (this.corriendo) return;
    this.corriendo = true;
    try {
      const r = await this.global.vueltaAutomatica();
      if (r.emitidas + r.fallidas > 0) {
        this.logger.log(`Factura global: ${r.emitidas} emitidas, ${r.fallidas} fallidas.`);
      }
    } catch (error) {
      this.logger.warn(`Vuelta de la factura global fallida: ${String(error)}`);
    } finally {
      this.corriendo = false;
    }
  }
}
