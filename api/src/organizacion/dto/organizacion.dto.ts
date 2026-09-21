import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

import type { EmpresaVista, SucursalVista } from '../organizacion.service';

export class SucursalesQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Sólo las sucursales de esta empresa. Fuera del alcance del usuario = 404.',
  })
  @IsOptional()
  @IsUUID('all')
  empresaId?: string;
}

export class EmpresaDto implements EmpresaVista {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty()
  activo!: boolean;
}

export class SucursalDto implements SucursalVista {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  empresaId!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({
    example: 'America/Mexico_City',
    description: 'Zona IANA. Es la que corta "hoy" en los agregados de esta sucursal.',
  })
  zonaHoraria!: string;

  @ApiProperty()
  activo!: boolean;
}
