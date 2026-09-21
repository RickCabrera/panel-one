import { Body, Controller, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';

import { THROTTLER_AGENTE } from '../agentes/throttle-agente';
import { Auditoria } from '../comun/auditoria';
import { AUTH_CONFIG, COOKIE_REFRESH, type AuthConfig } from '../config/auth.config';
import { responderSesion } from './auth.controller';
import { AuthService } from './auth.service';
import { CambiarPasswordDto } from './dto/password.dto';
import { ErrorDto, SesionDto } from './dto/sesion.dto';
import type { RequestAutenticado } from './request-autenticado';

/**
 * La cuenta del propio usuario (F1-060), para CUALQUIER rol. Vive fuera de
 * `/auth` a propósito: el cliente web no refresca ante un 401 de `/auth/*`, y
 * aquí un access token vencido sí debe refrescarse y reintentar.
 */
@ApiTags('cuenta')
@ApiBearerAuth()
@Controller('cuenta')
export class CuentaController {
  constructor(
    private readonly auth: AuthService,
    private readonly auditoria: Auditoria,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Post('password')
  // Mismo límite que el login (5/min por IP): adivinar la contraseña actual con
  // un token robado no sale más barato que por el login.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ [THROTTLER_AGENTE]: true })
  @HttpCode(200)
  @ApiOperation({
    summary: 'Cambia la contraseña del usuario autenticado.',
    description:
      'Invalida todos sus refresh tokens anteriores (otros navegadores) y devuelve una sesión ' +
      `nueva: pone la cookie \`${COOKIE_REFRESH}\` igual que el login. Los access tokens ya ` +
      'emitidos siguen valiendo hasta que venzan (15 min).',
  })
  @ApiOkResponse({ type: SesionDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: 'Cuerpo inválido (la nueva mide 12..128) o la contraseña actual no es correcta.',
  })
  @ApiUnauthorizedResponse({
    type: ErrorDto,
    description: 'Sin token, token inválido o vencido, o usuario/empresa ya inactivos.',
  })
  @ApiTooManyRequestsResponse({ description: 'Más de 5 intentos por minuto desde la misma IP.' })
  async cambiarPassword(
    @Req() req: RequestAutenticado,
    @Body() dto: CambiarPasswordDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SesionDto> {
    // El JwtAuthGuard global garantiza `req.usuario` en toda ruta no pública.
    const usuario = req.usuario!;
    const emitida = await this.auth.cambiarPassword(usuario.id, dto.actual, dto.nueva);
    this.auditoria.registrar(usuario, {
      accion: 'usuario.cambiar_password',
      recurso: 'usuario',
      recursoId: usuario.id,
      empresaId: usuario.empresaId,
    });
    return responderSesion(emitida, res, this.config);
  }
}
