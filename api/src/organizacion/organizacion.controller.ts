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
import { EmpresaDto, SucursalDto, SucursalesQueryDto } from './dto/organizacion.dto';
import { OrganizacionService, type EmpresaVista, type SucursalVista } from './organizacion.service';

const DESC_401 = 'Sin token, token inválido o vencido.';

@ApiTags('organizacion')
@ApiBearerAuth()
@Controller('empresas')
export class EmpresasController {
  constructor(private readonly organizacion: OrganizacionService) {}

  @Get()
  @ApiOperation({
    summary: 'Empresas en tu alcance: la tuya, o todas si eres admin_global. Activas e inactivas.',
  })
  @ApiOkResponse({ type: [EmpresaDto] })
  @ApiUnauthorizedResponse({ type: ErrorDto, description: DESC_401 })
  listar(@EmpresaScopeActual() scope: EmpresaScope): Promise<EmpresaVista[]> {
    return this.organizacion.empresas(scope);
  }
}

/** Convive con `POST /sucursales/:id/api-key` (SucursalApiKeyController, F1-012). */
@ApiTags('organizacion')
@ApiBearerAuth()
@Controller('sucursales')
export class SucursalesController {
  constructor(private readonly organizacion: OrganizacionService) {}

  @Get()
  @ApiOperation({
    summary: 'Sucursales en tu alcance, activas e inactivas. Nunca incluye la API key ni su hash.',
  })
  @ApiOkResponse({ type: [SucursalDto] })
  @ApiBadRequestResponse({ type: ErrorDto, description: '`empresaId` no es un UUID.' })
  @ApiUnauthorizedResponse({ type: ErrorDto, description: DESC_401 })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description:
      'La empresa pedida no existe o no está en tu alcance. Misma respuesta (nunca 403).',
  })
  listar(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: SucursalesQueryDto,
  ): Promise<SucursalVista[]> {
    return this.organizacion.sucursales(scope, q.empresaId);
  }
}
