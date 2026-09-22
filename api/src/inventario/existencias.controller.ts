import { Body, Controller, Get, Put, Query, Req } from '@nestjs/common';
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
import type { RequestAutenticado } from '../auth/request-autenticado';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  ExistenciasDto,
  ExistenciasQueryDto,
  FilaExistenciaDto,
  GuardarLimitesDto,
} from './dto/existencias.dto';
import { ExistenciasService } from './existencias.service';

const DESC_404 =
  'La empresa no existe o no está en tu alcance, la sucursal no es de esa empresa, o el artículo ' +
  'no tiene existencia ni límite en ese almacén. Misma respuesta en todos los casos (nunca 403).';

@ApiTags('inventario')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@Controller('inventario/existencias')
export class ExistenciasController {
  constructor(private readonly existencias: ExistenciasService) {}

  @Get()
  @ApiOperation({
    summary: 'Existencias por artículo, sucursal y almacén, con su valor y su semáforo (F2-121).',
    description:
      'La última foto que el agente mandó de cada almacén (`POST /ingesta/existencias`), con los ' +
      'nombres de los catálogos espejo y los mínimos/máximos del panel. KPIs sobre las filas del ' +
      'filtro (sucursal, almacén, búsqueda). Un artículo con límite que ya no viene en la foto sale ' +
      '`sin_lectura`. Una sucursal sin ninguna lectura lo dice en `sucursales[].almacenesLeidos`.',
  })
  @ApiOkResponse({ type: ExistenciasDto })
  listar(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: ExistenciasQueryDto,
  ): Promise<ExistenciasDto> {
    return this.existencias.listar(scope, q);
  }

  @Put('limites')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Guarda el mínimo y el máximo de un artículo en su almacén (NUNCA escribe a SR).',
    description:
      'Son nuestros: viven en Postgres, la ingesta no los toca y sobreviven a que el artículo salga ' +
      'de la foto. Los dos nulos = se borran. Mínimo mayor que máximo = 400. Responde la fila.',
  })
  @ApiOkResponse({ type: FilaExistenciaDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  guardarLimites(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: GuardarLimitesDto,
  ): Promise<FilaExistenciaDto> {
    const { id, rol } = req.usuario!;
    return this.existencias.guardarLimites({ id, rol }, scope, dto);
  }
}
