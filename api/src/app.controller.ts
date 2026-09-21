import { Controller, Get } from '@nestjs/common';

import { AppService } from './app.service';

/**
 * Andamio del carril /api. `GET /` NO es contrato: la fuente única del contrato es
 * el OpenAPI, que nace en F1-033. No construyas nada contra esta ruta.
 */
@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  estado(): { servicio: string; estado: string } {
    return this.appService.estado();
  }
}
