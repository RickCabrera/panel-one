import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ErrorDto } from '../auth/dto/sesion.dto';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { MesasQueryDto, MesasSucursalDto } from './dto/mesas.dto';
import { MesasService, type MesasSucursal } from './mesas.service';

@ApiTags('mesas')
@ApiBearerAuth()
@Controller('mesas')
export class MesasController {
  constructor(private readonly mesas: MesasService) {}

  @Get('abiertas')
  @ApiOperation({
    summary: 'Cuentas abiertas: el último snapshot de cada sucursal y la edad del dato.',
    description:
      'Una fila por sucursal en alcance (también las que nunca mandaron snapshot, con ' +
      '`snapshot: null`). Sin cache: es el dato en vivo.',
  })
  @ApiOkResponse({ type: [MesasSucursalDto] })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
  @ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description:
      'La empresa no existe o no está en tu alcance, o la sucursal no es de esa empresa. ' +
      'Misma respuesta en todos los casos (nunca 403).',
  })
  abiertas(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: MesasQueryDto,
  ): Promise<MesasSucursal[]> {
    return this.mesas.abiertas(scope, q.empresaId, q.sucursalId);
  }
}
