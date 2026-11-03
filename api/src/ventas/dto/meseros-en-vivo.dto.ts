import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

import type { MeseroEnVivo, MeserosEnVivo, SucursalEnVivo } from '../meseros-en-vivo.service';

const DINERO = { type: String, example: '1234.50', description: 'Pesos, 2 decimales, en texto.' };

export class MeserosEnVivoQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Empresa a consultar. Fuera del alcance = 404.' })
  @IsUUID('all')
  empresaId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Una sucursal de esa empresa. Sin él, todas. De otra empresa = 404.',
  })
  @IsOptional()
  @IsUUID('all')
  sucursalId?: string;

  @ApiProperty({
    example: '2026-11-03',
    description:
      'El día LOCAL (`YYYY-MM-DD`) de lo cobrado; el panel manda el "hoy" de la zona de la ' +
      'sucursal. Cada sucursal se corta en SU zona, como en /ventas/*.',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'dia debe ser YYYY-MM-DD' })
  dia!: string;
}

class SnapshotEnVivoDto {
  @ApiProperty({ format: 'date-time', description: 'Lectura del agente (reloj del POS), UTC.' })
  capturadoAt!: string;

  @ApiProperty({ format: 'date-time', description: 'Recepción en el API, UTC.' })
  recibidoAt!: string;

  @ApiProperty({
    description:
      'Segundos desde `recibidoAt` (reloj del servidor). El panel decide con esto si la sucursal ' +
      'está desconectada (mismo umbral que el Monitor de mesas).',
  })
  edadRecepcionSegundos!: number;
}

class SucursalEnVivoDto implements SucursalEnVivo {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ example: 'America/Mexico_City' })
  zonaHoraria!: string;

  @ApiProperty({
    type: SnapshotEnVivoDto,
    nullable: true,
    description: 'El último snapshot de mesas, o null si nunca ha llegado uno.',
  })
  snapshot!: SnapshotEnVivoDto | null;
}

class MeseroEnVivoDto implements MeseroEnVivo {
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'Lugar dentro de SU sucursal por total (cobrado + en curso). Null = sin mesero.',
  })
  posicion!: number | null;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Texto del POS (recortado). Null = cuentas o mesas sin mesero.',
  })
  mesero!: string | null;

  @ApiProperty({
    ...DINERO,
    description: 'Σ total de sus cuentas cerradas del día (= su venta en /ventas/por-mesero).',
  })
  cobrado!: string;

  @ApiProperty({ description: 'Cuentas cerradas del día (no canceladas).' })
  cuentas!: number;

  @ApiProperty({ description: 'Comensales de sus cuentas cerradas del día.' })
  comensales!: number;

  @ApiProperty({ type: String, nullable: true, description: 'cobrado / cuentas; null sin cuentas.' })
  ticketPromedio!: string | null;

  @ApiProperty({ description: 'Mesas abiertas que atiende en el último snapshot.' })
  mesasAbiertas!: number;

  @ApiProperty({ ...DINERO, description: 'Σ de los totales legibles de sus mesas abiertas.' })
  enCurso!: string;

  @ApiProperty({ description: 'Mesas abiertas suyas sin total legible (no entran en enCurso).' })
  mesasSinTotal!: number;

  @ApiProperty({ description: 'Comensales en sus mesas abiertas.' })
  comensalesEnMesa!: number;

  @ApiProperty({ ...DINERO, description: 'cobrado + enCurso.' })
  total!: string;
}

class TotalesEnVivoDto {
  @ApiProperty({ ...DINERO, description: 'Σ cobrado = la venta de /ventas/resumen del día.' })
  cobrado!: string;

  @ApiProperty()
  cuentas!: number;

  @ApiProperty(DINERO)
  enCurso!: string;

  @ApiProperty()
  mesasAbiertas!: number;

  @ApiProperty()
  mesasSinTotal!: number;

  @ApiProperty(DINERO)
  total!: string;
}

export class MeserosEnVivoDto implements MeserosEnVivo {
  @ApiProperty({ example: '2026-11-03' })
  dia!: string;

  @ApiProperty({ type: [SucursalEnVivoDto] })
  sucursales!: SucursalEnVivoDto[];

  @ApiProperty({
    type: [MeseroEnVivoDto],
    description: 'Orden: total desc, cobrado desc, sucursal, mesero (sin mesero al final).',
  })
  meseros!: MeseroEnVivoDto[];

  @ApiProperty({ type: TotalesEnVivoDto })
  totales!: TotalesEnVivoDto;
}
