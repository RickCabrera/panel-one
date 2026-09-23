import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';

import { MAX_CANTIDAD_PAQUETE } from '../folios';

/**
 * Contratos del CONTROL DE FOLIOS del PAC (F2-110). Rutas de PLATAFORMA, sólo admin_global.
 * Cantidades de folios como enteros (no son dinero); instantes en ISO-8601 UTC.
 */

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const ESTADOS_SALDO = ['sin_control', 'ok', 'bajo', 'agotado'] as const;
const ESTADOS_PAQUETE = ['vigente', 'por_vencer', 'agotado', 'vencido', 'futuro'] as const;

export class AltaPaqueteFoliosDto {
  @ApiProperty({ minimum: 1, maximum: MAX_CANTIDAD_PAQUETE, example: 1000 })
  @IsInt()
  @Min(1)
  @Max(MAX_CANTIDAD_PAQUETE)
  cantidad!: number;

  @ApiProperty({
    example: '2026-09-01',
    description:
      'Día de compra (AAAA-MM-DD, hora de la Ciudad de México). No puede ser futuro. El paquete ' +
      'vence al empezar el mismo día un año después.',
  })
  @IsString()
  @Matches(DIA)
  fechaCompra!: string;

  @ApiProperty({ required: false, maxLength: 200, example: 'Paquete anual 2026' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nota?: string;
}

export class ConfiguracionFoliosDto {
  @ApiProperty({ minimum: 1, maximum: 100, example: 20 })
  @IsInt()
  @Min(1)
  @Max(100)
  umbralPct!: number;
}

export class ReporteFoliosQueryDto {
  @ApiProperty({ example: '2026-01', description: 'Primer mes (AAAA-MM), inclusive.' })
  @IsString()
  @Matches(MES)
  desde!: string;

  @ApiProperty({
    example: '2026-09',
    description: 'Último mes (AAAA-MM), inclusive. Máx. 24 meses.',
  })
  @IsString()
  @Matches(MES)
  hasta!: string;
}

export class PaqueteFoliosDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
  @ApiProperty()
  cantidad!: number;
  @ApiProperty({ format: 'date-time' })
  compradoAt!: string;
  @ApiProperty({
    format: 'date-time',
    description: 'Exclusivo: en ese instante ya no ampara nada.',
  })
  venceAt!: string;
  @ApiProperty({ type: String, nullable: true })
  nota!: string | null;
  @ApiProperty({ description: 'Timbres asignados (FIFO por vencimiento).' })
  consumidos!: number;
  @ApiProperty()
  restantes!: number;
  @ApiProperty({ enum: ESTADOS_PAQUETE })
  estado!: (typeof ESTADOS_PAQUETE)[number];
  @ApiProperty({ type: Number, nullable: true })
  diasParaVencer!: number | null;
}

export class ConsumoEmpresaDto {
  @ApiProperty({ format: 'uuid' })
  empresaId!: string;
  @ApiProperty()
  empresa!: string;
  @ApiProperty({ description: 'Timbres del mes en curso (mes local de cada sucursal).' })
  mesActual!: number;
  @ApiProperty({ description: 'Timbres de los 12 meses locales que terminan en el mes en curso.' })
  ultimos12Meses!: number;
}

export class FoliosDto {
  @ApiProperty({ description: 'false = nunca se registró un paquete: la emisión no se limita.' })
  control!: boolean;
  @ApiProperty()
  umbralPct!: number;
  @ApiProperty({ enum: ESTADOS_SALDO })
  estado!: (typeof ESTADOS_SALDO)[number];
  @ApiProperty({ description: 'Folios que quedan en los paquetes vigentes.' })
  disponible!: number;
  @ApiProperty({ description: 'Σ de las cantidades de los paquetes vigentes: la base del umbral.' })
  vigenteTotal!: number;
  @ApiProperty({
    description:
      'Reservas en emisión (`timbrando`), ya descontadas de `disponible`. Una reserva colgada se ' +
      'descuenta hasta que se concilie (F2-110b).',
  })
  enEmision!: number;
  @ApiProperty({ description: 'Timbres que no cupieron en ningún paquete vigente en su momento.' })
  sobregiro!: number;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  avisoUmbralAt!: string | null;
  @ApiProperty({ type: [PaqueteFoliosDto] })
  paquetes!: PaqueteFoliosDto[];
  @ApiProperty({ type: [ConsumoEmpresaDto] })
  consumoPorEmpresa!: ConsumoEmpresaDto[];
}

export class PaqueteCreadoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
}

export class ConteoMensualDto {
  @ApiProperty({ format: 'uuid' })
  empresaId!: string;
  @ApiProperty()
  empresa!: string;
  @ApiProperty({ example: '2026-09', description: 'Mes local de la sucursal que emitió.' })
  mes!: string;
  @ApiProperty()
  vigentes!: number;
  @ApiProperty()
  cancelados!: number;
  @ApiProperty({ description: 'vigentes + cancelados: los folios consumidos.' })
  total!: number;
  @ApiProperty({ description: 'Del portal (ticket), sin contar sustitutos.' })
  ticket!: number;
  @ApiProperty({ description: 'Sin ticket (captura manual), sin contar sustitutos.' })
  manual!: number;
  @ApiProperty({ description: 'Facturas globales.' })
  global!: number;
  @ApiProperty({ description: 'Sustitutos de una refacturación (relación 04).' })
  sustitutos!: number;
}

export class TotalMesDto {
  @ApiProperty({ example: '2026-09' })
  mes!: string;
  @ApiProperty()
  vigentes!: number;
  @ApiProperty()
  cancelados!: number;
  @ApiProperty()
  total!: number;
}

export class ReporteFoliosDto {
  @ApiProperty()
  desde!: string;
  @ApiProperty()
  hasta!: string;
  @ApiProperty({ type: [ConteoMensualDto], description: 'Empresa × mes; sin fila = 0 timbres.' })
  filas!: ConteoMensualDto[];
  @ApiProperty({ type: [TotalMesDto], description: 'Un renglón por cada mes del rango.' })
  totales!: TotalMesDto[];
}
