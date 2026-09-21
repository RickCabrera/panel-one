import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /**
   * Señal de vida del proceso, sin tocar base de datos. El `/health` de verdad
   * —el que además responde `db:'ok'`— es de F1-002, que necesita el Postgres
   * levantado y es tarea diurna.
   */
  estado(): { servicio: string; estado: string } {
    return { servicio: 'monitor-api', estado: 'arriba' };
  }
}
