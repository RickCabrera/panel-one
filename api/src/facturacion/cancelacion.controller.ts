import { Body, Controller, HttpCode, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
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
  CancelacionCfdiService,
  type ConsultaCancelacionCfdi,
  type ResultadoCancelacionCfdi,
} from './cancelacion.service';
import {
  CancelarCfdiDto,
  ConsultaCancelacionDto,
  ResultadoCancelacionDto,
} from './dto/cancelacion.dto';
import { ErrorFacturaAdminDto } from './dto/emision-admin.dto';

/**
 * Cancelación de CFDI (F2-109). Sólo administradores; todo lo que no está en el alcance es 404
 * (nunca 403).
 */
@ApiTags('facturacion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
@ApiNotFoundResponse({
  type: ErrorDto,
  description: 'El CFDI no existe, es una reserva o no está en tu alcance (nunca 403).',
})
@ApiServiceUnavailableResponse({
  type: ErrorDto,
  description: 'El PAC no está disponible: no se canceló nada (no queda solicitud).',
})
@ApiBadGatewayResponse({
  type: ErrorDto,
  description:
    'El PAC no confirmó (la cancelación pudo registrarse): la solicitud se queda `solicitando` y ' +
    'NO se vuelve a pedir; se consulta con `cancelacion/consultar` (o el sondeo) pasados 10 min.',
})
@Controller('facturacion')
export class CancelacionController {
  constructor(private readonly cancelacion: CancelacionCfdiService) {}

  @Post('cfdis/:id/cancelar')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Solicita la cancelación de un CFDI vigente ante el SAT (F2-109).',
    description:
      'Primero CONSULTA al PAC (una cancelación que ya ocurrió sólo se anota) y, si sigue vigente, ' +
      'la pide con el motivo. Si el receptor tiene que aceptarla queda `en_proceso` (la factura ' +
      'sigue vigente); al quedar cancelada: deja de sumar a lo facturado, se avisa al receptor por ' +
      'correo, y con motivo 02/03 el ticket vuelve a poderse facturar (su código regresa a ' +
      '`pendiente`); una global cancelada suelta sus tickets para otra global. El motivo 01 exige ' +
      'el UUID del sustituto que dejó la refacturación.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiCreatedResponse({ type: ResultadoCancelacionDto })
  @ApiBadRequestResponse({
    type: ErrorFacturaAdminDto,
    description: 'Motivo inválido, motivo 01 sin `uuidSustitucion`, o id que no es UUID.',
  })
  @ApiConflictResponse({
    type: ErrorDto,
    description:
      'Ya está cancelada; ya tiene una solicitud abierta; el motivo no aplica (01 sin sustituto o ' +
      'con otro UUID, 04 fuera de una global, 01 en una global, otro motivo con una refacturación ' +
      'en curso o hecha, o un sustituto cuyo anterior sigue vigente); o el PAC no la conoce.',
  })
  @ApiUnprocessableEntityResponse({ type: ErrorDto, description: 'El PAC rechazó la cancelación.' })
  cancelar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: CancelarCfdiDto,
  ): Promise<ResultadoCancelacionCfdi> {
    const u = req.usuario!;
    return this.cancelacion.solicitar(scope, { id: u.id, rol: u.rol }, id, dto);
  }

  @Post('cfdis/:id/cancelacion/consultar')
  @HttpCode(200)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary:
      'Consulta al PAC la solicitud de cancelación abierta de un CFDI y la resuelve (F2-109).',
    description:
      'Lo mismo que hace el sondeo automático, a pedido. Una solicitud `solicitando` de menos de ' +
      '10 min no se toca (puede ir una llamada en vuelo).',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: ConsultaCancelacionDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'El id no es un UUID.' })
  @ApiConflictResponse({
    type: ErrorDto,
    description: 'La factura no tiene una solicitud abierta, o el PAC no la conoce.',
  })
  consultar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<ConsultaCancelacionCfdi> {
    const u = req.usuario!;
    return this.cancelacion.actualizar(scope, { id: u.id, rol: u.rol }, id);
  }
}
