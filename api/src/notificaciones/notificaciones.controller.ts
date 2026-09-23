import { Body, Controller, Delete, Get, HttpCode, Post, Put, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';

import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { SoloThrottlers, THROTTLER_PRUEBA_PUSH } from '../auth/throttlers';
import {
  NotificacionesDto,
  PreferenciasPushDto,
  QuitarDispositivoDto,
  RegistrarDispositivoDto,
  ResultadoPruebaDto,
} from './dto/notificaciones.dto';
import {
  NotificacionesService,
  type NotificacionesVista,
  type ResultadoEnvio,
} from './notificaciones.service';

/**
 * Las notificaciones push del PROPIO usuario (F2-146), para cualquier rol. Vive bajo
 * `/cuenta` como la contraseña y los reportes: el usuario sale del token, nunca del cuerpo.
 */
@ApiTags('cuenta')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Cuerpo inválido.' })
@Controller('cuenta/notificaciones')
export class NotificacionesController {
  constructor(private readonly notificaciones: NotificacionesService) {}

  @Get()
  @ApiOperation({
    summary: 'Qué notificaciones tiene activas el usuario y cuántos navegadores registró.',
    description: 'Incluye la llave pública VAPID para suscribir el navegador.',
  })
  @ApiOkResponse({ type: NotificacionesDto })
  obtener(@Req() req: RequestAutenticado): Promise<NotificacionesVista> {
    return this.notificaciones.vista(req.usuario!);
  }

  @Put('preferencias')
  @ApiOperation({
    summary: 'Activa o apaga cada notificación por separado.',
    description:
      'Aplica a todos los navegadores del usuario. Las alertas usan además el umbral y el ' +
      'encendido de la regla de la EMPRESA (centro de alertas): una regla apagada no avisa.',
  })
  @ApiOkResponse({ type: NotificacionesDto })
  preferencias(
    @Req() req: RequestAutenticado,
    @Body() dto: PreferenciasPushDto,
  ): Promise<NotificacionesVista> {
    return this.notificaciones.guardarPreferencias(req.usuario!, {
      mesaAbierta: dto.mesaAbierta,
      sucursalSinReporte: dto.sucursalSinReporte,
      foliosBajo: dto.foliosBajo,
      cierreDia: dto.cierreDia,
    });
  }

  @Post('dispositivos')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Registra (o renueva) este navegador para recibir notificaciones.',
    description:
      'Idempotente. El panel lo llama cada vez que abre en un navegador suscrito: un navegador ' +
      'sin renovarse en 7 días, o registrado antes de un cambio de contraseña, deja de recibir.',
  })
  @ApiOkResponse({ type: NotificacionesDto })
  registrar(
    @Req() req: RequestAutenticado,
    @Body() dto: RegistrarDispositivoDto,
  ): Promise<NotificacionesVista> {
    return this.notificaciones.registrarDispositivo(req.usuario!, {
      endpoint: dto.endpoint,
      p256dh: dto.keys.p256dh,
      auth: dto.keys.auth,
    });
  }

  @Delete('dispositivos')
  @ApiOperation({ summary: 'Da de baja este navegador (desactivar, o cerrar sesión).' })
  @ApiOkResponse({ type: NotificacionesDto })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description: 'El navegador no está registrado a tu nombre. Misma respuesta si no existe.',
  })
  quitar(
    @Req() req: RequestAutenticado,
    @Body() dto: QuitarDispositivoDto,
  ): Promise<NotificacionesVista> {
    return this.notificaciones.quitarDispositivo(req.usuario!, dto.endpoint);
  }

  @Post('prueba')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_PRUEBA_PUSH)
  @ApiOperation({ summary: 'Manda una notificación de prueba a los navegadores del usuario.' })
  @ApiOkResponse({ type: ResultadoPruebaDto })
  @ApiTooManyRequestsResponse({ description: 'Más de 5 pruebas por minuto desde la misma IP.' })
  prueba(@Req() req: RequestAutenticado): Promise<ResultadoEnvio> {
    return this.notificaciones.prueba(req.usuario!);
  }
}
