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
import {
  CatalogosService,
  type FichaCliente,
  type MapeoAreas,
  type Pagina,
} from './catalogos.service';
import { POR_PAGINA_CLIENTES, type ResumenClientes } from './clientes';
import type { RendimientoMeseros } from './meseros';
import {
  AsignarCanalAreaDto,
  CatalogoQueryDto,
  DetalleProductoDto,
  EmpresaQueryDto,
  FichaClienteDto,
  FichaClienteQueryDto,
  ResumenClientesDto,
  ResumenClientesQueryDto,
  ForzarSincronizacionDto,
  FilaMapeoAreaDto,
  GuardarMetadataDto,
  MapeoAreasDto,
  MapeoAreasQueryDto,
  MenuDto,
  MenuQueryDto,
  PaginaCatalogoLecturaDto,
  PaginaClientesDto,
  PaginaInsumosDto,
  PaginaProductosDto,
  RendimientoMeserosDto,
  RendimientoMeserosQueryDto,
  SincronizacionSucursalDto,
  SinCatalogoQueryDto,
  VendidosSinCatalogoDto,
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
    description:
      `${DESC_LISTA} No interviene en el canal de negocio de las ventas: ése sale del mapeo ` +
      'área → canal (`/catalogos/areas/mapeo`, F2-233).',
  })
  @ApiOkResponse({ type: PaginaCatalogoLecturaDto })
  canales(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CatalogoQueryDto,
  ): Promise<Pagina<FilaCatalogoDto>> {
    return this.listar(scope, 'canales', q);
  }

  // --- inventario (F2-120) ---

  @Get('unidades')
  @ApiOperation({ summary: 'Unidades de medida del inventario del POS.', description: DESC_LISTA })
  @ApiOkResponse({ type: PaginaCatalogoLecturaDto })
  unidades(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CatalogoQueryDto,
  ): Promise<Pagina<FilaCatalogoDto>> {
    return this.listar(scope, 'unidades', q);
  }

  @Get('grupos-insumo')
  @ApiOperation({ summary: 'Grupos de insumos del inventario del POS.', description: DESC_LISTA })
  @ApiOkResponse({ type: PaginaCatalogoLecturaDto })
  gruposInsumo(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CatalogoQueryDto,
  ): Promise<Pagina<FilaCatalogoDto>> {
    return this.listar(scope, 'grupos_insumo', q);
  }

  @Get('insumos')
  @ApiOperation({
    summary: 'Insumos del inventario del POS, con su grupo y su unidad en la misma sucursal.',
    description: `${DESC_LISTA} Sin costo: el costo con que se valúa va por almacén (existencias).`,
  })
  @ApiOkResponse({ type: PaginaInsumosDto })
  insumos(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CatalogoQueryDto,
  ): Promise<Pagina<FilaCatalogoDto>> {
    return this.listar(scope, 'insumos', q);
  }

  @Get('almacenes')
  @ApiOperation({ summary: 'Almacenes de cada sucursal en el POS.', description: DESC_LISTA })
  @ApiOkResponse({ type: PaginaCatalogoLecturaDto })
  almacenes(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CatalogoQueryDto,
  ): Promise<Pagina<FilaCatalogoDto>> {
    return this.listar(scope, 'almacenes', q);
  }

  @Get('proveedores')
  @ApiOperation({ summary: 'Proveedores registrados en el POS.', description: DESC_LISTA })
  @ApiOkResponse({ type: PaginaCatalogoLecturaDto })
  proveedores(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CatalogoQueryDto,
  ): Promise<Pagina<FilaCatalogoDto>> {
    return this.listar(scope, 'proveedores', q);
  }

  @Get('areas/mapeo')
  @ApiOperation({
    summary: 'Áreas del espejo con su canal de negocio asignado (F2-233).',
    description:
      'Todas las áreas (también las dadas de baja) y la última sincronización completa del ' +
      'catálogo de áreas de cada sucursal. El mapeo es nuestro: ninguna sincronización lo toca.',
  })
  @ApiOkResponse({ type: MapeoAreasDto })
  mapeoAreas(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: MapeoAreasQueryDto,
  ): Promise<MapeoAreas> {
    return this.catalogos.mapeoAreas(scope, q.empresaId, q.sucursalId);
  }

  @Put('areas/:id/canal')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Asigna (o quita, con null) el canal de negocio de un área del POS (F2-233).',
    description:
      'Se aplica al leer: `/ventas/por-area` recalcula cualquier periodo sin re-ingerir. Un área ' +
      'de otra empresa, fuera de alcance o inexistente = el mismo 404. Responde la fila.',
  })
  @ApiOkResponse({ type: FilaMapeoAreaDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: 'Rol insuficiente (visor).' })
  asignarCanalArea(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AsignarCanalAreaDto,
  ): Promise<FilaMapeoAreaDto> {
    const { id: actorId, rol } = req.usuario!;
    return this.catalogos.asignarCanalArea({ id: actorId, rol }, scope, id, dto);
  }

  @Get('menu')
  @ApiOperation({
    summary:
      'Orquestador de menú (F2-145): productos activos cruzados entre sucursales, por categoría, ' +
      'con los precios distintos señalados.',
    description:
      'Sólo lectura: el precio lo manda el POS. El mismo producto se reconoce por su clave visible ' +
      '(o, sin clave, por su nombre): supuesto no validado en SR. `discrepancia` compara sólo las ' +
      'filas vigentes con precio. Hasta 5000 filas (`truncado`).',
  })
  @ApiOkResponse({ type: MenuDto })
  menu(@EmpresaScopeActual() scope: EmpresaScope, @Query() q: MenuQueryDto): Promise<MenuDto> {
    return this.catalogos.menu(scope, q.empresaId, q.sucursalId);
  }

  @Get('sin-catalogo')
  @ApiOperation({
    summary:
      'Productos vendidos en el periodo que no están en el catálogo de su sucursal (F2-145).',
    description:
      'Cruce por NOMBRE (sin distinguir mayúsculas ni espacios de más): el ticket no trae id de ' +
      'producto. Un producto renombrado en el POS dentro del periodo sale con su nombre viejo. Sólo ' +
      'se cruzan las sucursales con una sincronización completa del catálogo de productos; las ' +
      'demás salen en `sucursalesSinCatalogo`. Los cancelados no entran. Hasta 500 renglones.',
  })
  @ApiOkResponse({ type: VendidosSinCatalogoDto })
  sinCatalogo(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: SinCatalogoQueryDto,
  ): Promise<VendidosSinCatalogoDto> {
    return this.catalogos.vendidosSinCatalogo(scope, {
      empresaId: q.empresaId,
      sucursalId: q.sucursalId,
      desde: q.desde,
      hasta: q.hasta,
    });
  }

  @Get('meseros/rendimiento')
  @ApiOperation({
    summary: 'Meseros (F2-231): rendimiento del periodo por mesero, ligado con el espejo.',
    description:
      'Las cifras son las de /ventas/por-mesero (mismo filtro, días LOCALES de cada sucursal): ' +
      'Σ venta de `filas` = /ventas/resumen. Cancelaciones y descuentos van aparte, como conteo e ' +
      'importe; la venta no los incluye. El cheque sólo trae el TEXTO del mesero: se liga con el ' +
      'espejo por (sucursal, nombre sin espacios de más ni mayúsculas), y dos textos que ligan con ' +
      'el mismo mesero salen en una fila. Un mesero dado de baja sale en los periodos en que ' +
      'atendió. Ranking y promedio, por sucursal. Sin cache.',
  })
  @ApiOkResponse({ type: RendimientoMeserosDto })
  rendimientoMeseros(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: RendimientoMeserosQueryDto,
  ): Promise<RendimientoMeseros> {
    return this.catalogos.rendimientoMeseros(scope, {
      empresaId: q.empresaId,
      sucursalId: q.sucursalId,
      desde: q.desde,
      hasta: q.hasta,
    });
  }

  @Get('clientes/resumen')
  @ApiOperation({
    summary: 'Clientes (F2-232): la lista del periodo, con lo derivable de las cuentas.',
    description:
      'Visitas, venta, ticket promedio, última visita y canceladas (aparte) por cliente, de las ' +
      'cuentas del periodo (días LOCALES de cada sucursal) ligadas con el espejo por (sucursal, id ' +
      'del cliente en el POS). Un id que las cuentas traen y el espejo no tiene sale sin ficha, sin ' +
      'inventarle una. Por sucursal, el estado de su catálogo y cuántas cuentas traen cliente. Sin ' +
      'teléfono, correo ni RFC salvo `contacto=true`. Sin cache.',
  })
  @ApiOkResponse({ type: ResumenClientesDto })
  resumenClientes(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: ResumenClientesQueryDto,
  ): Promise<ResumenClientes> {
    return this.catalogos.resumenClientes(
      scope,
      { empresaId: q.empresaId, sucursalId: q.sucursalId, desde: q.desde, hasta: q.hasta },
      {
        q: q.q,
        pagina: q.pagina ?? 1,
        porPagina: q.porPagina ?? POR_PAGINA_CLIENTES,
        contacto: q.contacto === 'true',
      },
    );
  }

  @Get('clientes/:id/ficha')
  @ApiOperation({
    summary: 'Clientes (F2-232): la ficha de un cliente, con sus datos y su periodo.',
    description:
      'Datos del POS (teléfono, correo, RFC tal como los guarda), cifras del periodo en SU ' +
      'sucursal (las mismas que /ventas/tickets con `clienteId` y `canceladas=excluir`) y lo que ' +
      'más pide. Un id que no existe o no es de la empresa = 404.',
  })
  @ApiOkResponse({ type: FichaClienteDto })
  fichaCliente(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query() q: FichaClienteQueryDto,
  ): Promise<FichaCliente> {
    return this.catalogos.fichaCliente(scope, id, {
      empresaId: q.empresaId,
      desde: q.desde,
      hasta: q.hasta,
    });
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
    summary: 'Estado de sincronización de los once catálogos de cada sucursal de la empresa.',
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
