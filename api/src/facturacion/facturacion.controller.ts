import { Body, Controller, Get, HttpCode, Post, Put, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';

import { Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  CargarCsdDto,
  GuardarPerfilFiscalDto,
  GuardarPerfilRespuestaDto,
  PerfilFiscalQueryDto,
  RegimenFiscalDto,
  RespuestaPerfilFiscalDto,
} from './dto/facturacion.dto';
import { FacturacionService } from './facturacion.service';
import { REGIMENES_FISCALES } from './sat';

const DESC_404 =
  'La empresa no existe o no está en tu alcance. Misma respuesta en todos los casos (nunca 403), ' +
  'tenga o no datos fiscales.';
const DESC_403 = 'Rol insuficiente (visor): los datos fiscales son sólo de administradores.';

@ApiTags('facturacion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@Controller('facturacion')
export class FacturacionController {
  constructor(private readonly facturacion: FacturacionService) {}

  @Get('regimenes-fiscales')
  @ApiOperation({
    summary:
      'Catálogo c_RegimenFiscal del SAT con su aplicación a persona física o moral (F2-100).',
    description:
      'Cualquier usuario autenticado (sin rol): es el catálogo público del SAT y no trae datos de ' +
      'ninguna empresa.',
  })
  @ApiOkResponse({ type: RegimenFiscalDto, isArray: true })
  regimenes(): RegimenFiscalDto[] {
    return REGIMENES_FISCALES.map((r) => ({ ...r }));
  }

  @Get('perfil-fiscal')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Datos fiscales de una empresa y METADATA de su CSD (F2-100).',
    description:
      'Nunca devuelve el .cer, el .key ni la contraseña: no se guardan. `perfil = null` = la ' +
      'empresa no tiene datos fiscales todavía.',
  })
  @ApiOkResponse({ type: RespuestaPerfilFiscalDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
  perfil(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: PerfilFiscalQueryDto,
  ): Promise<RespuestaPerfilFiscalDto> {
    return this.facturacion.perfil(scope, q.empresaId);
  }

  @Put('perfil-fiscal')
  @HttpCode(200)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Crea o edita los datos fiscales de una empresa (F2-100).',
    description:
      'Valida RFC, régimen (existe y aplica a moral/física), CP y serie. Cambiar el RFC con un CSD ' +
      'cargado quita el CSD y el alta en el PAC (`csdQuitado = true`): eran de otro RFC.',
  })
  @ApiOkResponse({ type: GuardarPerfilRespuestaDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Datos fiscales inválidos.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
  @ApiConflictResponse({ type: ErrorDto, description: 'Otro administrador los cambió a la vez.' })
  guardarPerfil(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: GuardarPerfilFiscalDto,
  ): Promise<GuardarPerfilRespuestaDto> {
    const u = req.usuario!;
    return this.facturacion.guardarPerfil(scope, { id: u.id, rol: u.rol }, dto);
  }

  @Post('perfil-fiscal/csd')
  @HttpCode(200)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Carga (o reemplaza) el CSD de la empresa: .cer, .key y contraseña (F2-100).',
    description:
      'Orden: empresa en alcance (404) → hay datos fiscales (409) → validación local del CSD (400: ' +
      '.cer o .key inválidos, contraseña incorrecta, llave de otro certificado, RFC distinto, ' +
      'vencido) → alta en el PAC (400 si lo rechaza, 503 si no responde). Sólo si todo pasa se ' +
      'guarda la METADATA (número, RFC, vigencia). El .key y la contraseña van al PAC y no se ' +
      'guardan ni se loguean.',
  })
  @ApiOkResponse({ type: RespuestaPerfilFiscalDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'CSD inválido o rechazado por el PAC.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
  @ApiConflictResponse({
    type: ErrorDto,
    description: 'La empresa no tiene datos fiscales todavía, o su RFC cambió durante la carga.',
  })
  @ApiServiceUnavailableResponse({ type: ErrorDto, description: 'El PAC no respondió.' })
  cargarCsd(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: CargarCsdDto,
  ): Promise<RespuestaPerfilFiscalDto> {
    const u = req.usuario!;
    return this.facturacion.cargarCsd(scope, { id: u.id, rol: u.rol }, dto);
  }
}
