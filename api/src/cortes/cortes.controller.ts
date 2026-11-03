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
  CortesService,
  type DetalleCorte,
  type ListaCortes,
  type ResumenCorte,
} from './cortes.service';
import {
  AlcanceCortesQueryDto,
  CortesQueryDto,
  DetalleCorteDto,
  ListaCortesDto,
  ResumenCorteDto,
} from './dto/cortes.dto';

const DESC_404 =
  'La empresa (o el corte) no existe o no está en tu alcance, o la sucursal no es de esa ' +
  'empresa. Misma respuesta en todos los casos (nunca 403).';

/**
 * Cortes de caja: los turnos de SoftRestaurant y lo cobrado en cada uno (MVP de cortes).
 * Cualquier rol autenticado; el alcance lo pone el scope del token. Sin cache: el turno abierto
 * es un acumulado en curso.
 */
@ApiTags('cortes')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@Controller('cortes')
export class CortesController {
  constructor(private readonly cortes: CortesService) {}

  @Get()
  @ApiOperation({
    summary: 'Cortes (turnos de SR) que estuvieron abiertos en el rango, con su venta.',
    description:
      'Un turno entra si se abrió antes del fin del rango y no se cerró antes de su inicio (días ' +
      'locales de SU sucursal); un turno abierto que empezó antes también sale. Venta = Σ total ' +
      'de las cuentas no canceladas cuyo `idturno` (el del COBRO en SR) es el del turno. Orden: ' +
      'apertura más reciente primero; máximo 500.',
  })
  @ApiOkResponse({ type: ListaCortesDto })
  listar(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: CortesQueryDto,
  ): Promise<ListaCortes> {
    return this.cortes.listar(scope, {
      empresaId: q.empresaId,
      sucursalId: q.sucursalId,
      desde: q.desde,
      hasta: q.hasta,
    });
  }

  @Get('en-curso')
  @ApiOperation({
    summary: 'Los turnos abiertos ahora (sin cierre), con lo cobrado hasta el momento.',
    description: 'Una fila por turno abierto de la empresa o de la sucursal. Vacío si no hay.',
  })
  @ApiOkResponse({ type: [ResumenCorteDto] })
  enCurso(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: AlcanceCortesQueryDto,
  ): Promise<ResumenCorte[]> {
    return this.cortes.enCurso(scope, q.empresaId, q.sucursalId);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Detalle de un corte: venta, cuentas, comensales, formas de pago, declarado vs cobrado.',
    description:
      'Turno abierto = acumulado en curso (sin diferencias del cuadre). Un corte de otra empresa ' +
      'responde 404, igual que uno que no existe.',
  })
  @ApiOkResponse({ type: DetalleCorteDto })
  detalle(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<DetalleCorte> {
    return this.cortes.detalle(scope, id);
  }
}
