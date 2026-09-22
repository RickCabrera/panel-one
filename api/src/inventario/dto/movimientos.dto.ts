import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TipoPolizaInventario } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';

import { TIPOS_POLIZA } from '../../ingesta/dto/movimientos.dto';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const DOC_DIA =
  'Día `YYYY-MM-DD` en la zona de CADA sucursal: [desde 00:00, hasta+1 00:00) locales. Máximo 366 días.';

export const POR_PAGINA_MOVIMIENTOS = 50;
export const MAX_POR_PAGINA_MOVIMIENTOS = 200;

// ---------------------------------------------------------------------------
// consultas
// ---------------------------------------------------------------------------

export class MovimientosQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Una sucursal de esa empresa. Sin él, todas. De otra empresa = 404.',
  })
  @IsOptional()
  @IsUUID('all')
  sucursalId?: string;

  @ApiPropertyOptional({
    maxLength: 64,
    description: 'El `origenSrId` de un almacén de esa sucursal. Exige `sucursalId` (si no, 400).',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  almacenOrigenSrId?: string;

  @ApiPropertyOptional({
    maxLength: 64,
    description: 'El `origenSrId` de un insumo de esa sucursal. Exige `sucursalId` (si no, 400).',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  insumoOrigenSrId?: string;

  @ApiPropertyOptional({ enum: TIPOS_POLIZA, enumName: 'TipoPolizaInventario' })
  @IsOptional()
  @IsIn(TIPOS_POLIZA)
  tipo?: TipoPolizaInventario;

  @ApiProperty({ example: '2026-09-01', description: DOC_DIA })
  @Matches(DIA, { message: 'desde debe ser YYYY-MM-DD' })
  desde!: string;

  @ApiProperty({ example: '2026-09-20', description: DOC_DIA })
  @Matches(DIA, { message: 'hasta debe ser YYYY-MM-DD' })
  hasta!: string;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100_000)
  pagina?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: MAX_POR_PAGINA_MOVIMIENTOS,
    default: POR_PAGINA_MOVIMIENTOS,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_POR_PAGINA_MOVIMIENTOS)
  porPagina?: number;
}

export class PolizaQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;
}

export class KardexQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({ format: 'uuid', description: 'La sucursal del almacén. De otra empresa = 404.' })
  @IsUUID('all')
  sucursalId!: string;

  @ApiProperty({ maxLength: 64 })
  @IsString()
  @Length(1, 64)
  almacenOrigenSrId!: string;

  @ApiProperty({ maxLength: 64 })
  @IsString()
  @Length(1, 64)
  insumoOrigenSrId!: string;

  @ApiProperty({ example: '2026-09-01', description: DOC_DIA })
  @Matches(DIA, { message: 'desde debe ser YYYY-MM-DD' })
  desde!: string;

  @ApiProperty({ example: '2026-09-20', description: DOC_DIA })
  @Matches(DIA, { message: 'hasta debe ser YYYY-MM-DD' })
  hasta!: string;
}

// ---------------------------------------------------------------------------
// respuestas
// ---------------------------------------------------------------------------

const DOC_CANTIDAD = 'Texto decimal con 3 decimales, CON SIGNO (+ entra, − sale).';

export class PolizaResumenDto {
  @ApiProperty({ format: 'uuid', description: 'Id del panel: el del detalle.' })
  id!: string;

  @ApiProperty()
  folio!: string;

  @ApiProperty({ enum: TIPOS_POLIZA, enumName: 'TipoPolizaInventario' })
  tipo!: TipoPolizaInventario;

  @ApiProperty({ description: 'Cancelada en SR: se muestra, pero no suma al kardex.' })
  cancelada!: boolean;

  @ApiProperty({ type: String, nullable: true })
  referencia!: string | null;
}

export class FilaMovimientoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: PolizaResumenDto })
  poliza!: PolizaResumenDto;

  @ApiProperty({ description: 'Renglón de la partida en su póliza (desde 0).' })
  renglon!: number;

  @ApiProperty({ format: 'date-time', description: 'UTC; se presenta en la zona de la sucursal.' })
  fecha!: string;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty()
  almacenOrigenSrId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nombre del catálogo; nulo si no está.',
  })
  almacen!: string | null;

  @ApiProperty()
  insumoOrigenSrId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nombre del catálogo; nulo si no está.',
  })
  insumo!: string | null;

  @ApiProperty({ type: String, nullable: true })
  clave!: string | null;

  @ApiProperty({ type: String, nullable: true })
  unidad!: string | null;

  @ApiProperty({ description: DOC_CANTIDAD, example: '-2.500' })
  cantidad!: string;

  @ApiProperty({ description: 'Costo por unidad, 2 decimales.', example: '85.40' })
  costoUnitario!: string;

  @ApiProperty({ description: 'cantidad × costo, 2 decimales, con signo.', example: '-213.50' })
  importe!: string;
}

export class SucursalMovimientosDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({ description: 'Zona IANA de la sucursal: las horas se presentan en ella.' })
  zonaHoraria!: string;

  @ApiProperty({
    description: 'Pólizas recibidas del agente en toda la historia. 0 = nunca mandó movimientos.',
  })
  polizasRecibidas!: number;
}

export class AlmacenMovimientosDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  almacenOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  almacen!: string | null;
}

export class MovimientosDto {
  @ApiProperty({ type: [FilaMovimientoDto], description: 'Más reciente primero.' })
  movimientos!: FilaMovimientoDto[];

  @ApiProperty({ description: 'Movimientos del filtro (todas las páginas).' })
  total!: number;

  @ApiProperty()
  pagina!: number;

  @ApiProperty()
  porPagina!: number;

  @ApiProperty({ type: [SucursalMovimientosDto] })
  sucursales!: SucursalMovimientosDto[];

  @ApiProperty({
    type: [AlmacenMovimientosDto],
    description: 'Los almacenes con pólizas o del catálogo (activos), para el filtro.',
  })
  almacenes!: AlmacenMovimientosDto[];
}

export class PartidaPolizaDto {
  @ApiProperty()
  renglon!: number;

  @ApiProperty()
  insumoOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  insumo!: string | null;

  @ApiProperty({ type: String, nullable: true })
  clave!: string | null;

  @ApiProperty({ type: String, nullable: true })
  unidad!: string | null;

  @ApiProperty({ description: DOC_CANTIDAD })
  cantidad!: string;

  @ApiProperty()
  costoUnitario!: string;

  @ApiProperty()
  importe!: string;
}

export class PolizaDetalleDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  origenSrId!: string;

  @ApiProperty()
  folio!: string;

  @ApiProperty({ enum: TIPOS_POLIZA, enumName: 'TipoPolizaInventario' })
  tipo!: TipoPolizaInventario;

  @ApiProperty({ type: String, nullable: true, description: 'El código crudo de SR.' })
  tipoSr!: string | null;

  @ApiProperty({ format: 'date-time' })
  fecha!: string;

  @ApiProperty({ type: String, nullable: true })
  referencia!: string | null;

  @ApiProperty()
  cancelada!: boolean;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty()
  zonaHoraria!: string;

  @ApiProperty()
  almacenOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  almacen!: string | null;

  @ApiProperty({ format: 'date-time', description: 'Cuándo la recibió el API por última vez.' })
  recibidaAt!: string;

  @ApiProperty({ type: [PartidaPolizaDto], description: 'En orden de renglón.' })
  partidas!: PartidaPolizaDto[];

  @ApiProperty({ description: 'Σ importes de las partidas, con signo, 2 decimales.' })
  importeTotal!: string;
}

export class FilaKardexDto extends FilaMovimientoDto {
  @ApiProperty({
    description: 'Saldo después de este movimiento (una fila cancelada repite el anterior).',
  })
  saldo!: string;
}

export class KardexDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty()
  zonaHoraria!: string;

  @ApiProperty()
  almacenOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  almacen!: string | null;

  @ApiProperty()
  insumoOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  insumo!: string | null;

  @ApiProperty({ type: String, nullable: true })
  clave!: string | null;

  @ApiProperty({ type: String, nullable: true })
  unidad!: string | null;

  @ApiProperty({
    description:
      'Pólizas recibidas de la sucursal en toda la historia. 0 = nunca mandó movimientos.',
  })
  polizasRecibidas!: number;

  @ApiProperty({ description: 'Σ de lo no cancelado ANTES del rango. 3 decimales.' })
  saldoInicial!: string;

  @ApiProperty({ type: [FilaKardexDto], description: 'Del rango, fecha → folio → renglón.' })
  movimientos!: FilaKardexDto[];

  @ApiProperty({ description: 'Saldo al final del rango.' })
  saldoFinal!: string;

  @ApiProperty({ description: 'Σ entradas del rango (no canceladas).' })
  entradas!: string;

  @ApiProperty({ description: 'Σ salidas del rango, en positivo (no canceladas).' })
  salidas!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Cuándo se leyó la última foto de existencias de ese almacén. Nulo = nunca.',
  })
  corteExistencia!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'La existencia de ese artículo en esa foto. Nulo = no viene en ella o no hay foto.',
  })
  existencia!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Σ de lo no cancelado con fecha ≤ `corteExistencia`. Nulo sin foto.',
  })
  saldoAlCorte!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'existencia − saldoAlCorte. Nulo si no hay con qué comparar.',
  })
  diferencia!: string | null;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'true = el kardex reproduce la existencia leída. Nulo = sin movimientos recibidos o sin existencia leída.',
  })
  cuadra!: boolean | null;
}
