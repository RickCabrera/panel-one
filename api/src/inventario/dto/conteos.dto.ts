import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoConteo } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

import { CANTIDAD_NO_NEGATIVA } from '../../catalogos/dto/catalogos.dto';
import { ESTADOS_RENGLON, type EstadoRenglon } from '../conteos';

/** Tope de renglones por petición de captura (el web manda en lotes). */
export const MAX_CAPTURAS_LOTE = 500;

// ---------------------------------------------------------------------------
// peticiones
// ---------------------------------------------------------------------------

export class ConteosQueryDto {
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

  @ApiPropertyOptional({ enum: EstadoConteo, enumName: 'EstadoConteo' })
  @IsOptional()
  @IsEnum(EstadoConteo)
  estado?: EstadoConteo;
}

export class ConteoEmpresaDto {
  @ApiProperty({ format: 'uuid', description: 'La empresa del conteo. Otra = 404.' })
  @IsUUID('all')
  empresaId!: string;
}

export class CrearConteoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({ format: 'uuid', description: 'La sucursal del almacén. De otra empresa = 404.' })
  @IsUUID('all')
  sucursalId!: string;

  @ApiProperty({ maxLength: 64, description: 'El `origenSrId` de un almacén de esa sucursal.' })
  @IsString()
  @Length(1, 64)
  almacenOrigenSrId!: string;

  @ApiPropertyOptional({
    maxLength: 64,
    description: 'Sólo los artículos de este grupo de insumos. Sin él, todos los del almacén.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  grupoOrigenSrId?: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Nota libre (quién cuenta, turno...).' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  nota?: string;
}

export class CapturaConteoDto {
  @ApiProperty({ maxLength: 64 })
  @IsString()
  @Length(1, 64)
  insumoOrigenSrId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: CANTIDAD_NO_NEGATIVA.source,
    example: '12.5',
    description:
      'Lo contado en la unidad del insumo: texto decimal sin signo, hasta 3 decimales (más = ' +
      '400, nunca se redondea). Nulo = borrar lo capturado (vuelve a "sin contar").',
  })
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @Matches(CANTIDAD_NO_NEGATIVA, { message: '$property debe ser una cantidad decimal sin signo' })
  contado!: string | null;
}

export class CapturarConteoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({
    type: [CapturaConteoDto],
    minItems: 1,
    maxItems: MAX_CAPTURAS_LOTE,
    description: 'Todo o nada: un artículo que no es del conteo = 400 sin guardar nada.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_CAPTURAS_LOTE)
  @ValidateNested({ each: true })
  @Type(() => CapturaConteoDto)
  partidas!: CapturaConteoDto[];
}

// ---------------------------------------------------------------------------
// respuestas
// ---------------------------------------------------------------------------

export class ConteoResumenDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Consecutivo por sucursal.' })
  folio!: number;

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

  @ApiProperty({ type: String, nullable: true, description: 'Nulo = todos los artículos.' })
  grupoOrigenSrId!: string | null;

  @ApiProperty({ type: String, nullable: true })
  grupo!: string | null;

  @ApiProperty({ type: String, nullable: true })
  nota!: string | null;

  @ApiProperty({ enum: EstadoConteo, enumName: 'EstadoConteo' })
  estado!: EstadoConteo;

  @ApiProperty({
    format: 'date-time',
    description: 'El corte de la foto de existencias congelada como teórico (reloj del agente).',
  })
  teoricoCapturadoAt!: string;

  @ApiProperty({
    description:
      'La foto tenía más de 90 min cuando se creó el conteo: el teórico puede no reflejar lo ' +
      'último que pasó en el almacén.',
  })
  teoricoAtrasado!: boolean;

  @ApiProperty({ format: 'date-time' })
  creadoAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cerradoAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  canceladoAt!: string | null;

  @ApiProperty()
  articulos!: number;

  @ApiProperty({ description: 'Renglones con algo capturado.' })
  contados!: number;
}

export class AlmacenConteoDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  almacenOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  almacen!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Corte de la última foto de existencias. Nulo = sin lectura: no se puede contar.',
  })
  capturadoAt!: string | null;

  @ApiProperty({ description: 'La última foto se recibió hace más de 90 min.' })
  atrasada!: boolean;
}

export class GrupoConteoDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  grupoOrigenSrId!: string;

  @ApiProperty()
  grupo!: string;
}

export class SucursalConteosDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({ example: 'America/Mexico_City' })
  zonaHoraria!: string;
}

export class ConteosDto {
  @ApiProperty({ type: [ConteoResumenDto], description: 'Los más recientes primero (hasta 200).' })
  conteos!: ConteoResumenDto[];

  @ApiProperty({ description: 'Cuántos conteos hay en el filtro (puede ser más que `conteos`).' })
  total!: number;

  @ApiProperty({
    type: [AlmacenConteoDto],
    description: 'Almacenes activos del catálogo y los que tienen lectura, para crear un conteo.',
  })
  almacenes!: AlmacenConteoDto[];

  @ApiProperty({ type: [GrupoConteoDto], description: 'Grupos de insumos activos por sucursal.' })
  grupos!: GrupoConteoDto[];

  @ApiProperty({ type: [SucursalConteosDto] })
  sucursales!: SucursalConteosDto[];
}

export class PartidaConteoDto {
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

  @ApiProperty({ type: String, nullable: true })
  grupo!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '12.500',
    description: 'Existencia congelada al crear. Nulo = no venía en la foto (sin teórico, no 0).',
  })
  teorico!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '30.00' })
  costoPromedio!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Nulo = sin contar (no es 0).' })
  contado!: string | null;

  @ApiProperty({ enum: ESTADOS_RENGLON, enumName: 'EstadoRenglonConteo' })
  estado!: EstadoRenglon;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '-2.500',
    description: 'contado − teórico. Nulo si falta alguno.',
  })
  diferencia!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '-75.00',
    description: 'round(diferencia × costo, 2). Nulo si falta alguno o no cabe en NUMERIC(12,2).',
  })
  importe!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  capturadoAt!: string | null;
}

export class TotalesConteoDto {
  @ApiProperty()
  articulos!: number;

  @ApiProperty({ description: 'Con algo capturado (incluye los sin teórico).' })
  contados!: number;

  @ApiProperty()
  sinContar!: number;

  @ApiProperty()
  sinTeorico!: number;

  @ApiProperty()
  conDiferencia!: number;

  @ApiProperty({ description: 'Con diferencia cuyo importe no cabe en NUMERIC(12,2).' })
  sinValuar!: number;

  @ApiProperty({ example: '-75.00', description: 'Σ de los importes negativos de los renglones.' })
  faltante!: string;

  @ApiProperty({ example: '24.99', description: 'Σ de los importes positivos de los renglones.' })
  sobrante!: string;

  @ApiProperty({ example: '-50.01', description: 'faltante + sobrante.' })
  neto!: string;
}

export class ConteoDetalleDto {
  @ApiProperty({ type: ConteoResumenDto })
  conteo!: ConteoResumenDto;

  @ApiProperty({ example: 'America/Mexico_City', description: 'Zona de la sucursal del conteo.' })
  zonaHoraria!: string;

  @ApiProperty({
    type: [PartidaConteoDto],
    description:
      'Por nombre del insumo. La diferencia se calcula siempre (en captura es preliminar).',
  })
  partidas!: PartidaConteoDto[];

  @ApiProperty({ type: TotalesConteoDto })
  totales!: TotalesConteoDto;
}

export class CapturaGuardadaDto {
  @ApiProperty()
  insumoOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true, example: '12.500' })
  contado!: string | null;
}

export class CapturaRespuestaDto {
  @ApiProperty({
    type: [CapturaGuardadaDto],
    description: 'Lo que quedó guardado de cada renglón del lote, ya normalizado a 3 decimales.',
  })
  guardadas!: CapturaGuardadaDto[];
}
