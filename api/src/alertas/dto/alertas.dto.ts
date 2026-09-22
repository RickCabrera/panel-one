import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MotivoCierreAlerta, SeveridadAlerta, TipoAlerta } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

import type { AlertaVista, HistorialAlertas, ReglaVista } from '../alertas.service';

export class AlertasQueryDto {
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
}

export class HistorialQueryDto extends AlertasQueryDto {
  @ApiPropertyOptional({
    minimum: 1,
    maximum: 10000,
    default: 1,
    description: 'Página de 50 filas.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  pagina?: number;
}

export class ReglasQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;
}

export class GuardarReglaDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({
    description: 'Apagada: deja de generar alertas y cierra las abiertas de su tipo.',
  })
  @IsBoolean()
  activa!: boolean;

  @ApiProperty({
    description:
      'Entero. Minutos para `sucursal_sin_reporte`, `mesa_abierta` y `cuenta_sin_imprimir` ' +
      '(1–1440); porcentaje para `caida_venta` (1–100). Fuera de rango = 400.',
  })
  @IsInt()
  umbral!: number;
}

export class AlertaDto implements AlertaVista {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty({ description: 'Nombre de la sucursal.' })
  sucursal!: string;

  @ApiProperty({ enum: TipoAlerta, enumName: 'TipoAlerta' })
  tipo!: TipoAlerta;

  @ApiProperty({ enum: SeveridadAlerta, enumName: 'SeveridadAlerta' })
  severidad!: SeveridadAlerta;

  @ApiProperty({
    description:
      'El sujeto dentro de la sucursal: vacío (sin reporte), el folio de la cuenta (mesa ' +
      'abierta, sin imprimir) o el día local AAAA-MM-DD (caída de venta).',
  })
  llave!: string;

  @ApiProperty({ description: 'El umbral de la regla cuando la alerta abrió (minutos o %).' })
  umbral!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    description:
      'Lo que se vio al abrir, por tipo. `sucursal_sin_reporte`: `{ nunca: bool, ' +
      'edadSegundos? }`. `mesa_abierta` / `cuenta_sin_imprimir`: `{ folio, mesa (o null), ' +
      'minutos }`. `caida_venta`: `{ dia, ventaHoy, ventaBase, cuentasBase, caidaPct }`, con ' +
      'importes y % como TEXTO decimal de 2 decimales (nunca número).',
  })
  detalle!: AlertaVista['detalle'];

  @ApiProperty({ format: 'date-time', description: 'UTC, reloj del servidor.' })
  abiertaAt!: string;

  @ApiProperty({
    format: 'date-time',
    nullable: true,
    type: String,
    description: 'Null = abierta.',
  })
  cerradaAt!: string | null;

  @ApiProperty({
    enum: MotivoCierreAlerta,
    enumName: 'MotivoCierreAlerta',
    nullable: true,
    description:
      '`condicion`: dejó de cumplirse (o el umbral nuevo ya no la alcanza). `regla_apagada`, ' +
      '`sucursal_inactiva`, `empresa_inactiva`. Null = abierta.',
  })
  motivoCierre!: MotivoCierreAlerta | null;
}

export class HistorialAlertasDto implements HistorialAlertas {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  pagina!: number;

  @ApiProperty()
  porPagina!: number;

  @ApiProperty({ type: [AlertaDto] })
  filas!: AlertaDto[];
}

export class ReglaAlertaDto implements ReglaVista {
  @ApiProperty({ enum: TipoAlerta, enumName: 'TipoAlerta' })
  tipo!: TipoAlerta;

  @ApiProperty()
  activa!: boolean;

  @ApiProperty()
  umbral!: number;

  @ApiProperty({ description: 'La empresa no la ha configurado: vale la regla por defecto.' })
  porDefecto!: boolean;

  @ApiProperty({ enum: ['minutos', 'porcentaje', 'horas'] })
  unidad!: ReglaVista['unidad'];

  @ApiProperty()
  minimo!: number;

  @ApiProperty()
  maximo!: number;

  @ApiProperty({ description: 'El umbral con que nace la regla.' })
  valorPorDefecto!: number;
}
