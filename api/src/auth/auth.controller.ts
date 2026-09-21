import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';

import {
  AUTH_CONFIG,
  COOKIE_REFRESH,
  COOKIE_REFRESH_PATH,
  REFRESH_TTL_SEGUNDOS,
  type AuthConfig,
} from '../config/auth.config';
import { THROTTLER_AGENTE } from '../agentes/throttle-agente';
import { AuthService, type SesionEmitida } from './auth.service';
import { Public } from './decoradores';
import { LoginDto } from './dto/login.dto';
import { ErrorDto, SesionDto, UsuarioActualDto } from './dto/sesion.dto';
import type { RequestAutenticado } from './request-autenticado';
import { THROTTLER_LOGIN, THROTTLER_REFRESH } from './throttlers';

const DESCRIPCION_COOKIE =
  `Pone la cookie \`${COOKIE_REFRESH}\` (httpOnly, SameSite=Strict, Path=${COOKIE_REFRESH_PATH}, ` +
  `7 días; Secure en producción) con el refresh token.`;

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  @Post('login')
  @Public()
  // Rate limit: 5 intentos por minuto por IP (throttler `login` de AuthModule).
  // Cuenta todo intento, también los 400 y los 401.
  @UseGuards(ThrottlerGuard)
  // Ni el de refresh ni el de agentes (por sucursal: aquí no hay agente) aplican.
  @SkipThrottle({ [THROTTLER_REFRESH]: true, [THROTTLER_AGENTE]: true })
  @HttpCode(200)
  @ApiOperation({ summary: 'Inicia sesión. ' + DESCRIPCION_COOKIE })
  @ApiOkResponse({ type: SesionDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Cuerpo inválido.' })
  @ApiUnauthorizedResponse({
    type: ErrorDto,
    description:
      'Credenciales inválidas. Misma respuesta para email inexistente, contraseña mala, ' +
      'usuario inactivo o empresa inactiva.',
  })
  @ApiTooManyRequestsResponse({ description: 'Más de 5 intentos por minuto desde la misma IP.' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SesionDto> {
    return this.responder(await this.auth.login(dto.email, dto.password), res);
  }

  @Post('refresh')
  @Public()
  // Rate limit: 30 por minuto por IP (throttler `refresh`). No gasta los intentos
  // del login, y el de agentes truena sin agente en el request: se saltan los dos.
  @UseGuards(ThrottlerGuard)
  @SkipThrottle({ [THROTTLER_LOGIN]: true, [THROTTLER_AGENTE]: true })
  @HttpCode(200)
  @ApiCookieAuth(COOKIE_REFRESH)
  @ApiOperation({
    summary: `Emite un access token nuevo a partir de la cookie de refresh y la rota. ${DESCRIPCION_COOKIE}`,
  })
  @ApiOkResponse({ type: SesionDto })
  @ApiUnauthorizedResponse({
    type: ErrorDto,
    description: 'Sin cookie, cookie inválida o vencida, o usuario/empresa ya inactivos.',
  })
  @ApiTooManyRequestsResponse({ description: 'Más de 30 refresh por minuto desde la misma IP.' })
  async refresh(
    @Req() req: RequestAutenticado,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SesionDto> {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    return this.responder(await this.auth.refrescar(cookies?.[COOKIE_REFRESH]), res);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'El usuario autenticado, leído de la base.' })
  @ApiOkResponse({ type: UsuarioActualDto })
  @ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
  me(@Req() req: RequestAutenticado): Promise<UsuarioActualDto> {
    // El JwtAuthGuard global garantiza `req.usuario` en toda ruta no pública.
    return this.auth.usuarioActual(req.usuario!.id);
  }

  private responder(emitida: SesionEmitida, res: Response): SesionDto {
    return responderSesion(emitida, res, this.config);
  }
}

/**
 * Pone la cookie de refresh y devuelve el cuerpo de la sesión. La usan el login,
 * el refresh y el cambio de contraseña propio (`CuentaController`, F1-060): la
 * cookie sale siempre con los mismos atributos, aunque la ruta no sea `/auth`.
 */
export function responderSesion(
  { sesion, refreshToken }: SesionEmitida,
  res: Response,
  config: AuthConfig,
): SesionDto {
  res.cookie(COOKIE_REFRESH, refreshToken, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.cookieSegura,
    path: COOKIE_REFRESH_PATH,
    maxAge: REFRESH_TTL_SEGUNDOS * 1000,
  });
  return sesion;
}
