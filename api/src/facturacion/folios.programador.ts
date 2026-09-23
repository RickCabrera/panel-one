import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { FoliosService } from './folios.service';

/**
 * Cada cuántos segundos revisa el programador de avisos de folios (F2-110):
 * `FOLIOS_INTERVALO_S`, 3600 por defecto, 0 lo apaga; en `NODE_ENV=test` va apagado (los tests
 * llaman la vuelta del servicio a mano, con reloj falso).
 */
export function intervaloFoliosS(entorno: NodeJS.ProcessEnv): number {
  const crudo = entorno.FOLIOS_INTERVALO_S;
  if (crudo === undefined || crudo.trim() === '') {
    return entorno.NODE_ENV === 'test' ? 0 : 3600;
  }
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`FOLIOS_INTERVALO_S debe ser un entero ≥ 0 (segundos); llegó "${crudo}".`);
  }
  return n;
}

/**
 * Los avisos por correo del control de folios (F2-110): saldo bajo el umbral y paquete por vencer,
 * con el patrón de `global.programador.ts` (un tick al arrancar y luego cada intervalo, sin
 * vueltas solapadas en el mismo proceso). Dos réplicas a la vez no duplican un aviso: cada uno se
 * RECLAMA en la base antes de mandarse.
 *
 * DECISION PROVISIONAL (nocturno): el saldo bajo NO es una regla del centro de alertas
 * (`folios_bajo`, nota de F2-224): ver `FoliosService.vueltaAvisos`.
 */
@Injectable()
export class FoliosProgramador implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('Folios');
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private corriendo = false;
  private readonly intervaloS = intervaloFoliosS(process.env);

  constructor(private readonly folios: FoliosService) {}

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
      const r = await this.folios.vueltaAvisos();
      if (r.umbral !== 'nada' && r.umbral !== 'sin_control' && r.umbral !== 'ya_avisado') {
        this.logger.log(`Aviso de saldo de folios: ${r.umbral}.`);
      }
      if (r.vigenciaEnviados + r.vigenciaFallidos > 0) {
        this.logger.log(
          `Avisos de vigencia de folios: ${r.vigenciaEnviados} enviados, ${r.vigenciaFallidos} fallidos.`,
        );
      }
    } catch (error) {
      this.logger.warn(`Vuelta de avisos de folios fallida: ${String(error)}`);
    } finally {
      this.corriendo = false;
    }
  }
}
