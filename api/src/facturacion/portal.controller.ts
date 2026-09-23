import {
  Body,
  Controller,
  Delete,
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
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiProduces,
  ApiBadGatewayResponse,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnprocessableEntityResponse,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RolUsuario } from '@prisma/client';
import type { Response } from 'express';

import { Public, Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import {
  SoloThrottlers,
  THROTTLER_CODIGO,
  THROTTLER_FACTURAS_PORTAL,
  THROTTLER_PORTAL,
} from '../auth/throttlers';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { RegimenFiscalDto } from './dto/facturacion.dto';
import {
  CatalogosSatDto,
  ConsultaCodigoPortalDto,
  ErrorEstadoCodigoDto,
  ErrorReceptorDto,
  FacturaPortalDto,
  GuardarPortalDto,
  LogoPortalDto,
  PortalesQueryDto,
  PortalPublicoDto,
  SolicitarFacturaDto,
  SucursalPortalDto,
  UsoCfdiDto,
} from './dto/portal.dto';
import { PortalFacturacionService } from './portal.service';
import { REGIMENES_FISCALES, USOS_CFDI } from './sat';

const DESC_404_PORTAL =
  'No hay portal con ese enlace, o el portal, su sucursal o su empresa están dados de baja. ' +
  'Mismo cuerpo siempre.';

/**
 * El portal público de autofactura (F2-103): SIN sesión. Controlador aparte para que no herede
 * el `@ApiBearerAuth` de los de administración. Cada ruta nombra sus throttlers por IP.
 */
@ApiTags('facturacion')
@Controller('facturacion')
export class PortalPublicoController {
  constructor(private readonly portal: PortalFacturacionService) {}

  @Get('catalogos-sat')
  @Public()
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_PORTAL)
  @ApiOperation({
    summary: 'Catálogos del SAT que usa el portal: c_RegimenFiscal y c_UsoCFDI (F2-103).',
    description:
      'Pública (60/min por IP). Cada uso trae los regímenes del receptor con que el SAT lo ' +
      'acepta; el servidor valida con estos mismos catálogos.',
  })
  @ApiOkResponse({ type: CatalogosSatDto })
  @ApiTooManyRequestsResponse({ description: 'Más de 60 por minuto desde la misma IP.' })
  catalogos(): CatalogosSatDto {
    return {
      regimenesFiscales: REGIMENES_FISCALES.map((r): RegimenFiscalDto => ({ ...r })),
      usosCfdi: USOS_CFDI.map((u): UsoCfdiDto => ({ ...u, regimenes: [...u.regimenes] })),
    };
  }

  @Get('portal/:slug')
  @Public()
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_PORTAL)
  @ApiOperation({
    summary: 'La marca del portal de una sucursal y si hoy puede emitir (F2-103).',
    description: 'Pública (60/min por IP). No trae datos de ningún ticket.',
  })
  @ApiParam({ name: 'slug', example: 'demo-centro' })
  @ApiOkResponse({ type: PortalPublicoDto })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404_PORTAL })
  @ApiTooManyRequestsResponse({ description: 'Más de 60 por minuto desde la misma IP.' })
  marca(@Param('slug') slug: string): Promise<PortalPublicoDto> {
    return this.portal.portal(slug);
  }

  @Get('portal/:slug/logo')
  @Public()
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_PORTAL)
  @ApiOperation({
    summary: 'El logo del portal (PNG, JPEG o WebP) (F2-103).',
    description:
      'Pública (60/min por IP). Se sirve con su tipo, `nosniff` y una CSP que no deja ejecutar ' +
      'nada. 404 también si el portal no tiene logo.',
  })
  @ApiParam({ name: 'slug', example: 'demo-centro' })
  @ApiProduces('image/png', 'image/jpeg', 'image/webp')
  @ApiOkResponse({ description: 'Los bytes del logo.' })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404_PORTAL })
  @ApiTooManyRequestsResponse({ description: 'Más de 60 por minuto desde la misma IP.' })
  async logo(
    @Param('slug') slug: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { logo, tipo } = await this.portal.logo(slug);
    res.set({
      'Content-Type': tipo,
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'",
      'Cache-Control': 'public, max-age=300',
    });
    return new StreamableFile(logo);
  }

  @Get('portal/:slug/codigo/:codigo')
  @Public()
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_CODIGO)
  @ApiOperation({
    summary: 'Un código de facturación visto desde el portal de una sucursal (F2-103).',
    description:
      'Pública, 10 por minuto por IP. Como `GET /facturacion/codigo/{codigo}` más el desglose ' +
      '(`subtotal`, `impuestos`) cuando suma exactamente el total. El código tiene que ser de ' +
      'una sucursal de la MISMA empresa que el portal; de otra empresa es el mismo 404 que uno ' +
      'que no existe. `ticket` sólo con `estado = pendiente`.',
  })
  @ApiParam({ name: 'slug', example: 'demo-centro' })
  @ApiParam({ name: 'codigo', example: '7JQRECP3U' })
  @ApiOkResponse({ type: ConsultaCodigoPortalDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'El código no tiene el formato.' })
  @ApiNotFoundResponse({
    type: ErrorDto,
    description: 'El portal no existe (ver arriba), o el código no existe en esta empresa.',
  })
  @ApiTooManyRequestsResponse({ description: 'Más de 10 consultas por minuto desde la misma IP.' })
  consultarCodigo(
    @Param('slug') slug: string,
    @Param('codigo') codigo: string,
  ): Promise<ConsultaCodigoPortalDto> {
    return this.portal.consultarCodigo(slug, codigo);
  }

  @Post('portal/:slug/facturas')
  @HttpCode(201)
  @Public()
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_FACTURAS_PORTAL)
  @ApiOperation({
    summary: 'Emite la factura (CFDI) de un código desde el portal (F2-103, F2-104).',
    description:
      'Pública, 5 por minuto por IP. Orden fijo: portal (404) → formato del código (400) → ' +
      'código de la empresa (404) → estado del código (409 con `estado`) → datos del receptor ' +
      '(400 con `campos`, un mensaje en español por campo) → emisión (F2-104): se RESERVA el ' +
      'CFDI con candado por código (doble clic = un solo CFDI; el segundo recibe 409 ' +
      '`en_proceso` o `facturado`), se timbra con el PAC y, con el timbre, en una sola operación ' +
      'el CFDI queda vigente, el código `facturado` y el receptor guardado como frecuente. Un ' +
      'rechazo del SAT sobre un dato del receptor vuelve como 400 con `campos` (mensaje en ' +
      'español, nunca el texto crudo del PAC) y no guarda nada.',
  })
  @ApiParam({ name: 'slug', example: 'demo-centro' })
  @ApiCreatedResponse({
    type: FacturaPortalDto,
    description:
      'CFDI timbrado (F2-105): el XML y el PDF quedan guardados y salen por correo al del ' +
      'receptor, con bitácora de envío. `descargas` trae enlaces firmados de 1 h; nulos si el ' +
      'archivo no se pudo guardar. Una falla del correo NO cambia esta respuesta: el envío queda ' +
      'para reintento.',
  })
  @ApiBadRequestResponse({
    type: ErrorReceptorDto,
    description:
      'Código con formato inválido (sin `campos`), datos del receptor inválidos, o el SAT ' +
      'rechazó un dato del receptor (RFC no inscrito, nombre, CP, régimen o uso que no ' +
      'corresponden): `campos` dice cuál. No se guardó nada.',
  })
  @ApiNotFoundResponse({ type: ErrorDto, description: 'Portal o código no encontrados.' })
  @ApiConflictResponse({
    type: ErrorEstadoCodigoDto,
    description:
      'El código no se puede facturar: ya facturado, en proceso de emisión, en global, ' +
      'expirado o cancelado.',
  })
  @ApiUnprocessableEntityResponse({
    type: ErrorDto,
    description:
      'La cuenta no se puede facturar en línea: su forma de pago no se puede declarar con PUE ' +
      '(sin catálogo o `otro`), ya no está cerrada, o el SAT la rechazó por algo que no es un ' +
      'dato del receptor. No se guardó nada.',
  })
  @ApiBadGatewayResponse({
    type: ErrorDto,
    description:
      'El PAC no confirmó a tiempo y pudo haber timbrado: la emisión queda EN PROCESO (el ' +
      'código responde `en_proceso`) y no se debe volver a pedir.',
  })
  @ApiServiceUnavailableResponse({
    type: ErrorDto,
    description:
      'La empresa no puede emitir (sin perfil fiscal activo o sin CSD vigente), la plataforma se ' +
      'quedó sin folios de timbrado (F2-110; antes de llamar al PAC), o el PAC no está disponible ' +
      'tras los reintentos. No se guardó nada.',
  })
  @ApiTooManyRequestsResponse({ description: 'Más de 5 por minuto desde la misma IP.' })
  solicitarFactura(
    @Param('slug') slug: string,
    @Body() dto: SolicitarFacturaDto,
  ): Promise<FacturaPortalDto> {
    return this.portal.solicitarFactura(slug, dto);
  }
}

const DESC_404_SUCURSAL =
  'La sucursal (o la empresa) no existe o no está en tu alcance. Misma respuesta siempre (nunca 403).';
const DESC_403 = 'Rol insuficiente (visor): el portal lo configuran los administradores.';

/** La configuración del portal de cada sucursal (F2-103): sólo administradores. */
@ApiTags('facturacion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@Controller('facturacion/portales')
export class PortalesAdminController {
  constructor(private readonly portal: PortalFacturacionService) {}

  @Get()
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({ summary: 'Las sucursales de una empresa con su portal de autofactura (F2-103).' })
  @ApiOkResponse({ type: SucursalPortalDto, isArray: true })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404_SUCURSAL })
  listar(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: PortalesQueryDto,
  ): Promise<SucursalPortalDto[]> {
    return this.portal.portales(scope, q.empresaId);
  }

  @Put(':sucursalId')
  @HttpCode(200)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Crea o edita el enlace, el color y el estado del portal de una sucursal (F2-103).',
    description:
      'Alcance (404) → formato (400) → enlace ocupado por OTRO portal de cualquier empresa (409; ' +
      'los enlaces son URLs públicas).',
  })
  @ApiOkResponse({ type: SucursalPortalDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Enlace o color inválidos.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404_SUCURSAL })
  @ApiConflictResponse({ type: ErrorDto, description: 'El enlace ya lo usa otro portal.' })
  guardar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('sucursalId', new ParseUUIDPipe()) sucursalId: string,
    @Body() dto: GuardarPortalDto,
  ): Promise<SucursalPortalDto> {
    const u = req.usuario!;
    return this.portal.guardarPortal(scope, { id: u.id, rol: u.rol }, sucursalId, dto);
  }

  @Put(':sucursalId/logo')
  @HttpCode(200)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Pone o reemplaza el logo del portal (PNG, JPEG o WebP, hasta 200 KB) (F2-103).',
    description:
      'Alcance (404) → archivo (400: vacío, de más, o que no es PNG/JPEG/WebP por sus bytes; SVG ' +
      'no) → la sucursal tiene portal (409).',
  })
  @ApiOkResponse({ type: SucursalPortalDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Archivo inválido.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404_SUCURSAL })
  @ApiConflictResponse({ type: ErrorDto, description: 'La sucursal todavía no tiene portal.' })
  guardarLogo(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('sucursalId', new ParseUUIDPipe()) sucursalId: string,
    @Body() dto: LogoPortalDto,
  ): Promise<SucursalPortalDto> {
    const u = req.usuario!;
    return this.portal.guardarLogo(
      scope,
      { id: u.id, rol: u.rol },
      sucursalId,
      dto.contenidoBase64,
    );
  }

  @Delete(':sucursalId/logo')
  @HttpCode(200)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({ summary: 'Quita el logo del portal de la sucursal (F2-103).' })
  @ApiOkResponse({ type: SucursalPortalDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404_SUCURSAL })
  @ApiConflictResponse({ type: ErrorDto, description: 'La sucursal todavía no tiene portal.' })
  quitarLogo(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('sucursalId', new ParseUUIDPipe()) sucursalId: string,
  ): Promise<SucursalPortalDto> {
    const u = req.usuario!;
    return this.portal.guardarLogo(scope, { id: u.id, rol: u.rol }, sucursalId, null);
  }
}
