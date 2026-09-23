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
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';

import { Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import type { RequestAutenticado } from '../auth/request-autenticado';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import { ComprasService } from './compras.service';
import {
  AlcanceQueryDto,
  CambiarCategoriaDto,
  CategoriasGastoDto,
  CompraDetalleDto,
  ComprasDto,
  ComprasQueryDto,
  CrearCategoriaDto,
  CrearGastoDto,
  EditarGastoDto,
  EstadoResultadosDto,
  GastoCreadoDto,
  GastosDto,
  GastosQueryDto,
  RangoQueryDto,
} from './dto/finanzas.dto';
import { EstadoResultadosService } from './estado-resultados.service';
import { GastosService } from './gastos.service';

const DESC_404 =
  'La empresa no existe o no está en tu alcance, la sucursal no es de esa empresa, o la compra, ' +
  'la categoría o el gasto no son de esa empresa. Misma respuesta en todos los casos (nunca 403).';
const DESC_403 = 'Rol insuficiente (visor): sólo los administradores capturan gastos.';

@ApiTags('finanzas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@Controller('finanzas')
export class FinanzasController {
  constructor(
    private readonly compras: ComprasService,
    private readonly gastos: GastosService,
    private readonly estado: EstadoResultadosService,
  ) {}

  @Get('estado-resultados')
  @ApiOperation({
    summary: 'Estado de resultados simple por sucursal y total (F2-126).',
    description:
      'Venta neta (Σ `cheques.subtotal`, sin IVA — supuesto de esquema-sr §2) − costo de lo vendido ' +
      '(consumo teórico de F2-125 a costo) = utilidad bruta; − gastos del panel = utilidad de ' +
      'operación. Costo incompleto (insumo sin costo o producto vendido sin receta) = utilidad ' +
      'marcada `utilidadSobrestimada`. Sucursal con ventas sin catálogo de productos o sin recetas = ' +
      'costo y utilidades nulos con su motivo; el total es nulo si falta alguna. Las compras viajan ' +
      'como dato informativo y NO entran a la utilidad.',
  })
  @ApiOkResponse({ type: EstadoResultadosDto })
  estadoResultados(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: RangoQueryDto,
  ): Promise<EstadoResultadosDto> {
    return this.estado.estado(scope, q);
  }

  @Get('compras')
  @ApiOperation({
    summary: 'Compras a proveedor LEÍDAS de SoftRestaurant en un rango (F2-126).',
    description:
      'Por fecha en la zona de cada sucursal. Resumen por proveedor (sólo no canceladas), la lista ' +
      '(canceladas marcadas, tope 2000 con `truncado`) y el total sin IVA. ' +
      '`sucursales[].comprasRecibidas = 0` = el agente nunca mandó compras de esa sucursal.',
  })
  @ApiOkResponse({ type: ComprasDto })
  listarCompras(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: ComprasQueryDto,
  ): Promise<ComprasDto> {
    return this.compras.listar(scope, q);
  }

  @Get('compras/:id')
  @ApiOperation({ summary: 'Una compra con sus partidas (insumo, cantidad, costo, importe).' })
  @ApiOkResponse({ type: CompraDetalleDto })
  detalleCompra(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: AlcanceQueryDto,
  ): Promise<CompraDetalleDto> {
    return this.compras.detalle(scope, id, q);
  }

  @Get('categorias-gasto')
  @ApiOperation({ summary: 'Categorías de gasto de la empresa (activas e inactivas).' })
  @ApiOkResponse({ type: CategoriasGastoDto })
  categorias(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: AlcanceQueryDto,
  ): Promise<CategoriasGastoDto> {
    return this.gastos.categorias(scope, q);
  }

  @Post('categorias-gasto')
  @HttpCode(201)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({ summary: 'Crea una categoría de gasto (nombre único en la empresa).' })
  @ApiCreatedResponse({ type: GastoCreadoDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  @ApiConflictResponse({ type: ErrorDto, description: 'Ya existe una categoría con ese nombre.' })
  crearCategoria(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: CrearCategoriaDto,
  ): Promise<GastoCreadoDto> {
    return this.gastos.crearCategoria(scope, dto);
  }

  @Patch('categorias-gasto/:id')
  @HttpCode(204)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({ summary: 'Renombra o (des)activa una categoría. Inactiva = sin gastos nuevos.' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  @ApiConflictResponse({ type: ErrorDto, description: 'Ya existe una categoría con ese nombre.' })
  cambiarCategoria(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CambiarCategoriaDto,
  ): Promise<void> {
    return this.gastos.cambiarCategoria(scope, id, dto);
  }

  @Get('gastos')
  @ApiOperation({
    summary: 'Gastos de operación capturados en el panel, en un rango de días contables.',
    description:
      'Día CONTABLE local de cada sucursal (inclusivo). Sin anulados salvo `incluirAnulados=true`. ' +
      'Total y desglose por categoría sin anulados. Montos sin IVA acreditable.',
  })
  @ApiOkResponse({ type: GastosDto })
  listarGastos(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: GastosQueryDto,
  ): Promise<GastosDto> {
    return this.gastos.listar(scope, q);
  }

  @Post('gastos')
  @HttpCode(201)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Registra un gasto de una sucursal. Dato del panel: nunca se escribe a SR.',
  })
  @ApiCreatedResponse({ type: GastoCreadoDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  crearGasto(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Body() dto: CrearGastoDto,
  ): Promise<GastoCreadoDto> {
    return this.gastos.crear(scope, req.usuario!.id, dto);
  }

  @Patch('gastos/:id')
  @HttpCode(204)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({ summary: 'Edita día, categoría, concepto o monto de un gasto vigente.' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  @ApiConflictResponse({ type: ErrorDto, description: 'El gasto está anulado.' })
  editarGasto(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EditarGastoDto,
  ): Promise<void> {
    return this.gastos.editar(scope, req.usuario!.id, id, dto);
  }

  @Post('gastos/:id/anular')
  @HttpCode(204)
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({ summary: 'Anula un gasto (baja lógica: se queda marcado y deja de sumar).' })
  @ApiNoContentResponse()
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  @ApiConflictResponse({ type: ErrorDto, description: 'El gasto ya estaba anulado.' })
  anularGasto(
    @Req() req: RequestAutenticado,
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: AlcanceQueryDto,
  ): Promise<void> {
    return this.gastos.anular(scope, req.usuario!.id, id, q);
  }
}
