import { Controller, Header, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';

import { Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ApiKeyService } from './api-key.service';
import { ApiKeyEmitidaDto } from './dto/agentes.dto';

@ApiTags('agentes')
@ApiBearerAuth()
@Controller('sucursales')
export class SucursalApiKeyController {
  constructor(private readonly apiKeys: ApiKeyService) {}

  @Post(':id/api-key')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @HttpCode(201)
  // La key en claro no se queda en ninguna caché intermedia.
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Genera la API key del agente de la sucursal, o la rota si ya tenía una.',
    description:
      'La key se devuelve UNA sola vez; en la base queda su hash. Rotar invalida la key ' +
      'anterior de inmediato: el siguiente request del agente con ella es 401. Si llegan dos ' +
      'rotaciones a la vez, las dos responden 201 pero sólo la última key queda vigente.',
  })
  @ApiCreatedResponse({ type: ApiKeyEmitidaDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: '`id` no es un UUID.' })
  @ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description: 'La sucursal no existe o es de otra empresa. Misma respuesta en los dos casos.',
  })
  rotar(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ApiKeyEmitidaDto> {
    return this.apiKeys.rotar(scope, id);
  }
}
