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
import { LoteRecetasDto, ResultadoRecetasDto } from './dto/recetas.dto';
import { RecetasIngestaService } from './recetas-ingesta.service';

/** La ingesta de recetas (explosión de insumos por producto) del agente de la sucursal (F2-125). */
@ApiTags('agente')
@AutenticacionAgente()
@Controller('ingesta/recetas')
export class RecetasIngestaController {
  constructor(private readonly recetas: RecetasIngestaService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Recibe un lote de recetas del POS, cada una con todos sus renglones.',
    description:
      'Upsert por (sucursal de la API key, `productoOrigenSrId`). Idempotente: el mismo lote tres ' +
      'veces (también con los renglones en otro orden) deja exactamente los mismos datos. Una ' +
      'receta que cambió REEMPLAZA sus renglones. Una receta guardada con una lectura más nueva ' +
      'que `leidoAt` no se toca (`obsoletas`). Cada receta se valida aparte: una inválida, o con ' +
      'algún renglón inválido, va a `rechazadas` sin tocar lo guardado. Nunca se borra una ' +
      'receta: la que SR ya no tenga se manda con `renglones: []`. Registra el contacto del agente.',
  })
  @ApiOkResponse({ type: ResultadoRecetasDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description:
      'Sobre inválido: `leidoAt` sin zona o más de 5 min en el futuro, `recetas` vacío, no ' +
      'arreglo, con más de 500 o con no-objetos, más de 5000 renglones en total, o un campo de ' +
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
    @Body() dto: LoteRecetasDto,
  ): Promise<ResultadoRecetasDto> {
    return this.recetas.recibir(agente, dto);
  }
}
