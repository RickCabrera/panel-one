import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
  ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';

import { Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  ConfiguracionGlobalDto,
  EmitirGlobalDto,
  EmpresaGlobalQueryDto,
  FacturaGlobalEmitidaDto,
  GuardarConfiguracionGlobalDto,
  PeriodosGlobalDto,
  PeriodosGlobalQueryDto,
  VistaPreviaGlobalDto,
  VistaPreviaGlobalQueryDto,
} from './dto/global.dto';
import { FacturaGlobalService } from './global.service';

const NO_ENCONTRADA =
  'La empresa o la sucursal no existen, están inactivas o no están en tu alcance (nunca 403).';

/**
 * Factura global a público en general (F2-108). Sólo administradores: la global es un CFDI que
 * gasta folios y ampara la venta de la sucursal.
 */
@ApiTags('facturacion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
@Controller('facturacion/global')
export class FacturaGlobalController {
  constructor(private readonly global: FacturaGlobalService) {}

  @Get('configuracion')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({ summary: 'Periodicidad de la factura global y si se emite sola (F2-108).' })
  @ApiOkResponse({ type: ConfiguracionGlobalDto })
  @ApiNotFoundResponse({ type: ErrorDto, description: NO_ENCONTRADA })
  configuracion(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: EmpresaGlobalQueryDto,
  ): Promise<ConfiguracionGlobalDto> {
    return this.global.configuracion(scope, q.empresaId);
  }

  @Put('configuracion')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Guarda la periodicidad de la global y la emisión automática (F2-108).',
    description:
      'Al encender la automática se anota desde cuándo: el programador sólo emite periodos que ' +
      'terminen DESPUÉS (los anteriores se emiten a mano). Default: mensual y manual.',
  })
  @ApiOkResponse({ type: ConfiguracionGlobalDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Cuerpo mal formado.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: NO_ENCONTRADA })
  guardar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: GuardarConfiguracionGlobalDto,
  ): Promise<ConfiguracionGlobalDto> {
    const u = req.usuario!;
    return this.global.guardarConfiguracion(scope, { id: u.id, rol: u.rol }, dto.empresaId, {
      periodicidad: dto.periodicidad,
      automatica: dto.automatica,
    });
  }

  @Get('periodos')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Periodos de la sucursal con tickets para la global, y las globales emitidas (F2-108).',
    description:
      'Un ticket entra a la global sólo cuando su código ya no se puede autofacturar. Periodos ' +
      'cortados en la zona de la sucursal, desde el 1 de enero del año anterior.',
  })
  @ApiOkResponse({ type: PeriodosGlobalDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros mal formados.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: NO_ENCONTRADA })
  periodos(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: PeriodosGlobalQueryDto,
  ): Promise<PeriodosGlobalDto> {
    return this.global.periodos(scope, q.empresaId, q.sucursalId, q.periodicidad);
  }

  @Get('periodos/:clave')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({ summary: 'Vista previa de la global de un periodo (F2-108).' })
  @ApiParam({ name: 'clave', example: '2026-08-01', description: 'Primer día local del periodo.' })
  @ApiOkResponse({ type: VistaPreviaGlobalDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'La clave no es inicio de un periodo.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: NO_ENCONTRADA })
  vistaPrevia(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('clave') clave: string,
    @Query() q: VistaPreviaGlobalQueryDto,
  ): Promise<VistaPreviaGlobalDto> {
    return this.global.vistaPrevia(scope, q.empresaId, {
      sucursalId: q.sucursalId,
      periodicidad: q.periodicidad,
      clave,
    });
  }

  @Post()
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Emite la factura global de un periodo (F2-108).',
    description:
      'Público en general (XAXX010101000, 616, S01), un concepto por ticket (01010101, ACT) e ' +
      'InformacionGlobal (periodicidad, meses, año). Los tickets incluidos quedan `en_global` y el ' +
      'portal ya no los factura.',
  })
  @ApiCreatedResponse({ type: FacturaGlobalEmitidaDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Clave o cuerpo inválidos.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: NO_ENCONTRADA })
  @ApiConflictResponse({
    type: ErrorDto,
    description:
      'El periodo no ha terminado, todavía hay tickets que se pueden autofacturar, o no queda ' +
      'ninguno que incluir (otra global ya los tomó).',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorDto,
    description: 'Año fuera de plazo, sin forma de pago declarable, o el PAC la rechazó.',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorDto,
    description: 'Sin perfil fiscal activo o CSD vigente, o el PAC no está disponible.',
  })
  @ApiBadGatewayResponse({
    type: ErrorDto,
    description: 'El PAC no confirmó (pudo emitirse): los tickets siguen reservados hasta conciliarla (F2-110b).',
  })
  emitir(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: EmitirGlobalDto,
  ): Promise<FacturaGlobalEmitidaDto> {
    const u = req.usuario!;
    return this.global.emitir(scope, { id: u.id, rol: u.rol }, dto.empresaId, {
      sucursalId: dto.sucursalId,
      periodicidad: dto.periodicidad,
      clave: dto.clave,
    });
  }
}
