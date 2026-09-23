import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';

import type { EmpresaScope } from '../scope/empresa-scope';
import { huboCambios } from './conciliacion';
import { ConciliacionPacService } from './conciliacion.service';

const SCOPE_SISTEMA: EmpresaScope = { tipo: 'global' };

/**
 * Cada cuántos segundos corre la conciliación con el PAC (F2-110b): `CONCILIACION_INTERVALO_S`, 900
 * por defecto, 0 la apaga; en `NODE_ENV=test` va apagada (los tests llaman la vuelta a mano).
 */
export function intervaloConciliacionS(entorno: NodeJS.ProcessEnv): number {
  const crudo = entorno.CONCILIACION_INTERVALO_S;
  if (crudo === undefined || crudo.trim() === '') {
    return entorno.NODE_ENV === 'test' ? 0 : 900;
  }
  const n = Number(crudo);
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(
      `CONCILIACION_INTERVALO_S debe ser un entero ≥ 0 (segundos); llegó "${crudo}".`,
    );
  }
  return n;
}

/**
 * La conciliación con el PAC en automático (F2-110b), con el patrón de `cancelacion.programador.ts`:
 * un tick al arrancar y luego cada intervalo, sin vueltas solapadas en el mismo proceso. Dos réplicas
 * (o una réplica y el botón del tablero) no procesan dos veces un CFDI: cada uno se RECLAMA en base.
 */
@Injectable()
export class ConciliacionProgramador implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger('ConciliacionPac');
  private temporizador: ReturnType<typeof setInterval> | null = null;
  private corriendo = false;
  private readonly intervaloS = intervaloConciliacionS(process.env);

  constructor(private readonly conciliacion: ConciliacionPacService) {}

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
      const r = await this.conciliacion.vuelta(SCOPE_SISTEMA);
      if (huboCambios(r)) this.logger.log(`Conciliación con el PAC: ${JSON.stringify(r)}`);
    } catch (error) {
      this.logger.warn(`Vuelta de la conciliación con el PAC fallida: ${String(error)}`);
    } finally {
      this.corriendo = false;
    }
  }
}
