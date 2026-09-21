import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiOkResponse,
  ApiOperation,
  ApiPayloadTooLargeResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AgenteActual, AutenticacionAgente } from '../agentes/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { AgenteAutenticado } from '../auth/request-autenticado';
import { LIMITE_BODY_JSON } from '../configurar-app';
import { LoteIngestaDto, MODELOS_EVENTO, ResultadoIngestaDto } from './dto/ingesta.dto';
import { IngestaService } from './ingesta.service';

/** La ingesta del agente de la sucursal (F1-031), autenticada con su API key. */
@ApiTags('agente')
@ApiExtraModels(...MODELOS_EVENTO)
@AutenticacionAgente()
@Controller('ingesta')
export class IngestaController {
  constructor(private readonly ingesta: IngestaService) {}

  @Post('eventos')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recibe un lote mixto de eventos (cheques, snapshot de mesas, heartbeat).',
    description:
      'Idempotente: reenviar el mismo lote deja exactamente los mismos datos. Cheques por ' +
      '(sucursal, folioSr), reemplazando partidas y pagos; snapshots por (sucursal, ' +
      'capturadoAt), con 24 h de histórico más el último; heartbeat al estado del agente. ' +
      'La sucursal sale de la API key: ningún evento manda ids de tenant. Acepta ' +
      '`Content-Encoding: gzip`. Todo lote con sobre válido registra además el CONTACTO del ' +
      'agente (reloj del servidor, `agente_contacto`; lo lee `GET /agentes/estado`), aunque sus ' +
      'eventos salgan rechazados. El contacto queda fuera de la idempotencia a propósito: un ' +
      'reenvío lo mueve, porque el agente sí volvió a hablar; los datos quedan idénticos. El ' +
      'heartbeat puede traer `tamanoCola`.',
  })
  @ApiOkResponse({
    type: ResultadoIngestaDto,
    description: 'Siempre 200 si el sobre es válido, aunque haya eventos rechazados.',
  })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: 'Sobre inválido: `eventos` ausente, vacío, con más de 100 o con no-objetos.',
  })
  @ApiPayloadTooLargeResponse({
    description: `Body de más de ${LIMITE_BODY_JSON} (medido ya inflado si llegó en gzip). El agente debe partir el lote.`,
  })
  recibir(
    @AgenteActual() agente: AgenteAutenticado,
    @Body() lote: LoteIngestaDto,
  ): Promise<ResultadoIngestaDto> {
    return this.ingesta.procesarLote(agente, lote.eventos);
  }
}
