import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EstadoTraspaso } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

import { CANTIDAD_NO_NEGATIVA } from '../../catalogos/dto/catalogos.dto';
import { MAX_PARTIDAS_TRASPASO } from '../../scope/escritura-traspasos';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const DOC_DIA =
  'Día `YYYY-MM-DD` en la zona de CADA sucursal: [desde 00:00, hasta+1 00:00) locales. Máximo 366 días.';

export const ESTADOS_CONCILIACION = [
  'conciliado',
  'pendiente_sr',
  'en_alerta',
  'cancelado',
] as const;

/** Tope de pólizas de SR que devuelve `GET /inventario/traspasos/sr`. */
export const MAX_POLIZAS_TRASPASO_SR = 400;

// ---------------------------------------------------------------------------
// peticiones
// ---------------------------------------------------------------------------

export class TraspasosQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Una sucursal de esa empresa: los traspasos que SALEN de ella o LLEGAN a ella. De otra ' +
      'empresa = 404.',
  })
  @IsOptional()
  @IsUUID('all')
  sucursalId?: string;

  @ApiPropertyOptional({ enum: EstadoTraspaso, enumName: 'EstadoTraspaso' })
  @IsOptional()
  @IsEnum(EstadoTraspaso)
  estado?: EstadoTraspaso;
}

export class TraspasosSrQueryDto {
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

  @ApiProperty({ example: '2026-09-01', description: DOC_DIA })
  @Matches(DIA, { message: 'desde debe ser YYYY-MM-DD' })
  desde!: string;

  @ApiProperty({ example: '2026-09-20', description: DOC_DIA })
  @Matches(DIA, { message: 'hasta debe ser YYYY-MM-DD' })
  hasta!: string;
}

export class TraspasoEmpresaDto {
  @ApiProperty({ format: 'uuid', description: 'La empresa del traspaso. Otra = 404.' })
  @IsUUID('all')
  empresaId!: string;
}

export class RenglonNuevoDto {
  @ApiProperty({
    maxLength: 64,
    description: 'El `origenSrId` de un insumo de la sucursal ORIGEN.',
  })
  @IsString()
  @Length(1, 64)
  insumoOrigenSrId!: string;

  @ApiProperty({
    pattern: CANTIDAD_NO_NEGATIVA.source,
    example: '2.5',
    description:
      'Lo que se traspasa, en la unidad del insumo: texto decimal sin signo, > 0, hasta 3 ' +
      'decimales (más = 400, nunca se redondea).',
  })
  @IsString()
  @Matches(CANTIDAD_NO_NEGATIVA, { message: '$property debe ser una cantidad decimal sin signo' })
  cantidad!: string;
}

export class EnviarTraspasoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({ format: 'uuid', description: 'La sucursal de ORIGEN. De otra empresa = 404.' })
  @IsUUID('all')
  sucursalOrigenId!: string;

  @ApiProperty({ maxLength: 64 })
  @IsString()
  @Length(1, 64)
  almacenOrigenSrId!: string;

  @ApiProperty({
    format: 'uuid',
    description: 'La sucursal de DESTINO (puede ser la misma). De otra empresa = 404.',
  })
  @IsUUID('all')
  sucursalDestinoId!: string;

  @ApiProperty({ maxLength: 64, description: 'Distinto del de origen si es la misma sucursal.' })
  @IsString()
  @Length(1, 64)
  almacenDestinoSrId!: string;

  @ApiPropertyOptional({ maxLength: 200, description: 'Nota libre (quién lleva, motivo...).' })
  @IsOptional()
  @IsString()
  @Length(1, 200)
  nota?: string;

  @ApiProperty({ type: [RenglonNuevoDto], minItems: 1, maxItems: MAX_PARTIDAS_TRASPASO })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_PARTIDAS_TRASPASO)
  @ValidateNested({ each: true })
  @Type(() => RenglonNuevoDto)
  partidas!: RenglonNuevoDto[];
}

// ---------------------------------------------------------------------------
// respuestas
// ---------------------------------------------------------------------------

export class TraspasoResumenDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ description: 'Consecutivo por EMPRESA (un traspaso cruza sucursales).' })
  folio!: number;

  @ApiProperty({ format: 'uuid', description: 'Sucursal de ORIGEN.' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty()
  almacenOrigenSrId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nombre del catálogo; nulo si no está.',
  })
  almacenOrigen!: string | null;

  @ApiProperty({ format: 'uuid' })
  sucursalDestinoId!: string;

  @ApiProperty()
  sucursalDestino!: string;

  @ApiProperty()
  almacenDestinoSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  almacenDestino!: string | null;

  @ApiProperty({ type: String, nullable: true })
  nota!: string | null;

  @ApiProperty({ enum: EstadoTraspaso, enumName: 'EstadoTraspaso', description: 'El flujo.' })
  estado!: EstadoTraspaso;

  @ApiProperty({
    enum: ESTADOS_CONCILIACION,
    enumName: 'EstadoConciliacionTraspaso',
    description:
      'Contra SoftRestaurant: `conciliado` (todos sus renglones tienen salida y entrada en SR), ' +
      '`pendiente_sr` (pendiente de registrar en SR), `en_alerta` (sin conciliar pasado el umbral ' +
      'de la regla, 48 h por defecto) o `cancelado`.',
  })
  conciliacion!: (typeof ESTADOS_CONCILIACION)[number];

  @ApiProperty({ format: 'date-time' })
  enviadoAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  recibidoAt!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  canceladoAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Cuándo lo concilió el panel. Nulo si no está conciliado.',
  })
  conciliadoAt!: string | null;

  @ApiProperty()
  articulos!: number;

  @ApiProperty({ description: 'Renglones con salida Y entrada vigentes en SR.' })
  conciliados!: number;
}

export class SucursalTraspasoDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty()
  zonaHoraria!: string;
}

export class AlmacenTraspasoDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  almacenOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  almacen!: string | null;
}

export class TraspasosDto {
  @ApiProperty({ type: [TraspasoResumenDto], description: 'Los 200 más recientes.' })
  traspasos!: TraspasoResumenDto[];

  @ApiProperty({ description: 'Cuántos hay con ese filtro (puede ser más que los devueltos).' })
  total!: number;

  @ApiProperty({ description: 'El umbral vigente de la regla `traspaso_sin_conciliar`, en horas.' })
  umbralAlertaHoras!: number;

  @ApiProperty({ type: [SucursalTraspasoDto], description: 'Las sucursales activas del alcance.' })
  sucursales!: SucursalTraspasoDto[];

  @ApiProperty({
    type: [AlmacenTraspasoDto],
    description: 'Almacenes de TODA la empresa (catálogo activo ∪ con lectura): origen y destino.',
  })
  almacenes!: AlmacenTraspasoDto[];
}

export class EspejoDto {
  @ApiProperty({ format: 'uuid' })
  polizaId!: string;

  @ApiProperty({ description: 'Folio de la póliza en SR.' })
  folio!: string;

  @ApiProperty({ type: String, nullable: true })
  referencia!: string | null;

  @ApiProperty()
  renglon!: number;

  @ApiProperty({ format: 'date-time' })
  fecha!: string;
}

export class PartidaTraspasoDto {
  @ApiProperty()
  insumoOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  insumo!: string | null;

  @ApiProperty({ type: String, nullable: true })
  clave!: string | null;

  @ApiProperty({ type: String, nullable: true })
  unidad!: string | null;

  @ApiProperty({ example: '2.500' })
  cantidad!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Costo promedio de la foto de ORIGEN al enviar; nulo = sin lectura (nunca 0).',
  })
  costoUnitario!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'round(cantidad × costo, 2).' })
  importe!: string | null;

  @ApiProperty({
    type: EspejoDto,
    nullable: true,
    description: 'La salida en SR (almacén de origen). Nulo = todavía no aparece.',
  })
  salida!: EspejoDto | null;

  @ApiProperty({ type: EspejoDto, nullable: true, description: 'La entrada en SR (destino).' })
  entrada!: EspejoDto | null;
}

export class TotalesTraspasoDto {
  @ApiProperty({ description: 'Σ de los importes conocidos.', example: '150.00' })
  importe!: string;

  @ApiProperty({ description: 'Renglones sin costo (no suman al importe).' })
  sinCosto!: number;
}

export class TraspasoDetalleDto {
  @ApiProperty({ type: TraspasoResumenDto })
  traspaso!: TraspasoResumenDto;

  @ApiProperty({ description: 'Zona de la sucursal de origen, para presentar las fechas.' })
  zonaHoraria!: string;

  @ApiProperty({ type: [PartidaTraspasoDto] })
  partidas!: PartidaTraspasoDto[];

  @ApiProperty({ type: TotalesTraspasoDto })
  totales!: TotalesTraspasoDto;
}

export class PolizaTraspasoSrDto {
  @ApiProperty({ format: 'uuid' })
  polizaId!: string;

  @ApiProperty()
  folio!: string;

  @ApiProperty({ enum: ['traspaso_salida', 'traspaso_entrada'] })
  tipo!: 'traspaso_salida' | 'traspaso_entrada';

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty()
  almacenOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  almacen!: string | null;

  @ApiProperty({ format: 'date-time' })
  fecha!: string;

  @ApiProperty()
  cancelada!: boolean;

  @ApiProperty()
  partidas!: number;
}

export class TraspasoWebRefDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  folio!: number;
}

export class TraspasoSrDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'La `referencia` del documento en SR; nula = póliza suelta (va sola).',
  })
  referencia!: string | null;

  @ApiProperty({ type: [PolizaTraspasoSrDto], description: 'Salida y entrada del documento.' })
  polizas!: PolizaTraspasoSrDto[];

  @ApiProperty({
    type: [TraspasoWebRefDto],
    description: 'Traspasos del panel conciliados contra alguna de estas pólizas (vigentes).',
  })
  traspasosPanel!: TraspasoWebRefDto[];
}

export class TraspasosSrDto {
  @ApiProperty({ type: [TraspasoSrDto] })
  traspasos!: TraspasoSrDto[];

  @ApiProperty({ description: `Hubo más de ${MAX_POLIZAS_TRASPASO_SR} pólizas: acorta el rango.` })
  truncado!: boolean;

  @ApiProperty({ description: 'Pólizas de traspaso recibidas alguna vez de esas sucursales.' })
  hayPolizas!: boolean;

  @ApiProperty({ type: [SucursalTraspasoDto] })
  sucursales!: SucursalTraspasoDto[];
}
