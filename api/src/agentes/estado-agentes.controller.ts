import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';

import { Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { EstadoAgenteSucursalDto, EstadoAgentesQueryDto } from './dto/estado-agentes.dto';
import { EstadoAgentesService, type EstadoAgenteSucursal } from './estado-agentes.service';

@ApiTags('agentes')
@ApiBearerAuth()
@Controller('agentes')
export class EstadoAgentesController {
  constructor(private readonly estado: EstadoAgentesService) {}

  @Get('estado')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Estado del agente de cada sucursal activa de la empresa (F1-061).',
    description:
      'Una fila por sucursal activa, también las que nunca reportaron (todo null). Devuelve ' +
      'edades en segundos; qué es "desconectado" lo decide el panel. Sin cache.',
  })
  @ApiOkResponse({ type: [EstadoAgenteSucursalDto] })
  @ApiBadRequestResponse({ type: ErrorDto, description: '`empresaId` ausente o no es un UUID.' })
  @ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description:
      'La empresa no existe o no está en tu alcance. Misma respuesta en los dos casos (nunca 403).',
  })
  deEmpresa(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: EstadoAgentesQueryDto,
  ): Promise<EstadoAgenteSucursal[]> {
    return this.estado.deEmpresa(scope, q.empresaId);
  }
}
