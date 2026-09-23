import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';

import { REGEX_VERSION_AGENTE } from '../../scope/versiones-agente';

/** Los motivos de falla que el agente puede reportar (F2-143). Mismo enum que Postgres. */
export const MOTIVOS_FALLA = [
  'hash_invalido',
  'descarga',
  'detener',
  'reemplazo',
  'arranque',
  'version_distinta',
] as const;
export type MotivoFalla = (typeof MOTIVOS_FALLA)[number];

export const RESULTADOS_ACTUALIZACION = ['aplicada', 'fallida'] as const;

const EJEMPLO_VERSION = '1.4.0';
const DESC_VERSION = 'X.Y.Z, cada parte de 1 a 4 dígitos (sin el `+commit`).';

/** `GET /agente/version`: lo que el canal le dice a UNA sucursal. */
export class VersionCanalDto {
  @ApiProperty({
    description:
      'false si la sucursal NO tiene la actualización automática encendida o si no hay versión ' +
      'vigente publicada. Con false no viene nada más.',
  })
  disponible!: boolean;

  @ApiPropertyOptional({ example: EJEMPLO_VERSION, description: DESC_VERSION })
  version?: string;

  @ApiPropertyOptional({
    example: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    description: 'SHA-256 del binario, 64 hex minúsculas. El agente lo verifica ANTES de usarlo.',
  })
  sha256?: string;

  @ApiPropertyOptional({ type: 'integer', description: 'Tamaño exacto del binario, en bytes.' })
  tamanoBytes?: number;

  @ApiPropertyOptional({
    example: 'agente/binario/1.4.0?expira=1790000000&firma=abc…',
    description:
      'Enlace de descarga firmado y temporal (15 min), RELATIVO a la URL base del api. La firma ' +
      'es la credencial: el agente lo baja SIN la API key.',
  })
  url?: string;
}

/** `POST /agente/actualizacion`: el resultado de un intento, como lo vio el agente. */
export class ReporteActualizacionDto {
  @ApiProperty({ example: EJEMPLO_VERSION, description: DESC_VERSION })
  @IsString()
  @Matches(REGEX_VERSION_AGENTE)
  version!: string;

  @ApiProperty({ enum: RESULTADOS_ACTUALIZACION })
  @IsIn(RESULTADOS_ACTUALIZACION)
  resultado!: (typeof RESULTADOS_ACTUALIZACION)[number];

  @ApiPropertyOptional({
    enum: MOTIVOS_FALLA,
    nullable: true,
    description: 'Obligatorio con `fallida`; prohibido con `aplicada`.',
  })
  @ValidateIf((o: ReporteActualizacionDto) => o.resultado === 'fallida' || o.motivo != null)
  @IsIn(MOTIVOS_FALLA)
  motivo?: MotivoFalla | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    maxLength: 500,
    description: 'Texto corto para el panel. Nunca lleva la API key ni la cadena de conexión.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  detalle?: string | null;
}

/** Una versión del canal, para la administración. */
export class VersionAgenteDto {
  @ApiProperty({ example: EJEMPLO_VERSION })
  version!: string;

  @ApiProperty()
  sha256!: string;

  @ApiProperty({ type: 'integer' })
  tamanoBytes!: number;

  @ApiProperty({ type: String, nullable: true })
  notas!: string | null;

  @ApiProperty({ format: 'date-time' })
  publicadaAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  retiradaAt!: string | null;

  @ApiProperty({ description: 'La que hoy toman las sucursales con la actualización automática.' })
  vigente!: boolean;
}

export class PublicarVersionQueryDto {
  @ApiProperty({ example: EJEMPLO_VERSION, description: DESC_VERSION })
  @IsString()
  @Matches(REGEX_VERSION_AGENTE)
  version!: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value.trim() === '' ? undefined : value,
  )
  notas?: string;
}

export class ActualizacionAutomaticaDto {
  @ApiProperty({ description: 'Encender o apagar la actualización automática de la sucursal.' })
  @IsBoolean()
  activa!: boolean;
}

export class ActualizacionAutomaticaHechaDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  actualizacionAutomatica!: boolean;
}

/** El último reporte del agente de una sucursal, para el estado de agentes. */
export class ReporteActualizacionVistoDto {
  @ApiProperty({ enum: RESULTADOS_ACTUALIZACION })
  resultado!: 'aplicada' | 'fallida';

  @ApiProperty({ example: EJEMPLO_VERSION })
  version!: string;

  @ApiProperty({ enum: MOTIVOS_FALLA, nullable: true })
  motivo!: MotivoFalla | null;

  @ApiProperty({ type: String, nullable: true })
  detalle!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Inicio de la racha de fallas de esa versión (reloj del servidor).',
  })
  primeraFallaAt!: string | null;

  @ApiProperty({
    format: 'date-time',
    description: 'Cuándo llegó el reporte (reloj del servidor).',
  })
  reportadaAt!: string;
}
