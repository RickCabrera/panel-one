import { Body, Controller, Get, HttpCode, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
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

import { Public } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { SoloThrottlers, THROTTLER_BAJA } from '../auth/throttlers';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  BajaReportesDto,
  BajaReportesRespuestaDto,
  EmpresaReportesQueryDto,
  GuardarSuscripcionDto,
  SuscripcionReporteDto,
  VistaPreviaDto,
  VistaPreviaQueryDto,
} from './dto/reportes.dto';
import { ReportesService, type SuscripcionVista, type VistaPrevia } from './reportes.service';

const DESC_404 =
  'La empresa no existe o no está en tu alcance. Misma respuesta en los dos casos (nunca 403).';

/**
 * Los reportes por correo del PROPIO usuario (F2-141), para cualquier rol: cada quien decide
 * qué le llega a su correo. Vive bajo `/cuenta` como el cambio de contraseña.
 */
@ApiTags('cuenta')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@Controller('cuenta/reportes')
export class CuentaReportesController {
  constructor(private readonly reportes: ReportesService) {}

  @Get()
  @ApiOperation({
    summary: 'Qué reportes por correo tiene activos el usuario para esa empresa.',
    description:
      'Sin suscripción guardada, los dos en false. Incluye la zona y la hora de envío y los ' +
      'últimos 10 envíos.',
  })
  @ApiOkResponse({ type: SuscripcionReporteDto })
  obtener(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: EmpresaReportesQueryDto,
  ): Promise<SuscripcionVista> {
    const { id, rol } = req.usuario!;
    return this.reportes.suscripcion({ id, rol }, scope, q.empresaId);
  }

  @Put()
  @ApiOperation({
    summary: 'Activa o apaga el resumen diario y el semanal del usuario para esa empresa.',
    description:
      'El diario sale todos los días a las 07:00 de la zona de la empresa con la venta de ' +
      'ayer; el semanal, los lunes a la misma hora con la semana anterior.',
  })
  @ApiOkResponse({ type: SuscripcionReporteDto })
  guardar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: GuardarSuscripcionDto,
  ): Promise<SuscripcionVista> {
    const { id, rol } = req.usuario!;
    return this.reportes.guardar({ id, rol }, scope, dto.empresaId, {
      diario: dto.diario,
      semanal: dto.semanal,
    });
  }

  @Get('vista-previa')
  @ApiOperation({
    summary: 'El correo que tocaría hoy, ya armado, para revisarlo sin esperar a las 7.',
    description:
      'Mismas cifras que el panel para el mismo periodo (ayer, o la semana pasada). No manda ' +
      'nada ni escribe nada.',
  })
  @ApiOkResponse({ type: VistaPreviaDto })
  vistaPrevia(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: VistaPreviaQueryDto,
  ): Promise<VistaPrevia> {
    const { id, rol } = req.usuario!;
    return this.reportes.vistaPrevia({ id, rol }, scope, q.empresaId, q.tipo);
  }
}

/** La baja desde el correo (F2-141): SIN sesión. El token firmado es la credencial. */
@ApiTags('reportes')
@Controller('reportes')
export class BajaReportesController {
  constructor(private readonly reportes: ReportesService) {}

  @Post('baja')
  @Public()
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_BAJA)
  @HttpCode(200)
  @ApiOperation({
    summary: 'Deja de recibir un reporte (o los dos) con el token del enlace del correo.',
    description:
      'Pública. Es POST a propósito: los escáneres de correo abren los enlaces (GET) y no deben ' +
      'dar a nadie de baja; la página del panel pide confirmar. Idempotente.',
  })
  @ApiOkResponse({ type: BajaReportesRespuestaDto, description: 'Cómo quedó la suscripción.' })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Cuerpo inválido.' })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description: 'Token inválido, alterado o de una suscripción que ya no existe.',
  })
  @ApiTooManyRequestsResponse({ description: 'Más de 10 intentos por minuto desde la misma IP.' })
  baja(@Body() dto: BajaReportesDto): Promise<BajaReportesRespuestaDto> {
    return this.reportes.baja(dto.token, dto.tipo);
  }
}
