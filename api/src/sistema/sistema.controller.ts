import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ADAPTADORES_CONFIG } from '../adaptadores/adaptadores.module';
import type { AdaptadoresConfig } from '../adaptadores/config';
import { Public } from '../auth/decoradores';
import { SistemaDto } from './dto/sistema.dto';

@ApiTags('sistema')
@Public()
@Controller('sistema')
export class SistemaController {
  constructor(@Inject(ADAPTADORES_CONFIG) private readonly config: AdaptadoresConfig) {}

  @Get()
  @ApiOperation({
    summary: 'Configuración pública del servidor que la interfaz necesita antes del login.',
    description:
      'Pública (sin token): la marca de "Datos de ejemplo" tiene que verse también en el ' +
      'login. No expone nada de ninguna empresa.',
  })
  @ApiOkResponse({ type: SistemaDto })
  sistema(): SistemaDto {
    return { modoDemo: this.config.modoDemo };
  }
}
