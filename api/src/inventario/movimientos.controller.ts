import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { ErrorDto } from '../auth/dto/sesion.dto';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  KardexDto,
  KardexQueryDto,
  MovimientosDto,
  MovimientosQueryDto,
  PolizaDetalleDto,
  PolizaQueryDto,
} from './dto/movimientos.dto';
import { MovimientosService } from './movimientos.service';

const DESC_404 =
  'La empresa no existe o no está en tu alcance, la sucursal no es de esa empresa, o la póliza ' +
  'no es de esa empresa. Misma respuesta en todos los casos (nunca 403).';

@ApiTags('inventario')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@Controller('inventario')
export class MovimientosController {
  constructor(private readonly movimientos: MovimientosService) {}

  @Get('movimientos')
  @ApiOperation({
    summary: 'Línea de tiempo de movimientos de inventario (F2-122), más reciente primero.',
    description:
      'Las partidas de las pólizas que el agente mandó (`POST /ingesta/movimientos`), con los ' +
      'nombres de los catálogos espejo. Filtra por sucursal, almacén, insumo, tipo y rango de ' +
      'días (en la zona de cada sucursal). Las de pólizas canceladas salen marcadas. ' +
      '`sucursales[].polizasRecibidas = 0` = esa sucursal nunca mandó movimientos.',
  })
  @ApiOkResponse({ type: MovimientosDto })
  listar(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: MovimientosQueryDto,
  ): Promise<MovimientosDto> {
    return this.movimientos.listar(scope, q);
  }

  @Get('polizas/:id')
  @ApiOperation({ summary: 'Detalle de una póliza de inventario con todas sus partidas (F2-122).' })
  @ApiOkResponse({ type: PolizaDetalleDto })
  poliza(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() q: PolizaQueryDto,
  ): Promise<PolizaDetalleDto> {
    return this.movimientos.poliza(scope, id, q.empresaId);
  }

  @Get('kardex')
  @ApiOperation({
    summary: 'Kardex de un artículo en un almacén: saldo corrido y cuadre contra la existencia.',
    description:
      'Saldo inicial = Σ de lo no cancelado antes del rango; cada movimiento del rango con su ' +
      'saldo (fecha → folio → renglón; uno cancelado se muestra y no mueve el saldo). `cuadra` ' +
      'compara la existencia de la última foto (F2-121) con el saldo de los movimientos HASTA el ' +
      'corte de esa foto; es nulo si la sucursal nunca mandó movimientos o no hay existencia leída.',
  })
  @ApiOkResponse({ type: KardexDto })
  kardex(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: KardexQueryDto,
  ): Promise<KardexDto> {
    return this.movimientos.kardex(scope, q);
  }
}
