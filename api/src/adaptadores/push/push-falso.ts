import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Reloj } from '../../comun/reloj';
import type {
  DispositivoDestino,
  MensajePush,
  OpcionesPush,
  PuertoPush,
  ResultadoPush,
} from './puerto';

export const DIRECTORIO_PUSH_FALSO = join(tmpdir(), 'push');

export interface PushEnviado {
  endpoint: string;
  mensaje: MensajePush;
  opciones: OpcionesPush;
  enviadoAt: string;
}

/**
 * Push FALSO (F2-146): no sale nada a la red. Guarda en memoria cada envío (los tests lo
 * leen con `enviados`) y, si hay directorio, un `.jsonl` por día para el modo demo.
 * Determinista: el mismo envío produce el mismo registro.
 *
 * Para probar la limpieza de dispositivos, un endpoint que contenga `/caducado/`
 * contesta `caducado` y uno con `/falla/` lanza, como haría el servicio real.
 */
export class PushFalso implements PuertoPush {
  readonly enviados: PushEnviado[] = [];

  constructor(
    readonly clavePublica: string | null,
    private readonly reloj: Pick<Reloj, 'ahora'>,
    private readonly directorio: string | undefined = undefined,
  ) {}

  async enviar(
    destino: DispositivoDestino,
    mensaje: MensajePush,
    opciones: OpcionesPush,
  ): Promise<ResultadoPush> {
    if (destino.endpoint.includes('/falla/')) {
      throw new Error('El servicio de push rechazó el envío (HTTP 500).');
    }
    if (destino.endpoint.includes('/caducado/')) return 'caducado';
    const registro: PushEnviado = {
      endpoint: destino.endpoint,
      mensaje,
      opciones,
      enviadoAt: new Date(this.reloj.ahora()).toISOString(),
    };
    this.enviados.push(registro);
    if (this.directorio) {
      await mkdir(this.directorio, { recursive: true });
      await writeFile(
        join(this.directorio, `${registro.enviadoAt.slice(0, 10)}.jsonl`),
        `${JSON.stringify(registro)}\n`,
        { flag: 'a' },
      );
    }
    return 'entregado';
  }

  /** Vacía la bandeja (entre tests). */
  vaciar(): void {
    this.enviados.length = 0;
  }
}
