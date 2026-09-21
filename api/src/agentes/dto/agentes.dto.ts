import { ApiProperty } from '@nestjs/swagger';

export class ApiKeyEmitidaDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty({
    example: 'msr_3q2-7wXz...',
    description:
      'La API key en claro. Se muestra SÓLO en esta respuesta: en la base queda su hash. ' +
      'El agente la manda en el header `X-Api-Key`.',
  })
  apiKey!: string;
}

/** Lo mínimo que el agente necesita saber de su sucursal para autodiagnosticarse. */
export class AgenteYoDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ example: 'America/Mexico_City', description: 'Zona IANA de la sucursal.' })
  zonaHoraria!: string;
}
