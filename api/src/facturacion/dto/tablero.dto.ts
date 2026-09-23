import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

import { FiltroVentasQueryDto, PAGINA_MAX } from '../../ventas/dto/ventas.dto';
import type {
  CfdiFila,
  CifrasCfdi,
  CuentaPorFacturar,
  EstadoCfdiEmitido,
  OrigenCfdi,
  PaginaCfdis,
  ReceptorFila,
  PaginaPorFacturar,
  SucursalTablero,
  TableroFacturacion,
} from '../tablero.service';
import { ORIGENES_CFDI } from '../tablero.service';

/**
 * Contratos del tablero de facturación (F2-106). Dinero como texto con 2 decimales; la tasa con 4.
 * Fechas en UTC (ISO 8601). El filtro es el de `/ventas/*`: días LOCALES de cada sucursal.
 */

export const ESTADOS_CFDI_EMITIDO: readonly EstadoCfdiEmitido[] = ['vigente', 'cancelado'];
export const POR_PAGINA_CFDIS_DEFAULT = 50;
export const POR_PAGINA_CFDIS_MAX = 200;
export const LARGO_MAX_BUSQUEDA = 64;

const DOC_TASA =
  'Facturado / venta del MISMO periodo, 4 decimales (0.1523 = 15.23 %), mitad lejos de cero. ' +
  'Null sin venta positiva. Lo facturado va por fecha de EMISIÓN y la venta por fecha de cierre: ' +
  'un ticket de otro periodo facturado en éste la puede llevar arriba de 1 (supuesto provisional).';

export class TableroQueryDto extends FiltroVentasQueryDto {}

class PaginaQueryDto extends FiltroVentasQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: PAGINA_MAX, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINA_MAX)
  pagina?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: POR_PAGINA_CFDIS_MAX,
    default: POR_PAGINA_CFDIS_DEFAULT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POR_PAGINA_CFDIS_MAX)
  porPagina?: number;
}

export class CfdisQueryDto extends PaginaQueryDto {
  @ApiPropertyOptional({
    maxLength: LARGO_MAX_BUSQUEDA,
    description:
      'Búsqueda literal (sin comodines, sin distinguir mayúsculas) en RFC del receptor, UUID, ' +
      'serie-folio (`A-123`, `A123` o `123`) y folio del ticket. Busca SÓLO en los CFDI emitidos ' +
      'en el rango pedido, no en todo el histórico. Vacía = sin búsqueda.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(LARGO_MAX_BUSQUEDA)
  q?: string;

  @ApiPropertyOptional({ enum: ESTADOS_CFDI_EMITIDO, description: 'Sin él, los dos.' })
  @IsOptional()
  @IsIn(ESTADOS_CFDI_EMITIDO)
  estado?: EstadoCfdiEmitido;

  @ApiPropertyOptional({
    enum: ORIGENES_CFDI,
    description: 'F2-107: `manual` = facturas sin ticket. Sin él, los dos.',
  })
  @IsOptional()
  @IsIn(ORIGENES_CFDI)
  origen?: OrigenCfdi;
}

export class PorFacturarQueryDto extends PaginaQueryDto {}

export class CifrasCfdiDto implements CifrasCfdi {
  @ApiProperty({ example: '2350.00' })
  monto!: string;

  @ApiProperty({ example: 4 })
  cfdis!: number;
}

export class VentasTableroDto {
  @ApiProperty({ example: '3406.78', description: 'La MISMA venta que `/ventas/resumen`.' })
  venta!: string;

  @ApiProperty({ example: 9 })
  cuentas!: number;
}

export class PorFacturarResumenDto {
  @ApiProperty({ example: 2 })
  cuentas!: number;

  @ApiProperty({ example: '273.45' })
  monto!: string;
}

export class SucursalTableroDto implements SucursalTablero {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ example: '2406.78', description: 'La de `/ventas/comparativo-sucursales`.' })
  venta!: string;

  @ApiProperty()
  cuentas!: number;

  @ApiProperty({ example: '1500.00', description: 'CFDI vigentes emitidos en el periodo.' })
  facturado!: string;

  @ApiProperty({ description: 'Cuántos CFDI vigentes.' })
  cfdis!: number;

  @ApiProperty({ type: CifrasCfdiDto })
  cancelados!: CifrasCfdiDto;

  @ApiProperty({ type: String, nullable: true, example: '0.6232', description: DOC_TASA })
  tasa!: string | null;
}

export class MesTableroDto {
  @ApiProperty({
    example: '2026-09',
    description: 'Mes LOCAL de la emisión (zona de la sucursal).',
  })
  mes!: string;

  @ApiProperty({ example: '2350.00' })
  facturado!: string;

  @ApiProperty()
  cfdis!: number;
}

export class HoraTableroDto {
  @ApiProperty({ minimum: 0, maximum: 23, description: 'Hora LOCAL de la emisión, 0..23.' })
  hora!: number;

  @ApiProperty({ example: '500.00' })
  facturado!: string;

  @ApiProperty()
  cfdis!: number;
}

export class TableroFacturacionDto implements TableroFacturacion {
  @ApiProperty({ type: VentasTableroDto })
  ventas!: VentasTableroDto;

  @ApiProperty({
    type: CifrasCfdiDto,
    description: 'CFDI VIGENTES emitidos en el periodo. Una reserva en `timbrando` nunca cuenta.',
  })
  facturado!: CifrasCfdiDto;

  @ApiProperty({
    type: CifrasCfdiDto,
    description:
      'CFDI emitidos en el periodo que HOY están cancelados (por su fecha de emisión: todavía no ' +
      'se guarda la de cancelación, F2-109). No suman en `facturado`.',
  })
  cancelados!: CifrasCfdiDto;

  @ApiProperty({ type: String, nullable: true, example: '0.6898', description: DOC_TASA })
  tasa!: string | null;

  @ApiProperty({
    type: PorFacturarResumenDto,
    description:
      'Cuentas del periodo con código de facturación todavía facturable (estado público ' +
      '`pendiente`: sin CFDI ni reserva, sin vencer).',
  })
  porFacturar!: PorFacturarResumenDto;

  @ApiProperty({ type: [SucursalTableroDto], description: 'Todas las del alcance, por nombre.' })
  porSucursal!: SucursalTableroDto[];

  @ApiProperty({
    type: [MesTableroDto],
    description: 'Todos los meses que toca el rango, en orden; un mes sin CFDI va en 0.',
  })
  porMes!: MesTableroDto[];

  @ApiProperty({ type: [HoraTableroDto], description: 'Siempre 24 filas, 0..23.' })
  porHora!: HoraTableroDto[];
}

export class ReceptorFilaDto implements ReceptorFila {
  @ApiProperty({ example: 'EKU9003173C9' })
  rfc!: string;

  @ApiProperty({ example: 'ESCUELA KEMPER URGATE' })
  razonSocial!: string;

  @ApiProperty({ example: '601' })
  regimenFiscal!: string;

  @ApiProperty({ example: '42501' })
  cp!: string;

  @ApiProperty({ example: 'G03' })
  usoCfdi!: string;

  @ApiProperty({ type: String, nullable: true })
  email!: string | null;
}

export class CfdiFilaDto implements CfdiFila {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '5FB2822E-396D-4725-8521-CDC4BDD20CCF' })
  uuid!: string;

  @ApiProperty({ example: 'A-1024' })
  serieFolio!: string;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({ example: 'EKU9003173C9' })
  receptorRfc!: string;

  @ApiProperty({ example: 'ESCUELA KEMPER URGATE' })
  receptorNombre!: string;

  @ApiProperty({ example: '315.50' })
  total!: string;

  @ApiProperty({ enum: ESTADOS_CFDI_EMITIDO })
  estado!: EstadoCfdiEmitido;

  @ApiProperty({ format: 'date-time' })
  emitidoAt!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Folio del ticket del POS. Null en una factura sin ticket (F2-107).',
  })
  folioTicket!: string | null;

  @ApiProperty({ description: 'Hay XML guardado (`GET /facturacion/cfdis/{id}/xml`).' })
  xml!: boolean;

  @ApiProperty({ description: 'Hay PDF guardado (`GET /facturacion/cfdis/{id}/pdf`).' })
  pdf!: boolean;

  @ApiProperty({ enum: ORIGENES_CFDI, description: 'F2-107: `manual` = factura sin ticket.' })
  origen!: OrigenCfdi;

  @ApiProperty({
    type: () => ReceptorFilaDto,
    description: 'Los datos con que se timbró (precargan la refacturación, F2-107).',
  })
  receptor!: ReceptorFilaDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'UUID del CFDI al que éste SUSTITUYE (relación 04, F2-107).',
  })
  sustituyeA!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'UUID de su sustituto ya timbrado (F2-107), aunque caiga fuera del rango.',
  })
  sustituidoPor!: string | null;

  @ApiProperty({
    description:
      'Vigente CON un sustituto vigente: la cancelación 01 sigue pendiente. No suma a lo ' +
      'facturado del tablero (suma el sustituto); el filtro `estado=vigente` sí lo lista.',
  })
  sustitucionPendiente!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'c_MotivoCancelacion con que se canceló (F2-107: 01), si se conoce.',
  })
  motivoCancelacion!: string | null;
}

export class PaginaCfdisDto implements PaginaCfdis {
  @ApiProperty({ description: 'CFDI del filtro completo, no de esta página.' })
  total!: number;

  @ApiProperty()
  pagina!: number;

  @ApiProperty()
  porPagina!: number;

  @ApiProperty({
    type: [CfdiFilaDto],
    description: 'Del más reciente al más viejo (por emisión). Vacío si la página pasa del final.',
  })
  cfdis!: CfdiFilaDto[];
}

export class CuentaPorFacturarDto implements CuentaPorFacturar {
  @ApiProperty({ format: 'uuid' })
  chequeId!: string;

  @ApiProperty()
  folio!: string;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({ format: 'date-time' })
  cerradoAt!: string;

  @ApiProperty({ example: '315.50' })
  total!: string;

  @ApiProperty({ example: '7JQRECP3U' })
  codigo!: string;

  @ApiProperty({ format: 'date-time', description: 'Desde este instante ya no sirve (exclusivo).' })
  expiraAt!: string;
}

export class PaginaPorFacturarDto implements PaginaPorFacturar {
  @ApiProperty({ description: 'Cuentas por facturar del filtro completo.' })
  total!: number;

  @ApiProperty({ example: '273.45', description: 'Suma de su total, del filtro completo.' })
  monto!: string;

  @ApiProperty()
  pagina!: number;

  @ApiProperty()
  porPagina!: number;

  @ApiProperty({ type: [CuentaPorFacturarDto], description: 'Las más recientes primero.' })
  cuentas!: CuentaPorFacturarDto[];
}
