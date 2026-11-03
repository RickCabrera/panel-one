import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/** Respuesta de `POST /sucursales/:id/codigo-enlace`: el código en claro, UNA sola vez. */
export class CodigoEnlaceEmitidoDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty({
    example: 'K7P4-42XQ',
    description:
      'El código para el instalador de un clic, con guión. Se muestra SÓLO en esta respuesta: ' +
      'en la base queda su hash. Sirve una vez y vence en `expiraAt`.',
  })
  codigo!: string;

  @ApiProperty({ format: 'date-time', description: 'Cuándo deja de servir (UTC), a los 30 min.' })
  expiraAt!: string;

  @ApiProperty({ example: 1800, description: 'Segundos de vigencia desde que se emitió.' })
  vigenciaSegundos!: number;
}

/** Cuerpo de `POST /agente/enlace`. */
export class CanjeEnlaceDto {
  @ApiProperty({
    example: 'K7P4-42XQ',
    description: 'El código del panel. Acepta minúsculas, espacios y con o sin guión.',
  })
  @IsString()
  @MaxLength(32)
  codigo!: string;
}

/** Respuesta de `POST /agente/enlace`: lo que el instalador escribe en `config.json`. */
export class EnlaceCanjeadoDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty({ example: 'Centro', description: 'Para que el instalador diga qué conectó.' })
  sucursal!: string;

  @ApiProperty({
    example: 'msr_3q2-7wXz...',
    description:
      'La API key NUEVA de la sucursal, en claro y UNA sola vez. La anterior deja de servir en ' +
      'este momento (como `POST /sucursales/:id/api-key`).',
  })
  apiKey!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'https://monitor.ejemplo.com',
    description:
      'La URL base de la API para `config.json` (`API_URL_PUBLICA` del despliegue). `null` si el ' +
      'despliegue no la define: el instalador usa la URL con la que llamó.',
  })
  apiUrl!: string | null;
}
