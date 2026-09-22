import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AgenteActual, AutenticacionAgente } from '../agentes/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { AgenteAutenticado } from '../auth/request-autenticado';
import { FotoExistenciasDto, ResultadoExistenciasDto } from './dto/existencias.dto';
import { ExistenciasIngestaService } from './existencias-ingesta.service';

/** La ingesta de existencias del agente de la sucursal (F2-121), con su API key. */
@ApiTags('agente')
@AutenticacionAgente()
@Controller('ingesta/existencias')
export class ExistenciasIngestaController {
  constructor(private readonly existencias: ExistenciasIngestaService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recibe la foto completa de las existencias de UN almacén del POS.',
    description:
      'Reemplaza lo que el panel sabe de ese almacén: crea lo nuevo, actualiza lo que cambió y ' +
      'BORRA lo que ya no viene. Idempotente: la misma foto tres veces deja exactamente los ' +
      'mismos datos. Llave: (sucursal de la API key, `almacenOrigenSrId`, `insumoOrigenSrId`). ' +
      'Cada registro se valida aparte: uno inválido va a `rechazados` y, si su insumo se puede ' +
      'identificar, su fila se queda como estaba; si algún rechazo no tiene insumo, la foto no ' +
      'borra nada (`ausentesConservados`). Una foto más vieja que la última aplicada del almacén ' +
      'responde `aplicado=false` sin escribir; con el mismo `capturadoAt` gana la que llega ' +
      'después. Nunca toca los mínimos y máximos del panel. Registra el contacto del agente.',
  })
  @ApiOkResponse({ type: ResultadoExistenciasDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description:
      'Sobre inválido: almacén vacío o de más de 64, fecha sin zona o más de 5 min en el futuro, ' +
      '`registros` no arreglo, con más de 5000 o con no-objetos, o un campo de más en el sobre.',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorDto,
    description:
      'Falla transitoria (base, o el candado del almacén lo tiene otra foto de la misma ' +
      'sucursal). No se guardó nada: reenviar igual más tarde.',
  })
  @ApiInternalServerErrorResponse({
    type: ErrorDto,
    description:
      'Falla determinista: no se guardó nada y reenviar lo mismo va a fallar igual. No reintentar en bucle.',
  })
  recibir(
    @AgenteActual() agente: AgenteAutenticado,
    @Body() dto: FotoExistenciasDto,
  ): Promise<ResultadoExistenciasDto> {
    return this.existencias.recibir(agente, dto);
  }
}
