import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';

import { AgenteActual, AutenticacionAgente } from '../agentes/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { AgenteAutenticado } from '../auth/request-autenticado';
import { CatalogosIngestaService } from './catalogos-ingesta.service';
import {
  CierreCatalogoDto,
  MODELOS_REGISTRO,
  PaginaCatalogoDto,
  ResultadoCierreDto,
  ResultadoPaginaDto,
  SolicitudAgenteDto,
} from './dto/catalogos.dto';

const DESC_503 =
  'Falla transitoria (base, o el candado del catálogo lo tiene otra página o cierre de la misma ' +
  'sucursal). No se guardó nada: reenviar igual más tarde.';
const DESC_500 =
  'Falla determinista: no se guardó nada y reenviar lo mismo va a fallar igual. No reintentar en bucle.';

/** La ingesta de catálogos del agente de la sucursal (F2-230), con su API key. */
@ApiTags('agente')
@ApiExtraModels(...MODELOS_REGISTRO)
@AutenticacionAgente()
@Controller('ingesta/catalogos')
export class CatalogosIngestaController {
  constructor(private readonly catalogos: CatalogosIngestaService) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Recibe una página de un catálogo del POS (grupos, productos, meseros, clientes, áreas, canales).',
    description:
      'Idempotente: la misma página tres veces deja exactamente los mismos datos (ni ids, ni ' +
      '`updatedAt`, ni `vistoAt` cambian). Llave: (sucursal de la API key, `origenSrId`). Cada ' +
      'registro se valida aparte: uno inválido va a `rechazados` y los demás se guardan; si su ' +
      'fila ya existía se marca vista sin tocar su contenido. Un registro traído por una ' +
      'sincronización más nueva, o una página anterior a la última sincronización completa ' +
      'aplicada, sale en `obsoletos` y no revierte nada. Las páginas de una sincronización ' +
      'COMPLETA terminan con `POST /ingesta/catalogos/cierre`; sin cierre es incremental y no da ' +
      'de baja nada. El agente no intercala dos sincronizaciones del mismo catálogo. Registra el ' +
      'contacto del agente, como `/ingesta/eventos`.',
  })
  @ApiOkResponse({ type: ResultadoPaginaDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description:
      'Sobre inválido: catálogo desconocido, `sincronizacionId` no es uuid, fecha sin zona o más de ' +
      '5 min en el futuro, `registros` vacío, con más de 1000 o con no-objetos.',
  })
  @ApiServiceUnavailableResponse({ type: ErrorDto, description: DESC_503 })
  @ApiInternalServerErrorResponse({ type: ErrorDto, description: DESC_500 })
  pagina(
    @AgenteActual() agente: AgenteAutenticado,
    @Body() dto: PaginaCatalogoDto,
  ): Promise<ResultadoPaginaDto> {
    return this.catalogos.pagina(agente, dto);
  }

  @Post('cierre')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cierra una sincronización COMPLETA: da de baja lo que el POS ya no tiene.',
    description:
      'Marca `activo=false` (nunca borra; `vistoAt` se queda) a las filas del catálogo que no vio ' +
      'esta sincronización ni una más nueva. Antes cuadra: filas vistas por este ' +
      '`sincronizacionId` + `rechazados` >= `total`; si no, 409 y no se da de baja nada (faltan ' +
      'páginas). `total = 0` da de baja todo el catálogo (el POS no tiene ninguno). Idempotente: ' +
      'reenviar el último cierre aplicado no escribe; uno más viejo que el último aplicado ' +
      'responde `aplicado=false`.',
  })
  @ApiOkResponse({ type: ResultadoCierreDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: 'Cuerpo inválido, fecha en el futuro, o `rechazados` mayor que `total`.',
  })
  @ApiConflictResponse({
    type: ErrorDto,
    description:
      'No cuadra: faltan páginas de esta sincronización. Reintentar tras reenviarlas; si nunca ' +
      'cuadra (p. ej. se intercaló otra sincronización), abrir una nueva.',
  })
  @ApiServiceUnavailableResponse({ type: ErrorDto, description: DESC_503 })
  @ApiInternalServerErrorResponse({ type: ErrorDto, description: DESC_500 })
  cierre(
    @AgenteActual() agente: AgenteAutenticado,
    @Body() dto: CierreCatalogoDto,
  ): Promise<ResultadoCierreDto> {
    return this.catalogos.cierre(agente, dto);
  }

  @Get('solicitud')
  @ApiOperation({
    summary: '¿Pidió un admin sincronizar todos los catálogos de esta sucursal?',
    description:
      '`pendiente=true` mientras algún catálogo de los once (F2-230 + inventario de F2-120) no haya recibido un cierre después de ' +
      'la solicitud (hora de recepción del API). Un catálogo que el POS no usa se cierra con ' +
      '`total=0`. Registra el contacto del agente.',
  })
  @ApiOkResponse({ type: SolicitudAgenteDto })
  solicitud(@AgenteActual() agente: AgenteAutenticado): Promise<SolicitudAgenteDto> {
    return this.catalogos.solicitud(agente);
  }
}
