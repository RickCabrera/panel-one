import { Body, Controller, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import {
  ApiBadGatewayResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
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
  ErrorCapturaRepetidaDto,
  ErrorFacturaAdminDto,
  FacturaEmitidaAdminDto,
  FacturaManualDto,
  RefacturarDto,
  ResultadoRefacturacionDto,
} from './dto/emision-admin.dto';
import {
  EmisionAdminService,
  type FacturaEmitidaAdmin,
  type ResultadoRefacturacion,
} from './emision-admin.service';

const DESC_AMBIGUO =
  'El PAC no confirmó a tiempo (la factura pudo emitirse): no la vuelvas a pedir sin revisar la ' +
  'tabla de facturas; o el PAC no contestó al consultar el estado (no se emitió nada).';

/**
 * Emisiones de administrador (F2-107): factura sin ticket y refacturación. Sólo administradores;
 * todo lo que no está en el alcance es 404 (nunca 403).
 */
@ApiTags('facturacion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
@ApiServiceUnavailableResponse({
  type: ErrorDto,
  description:
    'La empresa no puede emitir (sin perfil fiscal activo o CSD vigente), la plataforma se quedó ' +
    'sin folios de timbrado (F2-110; se responde ANTES de llamar al PAC), o el PAC no está disponible.',
})
@ApiBadGatewayResponse({ type: ErrorDto, description: DESC_AMBIGUO })
@ApiUnprocessableEntityResponse({ type: ErrorDto, description: 'El PAC rechazó el CFDI.' })
@Controller('facturacion')
export class EmisionAdminController {
  constructor(private readonly emision: EmisionAdminService) {}

  @Post('cfdis/manual')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Factura sin ticket: emite un CFDI por un importe capturado a mano (F2-107).',
    description:
      'Queda con `origen = manual`, ligada a la sucursal y sin cheque. Mismo concepto e importes ' +
      'que la factura de un ticket (subtotal = total / 1.16). La `solicitudId` hace que un doble ' +
      'clic o un reenvío no emitan dos veces (409 con el CFDI que ya salió).',
  })
  @ApiCreatedResponse({ type: FacturaEmitidaAdminDto })
  @ApiBadRequestResponse({
    type: ErrorFacturaAdminDto,
    description: 'Receptor o total inválidos (un mensaje por campo), o cuerpo mal formado.',
  })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description: 'La empresa o la sucursal no existen, están inactivas o no están en tu alcance.',
  })
  @ApiConflictResponse({
    type: ErrorCapturaRepetidaDto,
    description: 'Esta `solicitudId` ya se usó (emitida o en emisión).',
  })
  manual(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: FacturaManualDto,
  ): Promise<FacturaEmitidaAdmin> {
    const u = req.usuario!;
    return this.emision.emitirManual(scope, { id: u.id, rol: u.rol }, dto);
  }

  @Post('cfdis/:id/refacturar')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary:
      'Refactura un CFDI vigente: sustituto con relación 04 + cancelación motivo 01 (F2-107).',
    description:
      'En el orden que exige el SAT: consulta al PAC que el CFDI siga vigente, emite el SUSTITUTO ' +
      '(receptor corregido, mismos importes, `TipoRelacion` 04 con el UUID anterior) y cancela el ' +
      'anterior con motivo 01 y el UUID del sustituto. Si la cancelación no sale, responde 201 con ' +
      '`cancelacion = pendiente`: repetir la petición reintenta SÓLO la cancelación. Un CFDI ' +
      'vigente con sustituto vigente ya no suma a lo facturado del tablero.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: ResultadoRefacturacionDto })
  @ApiBadRequestResponse({
    type: ErrorFacturaAdminDto,
    description: 'Receptor inválido (un mensaje por campo), o el id no es un UUID.',
  })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description: 'El CFDI no existe, es una reserva o no está en tu alcance (nunca 403).',
  })
  @ApiConflictResponse({
    type: ErrorDto,
    description:
      'Ya está cancelado, tiene un sustituto en emisión o cancelado, o el PAC no lo ve vigente ' +
      '(`no_encontrado`/`cancelado`): no se emitió nada.',
  })
  refacturar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: RefacturarDto,
  ): Promise<ResultadoRefacturacion> {
    const u = req.usuario!;
    return this.emision.refacturar(scope, { id: u.id, rol: u.rol }, id, dto.receptor);
  }
}
