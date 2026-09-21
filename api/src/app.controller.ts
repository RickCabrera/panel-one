import { Controller, Get } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';

import { AppService } from './app.service';
import { Public } from './auth/decoradores';

/**
 * Andamio del carril /api. `GET /` NO es contrato: la fuente única del contrato es
 * `api/openapi.json` (F1-011), y esta ruta queda fuera a propósito. No construyas
 * nada contra ella. Es pública: es la señal de vida del proceso.
 */
@ApiExcludeController()
@Public()
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  estado(): { servicio: string; estado: string } {
    return this.appService.estado();
  }
}
