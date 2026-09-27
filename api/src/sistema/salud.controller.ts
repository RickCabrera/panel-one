import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { Public } from '../auth/decoradores';
import { SaludBaseService } from '../prisma/salud-base';
import { SaludDto } from './dto/salud.dto';

@ApiTags('sistema')
@Public()
@Controller('health')
export class SaludController {
  constructor(private readonly base: SaludBaseService) {}

  @Get()
  @ApiOperation({
    summary: 'Señal de vida de la instancia: la API y su base de datos.',
    description:
      'Pública (sin token): la consultan el healthcheck del contenedor y el monitor de ' +
      'disponibilidad (F1-002, F1-004). No lee ninguna tabla ni expone versión o detalles ' +
      'del error.',
  })
  @ApiOkResponse({ type: SaludDto, description: 'La API y la base responden.' })
  @ApiServiceUnavailableResponse({
    type: SaludDto,
    description: 'La base no contestó en 3 s: `{ status: "error", db: "error" }`.',
  })
  async salud(): Promise<SaludDto> {
    if (await this.base.responde()) {
      return { status: 'ok', db: 'ok' };
    }
    const caida: SaludDto = { status: 'error', db: 'error' };
    throw new ServiceUnavailableException(caida);
  }
}
