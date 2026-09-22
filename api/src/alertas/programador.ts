import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { AlertasService } from './alertas.service';

/**
 * Cada cuántos segundos se evalúan las alertas (F2-224). `ALERTAS_INTERVALO_S=0` lo apaga.
 * Por defecto 60 s; en `NODE_ENV=test` va apagado (los tests evalúan a mano con su reloj).
 */
export function intervaloAlertasS(env: NodeJS.ProcessEnv = process.env): number {
  const crudo = env.ALERTAS_INTERVALO_S;
  if (crudo === undefined || crudo.trim() === '') {
    return env.NODE_ENV === 'test' ? 0 : 60;
  }
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`ALERTAS_INTERVALO_S debe ser un entero ≥ 0 (segundos); llegó "${crudo}".`);
  }
  return n;
}

/**
 * Corre la evaluación de todas las empresas cada `ALERTAS_INTERVALO_S`, con un primer tick
 * al arrancar. Sin ticks solapados: si una vuelta tarda más que el intervalo, la siguiente se
 * salta. Una empresa que falla (candado ocupado, base lenta) se registra y no detiene a las
 * demás.
 */
@Injectable()
export class AlertasProgramador implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Alertas');
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private corriendo = false;

  constructor(private readonly alertas: AlertasService) {}

  onApplicationBootstrap(): void {
    const segundos = intervaloAlertasS();
    if (segundos === 0) {
      return;
    }
    void this.vuelta();
    this.temporizador = setInterval(() => void this.vuelta(), segundos * 1000);
    this.temporizador.unref();
  }

  onModuleDestroy(): void {
    if (this.temporizador !== null) {
      clearInterval(this.temporizador);
      this.temporizador = null;
    }
  }

  /** Una vuelta por todas las empresas. Pública para los tests. */
  async vuelta(): Promise<void> {
    if (this.corriendo) {
      return;
    }
    this.corriendo = true;
    try {
      const empresas = await this.alertas.empresasAEvaluar();
      for (const id of empresas) {
        try {
          if (!(await this.alertas.evaluarEmpresa(id))) {
            this.logger.debug(`Observación de la empresa ${id} descartada: llegó tarde.`);
          }
        } catch (error) {
          this.logger.warn(`No se evaluaron las alertas de la empresa ${id}: ${String(error)}`);
        }
      }
    } catch (error) {
      this.logger.warn(`Vuelta de alertas fallida: ${String(error)}`);
    } finally {
      this.corriendo = false;
    }
  }
}
