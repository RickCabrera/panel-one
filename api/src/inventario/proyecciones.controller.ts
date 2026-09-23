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
import { ProyeccionesDto, ProyeccionesQueryDto } from './dto/proyecciones.dto';
import { ProyeccionesService } from './proyecciones.service';

const DESC_404 =
  'La empresa no existe o no está en tu alcance, o la sucursal no es de esa empresa. Misma ' +
  'respuesta en todos los casos (nunca 403).';

@ApiTags('inventario')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@Controller('inventario/proyecciones')
export class ProyeccionesController {
  constructor(private readonly proyecciones: ProyeccionesService) {}

  @Get()
  @ApiOperation({
    summary: 'Proyección de demanda y sugerido de compra por artículo y almacén (F2-127).',
    description:
      'Demanda = salidas de pólizas NO canceladas de consumo, merma y traspaso de salida, por día ' +
      'LOCAL de la sucursal. Proyección = Σ sobre los días del horizonte (desde hoy) del promedio ' +
      'ponderado 4-3-2-1 de las 4 semanas anteriores a hoy para ese día de la semana. Sugerido = ' +
      'max(0, proyección − existencia + mínimo). Un artículo con menos de 28 días desde su primer ' +
      'movimiento sale `sin_historial` (proyección y sugerido NULOS, nunca 0); un almacén sin foto ' +
      'de existencias, sugerido nulo. Una sucursal sin pólizas no se calcula (`calculada=false`).',
  })
  @ApiOkResponse({ type: ProyeccionesDto })
  listar(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: ProyeccionesQueryDto,
  ): Promise<ProyeccionesDto> {
    return this.proyecciones.listar(scope, q);
  }
}
