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
import {
  AnalisisService,
  type VentaHoraDia,
  type VentaMesero,
  type VentaPorMesa,
  type VentaPorProducto,
} from './analisis.service';
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
  VentaHoraDiaDto,
  VentaHoraDto,
  VentaMeseroDto,
  VentaPorMesaDto,
  VentaPorProductoDto,
  VentaSucursalDto,
} from './dto/ventas.dto';
import { TicketsService, type PaginaTickets } from './tickets.service';

const DESC_404 =
  'La empresa no existe o no está en tu alcance, o la sucursal no es de esa empresa. ' +
  'Misma respuesta en todos los casos (nunca 403).';

function filtroDe(q: FiltroVentasQueryDto): FiltroVentas {
  return {
    empresaId: q.empresaId,
    sucursalId: q.sucursalId,
    desde: q.desde,
    hasta: q.hasta,
    alturaAl: q.alturaAl,
  };
}

/** `alturaAl` va al FINAL y como `''` sin él: las llaves de antes no cambian de significado. */
function parametros(q: FiltroVentasQueryDto): string[] {
  return [q.empresaId, q.sucursalId ?? '', q.desde, q.hasta, q.alturaAl ?? ''];
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
    private readonly analisis: AnalisisService,
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

  @Get('por-mesero')
  @ApiOperation({
    summary:
      'Análisis (F2-221): una fila por (sucursal, mesero) con venta, cuentas, ticket promedio, ' +
      'comensales, propina, descuentos y cancelados.',
    description:
      'Σ venta = la de /ventas/resumen con el mismo filtro. Los cancelados no suman: se cuentan ' +
      'aparte por mesero. Un mesero con sólo cancelados aparece con venta 0.00 y cuentas 0. Null ' +
      '= cuentas sin mesero. Orden: venta desc, sucursal, mesero. Cache de 15 s.',
  })
  @ApiOkResponse({ type: [VentaMeseroDto] })
  porMesero(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: FiltroVentasQueryDto,
  ): Promise<VentaMesero[]> {
    return this.cache.obtener(scope, 'por-mesero', parametros(q), () =>
      this.analisis.porMesero(scope, filtroDe(q)),
    );
  }

  @Get('por-producto')
  @ApiOperation({
    summary:
      'Análisis (F2-221): TODOS los productos vendidos (por nombre) con importe y cantidad, y la ' +
      'diferencia contra la venta.',
    description:
      'Σ importe + diferenciaCuentas = venta = la de /ventas/resumen. Los cancelados no ' +
      'entran. Sin límite de filas (el panel pagina). Cache de 15 s.',
  })
  @ApiOkResponse({ type: VentaPorProductoDto })
  porProducto(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: FiltroVentasQueryDto,
  ): Promise<VentaPorProducto> {
    return this.cache.obtener(scope, 'por-producto', parametros(q), () =>
      this.analisis.porProducto(scope, filtroDe(q)),
    );
  }

  @Get('hora-dia')
  @ApiOperation({
    summary:
      'Análisis (F2-221): mapa de calor día de la semana × hora LOCAL de cierre (168 celdas).',
    description:
      'Σ celdas = /ventas/resumen. Cada cuenta cae en el día y la hora de SU sucursal. ' +
      '`diasEnRango` dice cuántas veces cae cada día de la semana en el rango, para distinguir ' +
      '"no está en el periodo" de "sin ventas". Cache de 15 s.',
  })
  @ApiOkResponse({ type: VentaHoraDiaDto })
  horaDia(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: FiltroVentasQueryDto,
  ): Promise<VentaHoraDia> {
    return this.cache.obtener(scope, 'hora-dia', parametros(q), () =>
      this.analisis.horaDia(scope, filtroDe(q)),
    );
  }

  @Get('por-mesa')
  @ApiOperation({
    summary:
      'Análisis (F2-221): tiempo de mesa y rotación, una fila por (sucursal, mesa), más las ' +
      'cuentas sin mesa.',
    description:
      'Duración = cierre − apertura; una negativa no entra al promedio y se cuenta en ' +
      '`duracionesInvalidas`. Σ venta de filas + sinMesa = /ventas/resumen. Cache de 15 s.',
  })
  @ApiOkResponse({ type: VentaPorMesaDto })
  porMesa(
    @EmpresaScopeActual() scope: EmpresaScope,
    @Query() q: FiltroVentasQueryDto,
  ): Promise<VentaPorMesa> {
    return this.cache.obtener(scope, 'por-mesa', parametros(q), () =>
      this.analisis.porMesa(scope, filtroDe(q)),
    );
  }

  @Get('tickets')
  @ApiOperation({
    summary: 'Tickets del rango, paginados, con partidas y pagos (la fila expandible).',
    description:
      'Tickets = cuentas no canceladas cerradas en el rango + cancelados del rango (flag ' +
      '`cancelado`, no suman). Filtros (F2-222) combinables con AND: mesero, mesa, forma, ' +
      'importeMin/importeMax, canceladas, producto, clienteId (F2-232) y folio; `total` es siempre ' +
      'el del filtro ' +
      'completo. Orden por `orden`/`dir`. Sin cache.',
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
      mesero: q.mesero,
      mesa: q.mesa,
      forma: q.forma,
      importeMin: q.importeMin,
      importeMax: q.importeMax,
      canceladas: q.canceladas,
      producto: q.producto,
      clienteId: q.clienteId,
      orden: q.orden,
      dir: q.dir,
    });
  }
}
