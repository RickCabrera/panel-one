import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Length, Max, Min } from 'class-validator';

import { HORIZONTE_DEFECTO, HORIZONTE_MAX, PESOS } from '../proyecciones';

export const ESTADOS_PROYECCION = ['calculada', 'sin_historial'] as const;
export type EstadoProyeccion = (typeof ESTADOS_PROYECCION)[number];

export const AVISOS_PROYECCION = [
  'sin_foto',
  'fuera_de_foto',
  'foto_atrasada',
  'sin_minimo',
] as const;
export type AvisoProyeccion = (typeof AVISOS_PROYECCION)[number];

export const MOTIVOS_SUCURSAL_PROYECCION = ['sin_polizas'] as const;

// ---------------------------------------------------------------------------
// consulta
// ---------------------------------------------------------------------------

export class ProyeccionesQueryDto {
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
    minimum: 1,
    maximum: HORIZONTE_MAX,
    default: HORIZONTE_DEFECTO,
    description:
      'Días a cubrir, empezando HOY (en la zona de cada sucursal). Entero de 1 a ' +
      `${HORIZONTE_MAX}; fuera de rango = 400.`,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(HORIZONTE_MAX)
  horizonte?: number;
}

// ---------------------------------------------------------------------------
// respuesta
// ---------------------------------------------------------------------------

const CANTIDAD = { type: String, nullable: true } as const;

export class SucursalProyeccionDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({ description: 'Zona IANA con que se cortan sus días.' })
  zonaHoraria!: string;

  @ApiProperty({
    description: 'false = no se proyecta (ver `motivo`); sus artículos no salen en `filas`.',
  })
  calculada!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: MOTIVOS_SUCURSAL_PROYECCION,
    description: '`sin_polizas` = el agente nunca ha mandado pólizas de inventario.',
  })
  motivo!: (typeof MOTIVOS_SUCURSAL_PROYECCION)[number] | null;

  @ApiProperty({ description: 'Pólizas recibidas (cualquier tipo, también canceladas).' })
  polizasRecibidas!: number;

  @ApiProperty({ description: 'Almacenes con al menos una foto de existencias.' })
  almacenesConFoto!: number;

  @ApiProperty({ example: '2026-09-16', description: 'Hoy en la zona de la sucursal.' })
  hoy!: string;

  @ApiProperty({ description: 'Primer día de la ventana de historial (hoy − 28).' })
  ventanaDesde!: string;

  @ApiProperty({ description: 'Último día de la ventana (ayer).' })
  ventanaHasta!: string;

  @ApiProperty({ description: 'Primer día del horizonte (hoy).' })
  horizonteDesde!: string;

  @ApiProperty({ description: 'Último día del horizonte (hoy + horizonte − 1).' })
  horizonteHasta!: string;
}

export class FilaProyeccionDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty()
  almacenOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Nulo si no está en el catálogo.' })
  almacen!: string | null;

  @ApiProperty()
  insumoOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Nulo si no está en el catálogo.' })
  insumo!: string | null;

  @ApiProperty({ type: String, nullable: true })
  clave!: string | null;

  @ApiProperty({ type: String, nullable: true })
  unidad!: string | null;

  @ApiProperty({
    enum: ESTADOS_PROYECCION,
    description:
      '`sin_historial` = menos de 28 días desde su primer movimiento: NO se proyecta ni se ' +
      'sugiere (nulos), en vez de sugerir 0 a ciegas.',
  })
  estado!: EstadoProyeccion;

  @ApiProperty({
    description: 'Días desde su primer movimiento no cancelado (cualquier tipo) hasta hoy.',
  })
  diasHistorial!: number;

  @ApiProperty({
    type: [String],
    nullable: true,
    description:
      'Demanda (salidas por consumo, merma y traspaso) de cada una de las 4 semanas de la ' +
      'ventana, la MÁS RECIENTE primero. Nulo si `sin_historial`.',
  })
  semanas!: string[] | null;

  @ApiProperty({
    ...CANTIDAD,
    description: 'Demanda proyectada para el horizonte, 3 decimales. Nulo si `sin_historial`.',
  })
  proyeccion!: string | null;

  @ApiProperty({
    ...CANTIDAD,
    description:
      'Existencia de la última foto. Nulo si el almacén no tiene foto; 0 si hay foto y el ' +
      'artículo no viene en ella (aviso `fuera_de_foto`).',
  })
  existencia!: string | null;

  @ApiProperty({ ...CANTIDAD, description: 'Mínimo del panel (F2-121). Nulo = sin mínimo.' })
  minimo!: string | null;

  @ApiProperty({
    ...CANTIDAD,
    description:
      'max(0, proyección − existencia + mínimo). Nulo si `sin_historial` o sin foto del almacén.',
  })
  sugerido!: string | null;

  @ApiProperty({ enum: AVISOS_PROYECCION, isArray: true })
  avisos!: AvisoProyeccion[];
}

export class KpisProyeccionDto {
  @ApiProperty()
  filas!: number;

  @ApiProperty({ description: 'Filas con sugerido mayor que 0.' })
  conSugerido!: number;

  @ApiProperty({ description: 'Filas `sin_historial`.' })
  sinHistorial!: number;
}

export class ProyeccionesDto {
  @ApiProperty({ description: 'Días del horizonte usados.' })
  horizonte!: number;

  @ApiProperty({
    type: [Number],
    example: [...PESOS],
    description: 'Peso de cada semana de la ventana, la más reciente primero.',
  })
  pesos!: number[];

  @ApiProperty({ type: [SucursalProyeccionDto] })
  sucursales!: SucursalProyeccionDto[];

  @ApiProperty({ type: [FilaProyeccionDto] })
  filas!: FilaProyeccionDto[];

  @ApiProperty({ type: KpisProyeccionDto })
  kpis!: KpisProyeccionDto;
}
