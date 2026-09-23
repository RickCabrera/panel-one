import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiBody,
  ApiConflictResponse,
  ApiConsumes,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiPayloadTooLargeResponse,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RolUsuario } from '@prisma/client';
import type { Request, Response } from 'express';

import { Public, Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { SoloThrottlers, THROTTLER_BINARIO_AGENTE } from '../auth/throttlers';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ActualizacionAgenteService } from './actualizacion-agente.service';
import {
  ActualizacionAutomaticaDto,
  ActualizacionAutomaticaHechaDto,
  PublicarVersionQueryDto,
  VersionAgenteDto,
} from './dto/actualizacion.dto';

const DESC_403_PLATAFORMA = 'No es admin_global (el canal es de la plataforma, no de una empresa).';

/**
 * El canal de versiones del agente (F2-143), desde la administración. Rutas de PLATAFORMA: el
 * binario es el mismo para todas las empresas, así que sólo el admin_global entra; los demás roles
 * reciben 403 POR LA RUTA (como el control de folios de F2-110): aquí no hay recurso de ninguna
 * empresa que se pudiera confirmar.
 */
@ApiTags('agentes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiForbiddenResponse({ type: ErrorDto, description: DESC_403_PLATAFORMA })
@Roles(RolUsuario.admin_global)
@Controller('agente/versiones')
export class VersionesAgenteController {
  constructor(private readonly servicio: ActualizacionAgenteService) {}

  @Get()
  @ApiOperation({
    summary: 'Las versiones publicadas del agente, de la más reciente a la más vieja (F2-143).',
    description:
      'La VIGENTE es la publicada más reciente que no esté retirada: es la que toman las ' +
      'sucursales con la actualización automática encendida.',
  })
  @ApiOkResponse({ type: VersionAgenteDto, isArray: true })
  listar(@EmpresaScopeActual() scope: EmpresaScope): Promise<VersionAgenteDto[]> {
    return this.servicio.listar(scope);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: 'Publica un binario del agente en el canal (F2-143).',
    description:
      'El cuerpo es el `agente.exe` tal cual (`application/octet-stream`, hasta 128 MB). El ' +
      'servidor calcula su SHA-256 y su tamaño. La versión nueva queda VIGENTE de inmediato: ' +
      'las sucursales con la bandera la toman en su siguiente revisión. La versión tiene que ' +
      'ser la misma que reporta el exe (su `AssemblyInformationalVersion` sin el `+commit`): ' +
      'si no, el agente la aplica una vez y la reporta como `version_distinta`.',
  })
  @ApiConsumes('application/octet-stream')
  @ApiBody({ schema: { type: 'string', format: 'binary' } })
  @ApiCreatedResponse({ type: VersionAgenteDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description:
      'Versión que no es X.Y.Z, cuerpo vacío o sin Content-Type application/octet-stream.',
  })
  @ApiConflictResponse({ type: ErrorDto, description: 'Esa versión ya existe (retirada o no).' })
  @ApiPayloadTooLargeResponse({ description: 'El binario pasa de 128 MB.' })
  publicar(
    @Req() req: RequestAutenticado & Request,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: PublicarVersionQueryDto,
  ): Promise<VersionAgenteDto> {
    return this.servicio.publicar(scope, req.usuario!, q.version, q.notas, req.body);
  }

  @Post(':version/retirar')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Retira una versión del canal (F2-143). Retirar la vigente es el rollback.',
    description:
      'Idempotente. Si era la vigente, la anterior publicada sin retirar vuelve a serlo, y las ' +
      'sucursales con la bandera regresan a ella (el agente compara por igualdad, no por "más ' +
      'nueva"). Una versión retirada ya no se descarga.',
  })
  @ApiParam({ name: 'version', example: '1.4.0' })
  @ApiOkResponse({ type: VersionAgenteDto })
  @ApiNotFoundResponse({ type: ErrorDto, description: 'No existe esa versión.' })
  retirar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('version') version: string,
  ): Promise<VersionAgenteDto> {
    return this.servicio.retirar(scope, req.usuario!, version);
  }
}

/**
 * La bandera de rollout gradual por sucursal (F2-143). Sólo el admin_global: encenderla hace que la
 * PC del restaurante cambie su propio binario, y quien decide eso es quien publica las versiones.
 */
@ApiTags('agentes')
@ApiBearerAuth()
@Controller('sucursales')
export class SucursalActualizacionController {
  constructor(private readonly servicio: ActualizacionAgenteService) {}

  @Put(':id/actualizacion-automatica')
  @Roles(RolUsuario.admin_global)
  @ApiOperation({
    summary: 'Enciende o apaga la actualización automática del agente de la sucursal (F2-143).',
    description:
      'Con la bandera, el agente toma la versión vigente del canal en su siguiente revisión. ' +
      'Apagarla no desinstala nada: el agente se queda con la versión que tenga.',
  })
  @ApiOkResponse({ type: ActualizacionAutomaticaHechaDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: '`id` no es un UUID o `activa` no es booleano.',
  })
  @ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403_PLATAFORMA })
  @ApiNotFoundResponse({ type: ErrorDto, description: 'La sucursal no existe.' })
  cambiar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ActualizacionAutomaticaDto,
  ): Promise<ActualizacionAutomaticaHechaDto> {
    return this.servicio.cambiarAutomatica(scope, req.usuario!, id, dto.activa);
  }
}

/**
 * La descarga del binario por enlace FIRMADO (F2-143). Sin sesión y sin API key: la firma es la
 * credencial (el agente no manda su key a este enlace, por si un día apunta a otro host).
 * Controlador aparte para no heredar ni el bearer ni la auth de agente.
 */
@ApiTags('agente')
@Controller('agente/binario')
export class BinarioAgenteController {
  constructor(private readonly servicio: ActualizacionAgenteService) {}

  @Get(':version')
  @Public()
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_BINARIO_AGENTE)
  @ApiOperation({
    summary: 'Descarga el binario de una versión del agente por enlace firmado (F2-143).',
    description:
      'Pública (10/min por IP): la firma es la credencial y vence a los 15 min de que la dio ' +
      '`GET /agente/version`. Firma alterada o vencida, versión inválida, retirada o sin ' +
      'archivo: el MISMO 404. Se sirve en streaming.',
  })
  @ApiParam({ name: 'version', example: '1.4.0' })
  @ApiQuery({ name: 'expira', description: 'Segundos Unix en que vence el enlace.' })
  @ApiQuery({ name: 'firma', description: 'HMAC del enlace.' })
  @ApiProduces('application/octet-stream')
  @ApiOkResponse({ description: 'Los bytes del binario, como adjunto.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: 'Enlace inválido, vencido o sin binario.' })
  @ApiTooManyRequestsResponse({ description: 'Más de 10 por minuto desde la misma IP.' })
  async descargar(
    @Param('version') version: string,
    @Query('expira') expira: string | undefined,
    @Query('firma') firma: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const segundos = /^\d{1,12}$/.test(expira ?? '') ? Number(expira) : NaN;
    const b = await this.servicio.binario(
      version,
      segundos,
      typeof firma === 'string' ? firma : '',
    );
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(b.bytes),
      'Content-Disposition': `attachment; filename="${b.nombre}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    });
    return new StreamableFile(b.flujo);
  }
}
