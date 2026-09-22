import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
import {
  EnviarTraspasoDto,
  TraspasoDetalleDto,
  TraspasoEmpresaDto,
  TraspasosDto,
  TraspasosQueryDto,
  TraspasosSrDto,
  TraspasosSrQueryDto,
} from './dto/traspasos.dto';
import { TraspasosService } from './traspasos.service';

const DESC_404 =
  'La empresa no existe o no está en tu alcance, una sucursal no es de esa empresa, un almacén no ' +
  'es de su sucursal, o el traspaso no es de esa empresa. Misma respuesta en todos los casos ' +
  '(nunca 403).';
const DESC_409 = 'El traspaso ya no está enviado (recibido o cancelado).';
const DESC_503 = 'Otra operación tiene los traspasos de la empresa; reintentar.';

@ApiTags('inventario')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@Controller('inventario/traspasos')
export class TraspasosController {
  constructor(private readonly traspasos: TraspasosService) {}

  @Get()
  @ApiOperation({
    summary: 'Traspasos del panel (F2-124), los más recientes primero.',
    description:
      'Con su flujo (enviado → recibido) y su conciliación contra SoftRestaurant: "pendiente de ' +
      'registrar en SR" hasta que la sincronización trae su salida y su entrada (artículo + ' +
      'cantidad + fecha ± 1 día); sin conciliar pasado el umbral de la regla (48 h) queda en ' +
      'alerta. Un traspaso es dato del panel: NUNCA se escribe a SR.',
  })
  @ApiOkResponse({ type: TraspasosDto })
  listar(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: TraspasosQueryDto,
  ): Promise<TraspasosDto> {
    return this.traspasos.listar(scope, q);
  }

  @Get('sr')
  @ApiOperation({
    summary: 'Traspasos LEÍDOS de SoftRestaurant en un rango (pólizas de traspaso de F2-122).',
    description:
      'Las pólizas `traspaso_salida` y `traspaso_entrada`, agrupadas por la referencia del ' +
      'documento de SR, con los traspasos del panel conciliados contra ellas.',
  })
  @ApiOkResponse({ type: TraspasosSrDto })
  leidosDeSr(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: TraspasosSrQueryDto,
  ): Promise<TraspasosSrDto> {
    return this.traspasos.leidosDeSr(scope, q);
  }

  @Post()
  @HttpCode(201)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Envía un traspaso (1.ª confirmación): de un almacén a otro de la misma empresa.',
    description:
      'Congela el costo promedio de la foto del almacén de origen (nulo si no viene). No valida ' +
      'contra la existencia. Queda "pendiente de registrar en SR": el traspaso se captura también ' +
      'en SoftRestaurant, y el panel lo concilia solo cuando la sincronización lo trae.',
  })
  @ApiCreatedResponse({ type: TraspasoDetalleDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiServiceUnavailableResponse({ type: ErrorDto, description: DESC_503 })
  enviar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: EnviarTraspasoDto,
  ): Promise<TraspasoDetalleDto> {
    const { id, rol } = req.usuario!;
    return this.traspasos.enviar({ id, rol }, scope, dto);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Un traspaso con sus renglones, su importe y sus movimientos espejo en SR.',
    description:
      'Importe = round(cantidad × costo, 2) por renglón; sin costo no suma (se cuenta aparte). Un ' +
      'espejo se muestra sólo mientras sigue vigente (su póliza no se canceló ni cambió).',
  })
  @ApiOkResponse({ type: TraspasoDetalleDto })
  detalle(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: TraspasoEmpresaDto,
  ): Promise<TraspasoDetalleDto> {
    return this.traspasos.detalle(scope, id, q.empresaId);
  }

  @Post(':id/recibir')
  @HttpCode(200)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({ summary: 'Confirma la recepción (2.ª confirmación). Sólo desde enviado.' })
  @ApiOkResponse({ type: TraspasoDetalleDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiConflictResponse({ type: ErrorDto, description: DESC_409 })
  @ApiServiceUnavailableResponse({ type: ErrorDto, description: DESC_503 })
  recibir(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TraspasoEmpresaDto,
  ): Promise<TraspasoDetalleDto> {
    const { id: actor, rol } = req.usuario!;
    return this.traspasos.recibir({ id: actor, rol }, scope, id, dto.empresaId);
  }

  @Post(':id/cancelar')
  @HttpCode(200)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Cancela un traspaso enviado que SR todavía no registra (queda visible).',
  })
  @ApiOkResponse({ type: TraspasoDetalleDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiConflictResponse({
    type: ErrorDto,
    description: `${DESC_409} O SR ya tiene movimientos de este traspaso.`,
  })
  @ApiServiceUnavailableResponse({ type: ErrorDto, description: DESC_503 })
  cancelar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: TraspasoEmpresaDto,
  ): Promise<TraspasoDetalleDto> {
    const { id: actor, rol } = req.usuario!;
    return this.traspasos.cancelar({ id: actor, rol }, scope, id, dto.empresaId);
  }
}
