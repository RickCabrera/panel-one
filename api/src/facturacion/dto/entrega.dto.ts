import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

/**
 * Contratos de la entrega de facturas (F2-105): la bitácora de envíos por correo y su reintento
 * manual. Fechas en UTC (ISO 8601).
 */

export const FILTROS_ENVIO = ['fallido', 'atorado'] as const;
export type FiltroEnvio = (typeof FILTROS_ENVIO)[number];

export class EnviosQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario o inexistente = 404.' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({
    required: false,
    enum: FILTROS_ENVIO,
    description:
      '`fallido` = el correo falló; `atorado` = se quedó `enviando` más de 10 min (el proceso cayó ' +
      'a media llamada). Sin filtro: los dos, que son los que hay que reintentar.',
  })
  @IsOptional()
  @IsIn(FILTROS_ENVIO)
  estado?: FiltroEnvio;
}

export class EnvioCfdiDto {
  @ApiProperty({ format: 'uuid' })
  cfdiId!: string;

  @ApiProperty({ example: '5FB2822E-396D-4725-8521-CDC4BDD20CCF' })
  uuid!: string;

  @ApiProperty({ example: 'A-1024' })
  serieFolio!: string;

  @ApiProperty({ description: 'El correo del receptor con que se timbró. Siempre ése.' })
  email!: string;

  @ApiProperty({ enum: ['enviando', 'enviado', 'fallido'] })
  estado!: 'enviando' | 'enviado' | 'fallido';

  @ApiProperty({
    description: 'Fallido, o `enviando` desde hace más de 10 min: se puede reintentar.',
  })
  requiereReintento!: boolean;

  @ApiProperty({ example: 1 })
  intentos!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Último error del servicio de correo (recortado). Null si no falló.',
  })
  error!: string | null;

  @ApiProperty({ format: 'date-time' })
  ultimoIntentoAt!: string;
}
