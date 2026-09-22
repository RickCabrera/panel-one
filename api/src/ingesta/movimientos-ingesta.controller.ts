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
import { LoteMovimientosDto, ResultadoMovimientosDto } from './dto/movimientos.dto';
import { MovimientosIngestaService } from './movimientos-ingesta.service';

/** La ingesta de pólizas y movimientos de inventario del agente de la sucursal (F2-122). */
@ApiTags('agente')
@AutenticacionAgente()
@Controller('ingesta/movimientos')
export class MovimientosIngestaController {
  constructor(private readonly movimientos: MovimientosIngestaService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recibe un lote de pólizas de inventario del POS, cada una con todas sus partidas.',
    description:
      'Upsert por (sucursal de la API key, `origenSrId`). Idempotente: el mismo lote tres veces ' +
      'deja exactamente los mismos datos. Una póliza que cambió REEMPLAZA su cabecera y sus ' +
      'partidas (una corrección no duplica). Una póliza guardada con una lectura más nueva que ' +
      '`leidoAt` no se toca (`obsoletas`). Cada póliza se valida aparte: una inválida, o con ' +
      'alguna partida inválida, va a `rechazadas` sin tocar lo guardado. Nunca se borra una ' +
      'póliza: se anula mandándola `cancelada`. Registra el contacto del agente.',
  })
  @ApiOkResponse({ type: ResultadoMovimientosDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description:
      'Sobre inválido: `leidoAt` sin zona o más de 5 min en el futuro, `polizas` vacío, no ' +
      'arreglo, con más de 200 o con no-objetos, más de 5000 partidas en total, o un campo de ' +
      'más en el sobre.',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorDto,
    description:
      'Falla transitoria (base, o el candado lo tiene otro lote de la misma sucursal). No se ' +
      'guardó nada: reenviar igual más tarde.',
  })
  @ApiInternalServerErrorResponse({
    type: ErrorDto,
    description:
      'Falla determinista: no se guardó nada y reenviar lo mismo va a fallar igual. No reintentar en bucle.',
  })
  recibir(
    @AgenteActual() agente: AgenteAutenticado,
    @Body() dto: LoteMovimientosDto,
  ): Promise<ResultadoMovimientosDto> {
    return this.movimientos.recibir(agente, dto);
  }
}
