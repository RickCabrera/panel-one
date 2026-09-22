import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { REPORTES_CONFIG, type ReportesConfig } from './config';
import { ReportesService } from './reportes.service';

/**
 * Revisa cada `REPORTES_INTERVALO_S` qué reportes tocan (F2-141), con un primer tick al
 * arrancar. Sin ticks solapados: si una vuelta tarda más que el intervalo, la siguiente se
 * salta. Que dos réplicas corran a la vez no duplica correos: cada envío se reclama con un
 * único en base antes de mandarlo.
 */
@Injectable()
export class ReportesProgramador implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Reportes');
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private corriendo = false;

  constructor(
    private readonly reportes: ReportesService,
    @Inject(REPORTES_CONFIG) private readonly config: ReportesConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.intervaloS === 0) {
      return;
    }
    void this.vuelta();
    this.temporizador = setInterval(() => void this.vuelta(), this.config.intervaloS * 1000);
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
    if (this.corriendo) {
      return;
    }
    this.corriendo = true;
    try {
      const r = await this.reportes.vuelta();
      if (r.enviados + r.fallidos > 0) {
        this.logger.log(`Reportes: ${r.enviados} enviados, ${r.fallidos} fallidos.`);
      }
    } catch (error) {
      this.logger.warn(`Vuelta de reportes fallida: ${String(error)}`);
    } finally {
      this.corriendo = false;
    }
  }
}
