import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

import { PERIODICIDADES_GLOBAL, type PeriodicidadGlobalEnum } from '../global';
import { DescargasFacturaDto } from './portal.dto';

/**
 * Contratos de la FACTURA GLOBAL (F2-108). Dinero como texto con 2 decimales (nunca número);
 * instantes en ISO-8601 UTC; periodos cortados en la zona de la sucursal.
 */

const CLAVE_PERIODO = /^\d{4}-\d{2}-\d{2}$/;
const ESTADOS_PERIODO = ['lista', 'esperando', 'en_curso', 'fuera_de_plazo'] as const;
const ESTADOS_EMISION = ['timbrando', 'vigente', 'cancelado'] as const;

export class EmpresaGlobalQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  empresaId!: string;
}

export class PeriodosGlobalQueryDto extends EmpresaGlobalQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sucursalId!: string;

  @ApiProperty({
    enum: PERIODICIDADES_GLOBAL,
    required: false,
    description: 'Sin ella, la configurada en la empresa.',
  })
  @IsOptional()
  @IsIn(PERIODICIDADES_GLOBAL)
  periodicidad?: PeriodicidadGlobalEnum;
}

export class VistaPreviaGlobalQueryDto extends EmpresaGlobalQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sucursalId!: string;

  @ApiProperty({ enum: PERIODICIDADES_GLOBAL })
  @IsIn(PERIODICIDADES_GLOBAL)
  periodicidad!: PeriodicidadGlobalEnum;
}

export class GuardarConfiguracionGlobalDto extends EmpresaGlobalQueryDto {
  @ApiProperty({ enum: PERIODICIDADES_GLOBAL })
  @IsIn(PERIODICIDADES_GLOBAL)
  periodicidad!: PeriodicidadGlobalEnum;

  @ApiProperty({
    description:
      'true = el programador emite sola la global de cada periodo `lista` que termine DESPUÉS de ' +
      'encenderla (los periodos anteriores se emiten a mano desde la vista previa).',
  })
  @IsBoolean()
  automatica!: boolean;
}

export class EmitirGlobalDto extends EmpresaGlobalQueryDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sucursalId!: string;

  @ApiProperty({ enum: PERIODICIDADES_GLOBAL })
  @IsIn(PERIODICIDADES_GLOBAL)
  periodicidad!: PeriodicidadGlobalEnum;

  @ApiProperty({ example: '2026-08-01', description: 'Primer día local del periodo.' })
  @IsString()
  @Matches(CLAVE_PERIODO)
  clave!: string;
}

export class VigenciaGlobalDto {
  @ApiProperty({ enum: ['fin_de_mes', 'dias'] })
  regla!: 'fin_de_mes' | 'dias';

  @ApiProperty({ type: Number, nullable: true })
  dias!: number | null;
}

export class ConfiguracionGlobalDto {
  @ApiProperty({ enum: PERIODICIDADES_GLOBAL })
  periodicidad!: PeriodicidadGlobalEnum;

  @ApiProperty()
  automatica!: boolean;

  @ApiProperty({ type: String, nullable: true, description: 'Desde cuándo emite sola (ISO).' })
  automaticaDesde!: string | null;

  @ApiProperty({ type: VigenciaGlobalDto })
  vigencia!: VigenciaGlobalDto;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Aviso en español cuando la vigencia de los códigos RETRASA la global (la global de un ' +
      'periodo espera a que venza el último ticket).',
  })
  aviso!: string | null;
}

export class SucursalGlobalDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ example: 'America/Mexico_City' })
  zonaHoraria!: string;
}

export class PeriodoGlobalDto {
  @ApiProperty({ example: '2026-08-01', description: 'Primer día local: identifica el periodo.' })
  clave!: string;

  @ApiProperty({ example: '2026-08-31', description: 'Último día local (inclusive).' })
  ultimoDia!: string;

  @ApiProperty({ enum: PERIODICIDADES_GLOBAL })
  periodicidad!: PeriodicidadGlobalEnum;

  @ApiProperty({ example: 'agosto de 2026' })
  etiqueta!: string;

  @ApiProperty({ description: 'Inicio del periodo (ISO, UTC).' })
  desde!: string;

  @ApiProperty({ description: 'Fin del periodo, EXCLUSIVO (ISO, UTC).' })
  hasta!: string;

  @ApiProperty({ enum: ['01', '02', '04'], description: 'c_Periodicidad del CFDI.' })
  periodicidadSat!: string;

  @ApiProperty({ example: '08', description: 'c_Meses del CFDI.' })
  meses!: string;

  @ApiProperty({ example: 2026 })
  anio!: number;
}

export class ResumenPeriodoGlobalDto extends PeriodoGlobalDto {
  @ApiProperty({
    enum: ESTADOS_PERIODO,
    description:
      '`lista` = se puede emitir; `esperando` = terminó, pero hay tickets que el cliente todavía ' +
      'puede facturar; `en_curso` = no ha terminado; `fuera_de_plazo` = el SAT ya no acepta su año.',
  })
  estado!: (typeof ESTADOS_PERIODO)[number];

  @ApiProperty({ description: 'Tickets que entrarían a la global (su código ya venció).' })
  tickets!: number;

  @ApiProperty({ example: '12345.60', description: 'Suma de sus totales.' })
  total!: string;

  @ApiProperty({ description: 'Tickets que el cliente todavía puede autofacturar.' })
  vigentes!: number;

  @ApiProperty({ type: String, nullable: true, description: 'Hasta cuándo, el último (ISO).' })
  vigentesHasta!: string | null;

  @ApiProperty({
    description:
      'Globales vigentes (o en emisión) que YA tiene el periodo. > 0 = la siguiente es ' +
      'complementaria (tickets que llegaron tarde); el programador no la emite solo.',
  })
  globalesPrevias!: number;

  @ApiProperty({
    description:
      'F2-109: cuántas globales CANCELADAS tiene el periodo. Con alguna, la emisión automática ya no ' +
      'lo emite sola (sus tickets se soltaron): queda para emitir a mano.',
  })
  globalesCanceladas!: number;
}

export class GlobalEmitidaDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  uuid!: string | null;

  @ApiProperty({ example: 'A-120' })
  serieFolio!: string;

  @ApiProperty({ enum: ESTADOS_EMISION })
  estado!: (typeof ESTADOS_EMISION)[number];

  @ApiProperty({ example: '12345.60' })
  total!: string;

  @ApiProperty({ type: String, nullable: true })
  emitidoAt!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'julio de 2026' })
  etiqueta!: string | null;

  @ApiProperty({ enum: PERIODICIDADES_GLOBAL, nullable: true })
  periodicidad!: PeriodicidadGlobalEnum | null;

  @ApiProperty()
  tickets!: number;

  @ApiProperty({ description: 'Tiene XML y PDF guardados.' })
  conArchivos!: boolean;
}

export class PeriodosGlobalDto {
  @ApiProperty({ type: SucursalGlobalDto })
  sucursal!: SucursalGlobalDto;

  @ApiProperty({ enum: PERIODICIDADES_GLOBAL })
  periodicidad!: PeriodicidadGlobalEnum;

  @ApiProperty({ type: [ResumenPeriodoGlobalDto], description: 'Del más reciente al más viejo.' })
  periodos!: ResumenPeriodoGlobalDto[];

  @ApiProperty({ type: [GlobalEmitidaDto] })
  emitidas!: GlobalEmitidaDto[];
}

export class TicketGlobalDto {
  @ApiProperty({ example: '000123' })
  folio!: string;

  @ApiProperty()
  cerradoAt!: string;

  @ApiProperty({ example: '350.00' })
  total!: string;
}

export class VistaPreviaGlobalDto {
  @ApiProperty({ type: SucursalGlobalDto })
  sucursal!: SucursalGlobalDto;

  @ApiProperty({ type: PeriodoGlobalDto })
  periodo!: PeriodoGlobalDto;

  @ApiProperty({ enum: ESTADOS_PERIODO })
  estado!: (typeof ESTADOS_PERIODO)[number];

  @ApiProperty({ type: [TicketGlobalDto], description: 'Un concepto por ticket en el CFDI.' })
  tickets!: TicketGlobalDto[];

  @ApiProperty({ description: 'Tickets del periodo que el cliente todavía puede facturar.' })
  vigentes!: number;

  @ApiProperty({ type: String, nullable: true })
  vigentesHasta!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '01',
    description: 'c_FormaPago: la de mayor monto entre los pagos. Null = no se puede emitir.',
  })
  formaPago!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '10642.76' })
  subtotal!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '1702.84' })
  iva!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '12345.60' })
  total!: string | null;

  @ApiProperty()
  globalesPrevias!: number;
}

export class FacturaGlobalEmitidaDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  uuid!: string;

  @ApiProperty({ example: 'A-120' })
  serieFolio!: string;

  @ApiProperty({ example: '12345.60' })
  total!: string;

  @ApiProperty({ description: 'Tickets que ampara.' })
  tickets!: number;

  @ApiProperty({ example: 'agosto de 2026' })
  etiqueta!: string;

  @ApiProperty({ type: DescargasFacturaDto })
  descargas!: DescargasFacturaDto;
}
