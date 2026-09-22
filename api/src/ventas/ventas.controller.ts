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
import type { FiltroVentas } from '../scope/consulta-ventas';
import { EmpresaScopeActual } from '../scope/empresa-scope.decorator';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  AgregadosVentasService,
  LIMITE_TOP_DEFAULT,
  type FormasPago,
  type ProductoTop,
  type Resumen,
  type VentaDia,
  type VentaHora,
  type VentaSucursal,
} from './agregados-ventas.service';
import { CacheAgregados } from './cache-agregados';
import {
  FiltroVentasQueryDto,
  FormasPagoDto,
  PaginaTicketsDto,
  POR_PAGINA_DEFAULT,
  ProductoTopDto,
  ResumenDto,
  TicketsQueryDto,
  TopProductosQueryDto,
  VentaDiaDto,
  VentaHoraDto,
  VentaSucursalDto,
} from './dto/ventas.dto';
import { TicketsService, type PaginaTickets } from './tickets.service';

const DESC_404 =
  'La empresa no existe o no está en tu alcance, o la sucursal no es de esa empresa. ' +
  'Misma respuesta en todos los casos (nunca 403).';

function filtroDe(q: FiltroVentasQueryDto): FiltroVentas {
  return { empresaId: q.empresaId, sucursalId: q.sucursalId, desde: q.desde, hasta: q.hasta };
}

function parametros(q: FiltroVentasQueryDto): string[] {
  return [q.empresaId, q.sucursalId ?? '', q.desde, q.hasta];
}

/**
 * Lectura de ventas para el panel (F1-033). Cualquier rol autenticado; el
 * alcance lo pone el scope del token (`@EmpresaScopeActual()`).
 *
 * Los agregados (todo menos tickets) pasan por `CacheAgregados` (15 s). El cache se consulta
 * aquí, DESPUÉS del ValidationPipe, y su llave usa el scope del token más
 * todos los parámetros; nunca un tenant sacado del query. Tickets no se cachea.
 */
@ApiTags('ventas')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ type: ErrorDto, description: 'Sin token, token inválido o vencido.' })
@ApiBadRequestResponse({ type: ErrorDto, description: 'Parámetros inválidos.' })
@ApiNotFoundResponse({ type: ErrorDto, description: DESC_404 })
@Controller('ventas')
export class VentasController {
  constructor(
    private readonly agregados: AgregadosVentasService,
    private readonly tickets: TicketsService,
    private readonly cache: CacheAgregados,
  ) {}

  @Get('resumen')
  @ApiOperation({
    summary: 'Venta total, cuentas, ticket promedio, comensales, descuentos y cancelados.',
    description: 'Cache de 15 s por usuario-alcance y filtro.',
  })
  @ApiOkResponse({ type: ResumenDto })
  resumen(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: FiltroVentasQueryDto,
  ): Promise<Resumen> {
    return this.cache.obtener(scope, 'resumen', parametros(q), () =>
      this.agregados.resumen(scope, filtroDe(q)),
    );
  }

  @Get('por-hora')
  @ApiOperation({
    summary: 'Venta por hora LOCAL de cierre: siempre 24 filas (0..23), con cero donde no hubo.',
    description: 'Cache de 15 s por usuario-alcance y filtro.',
  })
  @ApiOkResponse({ type: [VentaHoraDto] })
  porHora(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: FiltroVentasQueryDto,
  ): Promise<VentaHora[]> {
    return this.cache.obtener(scope, 'por-hora', parametros(q), () =>
      this.agregados.porHora(scope, filtroDe(q)),
    );
  }

  @Get('por-dia')
  @ApiOperation({
    summary:
      'Venta por día LOCAL de cierre: una fila por cada día de desde..hasta, con cero donde no hubo.',
    description:
      'Σ venta y Σ cuentas = las de /ventas/resumen con el mismo filtro. Con varias sucursales, ' +
      'cada cuenta cae en el día de SU zona. Cache de 15 s por usuario-alcance y filtro.',
  })
  @ApiOkResponse({ type: [VentaDiaDto] })
  porDia(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: FiltroVentasQueryDto,
  ): Promise<VentaDia[]> {
    return this.cache.obtener(scope, 'por-dia', parametros(q), () =>
      this.agregados.porDia(scope, filtroDe(q)),
    );
  }

  @Get('comparativo-sucursales')
  @ApiOperation({
    summary:
      'Una fila por sucursal en alcance (incluidas las que no vendieron): venta, cuentas, ticket ' +
      'promedio y comensales.',
    description:
      'Σ venta y Σ cuentas = las de /ventas/resumen con el mismo filtro. Con `sucursalId`, sólo ' +
      'esa. Orden por nombre. Cache de 15 s por usuario-alcance y filtro.',
  })
  @ApiOkResponse({ type: [VentaSucursalDto] })
  comparativoSucursales(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: FiltroVentasQueryDto,
  ): Promise<VentaSucursal[]> {
    return this.cache.obtener(scope, 'comparativo-sucursales', parametros(q), () =>
      this.agregados.comparativoSucursales(scope, filtroDe(q)),
    );
  }

  @Get('formas-pago')
  @ApiOperation({
    summary: 'Desglose por forma de pago, con el catálogo de la empresa aplicado al leer.',
    description: 'Cache de 15 s por usuario-alcance y filtro.',
  })
  @ApiOkResponse({ type: FormasPagoDto })
  formasPago(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: FiltroVentasQueryDto,
  ): Promise<FormasPago> {
    return this.cache.obtener(scope, 'formas-pago', parametros(q), () =>
      this.agregados.formasPago(scope, filtroDe(q)),
    );
  }

  @Get('top-productos')
  @ApiOperation({
    summary: 'Top productos por importe o por cantidad, agrupados por nombre.',
    description: 'Cache de 15 s por usuario-alcance y filtro.',
  })
  @ApiOkResponse({ type: [ProductoTopDto] })
  topProductos(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: TopProductosQueryDto,
  ): Promise<ProductoTop[]> {
    const por = q.por ?? 'importe';
    const limite = q.limite ?? LIMITE_TOP_DEFAULT;
    return this.cache.obtener(scope, 'top-productos', [...parametros(q), por, limite], () =>
      this.agregados.topProductos(scope, filtroDe(q), { por, limite }),
    );
  }

  @Get('tickets')
  @ApiOperation({
    summary: 'Tickets del rango, paginados, con partidas y pagos (la fila expandible).',
    description:
      'Tickets = cuentas no canceladas cerradas en el rango + cancelados del rango (flag ' +
      '`cancelado`, no suman). Sin cache.',
  })
  @ApiOkResponse({ type: PaginaTicketsDto })
  listarTickets(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: TicketsQueryDto,
  ): Promise<PaginaTickets> {
    return this.tickets.listar(scope, filtroDe(q), {
      pagina: q.pagina ?? 1,
      porPagina: q.porPagina ?? POR_PAGINA_DEFAULT,
      folio: q.folio,
      corte: q.corte,
    });
  }
}
