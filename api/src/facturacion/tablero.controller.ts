import { Controller, Get, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';

import { Roles } from '../auth/decoradores';
import { ErrorDto } from '../auth/dto/sesion.dto';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import type { FiltroVentas } from '../scope/consulta-ventas';
import type { FiltroVentasQueryDto } from '../ventas/dto/ventas.dto';
import {
  CfdisQueryDto,
  PaginaCfdisDto,
  PaginaPorFacturarDto,
  POR_PAGINA_CFDIS_DEFAULT,
  PorFacturarQueryDto,
  TableroFacturacionDto,
  TableroQueryDto,
} from './dto/tablero.dto';
import {
  TableroFacturacionService,
  type PaginaCfdis,
  type PaginaPorFacturar,
  type TableroFacturacion,
} from './tablero.service';

const DESC_404 =
  'La empresa o la sucursal no existen o no están en tu alcance. Misma respuesta en todos los ' +
  'casos (nunca 403).';
const DESC_403 =
  'Rol insuficiente (visor): lleva datos de los receptores o códigos que facturan el ticket.';

function filtroDe(q: FiltroVentasQueryDto): FiltroVentas {
  return {
    empresaId: q.empresaId,
    sucursalId: q.sucursalId,
    desde: q.desde,
    hasta: q.hasta,
    alturaAl: q.alturaAl,
  };
}

/**
 * Tablero de facturación (F2-106). El resumen (`tablero`) es de cualquier rol: sólo agregados, la
 * usa también Comparativos. La tabla de CFDI (receptores) y las cuentas por facturar (el código
 * factura el ticket) son de administradores.
 */
@ApiTags('facturacion')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Filtro inválido.' })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@Controller('facturacion')
export class TableroFacturacionController {
  constructor(private readonly tablero: TableroFacturacionService) {}

  @Get('tablero')
  @ApiOperation({
    summary: 'KPIs, barras por sucursal / mes / hora y cuentas por facturar del periodo (F2-106).',
    description:
      'Cualquier rol. La venta es la MISMA de `/ventas/resumen` y `/ventas/comparativo-sucursales` ' +
      '(días locales de cada sucursal, `alturaAl` incluido). Lo facturado es por fecha de EMISIÓN ' +
      'del CFDI, cortada en la zona de su sucursal; una reserva en `timbrando` nunca cuenta.',
  })
  @ApiOkResponse({ type: TableroFacturacionDto })
  resumen(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: TableroQueryDto,
  ): Promise<TableroFacturacion> {
    return this.tablero.tablero(scope, filtroDe(q));
  }

  @Get('cfdis')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'CFDI emitidos en el periodo, con búsqueda y paginados (F2-106).',
    description:
      'Sólo administradores. Vigentes y cancelados (nunca reservas `timbrando`), por fecha de ' +
      'emisión en la zona de su sucursal, del más reciente al más viejo. Las descargas son ' +
      '`GET /facturacion/cfdis/{id}/xml|pdf`.',
  })
  @ApiOkResponse({ type: PaginaCfdisDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  cfdis(@EmpresaScopeActual() scope: EmpresaScope, @Query() q: CfdisQueryDto): Promise<PaginaCfdis> {
    return this.tablero.cfdis(scope, filtroDe(q), {
      q: q.q,
      estado: q.estado,
      pagina: q.pagina ?? 1,
      porPagina: q.porPagina ?? POR_PAGINA_CFDIS_DEFAULT,
    });
  }

  @Get('por-facturar')
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  @ApiOperation({
    summary: 'Cuentas del periodo con código de facturación todavía facturable (F2-106).',
    description:
      'Sólo administradores (el código deja facturar el ticket). Estado público `pendiente`: sin ' +
      'CFDI vigente ni reserva, sin vencer y de una cuenta no cancelada.',
  })
  @ApiOkResponse({ type: PaginaPorFacturarDto })
  @ApiForbiddenResponse({ type: ErrorDto, description: DESC_403 })
  porFacturar(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: PorFacturarQueryDto,
  ): Promise<PaginaPorFacturar> {
    return this.tablero.porFacturar(scope, filtroDe(q), {
      pagina: q.pagina ?? 1,
      porPagina: q.porPagina ?? POR_PAGINA_CFDIS_DEFAULT,
    });
  }
}
