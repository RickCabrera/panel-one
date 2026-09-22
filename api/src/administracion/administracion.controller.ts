import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { ThrottlerGuard } from '@nestjs/throttler';
import { RolUsuario } from '@prisma/client';

import { Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { SoloThrottlers, THROTTLER_RESET } from '../auth/throttlers';
import { EmpresaDto, SucursalDto } from '../organizacion/dto/organizacion.dto';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import type { EmpresaCreada, SucursalCreada, UsuarioCreado } from '../scope/escritura-admin';
import { AdministracionService, type Quien } from './administracion.service';
import {
  CrearEmpresaDto,
  CrearSucursalDto,
  CrearUsuarioDto,
  EditarEmpresaDto,
  EditarSucursalDto,
  EditarUsuarioDto,
  ResetPasswordDto,
  UsuarioDto,
  UsuariosQueryDto,
} from './dto/administracion.dto';

const DESC_400 = 'Cuerpo inválido, `id` que no es UUID, o un PATCH sin ningún campo.';
const DESC_401 = 'Sin token, token inválido o vencido.';
const DESC_403_RUTA = 'Rol insuficiente para la ruta (depende de la ruta, no del recurso).';
const DESC_404 = 'No existe o es de otra empresa. Misma respuesta en los dos casos (nunca 403).';

/** El actor y su scope, ambos del access token. Nunca de algo que mande el cliente. */
function quien(req: RequestAutenticado, scope: EmpresaScope): Quien {
  // El JwtAuthGuard global garantiza `req.usuario` en toda ruta no pública.
  const { id, rol } = req.usuario!;
  return { actor: { id, rol }, scope };
}

/** Convive con `GET /empresas` (OrganizacionModule, F1-033). */
@ApiTags('administracion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: DESC_401 })
@Controller('empresas')
export class EmpresasAdminController {
  constructor(private readonly admin: AdministracionService) {}

  @Post()
  @Roles(RolUsuario.admin_global)
  @HttpCode(201)
  @ApiOperation({ summary: 'Da de alta una empresa. Sólo admin_global.' })
  @ApiCreatedResponse({ type: EmpresaDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: DESC_400 })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403_RUTA })
  crear(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: CrearEmpresaDto,
  ): Promise<EmpresaCreada> {
    return this.admin.crearEmpresa(quien(req, scope), dto.nombre);
  }

  @Patch(':id')
  @Roles(RolUsuario.admin_global)
  @ApiOperation({ summary: 'Renombra, da de baja o reactiva una empresa. Sólo admin_global.' })
  @ApiOkResponse({ type: EmpresaDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: DESC_400 })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403_RUTA })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
  editar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarEmpresaDto,
  ): Promise<EmpresaCreada> {
    return this.admin.editarEmpresa(quien(req, scope), id, dto);
  }
}

/** Convive con `GET /sucursales` (F1-033) y `POST /sucursales/:id/api-key` (F1-012). */
@ApiTags('administracion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: DESC_401 })
@Controller('sucursales')
export class SucursalesAdminController {
  constructor(private readonly admin: AdministracionService) {}

  @Post()
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @HttpCode(201)
  @ApiOperation({
    summary: 'Da de alta una sucursal en una empresa de tu alcance. Nace sin API key.',
  })
  @ApiCreatedResponse({ type: SucursalDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: `${DESC_400} Zona que no es IANA.` })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403_RUTA })
  @ApiNotFoundResponse({ type: ErrorDto, description: `La empresa: ${DESC_404}` })
  crear(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: CrearSucursalDto,
  ): Promise<SucursalCreada> {
    return this.admin.crearSucursal(quien(req, scope), dto);
  }

  @Patch(':id')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Edita nombre y zona de una sucursal, o la da de baja / reactiva.',
    description:
      'Cambiar `zonaHoraria` de una sucursal con historial reclasifica sus ventas pasadas en ' +
      'los cortes por día: los agregados usan la zona actual.',
  })
  @ApiOkResponse({ type: SucursalDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: `${DESC_400} Zona que no es IANA.` })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403_RUTA })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
  editar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarSucursalDto,
  ): Promise<SucursalCreada> {
    return this.admin.editarSucursal(quien(req, scope), id, dto);
  }
}

@ApiTags('administracion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: DESC_401 })
@Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
@Controller('usuarios')
export class UsuariosAdminController {
  constructor(private readonly admin: AdministracionService) {}

  @Get()
  @ApiOperation({
    summary: 'Usuarios en tu alcance, activos e inactivos. Nunca incluye el hash.',
  })
  @ApiOkResponse({ type: [UsuarioDto] })
  @ApiBadRequestResponse({ type: ErrorDto, description: '`empresaId` no es un UUID.' })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403_RUTA })
  @ApiNotFoundResponse({ type: ErrorDto, description: `La empresa pedida: ${DESC_404}` })
  listar(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: UsuariosQueryDto,
  ): Promise<UsuarioCreado[]> {
    return this.admin.usuarios(scope, q.empresaId);
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Da de alta un usuario con rol y empresa.' })
  @ApiCreatedResponse({ type: UsuarioDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: `${DESC_400} empresaId ausente (o presente para admin_global).`,
  })
  @ApiForbiddenResponse({
    type: ErrorDto,
    description: `${DESC_403_RUTA} O un admin_empresa pidiendo rol admin_global.`,
  })
  @ApiNotFoundResponse({ type: ErrorDto, description: `La empresa: ${DESC_404}` })
  @ApiConflictResponse({ type: ErrorDto, description: 'El email ya está en uso.' })
  crear(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: CrearUsuarioDto,
  ): Promise<UsuarioCreado> {
    return this.admin.crearUsuario(quien(req, scope), dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita nombre y rol de un usuario, o lo da de baja / reactiva.' })
  @ApiOkResponse({ type: UsuarioDto })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: `${DESC_400} O un cambio de rol no permitido, o darte de baja a ti mismo.`,
  })
  @ApiForbiddenResponse({
    type: ErrorDto,
    description: `${DESC_403_RUTA} O un admin_empresa pidiendo rol admin_global.`,
  })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
  editar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarUsuarioDto,
  ): Promise<UsuarioCreado> {
    return this.admin.editarUsuario(quien(req, scope), id, dto);
  }

  @Post(':id/password')
  // 10 por minuto por IP (throttler `reset`, F2-203). Detrás del JWT global y del
  // guard de roles: sólo cuenta a quien ya pasó como admin.
  @UseGuards(ThrottlerGuard)
  @SoloThrottlers(THROTTLER_RESET)
  @HttpCode(204)
  @ApiOperation({
    summary: 'Restablece la contraseña de un usuario de tu alcance.',
    description:
      'Sus refresh tokens dejan de servir en ese instante; su access token vigente, hasta que ' +
      'venza (15 min).',
  })
  @ApiNoContentResponse({ description: 'Contraseña restablecida.' })
  @ApiBadRequestResponse({
    type: ErrorDto,
    description: `${DESC_400} O es tu propia contraseña: ésa se cambia en /cuenta/password.`,
  })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403_RUTA })
  @ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
  @ApiTooManyRequestsResponse({
    description: 'Más de 10 restablecimientos por minuto desde la misma IP.',
  })
  resetPassword(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetPasswordDto,
  ): Promise<void> {
    return this.admin.resetPassword(quien(req, scope), id, dto.password);
  }
}
