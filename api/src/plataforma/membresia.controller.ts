import { Controller, Get } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ErrorDto } from '../auth/dto/sesion.dto';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { RespuestaMembresiaDto } from './dto/plataforma.dto';
import { PlataformaService } from './plataforma.service';

/**
 * La membresía de la empresa del propio usuario (cualquier rol), para el aviso de "pago
 * pendiente" del panel. Vive en `/cuenta` y no en `/auth`: el web sí refresca ante un 401 aquí.
 */
@ApiTags('cuenta')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@Controller('cuenta')
export class MembresiaController {
  constructor(private readonly plataforma: PlataformaService) {}

  @Get('membresia')
  @ApiOperation({
    summary: 'El estado de la membresía de TU empresa (nulo para admin_global o sin suscripción).',
    description:
      'Sólo la de la empresa del token: nunca recibe un id. Con `vencida` el panel muestra el ' +
      'aviso de pago pendiente; el acceso sigue.',
  })
  @ApiOkResponse({ type: RespuestaMembresiaDto })
  async membresia(@EmpresaScopeActual() scope: EmpresaScope): Promise<RespuestaMembresiaDto> {
    return { membresia: await this.plataforma.membresiaPropia(scope) };
  }
}
