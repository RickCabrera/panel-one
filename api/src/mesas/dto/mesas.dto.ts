import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

import type { MesasSucursal, SnapshotMesas } from '../mesas.service';

export class MesasQueryDto {
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

export class SnapshotMesasDto implements SnapshotMesas {
  @ApiProperty({
    format: 'date-time',
    description: 'Cuándo leyó el agente las mesas, con el reloj de la PC del restaurante. UTC.',
  })
  capturadoAt!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Cuándo lo recibió el API por primera vez, con el reloj del servidor. UTC.',
  })
  recibidoAt!: string;

  @ApiProperty({
    description:
      'Segundos desde `capturadoAt`, recortado a ≥ 0. Depende del reloj del agente: si está ' +
      'adelantado, el dato parece más fresco de lo que es.',
  })
  edadSegundos!: number;

  @ApiProperty({
    description:
      'Segundos desde `recibidoAt` (reloj del servidor), ≥ 0. Es la edad confiable para ' +
      'decidir si una sucursal está desconectada.',
  })
  edadRecepcionSegundos!: number;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Las cuentas abiertas tal como las mandó el agente. La forma de cada mesa todavía no se ' +
      'fija (supuesto, esquema-sr.md §5; la fijan F1-023/F1-050).',
  })
  mesas!: Record<string, unknown>[];
}

export class MesasSucursalDto implements MesasSucursal {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ example: 'America/Mexico_City', description: 'Zona IANA de la sucursal.' })
  zonaHoraria!: string;

  @ApiProperty({
    type: SnapshotMesasDto,
    nullable: true,
    description: 'El último snapshot recibido, o null si nunca ha llegado uno.',
  })
  snapshot!: SnapshotMesasDto | null;
}
