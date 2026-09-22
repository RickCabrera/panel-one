import { Controller, Get, Query } from '@nestjs/common';
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
  ConsumoTeoricoDto,
  ConsumoTeoricoQueryDto,
  RecetasDto,
  RecetasQueryDto,
} from './dto/recetas.dto';
import { RecetasService } from './recetas.service';

const DESC_404 =
  'La empresa no existe o no está en tu alcance, o la sucursal no es de esa empresa. Misma ' +
  'respuesta en todos los casos (nunca 403).';

@ApiTags('inventario')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@Controller('inventario')
export class RecetasController {
  constructor(private readonly recetas: RecetasService) {}

  @Get('recetas')
  @ApiOperation({
    summary: 'Recetas de SoftRestaurant por producto, con su costo (F2-125).',
    description:
      'Las recetas que el agente mandó (`POST /ingesta/recetas`) cruzadas con el espejo de ' +
      'productos e insumos: renglones con nombre, unidad, costo de la última foto de existencias ' +
      'e importe; costo de la receta y % sobre el precio. Productos sin receta y recetas de ' +
      'productos que el espejo no tiene, marcados. `sucursales[].recetasRecibidas = 0` = el ' +
      'agente nunca mandó recetas de esa sucursal.',
  })
  @ApiOkResponse({ type: RecetasDto })
  lista(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: RecetasQueryDto,
  ): Promise<RecetasDto> {
    return this.recetas.recetas(scope, q);
  }

  @Get('consumo-teorico')
  @ApiOperation({
    summary: 'Consumo teórico (ventas × receta) contra el real (pólizas), por insumo (F2-125).',
    description:
      'Teórico = Σ cantidad vendida × receta, cruzando la partida con el producto POR NOMBRE en su ' +
      'sucursal (cheques no cancelados cerrados en el rango, en la zona de cada sucursal). Real = ' +
      'salidas por pólizas NO canceladas de consumo, merma y ajuste en el rango, con el desglose. ' +
      'Ranking por importe de la variación. Lo vendido sin receta, sin catálogo o con nombre ' +
      'ambiguo va aparte y no detiene el cálculo. Una sucursal sin catálogo de productos o sin ' +
      'recetas no se calcula (`calculada=false`); sin pólizas, el real es nulo (no cero).',
  })
  @ApiOkResponse({ type: ConsumoTeoricoDto })
  consumoTeorico(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: ConsumoTeoricoQueryDto,
  ): Promise<ConsumoTeoricoDto> {
    return this.recetas.consumoTeorico(scope, q);
  }
}
