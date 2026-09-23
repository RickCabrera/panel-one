import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsUUID, Max, Min, ValidateIf } from 'class-validator';

import {
  DIAS_VIGENCIA_MAX,
  DIAS_VIGENCIA_MIN,
  ESTADOS_PUBLICOS,
  type EstadoPublico,
} from '../codigo';

/**
 * Contratos del código corto de facturación (F2-101): la consulta PÚBLICA de un código y la regla
 * de vigencia por empresa. Fechas en UTC (ISO 8601); dinero como texto con 2 decimales.
 */

const REGLAS = ['fin_de_mes', 'dias'] as const;

export class TicketCodigoDto {
  @ApiProperty({ example: 'Sucursal Centro', description: 'Nombre de la sucursal.' })
  sucursal!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Cierre de la cuenta (UTC). Si SR la reabrió, su apertura.',
  })
  fecha!: string;

  @ApiProperty({
    example: 'America/Mexico_City',
    description: 'Zona IANA de la sucursal, para presentar `fecha` y `expiraAt`.',
  })
  zonaHoraria!: string;

  @ApiProperty({ example: '315.50', description: 'Total del ticket, 2 decimales.' })
  total!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Desde este instante el código ya no sirve (exclusivo, UTC).',
  })
  expiraAt!: string;
}

export class ConsultaCodigoDto {
  @ApiProperty({ example: '7JQRECP3U', description: 'El código normalizado (mayúsculas).' })
  codigo!: string;

  @ApiProperty({
    enum: ESTADOS_PUBLICOS,
    description:
      '`cancelado` se deriva de la cuenta; `expirado` también sale cuando `expiraAt` ya pasó.',
  })
  estado!: EstadoPublico;

  @ApiProperty({ description: 'Mensaje en español para mostrar tal cual. Sin datos del ticket.' })
  mensaje!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'septiembre de 2026',
    description:
      'F2-108: sólo con `en_global`, el periodo de la factura global en la que entró el ticket ' +
      '(en español, cortado en la zona de la sucursal). Nada más de la global sale al público.',
  })
  periodoGlobal!: string | null;

  @ApiProperty({
    type: TicketCodigoDto,
    nullable: true,
    description:
      'Datos no sensibles del ticket. SÓLO con `estado = pendiente`; en cualquier otro estado es ' +
      '`null` (ni sucursal, ni fecha, ni total).',
  })
  ticket!: TicketCodigoDto | null;
}

export class VigenciaCodigosQueryDto {
  @ApiProperty({ format: 'uuid', description: 'La empresa (tiene que estar en tu alcance).' })
  @IsUUID('all')
  empresaId!: string;
}

export class VigenciaCodigosDto {
  @ApiProperty({
    enum: REGLAS,
    description:
      '`fin_de_mes` (default): hasta el fin del mes del cierre. `dias`: hasta el final del día N ' +
      'después del cierre. Siempre en la zona de la sucursal.',
  })
  regla!: (typeof REGLAS)[number];

  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'N con `dias`; `null` con fin de mes.',
  })
  dias!: number | null;

  @ApiProperty({ description: 'false = la empresa usa el default (nadie la ha configurado).' })
  configurada!: boolean;
}

export class GuardarVigenciaCodigosDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({ enum: REGLAS })
  @IsIn(REGLAS, { message: 'regla debe ser fin_de_mes o dias' })
  regla!: (typeof REGLAS)[number];

  @ApiProperty({
    required: false,
    minimum: DIAS_VIGENCIA_MIN,
    maximum: DIAS_VIGENCIA_MAX,
    description: 'Obligatorio con `dias` y prohibido con `fin_de_mes`.',
  })
  @ValidateIf((o: GuardarVigenciaCodigosDto) => o.regla === 'dias' || o.dias !== undefined)
  @IsInt({ message: 'dias debe ser un entero' })
  @Min(DIAS_VIGENCIA_MIN, { message: `dias debe ser al menos ${DIAS_VIGENCIA_MIN}` })
  @Max(DIAS_VIGENCIA_MAX, { message: `dias debe ser a lo más ${DIAS_VIGENCIA_MAX}` })
  dias?: number;
}
