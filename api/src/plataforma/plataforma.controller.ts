import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  AdminDto,
  AjustesDto,
  AltaClienteDto,
  AnularPagoDto,
  BitacoraDto,
  BitacoraQueryDto,
  BuscarCuentaQueryDto,
  CambiarEstadoDto,
  ClienteDetalleDto,
  ClienteResumenDto,
  ClientesQueryDto,
  ConvertirCuentaDto,
  CrearAdminDto,
  CrearPlanDto,
  CuentaClienteDto,
  CuentaConvertidaDto,
  EditarAdminDto,
  EditarClienteDto,
  EditarPlanDto,
  GuardarAjustesDto,
  GuardarMembresiaDto,
  MetricasDto,
  PagoSuscripcionDto,
  PagoRegistradoDto,
  PagosMesDto,
  PagosQueryDto,
  PlanDto,
  RegistrarPagoDto,
  SuscripcionDto,
} from './dto/plataforma.dto';
import { PlataformaService, type QuienPlataforma } from './plataforma.service';
import { SoloPlataformaGuard } from './solo-plataforma.guard';

const DESC_401 = 'Sin token, token inválido o vencido.';
const DESC_404_RUTA =
  'Cualquier rol que no sea admin_global recibe 404 en TODA la ruta (igual que una ruta que no ' +
  'existe: no se revela que exista).';
const DESC_404 = `No existe. ${DESC_404_RUTA}`;
const DESC_400 = 'Cuerpo inválido, `id` que no es UUID, fecha inexistente o PATCH vacío.';

function quien(req: RequestAutenticado, scope: EmpresaScope): QuienPlataforma {
  // El JwtAuthGuard global garantiza `req.usuario` en toda ruta no pública.
  return { actorId: req.usuario!.id, scope };
}

/**
 * El panel de plataforma (back office de membresías). SÓLO admin_global: el
 * `SoloPlataformaGuard` responde 404 a cualquier otro rol, en cada ruta de aquí.
 */
@ApiTags('plataforma')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: DESC_401 })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@UseGuards(SoloPlataformaGuard)
@Controller('plataforma')
export class PlataformaController {
  constructor(private readonly plataforma: PlataformaService) {}

  // --- Tablero ---------------------------------------------------------------------------------

  @Get('metricas')
  @ApiOperation({
    summary: 'Métricas de la plataforma: MRR, clientes por estado, ingresos del mes, por vencer.',
  })
  @ApiOkResponse({ type: MetricasDto })
  metricas(@EmpresaScopeActual() scope: EmpresaScope): Promise<MetricasDto> {
    return this.plataforma.metricas(scope);
  }

  // --- Planes ----------------------------------------------------------------------------------

  @Get('planes')
  @ApiOperation({ summary: 'Planes (activos e inactivos) con cuántos clientes los usan.' })
  @ApiOkResponse({ type: [PlanDto] })
  planes(@EmpresaScopeActual() scope: EmpresaScope): Promise<PlanDto[]> {
    return this.plataforma.planes(scope);
  }

  @Post('planes')
  @HttpCode(201)
  @ApiOperation({ summary: 'Crea un plan.' })
  @ApiCreatedResponse({ type: PlanDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: DESC_400 })
  @ApiConflictResponse({ type: ErrorDto, description: 'Ya hay un plan con ese nombre.' })
  crearPlan(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: CrearPlanDto,
  ): Promise<PlanDto> {
    return this.plataforma.crearPlan(quien(req, scope), dto);
  }

  @Patch('planes/:id')
  @ApiOperation({
    summary: 'Edita un plan.',
    description: 'Cambiar el precio cambia el MRR de quien ya lo tiene; no toca pagos pasados.',
  })
  @ApiOkResponse({ type: PlanDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: DESC_400 })
  @ApiConflictResponse({ type: ErrorDto, description: 'Ya hay un plan con ese nombre.' })
  editarPlan(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarPlanDto,
  ): Promise<PlanDto> {
    return this.plataforma.editarPlan(quien(req, scope), id, dto);
  }

  @Delete('planes/:id')
  @HttpCode(204)
  @ApiOperation({
    summary: 'Borra un plan que ningún cliente usa (si alguno lo usa: desactívalo).',
  })
  @ApiNoContentResponse({ description: 'Borrado.' })
  @ApiConflictResponse({ type: ErrorDto, description: 'Algún cliente lo usa.' })
  borrarPlan(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.plataforma.borrarPlan(quien(req, scope), id);
  }

  // --- Clientes --------------------------------------------------------------------------------

  @Get('clientes')
  @ApiOperation({
    summary: 'Clientes (empresas) con plan, estado, vencimiento, último pago y actividad.',
  })
  @ApiOkResponse({ type: [ClienteResumenDto] })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Filtro inválido.' })
  clientes(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: ClientesQueryDto,
  ): Promise<ClienteResumenDto[]> {
    return this.plataforma.clientes(scope, q);
  }

  @Post('clientes')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Alta de cliente: empresa con contacto + suscripción + su primer admin_empresa.',
    description:
      'Todo en una transacción: si el email ya existe (409) no queda nada. Las sucursales (con ' +
      'su API key) se agregan después en Administración o con el alta guiada.',
  })
  @ApiCreatedResponse({ type: ClienteDetalleDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: `${DESC_400} Plan inactivo.` })
  @ApiConflictResponse({ type: ErrorDto, description: 'El email ya está en uso.' })
  altaCliente(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: AltaClienteDto,
  ): Promise<ClienteDetalleDto> {
    return this.plataforma.altaCliente(quien(req, scope), dto);
  }

  @Get('clientes/:id')
  @ApiOperation({
    summary: 'Detalle: suscripción, contacto, sucursales, agentes, usuarios y pagos.',
  })
  @ApiOkResponse({ type: ClienteDetalleDto })
  cliente(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<ClienteDetalleDto> {
    return this.plataforma.cliente(scope, id);
  }

  @Patch('clientes/:id')
  @ApiOperation({ summary: 'Edita el nombre y los datos de contacto del cliente.' })
  @ApiOkResponse({ type: ClienteDetalleDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: DESC_400 })
  editarCliente(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarClienteDto,
  ): Promise<ClienteDetalleDto> {
    return this.plataforma.editarCliente(quien(req, scope), id, dto);
  }

  @Put('clientes/:id/suscripcion')
  @ApiOperation({
    summary: 'Cambia plan, vencimiento, día de corte, gracia o notas (o crea la suscripción).',
    description: 'Si la empresa no tiene suscripción, la crea `activa` (planId obligatorio).',
  })
  @ApiOkResponse({ type: SuscripcionDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: `${DESC_400} Plan inactivo.` })
  guardarSuscripcion(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: GuardarMembresiaDto,
  ): Promise<SuscripcionDto> {
    return this.plataforma.guardarSuscripcion(quien(req, scope), id, dto);
  }

  @Post('clientes/:id/estado')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Suspende, cancela o reactiva al cliente (a mano; nunca es automático).',
    description:
      '`suspendida`/`cancelada`: sus usuarios no entran ni refrescan ("Tu cuenta está ' +
      'suspendida. Contacta a soporte.") y sus refresh tokens dejan de servir en el acto. La ' +
      'ingesta de sus agentes NO se detiene.',
  })
  @ApiOkResponse({ type: SuscripcionDto })
  @ApiConflictResponse({ type: ErrorDto, description: 'La empresa no tiene suscripción.' })
  cambiarEstado(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarEstadoDto,
  ): Promise<SuscripcionDto> {
    return this.plataforma.cambiarEstado(quien(req, scope), id, dto);
  }

  // --- Pagos -----------------------------------------------------------------------------------

  @Get('pagos')
  @ApiOperation({
    summary: 'Las mensualidades del mes en curso: pagadas, pendientes y vencidas, y lo cobrado.',
  })
  @ApiOkResponse({ type: PagosMesDto })
  pagosDelMes(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: PagosQueryDto,
  ): Promise<PagosMesDto> {
    return this.plataforma.pagosDelMes(scope, q);
  }

  @Get('clientes/:id/pagos')
  @ApiOperation({ summary: 'Historial de pagos del cliente (anulados incluidos).' })
  @ApiOkResponse({ type: [PagoSuscripcionDto] })
  pagosDeCliente(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<PagoSuscripcionDto[]> {
    return this.plataforma.pagosDeCliente(scope, id);
  }

  @Post('clientes/:id/pagos')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Registra un pago: corre el vencimiento y reactiva si estaba suspendida o en prueba.',
    description:
      'Cubre `periodos` periodos del plan DESDE el vencimiento actual. Una suscripción ' +
      'cancelada no recibe pagos (409).',
  })
  @ApiCreatedResponse({ type: PagoRegistradoDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: `${DESC_400} Fecha futura o monto 0.` })
  @ApiConflictResponse({ type: ErrorDto, description: 'Sin suscripción, o cancelada.' })
  registrarPago(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RegistrarPagoDto,
  ): Promise<PagoRegistradoDto> {
    return this.plataforma.registrarPago(quien(req, scope), id, dto);
  }

  @Post('pagos/:id/anular')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Anula un pago (no se borra) y regresa el vencimiento a donde estaba.',
    description: 'Sólo el más reciente que corrió el vencimiento; si hay uno posterior, 409.',
  })
  @ApiOkResponse({ type: PagoSuscripcionDto })
  @ApiConflictResponse({ type: ErrorDto, description: 'Ya anulado, o hay un pago posterior.' })
  anularPago(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AnularPagoDto,
  ): Promise<PagoSuscripcionDto> {
    return this.plataforma.anularPago(quien(req, scope), id, dto.motivo);
  }

  // --- Administradores internos ----------------------------------------------------------------

  @Get('administradores')
  @ApiOperation({ summary: 'Administradores internos (admin_global) con su último acceso.' })
  @ApiOkResponse({ type: [AdminDto] })
  administradores(@EmpresaScopeActual() scope: EmpresaScope): Promise<AdminDto[]> {
    return this.plataforma.administradores(scope);
  }

  @Post('administradores')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Agrega un administrador interno con su contraseña INICIAL.',
    description: 'Después, su contraseña sólo la cambia él mismo (Mi cuenta).',
  })
  @ApiCreatedResponse({ type: AdminDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: DESC_400 })
  @ApiConflictResponse({ type: ErrorDto, description: 'El email ya está en uso.' })
  crearAdmin(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: CrearAdminDto,
  ): Promise<AdminDto> {
    return this.plataforma.crearAdmin(quien(req, scope), dto);
  }

  @Get('administradores/buscar-cuenta')
  @ApiOperation({
    summary: 'Busca por correo una cuenta de cliente (dueño o gerente) a convertir.',
  })
  @ApiOkResponse({ type: CuentaClienteDto })
  buscarCuenta(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: BuscarCuentaQueryDto,
  ): Promise<CuentaClienteDto> {
    return this.plataforma.buscarCuenta(scope, q.email);
  }

  @Post('administradores/convertir')
  @HttpCode(200)
  @ApiOperation({
    summary:
      'Convierte una cuenta de cliente en administrador, sin cambiarle correo ni contraseña.',
    description:
      'Pasa a admin_global y deja de pertenecer a su empresa (la empresa sigue igual con sus ' +
      'demás usuarios). Su sesión de cliente se corta. Queda en la bitácora.',
  })
  @ApiOkResponse({ type: CuentaConvertidaDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'La cuenta está desactivada.' })
  convertirCuenta(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: ConvertirCuentaDto,
  ): Promise<CuentaConvertidaDto> {
    return this.plataforma.convertirCuenta(quien(req, scope), dto.usuarioId);
  }

  @Patch('administradores/:id')
  @ApiOperation({
    summary: 'Edita nombre/correo de un admin interno, o lo desactiva / reactiva.',
    description:
      'Nunca su contraseña (no hay ruta para eso) y nunca se borra. No te puedes desactivar a ' +
      'ti mismo (400) y siempre queda al menos uno activo (409).',
  })
  @ApiOkResponse({ type: AdminDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: `${DESC_400} Desactivarte a ti mismo.` })
  @ApiConflictResponse({ type: ErrorDto, description: 'Sería el último activo, o email en uso.' })
  editarAdmin(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarAdminDto,
  ): Promise<AdminDto> {
    return this.plataforma.editarAdmin(quien(req, scope), id, dto);
  }

  // --- Bitácora y ajustes ----------------------------------------------------------------------

  @Get('bitacora')
  @ApiOperation({ summary: 'Bitácora de plataforma, de la más reciente a la más vieja, paginada.' })
  @ApiOkResponse({ type: BitacoraDto })
  bitacora(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: BitacoraQueryDto,
  ): Promise<BitacoraDto> {
    return this.plataforma.bitacora(scope, q);
  }

  @Get('ajustes')
  @ApiOperation({ summary: 'Ajustes que valen para todos los clientes (color de interfaz).' })
  @ApiOkResponse({ type: AjustesDto })
  ajustes(@EmpresaScopeActual() scope: EmpresaScope): Promise<AjustesDto> {
    return this.plataforma.ajustes(scope);
  }

  @Put('ajustes')
  @ApiOperation({
    summary: 'Guarda el color de interfaz global (lo toman las páginas al cargar).',
  })
  @ApiOkResponse({ type: AjustesDto })
  @ApiBadRequestResponse({ type: ErrorDto, description: 'Color que no está en la lista.' })
  guardarAjustes(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: GuardarAjustesDto,
  ): Promise<AjustesDto> {
    return this.plataforma.guardarAjustes(quien(req, scope), dto.colorAcento);
  }
}
