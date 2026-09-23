import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiQuery,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RolUsuario } from '@prisma/client';
import type { Response } from 'express';

import { Public, Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { SoloThrottlers, THROTTLER_PORTAL } from '../auth/throttlers';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { EnvioCfdiDto, EnviosQueryDto } from './dto/entrega.dto';
import { EntregaCfdiService } from './entrega.service';

/** Cabeceras de toda descarga de un XML/PDF de CFDI: se baja, no se interpreta. */
function cabecerasDescarga(res: Response, tipo: string, nombre: string): void {
  res.set({
    'Content-Type': tipo,
    'Content-Disposition': `attachment; filename="${nombre.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'",
    'Cache-Control': 'private, no-store',
  });
}

const DESC_404_CFDI =
  'El CFDI no existe, es de otra empresa, o no tiene ese archivo guardado. Misma respuesta ' +
  'siempre (nunca 403).';

/** La entrega de facturas vista desde la administración (F2-105). */
@ApiTags('facturacion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@Controller('facturacion')
export class EntregaController {
  constructor(private readonly entrega: EntregaCfdiService) {}

  @Get('cfdis/:id/xml')
  @ApiOperation({
    summary: 'Descarga el XML de un CFDI emitido (F2-105).',
    description: 'Cualquier rol, dentro de su alcance. Se sirve como adjunto con `nosniff`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/xml')
  @ApiOkResponse({ description: 'Los bytes del XML.' })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'El id no es un UUID.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404_CFDI })
  xml(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.#descargar(scope, id, 'xml', res);
  }

  @Get('cfdis/:id/pdf')
  @ApiOperation({
    summary: 'Descarga el PDF de un CFDI emitido (F2-105).',
    description: 'Cualquier rol, dentro de su alcance. Se sirve como adjunto con `nosniff`.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiProduces('application/pdf')
  @ApiOkResponse({ description: 'Los bytes del PDF.' })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'El id no es un UUID.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404_CFDI })
  pdf(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    return this.#descargar(scope, id, 'pdf', res);
  }

  async #descargar(
    scope: EmpresaScope,
    id: string,
    extension: 'xml' | 'pdf',
    res: Response,
  ): Promise<StreamableFile> {
    const { contenido, tipo, nombre } = await this.entrega.descargar(scope, id, extension);
    cabecerasDescarga(res, tipo, nombre);
    return new StreamableFile(contenido);
  }

  @Get('envios')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Envíos de facturas por correo que hay que reintentar (F2-105).',
    description:
      'Fallidos (el servicio de correo falló) y atorados (se quedaron `enviando` más de 10 min). ' +
      'Hasta 500, los más recientes primero.',
  })
  @ApiOkResponse({ type: EnvioCfdiDto, isArray: true })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description: 'La empresa no existe o no está en tu alcance (nunca 403).',
  })
  envios(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: EnviosQueryDto,
  ): Promise<EnvioCfdiDto[]> {
    return this.entrega.envios(scope, q.empresaId, q.estado);
  }

  @Post('cfdis/:id/envios/reintento')
  @HttpCode(200)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Reintenta el correo de un CFDI cuyo envío falló o se quedó atorado (F2-105).',
    description:
      'Sin cuerpo: el correo sale SIEMPRE al del receptor con que se timbró. Orden: alcance (404) ' +
      '→ archivos guardados (409) → hay un envío fallido o atorado (409; si dos lo piden a la vez, ' +
      'sólo uno lo manda) → correo. Responde cómo quedó el envío: `fallido` otra vez si el ' +
      'servicio de correo volvió a fallar.',
  })
  @ApiParam({ name: 'id', format: 'uuid' })
  @ApiOkResponse({ type: EnvioCfdiDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'El id no es un UUID.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description: 'El CFDI no existe o es de otra empresa (nunca 403).',
  })
  @ApiConflictResponse({
    type: ErrorDto,
    description:
      'No hay nada que reintentar (el envío ya salió, se está enviando ahora, o no existe), o el ' +
      'CFDI no tiene sus archivos guardados (se recupera del PAC), o está CANCELADO (F2-109).',
  })
  reintentar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<EnvioCfdiDto> {
    const u = req.usuario!;
    return this.entrega.reintentar(scope, { id: u.id, rol: u.rol }, id);
  }
}

/**
 * La descarga por enlace FIRMADO (F2-105): la credencial es la firma, sin sesión. La usa la
 * pantalla de éxito del portal de autofactura. Controlador aparte para no heredar el bearer.
 */
@ApiTags('facturacion')
@Controller('archivos')
export class ArchivosPublicosController {
  constructor(private readonly entrega: EntregaCfdiService) {}

  @Get('*clave')
  @Public()
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_PORTAL)
  @ApiOperation({
    summary: 'Descarga un XML o PDF de CFDI por enlace firmado y temporal (F2-105).',
    description:
      'Pública (60/min por IP): la firma es la credencial y vence (1 h desde que la dio el ' +
      'portal). Sólo sirve archivos de CFDI (`cfdi/…` que terminan en .xml o .pdf). Firma ' +
      'alterada o vencida, clave inválida o archivo inexistente: el MISMO 404.',
  })
  @ApiParam({ name: 'clave', example: 'cfdi/<empresaId>/2026/09/<UUID>.pdf' })
  @ApiQuery({ name: 'expira', description: 'Segundos Unix en que vence el enlace.' })
  @ApiQuery({ name: 'firma', description: 'HMAC del enlace.' })
  @ApiProduces('application/xml', 'application/pdf')
  @ApiOkResponse({ description: 'Los bytes del archivo, como adjunto.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: 'Enlace inválido, vencido o sin archivo.' })
  @ApiTooManyRequestsResponse({ description: 'Más de 60 por minuto desde la misma IP.' })
  async descargar(
    @Param('clave') clave: string | string[],
    @Query('expira') expira: string | undefined,
    @Query('firma') firma: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const ruta = Array.isArray(clave) ? clave.join('/') : String(clave ?? '');
    const segundos = /^\d{1,12}$/.test(expira ?? '') ? Number(expira) : NaN;
    const r = await this.entrega.descargaPublica(
      ruta,
      segundos,
      typeof firma === 'string' ? firma : '',
    );
    cabecerasDescarga(res, r.tipo, r.nombre);
    return new StreamableFile(r.contenido);
  }
}
