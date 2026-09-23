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
import { LoteComprasDto, ResultadoComprasDto } from './dto/compras.dto';
import { ComprasIngestaService } from './compras-ingesta.service';

/** La ingesta de compras a proveedor del agente de la sucursal (F2-126). */
@ApiTags('agente')
@AutenticacionAgente()
@Controller('ingesta/compras')
export class ComprasIngestaController {
  constructor(private readonly compras: ComprasIngestaService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recibe un lote de compras a proveedor del POS, cada una con todas sus partidas.',
    description:
      'Upsert por (sucursal de la API key, `origenSrId`). Idempotente: el mismo lote tres veces ' +
      'deja exactamente los mismos datos. Una compra que cambió REEMPLAZA su cabecera y sus ' +
      'partidas (una corrección no duplica). Una compra guardada con una lectura más nueva que ' +
      '`leidoAt` no se toca (`obsoletas`). Cada compra se valida aparte: una inválida, o con ' +
      'alguna partida inválida, va a `rechazadas` sin tocar lo guardado. Nunca se borra una ' +
      'compra: se anula mandándola `cancelada`. Importes y total SIN IVA, calculados por el API. ' +
      'Registra el contacto del agente.',
  })
  @ApiOkResponse({ type: ResultadoComprasDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description:
      'Sobre inválido: `leidoAt` sin zona o más de 5 min en el futuro, `compras` vacío, no ' +
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
    @Body() dto: LoteComprasDto,
  ): Promise<ResultadoComprasDto> {
    return this.compras.recibir(agente, dto);
  }
}
