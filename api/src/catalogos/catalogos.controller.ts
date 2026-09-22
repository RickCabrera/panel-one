import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  ApiAcceptedResponse,
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolUsuario, type CatalogoSr } from '@prisma/client';

import { Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { CatalogosService, type Pagina } from './catalogos.service';
import {
  CatalogoQueryDto,
  DetalleProductoDto,
  EmpresaQueryDto,
  ForzarSincronizacionDto,
  GuardarMetadataDto,
  PaginaCatalogoLecturaDto,
  PaginaClientesDto,
  PaginaProductosDto,
  SincronizacionSucursalDto,
  type FilaCatalogoDto,
} from './dto/catalogos.dto';

const DESC_404 =
  'La empresa no existe o no está en tu alcance, o la sucursal no es de esa empresa. Misma ' +
  'respuesta en todos los casos (nunca 403).';
const DESC_LISTA =
  'Espejo de lo que el agente leyó del POS de cada sucursal (F2-230), 50 por página, por nombre. ' +
  'Nada se borra: lo que desapareció del POS sale con `activo=false` y su último `vistoAt`.';

@ApiTags('catalogos')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@Controller('catalogos')
export class CatalogosController {
  constructor(private readonly catalogos: CatalogosService) {}

  private listar(scope: EmpresaScope, catalogo: CatalogoSr, q: CatalogoQueryDto) {
    return this.catalogos.listar(scope, catalogo, q);
  }

  @Get('grupos')
  @ApiOperation({ summary: 'Grupos de productos del POS.', description: DESC_LISTA })
  @ApiOkResponse({ type: PaginaCatalogoLecturaDto })
  grupos(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CatalogoQueryDto,
  ): Promise<Pagina<FilaCatalogoDto>> {
    return this.listar(scope, 'grupos', q);
  }

  @Get('productos')
  @ApiOperation({
    summary: 'Productos del POS, con el nombre de su grupo en la misma sucursal.',
    description: DESC_LISTA,
  })
  @ApiOkResponse({ type: PaginaProductosDto })
  productos(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CatalogoQueryDto,
  ): Promise<Pagina<FilaCatalogoDto>> {
    return this.listar(scope, 'productos', q);
  }

  @Get('meseros')
  @ApiOperation({ summary: 'Meseros del POS.', description: DESC_LISTA })
  @ApiOkResponse({ type: PaginaCatalogoLecturaDto })
  meseros(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CatalogoQueryDto,
  ): Promise<Pagina<FilaCatalogoDto>> {
    return this.listar(scope, 'meseros', q);
  }

  @Get('clientes')
  @ApiOperation({
    summary: 'Clientes registrados en el POS (datos personales).',
    description: `${DESC_LISTA} Vacío si la instalación no usa clientes.`,
  })
  @ApiOkResponse({ type: PaginaClientesDto })
  clientes(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CatalogoQueryDto,
  ): Promise<Pagina<FilaCatalogoDto>> {
    return this.listar(scope, 'clientes', q);
  }

  @Get('areas')
  @ApiOperation({ summary: 'Áreas del POS (comedor, terraza, barra…).', description: DESC_LISTA })
  @ApiOkResponse({ type: PaginaCatalogoLecturaDto })
  areas(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CatalogoQueryDto,
  ): Promise<Pagina<FilaCatalogoDto>> {
    return this.listar(scope, 'areas', q);
  }

  @Get('canales')
  @ApiOperation({
    summary: 'Canales o tipos de servicio del POS.',
    description: `${DESC_LISTA} El mapeo área → canal de negocio es nuestro y es otra tarea (F2-233).`,
  })
  @ApiOkResponse({ type: PaginaCatalogoLecturaDto })
  canales(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CatalogoQueryDto,
  ): Promise<Pagina<FilaCatalogoDto>> {
    return this.listar(scope, 'canales', q);
  }

  @Get('productos/:id')
  @ApiOperation({ summary: 'Un producto con su metadata propia.' })
  @ApiOkResponse({ type: DetalleProductoDto })
  producto(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: EmpresaQueryDto,
  ): Promise<DetalleProductoDto> {
    return this.catalogos.producto(scope, q.empresaId, id);
  }

  @Put('productos/:id/metadata')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Reemplaza la metadata propia de un producto (foto, descripción, etiquetas, mín/máx).',
    description:
      'Es nuestra, no del POS: vive aparte y ninguna sincronización la toca. Reemplazo completo. ' +
      'Responde el producto con su metadata.',
  })
  @ApiOkResponse({ type: DetalleProductoDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  guardarMetadata(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: GuardarMetadataDto,
  ): Promise<DetalleProductoDto> {
    const { id: actorId, rol } = req.usuario!;
    return this.catalogos.guardarMetadata({ id: actorId, rol }, scope, id, dto);
  }

  @Get('sincronizacion')
  @ApiOperation({
    summary: 'Estado de sincronización de los seis catálogos de cada sucursal de la empresa.',
  })
  @ApiOkResponse({ type: [SincronizacionSucursalDto] })
  sincronizacion(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: EmpresaQueryDto,
  ): Promise<SincronizacionSucursalDto[]> {
    return this.catalogos.sincronizacion(scope, q.empresaId);
  }

  @Post('sincronizacion/forzar')
  @HttpCode(HttpStatus.ACCEPTED)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Pide al agente de la sucursal una sincronización completa ya.',
    description:
      'El agente la lee en `GET /ingesta/catalogos/solicitud` y la hace en su siguiente ciclo. ' +
      'Responde el estado de esa sucursal con la solicitud pendiente.',
  })
  @ApiAcceptedResponse({ type: SincronizacionSucursalDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  forzar(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: ForzarSincronizacionDto,
  ): Promise<SincronizacionSucursalDto> {
    const { id, rol } = req.usuario!;
    return this.catalogos.forzar({ id, rol }, scope, dto.empresaId, dto.sucursalId);
  }
}
