import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  /**
   * Señal de vida del proceso, sin tocar base de datos. La que además responde
   * `db:'ok'` es `GET /health` (F1-002, `sistema/salud.controller.ts`).
   */
  estado(): { servicio: string; estado: string } {
    return { servicio: 'monitor-api', estado: 'arriba' };
  }
}
