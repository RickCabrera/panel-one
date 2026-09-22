import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

import { CANTIDAD_NO_NEGATIVA } from '../../catalogos/dto/catalogos.dto';
import { ESTADOS_EXISTENCIA, type EstadoExistencia } from '../existencias';

// ---------------------------------------------------------------------------
// consultas
// ---------------------------------------------------------------------------

export class ExistenciasQueryDto {
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
    maxLength: 100,
    description:
      'Busca en el nombre, la clave y el origenSrId del insumo (sin distinguir mayúsculas).',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;
}

export class GuardarLimitesDto {
  @ApiProperty({ format: 'uuid' })
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

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: CANTIDAD_NO_NEGATIVA.source,
    example: '2.5',
    description:
      'Existencia mínima en la unidad del insumo, texto decimal sin signo (hasta 3 decimales). ' +
      'Nulo = sin mínimo.',
  })
  @IsOptional()
  @IsString()
  @Matches(CANTIDAD_NO_NEGATIVA, { message: '$property debe ser una cantidad decimal sin signo' })
  minimo!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: CANTIDAD_NO_NEGATIVA.source,
    description: 'Existencia máxima. Menor que el mínimo = 400. Los dos nulos = se borran.',
  })
  @IsOptional()
  @IsString()
  @Matches(CANTIDAD_NO_NEGATIVA, { message: '$property debe ser una cantidad decimal sin signo' })
  maximo!: string | null;
}

// ---------------------------------------------------------------------------
// respuestas
// ---------------------------------------------------------------------------

const DECIMAL = { type: String, nullable: true } as const;

export class FilaExistenciaDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty()
  almacenOrigenSrId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nombre del catálogo de almacenes de su sucursal; nulo si no está.',
  })
  almacen!: string | null;

  @ApiProperty()
  insumoOrigenSrId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nombre del catálogo de insumos de su sucursal; nulo si no está.',
  })
  insumo!: string | null;

  @ApiProperty({ type: String, nullable: true })
  clave!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Nombre de la unidad del insumo.' })
  unidad!: string | null;

  @ApiProperty({ ...DECIMAL, example: '12.500', description: 'NUMERIC(12,3). Nulo = sin lectura.' })
  cantidad!: string | null;

  @ApiProperty({ ...DECIMAL, example: '85.40', description: 'Dinero. Nulo = sin lectura.' })
  costoPromedio!: string | null;

  @ApiProperty({
    ...DECIMAL,
    example: '1067.50',
    description: 'round(cantidad × costo, 2). Nulo = sin lectura.',
  })
  valor!: string | null;

  @ApiProperty({ ...DECIMAL, description: 'Mínimo del panel (no de SR).' })
  minimo!: string | null;

  @ApiProperty({ ...DECIMAL, description: 'Máximo del panel (no de SR).' })
  maximo!: string | null;

  @ApiProperty({ enum: ESTADOS_EXISTENCIA, enumName: 'EstadoExistencia' })
  estado!: EstadoExistencia;
}

export class KpisExistenciasDto {
  @ApiProperty({ description: 'Artículos con lectura (tras sucursal, almacén y búsqueda).' })
  articulos!: number;

  @ApiProperty({ example: '12345.67', description: 'Σ valor, negativos incluidos.' })
  valor!: string;

  @ApiProperty({ description: 'Atención requerida = bajo mínimo.' })
  atencion!: number;

  @ApiProperty({ description: 'Cantidad ≤ 0.' })
  sinExistencia!: number;

  @ApiProperty()
  sobreMaximo!: number;

  @ApiProperty({ description: 'Con límite guardado pero ya no vienen en la foto de su almacén.' })
  sinLectura!: number;
}

export class AlmacenExistenciasDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  almacenOrigenSrId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nombre del catálogo; nulo si no está.',
  })
  almacen!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Cuándo se leyó la última foto aplicada (reloj del agente). Nulo = nunca.',
  })
  capturadoAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Cuándo la recibió el API. Nulo = nunca.',
  })
  recibidaAt!: string | null;

  @ApiProperty({ description: 'Recibida hace más de 90 min (3 × la lectura de 30 min).' })
  atrasada!: boolean;
}

export class SucursalExistenciasDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({ description: 'Zona IANA de la sucursal: las horas se presentan en ella.' })
  zonaHoraria!: string;

  @ApiProperty({ description: 'Almacenes con al menos una foto aplicada.' })
  almacenesLeidos!: number;
}

export class ExistenciasDto {
  @ApiProperty({ type: KpisExistenciasDto })
  kpis!: KpisExistenciasDto;

  @ApiProperty({
    type: [FilaExistenciaDto],
    description: 'Todas las filas del filtro (sin paginar), por sucursal, almacén y nombre.',
  })
  filas!: FilaExistenciaDto[];

  @ApiProperty({
    type: [AlmacenExistenciasDto],
    description: 'Los almacenes de las sucursales pedidas: con lectura o del catálogo.',
  })
  almacenes!: AlmacenExistenciasDto[];

  @ApiProperty({ type: [SucursalExistenciasDto] })
  sucursales!: SucursalExistenciasDto[];
}
