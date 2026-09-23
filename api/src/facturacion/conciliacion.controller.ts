import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiForbiddenResponse,
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
import type { ResumenConciliacion } from './conciliacion';
import { ConciliacionPacService } from './conciliacion.service';
import { ResumenConciliacionDto } from './dto/conciliacion.dto';

/** Conciliación con el PAC a pedido (F2-110b). Sólo administradores. */
@ApiTags('facturacion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
@Controller('facturacion')
export class ConciliacionController {
  constructor(private readonly conciliacion: ConciliacionPacService) {}

  @Post('conciliacion')
  @HttpCode(200)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary:
      'Concilia contra el PAC lo que la emisión o la cancelación dejaron sin saber (F2-110b).',
    description:
      'Lo mismo que hace el programador cada 15 min, a pedido y sólo dentro de tu alcance (un ' +
      'admin_empresa concilia su empresa; un admin_global, todas). Resuelve: reservas colgadas en ' +
      '`timbrando` de más de 15 min (si el PAC las timbró se confirman; si no las tiene en dos ' +
      'búsquedas separadas 15 min, se liberan), cancelaciones `sin_confirmar` que el PAC registró ' +
      'tarde, refacturaciones con la cancelación 01 pendiente, y facturas vigentes sin XML/PDF. Un ' +
      'error del PAC no falla la llamada: el elemento se cuenta en `fallidas` y se reintenta solo.',
  })
  @ApiOkResponse({ type: ResumenConciliacionDto })
  conciliar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
  ): Promise<ResumenConciliacion> {
    const u = req.usuario!;
    return this.conciliacion.conciliar(scope, { id: u.id, rol: u.rol });
  }
}
