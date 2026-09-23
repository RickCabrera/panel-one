import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import type { EstadoAgenteSucursal } from '../estado-agentes.service';
import { ReporteActualizacionVistoDto } from './actualizacion.dto';

export class EstadoAgentesQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;
}

export class EstadoAgenteSucursalDto implements EstadoAgenteSucursal {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ example: 'America/Mexico_City', description: 'Zona IANA de la sucursal.' })
  zonaHoraria!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Cuándo nos habló el agente por última vez: el último lote aceptado por ' +
      '`POST /ingesta/eventos`, con el reloj del SERVIDOR. UTC. Null = nunca ha reportado.',
  })
  ultimoContactoAt!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'Segundos desde `ultimoContactoAt` (reloj del servidor), ≥ 0. Es la edad confiable para ' +
      'decidir si el agente está desconectado; el umbral lo decide el panel.',
  })
  edadContactoSegundos!: number | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Última lectura exitosa de SoftRestaurant que reportó el heartbeat, con el reloj de la ' +
      'PC del POS. UTC. Se queda quieta si el agente está vivo pero no puede leer SR.',
  })
  ultimaLecturaAt!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'Segundos desde `ultimaLecturaAt`, recortado a ≥ 0. Depende del reloj de la PC del POS: ' +
      'si está adelantado, la lectura parece más reciente de lo que es.',
  })
  edadLecturaSegundos!: number | null;

  @ApiProperty({ type: String, nullable: true, example: '0.1.0' })
  versionAgente!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '10.0' })
  versionSr!: string | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    description:
      'Eventos en la cola local del agente, según su último heartbeat. Null = no reportado.',
  })
  tamanoCola!: number | null;

  @ApiProperty({
    type: 'integer',
    nullable: true,
    example: 12,
    description:
      'Milisegundos que tardó la consulta a SoftRestaurant en el último heartbeat (F1-025). ' +
      'Null = sin medición (SR inalcanzable o sin versión detectada) o agente anterior a F1-025.',
  })
  latenciaQueryMs!: number | null;

  @ApiProperty({ type: String, nullable: true, description: 'Último error que reportó el agente.' })
  ultimoError!: string | null;

  @ApiProperty({
    description: 'F2-143: la bandera de rollout. Con ella el agente toma solo la versión vigente.',
  })
  actualizacionAutomatica!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '1.4.0',
    description:
      'F2-143: la versión vigente del canal si la bandera está encendida (null sin bandera o ' +
      'sin versión publicada). Se compara contra `versionAgente` sin el `+commit`.',
  })
  versionObjetivo!: string | null;

  @ApiProperty({
    type: ReporteActualizacionVistoDto,
    nullable: true,
    description:
      'F2-143: el último reporte de auto-actualización del agente. Null = nunca reportó.',
  })
  actualizacion!: ReporteActualizacionVistoDto | null;
}
