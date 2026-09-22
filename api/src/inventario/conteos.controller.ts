import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';

import { Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ConteosService } from './conteos.service';
import {
  CapturaRespuestaDto,
  CapturarConteoDto,
  ConteoDetalleDto,
  ConteoEmpresaDto,
  ConteosDto,
  ConteosQueryDto,
  CrearConteoDto,
} from './dto/conteos.dto';

const DESC_404 =
  'La empresa no existe o no está en tu alcance, la sucursal no es de esa empresa, el almacén o el ' +
  'grupo no son de esa sucursal, o el conteo no es de esa empresa. Misma respuesta en todos los ' +
  'casos (nunca 403).';
const DESC_409_ESTADO = 'El conteo ya no está en captura (cerrado o cancelado).';
const DESC_503 = 'Otra operación tiene el conteo; reintentar.';

@ApiTags('inventario')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@Controller('inventario/conteos')
export class ConteosController {
  constructor(private readonly conteos: ConteosService) {}

  @Get()
  @ApiOperation({
    summary: 'Conteos físicos de la empresa (F2-123), los más recientes primero.',
    description:
      'Con su avance (contados de artículos), y lo necesario para crear uno: los almacenes (con ' +
      'la lectura de existencias que servirá de teórico; sin lectura no se puede contar) y los ' +
      'grupos de insumos. Un conteo es dato del panel: NUNCA se escribe a SoftRestaurant.',
  })
  @ApiOkResponse({ type: ConteosDto })
  listar(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: ConteosQueryDto,
  ): Promise<ConteosDto> {
    return this.conteos.listar(scope, q);
  }

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Crea un conteo de un almacén (todos sus artículos o los de un grupo).',
    description:
      'El teórico se CONGELA al crear: la última foto de existencias del almacén (cantidad y ' +
      'costo promedio) y su corte. Una foto posterior no lo cambia. Un artículo del catálogo que ' +
      'no viene en la foto va "sin teórico", nunca 0. Almacén sin ninguna lectura = 409.',
  })
  @ApiCreatedResponse({ type: ConteoDetalleDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiConflictResponse({
    type: ErrorDto,
    description: 'El almacén no tiene lectura de existencias.',
  })
  @ApiServiceUnavailableResponse({ type: ErrorDto, description: DESC_503 })
  crear(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: CrearConteoDto,
  ): Promise<ConteoDetalleDto> {
    const { id, rol } = req.usuario!;
    return this.conteos.crear({ id, rol }, scope, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Un conteo con sus renglones y el reporte de diferencias contra el teórico.',
    description:
      'Diferencia = contado − teórico; importe = round(diferencia × costo, 2) por renglón, y los ' +
      'totales son la Σ de esos importes. Sin contar y sin teórico van aparte, nunca como 0. En ' +
      'captura el reporte es preliminar.',
  })
  @ApiOkResponse({ type: ConteoDetalleDto })
  detalle(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: ConteoEmpresaDto,
  ): Promise<ConteoDetalleDto> {
    return this.conteos.detalle(scope, id, q.empresaId);
  }

  @Put(':id/partidas')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Guarda lo contado de un lote de renglones (todo o nada, idempotente).',
    description:
      'Poner el mismo valor otra vez no cambia nada. Nulo = borrar lo capturado. Un artículo que ' +
      'no es del conteo, o repetido en el lote, = 400 sin guardar nada. El último en llegar gana.',
  })
  @ApiOkResponse({ type: CapturaRespuestaDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiConflictResponse({ type: ErrorDto, description: DESC_409_ESTADO })
  @ApiServiceUnavailableResponse({ type: ErrorDto, description: DESC_503 })
  capturar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CapturarConteoDto,
  ): Promise<CapturaRespuestaDto> {
    const { id: actor, rol } = req.usuario!;
    return this.conteos.capturar({ id: actor, rol }, scope, id, dto);
  }

  @Post(':id/cerrar')
  @HttpCode(200)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Cierra el conteo: ya no admite captura y su reporte queda final.',
    description:
      'Lo que quede sin contar se reporta aparte (no se asume 0). NO ajusta nada en SR: el ' +
      'reporte es para que el encargado registre el ajuste allá.',
  })
  @ApiOkResponse({ type: ConteoDetalleDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiConflictResponse({ type: ErrorDto, description: DESC_409_ESTADO })
  @ApiServiceUnavailableResponse({ type: ErrorDto, description: DESC_503 })
  cerrar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConteoEmpresaDto,
  ): Promise<ConteoDetalleDto> {
    const { id: actor, rol } = req.usuario!;
    return this.conteos.cerrar({ id: actor, rol }, scope, id, dto.empresaId);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({ summary: 'Cancela un conteo en captura (queda visible, sin reporte final).' })
  @ApiOkResponse({ type: ConteoDetalleDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiConflictResponse({ type: ErrorDto, description: DESC_409_ESTADO })
  @ApiServiceUnavailableResponse({ type: ErrorDto, description: DESC_503 })
  cancelar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ConteoEmpresaDto,
  ): Promise<ConteoDetalleDto> {
    const { id: actor, rol } = req.usuario!;
    return this.conteos.cancelar({ id: actor, rol }, scope, id, dto.empresaId);
  }
}
