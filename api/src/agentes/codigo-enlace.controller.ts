import {
  Body,
  Controller,
  Header,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RolUsuario } from '@prisma/client';
import type { Request } from 'express';

import { Public, Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { SoloThrottlers, THROTTLER_ENLACE, THROTTLER_ENLACE_CODIGO } from '../auth/throttlers';
import { Auditoria } from '../comun/auditoria';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { CodigoEnlaceService } from './codigo-enlace.service';
import { CanjeEnlaceDto, CodigoEnlaceEmitidoDto, EnlaceCanjeadoDto } from './dto/enlace.dto';

/** Emitir el código de enlace de una sucursal (Administración › Sucursales › Conectar sucursal). */
@ApiTags('agentes')
@ApiBearerAuth()
@Controller('sucursales')
export class SucursalCodigoEnlaceController {
  constructor(
    private readonly servicio: CodigoEnlaceService,
    private readonly auditoria: Auditoria,
  ) {}

  @Post(':id/codigo-enlace')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Genera el código de enlace del instalador de un clic para una sucursal.',
    description:
      'Un código corto (`K7P-42X`) que el instalador cambia por la API key de la sucursal en ' +
      '`POST /agente/enlace`. Se devuelve UNA sola vez (en la base queda su hash), sirve UNA vez ' +
      'y vence a los 30 min. Generar otro invalida el anterior sin usar. Generarlo NO toca la ' +
      'key vigente: ésa se rota hasta que el instalador canjea el código.',
  })
  @ApiCreatedResponse({ type: CodigoEnlaceEmitidoDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: '`id` no es un UUID.' })
  @ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description: 'La sucursal no existe o es de otra empresa. Misma respuesta en los dos casos.',
  })
  @ApiConflictResponse({
    type: ErrorDto,
    description: 'La sucursal o su empresa están dadas de baja.',
  })
  async emitir(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: RequestAutenticado,
  ): Promise<CodigoEnlaceEmitidoDto> {
    const { empresaId, ...emitido } = await this.servicio.emitir(scope, id, req.usuario!.id);
    // Sin el código, ni en claro ni su hash.
    this.auditoria.registrar(req.usuario!, {
      accion: 'sucursal.codigo_enlace',
      recurso: 'sucursal',
      recursoId: emitido.sucursalId,
      empresaId,
    });
    return emitido;
  }
}

/**
 * El canje del instalador: SIN sesión ni API key (el código es la credencial). Controlador aparte
 * para no heredar el `@ApiBearerAuth`.
 */
@ApiTags('agente')
@Controller('agente/enlace')
export class CanjeEnlaceController {
  constructor(private readonly servicio: CodigoEnlaceService) {}

  @Post()
  @Public()
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_ENLACE, THROTTLER_ENLACE_CODIGO)
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  @ApiOperation({
    summary: 'Cambia un código de enlace por la API key de su sucursal (instalador de un clic).',
    description:
      'Pública. Devuelve una API key NUEVA de la sucursal (la anterior deja de servir) y quema el ' +
      'código: un segundo canje es 404. Límites: 20 por minuto por IP, 5 por código cada 15 min ' +
      '(de cualquier IP) y, tras 10 códigos equivocados en una hora desde la misma IP, 429 por el ' +
      'resto de esa hora. No existe, ya se usó, venció o la sucursal está dada de baja: el MISMO ' +
      '404, y no cambia nada.',
  })
  @ApiOkResponse({ type: EnlaceCanjeadoDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: 'Sin `codigo`, o no tiene el formato (6 de A–Z y 2–9 sin O, 0, I, 1).',
  })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description: 'Código que no sirve. Mismo cuerpo siempre.',
  })
  @ApiTooManyRequestsResponse({ description: 'Alguno de los tres límites.' })
  canjear(@Body() dto: CanjeEnlaceDto, @Req() req: Request): Promise<EnlaceCanjeadoDto> {
    return this.servicio.canjear(dto.codigo, req.ip ?? 'desconocida');
  }
}
