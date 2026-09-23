import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import { CancelacionCfdiService } from './cancelacion.service';

/**
 * Cada cuántos segundos consulta el sondeo de cancelaciones (F2-109): `CANCELACION_INTERVALO_S`,
 * 900 por defecto, 0 lo apaga; en `NODE_ENV=test` va apagado (los tests llaman la vuelta a mano).
 */
export function intervaloCancelacionS(entorno: NodeJS.ProcessEnv): number {
  const crudo = entorno.CANCELACION_INTERVALO_S;
  if (crudo === undefined || crudo.trim() === '') {
    return entorno.NODE_ENV === 'test' ? 0 : 900;
  }
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`CANCELACION_INTERVALO_S debe ser un entero ≥ 0 (segundos); llegó "${crudo}".`);
  }
  return n;
}

/**
 * Consulta al PAC las cancelaciones abiertas (F2-109): las que esperan al receptor y las que se
 * quedaron ambiguas. La ficha pedía "polling o webhook de Facturama": webhook no (no hay dominio
 * público ni cuenta de Facturama todavía, F2-190); sondeo con el patrón de `global.programador.ts`:
 * un tick al arrancar y luego cada intervalo, sin vueltas solapadas en el mismo proceso. Dos
 * réplicas a la vez no anotan dos veces: la anotación es condicional al estado leído.
 */
@Injectable()
export class CancelacionProgramador implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('CancelacionCfdi');
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private corriendo = false;
  private readonly intervaloS = intervaloCancelacionS(process.env);

  constructor(private readonly cancelacion: CancelacionCfdiService) {}

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
      const r = await this.cancelacion.vueltaAutomatica();
      if (r.resueltas + r.fallidas > 0) {
        this.logger.log(
          `Cancelaciones: ${r.revisadas} revisadas, ${r.resueltas} resueltas, ${r.fallidas} fallidas.`,
        );
      }
    } catch (error) {
      this.logger.warn(`Vuelta del sondeo de cancelaciones fallida: ${String(error)}`);
    } finally {
      this.corriendo = false;
    }
  }
}
