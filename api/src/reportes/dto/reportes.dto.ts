import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoEnvioReporte, TipoReporte } from '@prisma/client';
import { IsBoolean, IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import type { EnvioVista, SuscripcionVista, VistaPrevia } from '../reportes.service';

export class EmpresaReportesQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;
}

export class VistaPreviaQueryDto extends EmpresaReportesQueryDto {
  @ApiProperty({ enum: TipoReporte, enumName: 'TipoReporte' })
  @IsEnum(TipoReporte)
  tipo!: TipoReporte;
}

export class GuardarSuscripcionDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({ description: 'Resumen diario: la venta de ayer, top 5 y alertas.' })
  @IsBoolean()
  diario!: boolean;

  @ApiProperty({ description: 'Resumen semanal (los lunes): comparativo y tendencia.' })
  @IsBoolean()
  semanal!: boolean;
}

export class BajaReportesDto {
  @ApiProperty({ description: 'El token del enlace del correo (`t`).', maxLength: 200 })
  @IsString()
  @MaxLength(200)
  token!: string;

  @ApiPropertyOptional({
    enum: TipoReporte,
    enumName: 'TipoReporte',
    description: 'Sólo ese reporte. Sin él, los dos.',
  })
  @IsOptional()
  @IsEnum(TipoReporte)
  tipo?: TipoReporte;
}

export class EnvioReporteDto implements EnvioVista {
  @ApiProperty({ enum: TipoReporte, enumName: 'TipoReporte' })
  tipo!: TipoReporte;

  @ApiProperty({
    description: 'Diario: el día reportado. Semanal: el lunes de la semana reportada.',
    example: '2026-09-21',
  })
  periodo!: string;

  @ApiProperty({
    enum: EstadoEnvioReporte,
    enumName: 'EstadoEnvioReporte',
    description:
      '`enviando` (en curso, o se perdió a media llamada: no se reintenta), `enviado`, ' +
      '`fallido` (se reintenta hasta 3 veces ese mismo día) o `descartado` (ya no se reintenta).',
  })
  estado!: EstadoEnvioReporte;

  @ApiProperty()
  intentos!: number;

  @ApiProperty({ format: 'date-time' })
  creadoAt!: string;

  @ApiProperty({ format: 'date-time', nullable: true, type: String })
  enviadoAt!: string | null;
}

export class SuscripcionReporteDto implements SuscripcionVista {
  @ApiProperty({ format: 'uuid' })
  empresaId!: string;

  @ApiProperty()
  diario!: boolean;

  @ApiProperty()
  semanal!: boolean;

  @ApiProperty({
    description:
      'Zona de la empresa (la que comparten más sucursales activas): decide la hora de envío ' +
      'y qué día es "ayer". Cada sucursal corta su venta en SU zona, como el panel.',
    example: 'America/Mexico_City',
  })
  zonaHoraria!: string;

  @ApiProperty({ description: 'Hora local de envío en esa zona (0–23).', example: 7 })
  horaEnvio!: number;

  @ApiProperty({ type: [EnvioReporteDto], description: 'Los 10 más recientes.' })
  ultimosEnvios!: EnvioReporteDto[];
}

export class VistaPreviaDto implements VistaPrevia {
  @ApiProperty({ enum: TipoReporte, enumName: 'TipoReporte' })
  tipo!: TipoReporte;

  @ApiProperty({ example: '2026-09-21' })
  periodo!: string;

  @ApiProperty()
  asunto!: string;

  @ApiProperty({ description: 'HTML completo del correo. Mostrarlo en un iframe con sandbox.' })
  html!: string;

  @ApiProperty()
  texto!: string;
}

export class BajaReportesRespuestaDto {
  @ApiProperty()
  diario!: boolean;

  @ApiProperty()
  semanal!: boolean;
}
