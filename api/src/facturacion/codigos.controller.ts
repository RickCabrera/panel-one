import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';

import { Public } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import { SoloThrottlers, THROTTLER_CODIGO } from '../auth/throttlers';
import { CodigosFacturacionService } from './codigos.service';
import { ConsultaCodigoDto } from './dto/codigo.dto';

/**
 * La consulta de un código de facturación desde el portal de autofactura (F2-101): SIN sesión.
 * Controlador aparte para que no herede el `@ApiBearerAuth` de `FacturacionController`.
 */
@ApiTags('facturacion')
@Controller('facturacion')
export class CodigoFacturacionPublicoController {
  constructor(private readonly codigos: CodigosFacturacionService) {}

  @Get('codigo/:codigo')
  @Public()
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_CODIGO)
  @ApiOperation({
    summary: 'Estado de un código de facturación y, si se puede facturar, los datos del ticket.',
    description:
      'Pública (sin sesión), 10 consultas por minuto por IP. Acepta minúsculas y espacios ' +
      'alrededor. `ticket` (sucursal, fecha, total, vencimiento) viene SÓLO con ' +
      '`estado = pendiente`; con `expirado`, `facturado`, `en_global` o `cancelado` es `null`.',
  })
  @ApiParam({ name: 'codigo', example: '7JQRECP3U' })
  @ApiOkResponse({ type: ConsultaCodigoDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: 'No tiene el formato (9 de A–Z y 2–9 sin O, 0, I, 1). No se busca en la base.',
  })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description: 'No existe (o su sucursal o empresa están dadas de baja). Mismo cuerpo siempre.',
  })
  @ApiTooManyRequestsResponse({ description: 'Más de 10 consultas por minuto desde la misma IP.' })
  consultar(@Param('codigo') codigo: string): Promise<ConsultaCodigoDto> {
    return this.codigos.consultar(codigo);
  }
}
