import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

import { CANTIDAD, DINERO, ISO_CON_ZONA } from '../normalizar';

/**
 * Contrato de `POST /ingesta/eventos` (F1-031), la única frontera entre el
 * agente y el api. El ValidationPipe global valida SÓLO el sobre
 * (`LoteIngestaDto`). Cada evento se valida aparte, en el servicio, con las
 * clases `Datos*Dto` de aquí: así un evento malo se rechaza solo y no tumba el
 * lote.
 *
 * Ningún evento lleva `sucursalId` ni `empresaId`: el tenant sale de la API
 * key. Un campo que no esté aquí rechaza el evento (`forbidNonWhitelisted`).
 */

export const MAX_EVENTOS_POR_LOTE = 100;
export const TIPOS_EVENTO = ['cheque', 'snapshot', 'heartbeat'] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

const DOC_DINERO = {
  type: String,
  pattern: DINERO.source,
  example: '125.50',
  description:
    'Importe como STRING decimal, nunca número JSON. Hasta 4 decimales; se guarda ' +
    'redondeado a 2 (mitad lejos de cero). Puede ser negativo.',
} as const;

const DOC_FECHA = {
  type: String,
  format: 'date-time',
  pattern: ISO_CON_ZONA.source,
  example: '2026-09-20T19:42:10.123Z',
  description: 'ISO-8601 con zona obligatoria (`Z` u offset). Sin zona se rechaza.',
} as const;

const MENSAJE_FECHA = '$property debe ser ISO-8601 con zona (Z u offset ±hh:mm)';
const MENSAJE_DINERO = '$property debe ser un importe decimal en texto (p. ej. "125.50")';

// ---------------------------------------------------------------------------
// cheque
// ---------------------------------------------------------------------------

export class ModificadorDto {
  @ApiProperty({ example: 'Sin cebolla' })
  @IsString()
  @Length(1, 200)
  nombre!: string;

  @ApiProperty({ ...DOC_DINERO, example: '0.00' })
  @IsString()
  @Matches(DINERO, { message: MENSAJE_DINERO })
  precio!: string;
}

export class PartidaDto {
  @ApiProperty({ example: 'Tacos al pastor' })
  @IsString()
  @Length(1, 200)
  producto!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'Tacos' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  categoria?: string | null;

  @ApiProperty({
    type: String,
    pattern: CANTIDAD.source,
    example: '2',
    description: 'STRING decimal, hasta 3 decimales (venta fraccionada).',
  })
  @IsString()
  @Matches(CANTIDAD, { message: '$property debe ser una cantidad decimal en texto' })
  cantidad!: string;

  @ApiProperty(DOC_DINERO)
  @IsString()
  @Matches(DINERO, { message: MENSAJE_DINERO })
  precioUnit!: string;

  @ApiProperty(DOC_DINERO)
  @IsString()
  @Matches(DINERO, { message: MENSAJE_DINERO })
  total!: string;

  @ApiPropertyOptional({
    type: [ModificadorDto],
    description: 'Incluidos los de $0.00. Ausente = sin modificadores.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ModificadorDto)
  modificadores?: ModificadorDto[];
}

export class PagoDto {
  @ApiProperty({
    example: 'EFECTIVO',
    description: 'El nombre de la forma de pago tal como viene de SR.',
  })
  @IsString()
  @Length(1, 100)
  formaRaw!: string;

  @ApiProperty(DOC_DINERO)
  @IsString()
  @Matches(DINERO, { message: MENSAJE_DINERO })
  monto!: string;
}

export class DatosChequeDto {
  @ApiProperty({
    example: '000123',
    description: 'Llave estable del cheque en SR. Única por sucursal: el upsert va por aquí.',
  })
  @IsString()
  @Length(1, 64)
  folioSr!: string;

  @ApiProperty({ example: '123', description: 'El folio que ve el cliente en el ticket.' })
  @IsString()
  @Length(1, 64)
  folio!: string;

  @ApiProperty(DOC_FECHA)
  @IsString()
  @Matches(ISO_CON_ZONA, { message: MENSAJE_FECHA })
  @IsISO8601({ strict: true, strictSeparator: true })
  abiertoAt!: string;

  @ApiPropertyOptional({ ...DOC_FECHA, nullable: true })
  @IsOptional()
  @IsString()
  @Matches(ISO_CON_ZONA, { message: MENSAJE_FECHA })
  @IsISO8601({ strict: true, strictSeparator: true })
  cerradoAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '12' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mesa?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: 'JUAN' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  mesero?: string | null;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    example: 4,
    description: 'Nulo/ausente = SR no lo reportó (distinto de 0).',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10000)
  comensales?: number | null;

  @ApiProperty(DOC_DINERO)
  @IsString()
  @Matches(DINERO, { message: MENSAJE_DINERO })
  subtotal!: string;

  @ApiProperty(DOC_DINERO)
  @IsString()
  @Matches(DINERO, { message: MENSAJE_DINERO })
  impuestos!: string;

  @ApiProperty(DOC_DINERO)
  @IsString()
  @Matches(DINERO, { message: MENSAJE_DINERO })
  descuentos!: string;

  @ApiProperty(DOC_DINERO)
  @IsString()
  @Matches(DINERO, { message: MENSAJE_DINERO })
  propina!: string;

  @ApiProperty({
    ...DOC_DINERO,
    description: `${DOC_DINERO.description} Se guarda tal como lo reporta SR: nunca se recalcula de las partidas.`,
  })
  @IsString()
  @Matches(DINERO, { message: MENSAJE_DINERO })
  total!: string;

  @ApiProperty()
  @IsBoolean()
  cancelado!: boolean;

  @ApiProperty({
    type: [PartidaDto],
    description: 'En orden de ticket. Reemplazan por completo a las guardadas.',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => PartidaDto)
  partidas!: PartidaDto[];

  @ApiProperty({ type: [PagoDto], description: 'Reemplazan por completo a los guardados.' })
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => PagoDto)
  pagos!: PagoDto[];
}

// ---------------------------------------------------------------------------
// snapshot
// ---------------------------------------------------------------------------

export class DatosSnapshotDto {
  @ApiProperty({
    ...DOC_FECHA,
    description: `Cuándo leyó el agente las mesas. ${DOC_FECHA.description}`,
  })
  @IsString()
  @Matches(ISO_CON_ZONA, { message: MENSAJE_FECHA })
  @IsISO8601({ strict: true, strictSeparator: true })
  capturadoAt!: string;

  @ApiProperty({
    type: 'array',
    items: { type: 'object', additionalProperties: true },
    description:
      'Las cuentas abiertas, completas (no delta). La forma de cada mesa todavía no se ' +
      'valida: la fijan F1-023/F1-050 (supuesto, esquema-sr.md §5).',
  })
  @IsArray()
  @ArrayMaxSize(500)
  @IsObject({ each: true })
  mesas!: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// heartbeat
// ---------------------------------------------------------------------------

export class DatosHeartbeatDto {
  @ApiProperty({ example: '0.1.0' })
  @IsString()
  @Length(1, 50)
  versionAgente!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '10.0' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  versionSr?: string | null;

  @ApiPropertyOptional({
    ...DOC_FECHA,
    nullable: true,
    description: `Última lectura exitosa de SR. Un heartbeat con una lectura ANTERIOR a la guardada se ignora (llegó tarde). ${DOC_FECHA.description}`,
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_CON_ZONA, { message: MENSAJE_FECHA })
  @IsISO8601({ strict: true, strictSeparator: true })
  ultimaLecturaAt?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  ultimoError?: string | null;
}

// ---------------------------------------------------------------------------
// eventos y sobre
// ---------------------------------------------------------------------------

/** Lo común a todo evento. `datos` se valida después, con la clase de su `tipo`. */
export class CabeceraEventoDto {
  @IsString()
  @Length(1, 64)
  id!: string;

  @IsIn(TIPOS_EVENTO)
  tipo!: TipoEvento;

  @IsObject()
  datos!: Record<string, unknown>;
}

const DOC_ID_EVENTO = {
  example: '1042',
  description:
    'Id del evento en la cola local del agente (1..64 caracteres). Vuelve en la respuesta.',
} as const;

// Sólo documentación: el contrato de cada tipo de evento en el OpenAPI.
export class EventoChequeDto {
  @ApiProperty(DOC_ID_EVENTO)
  id!: string;

  @ApiProperty({ enum: ['cheque'] })
  tipo!: 'cheque';

  @ApiProperty({ type: DatosChequeDto })
  datos!: DatosChequeDto;
}

export class EventoSnapshotDto {
  @ApiProperty(DOC_ID_EVENTO)
  id!: string;

  @ApiProperty({ enum: ['snapshot'] })
  tipo!: 'snapshot';

  @ApiProperty({ type: DatosSnapshotDto })
  datos!: DatosSnapshotDto;
}

export class EventoHeartbeatDto {
  @ApiProperty(DOC_ID_EVENTO)
  id!: string;

  @ApiProperty({ enum: ['heartbeat'] })
  tipo!: 'heartbeat';

  @ApiProperty({ type: DatosHeartbeatDto })
  datos!: DatosHeartbeatDto;
}

export const MODELOS_EVENTO = [EventoChequeDto, EventoSnapshotDto, EventoHeartbeatDto];

export class LoteIngestaDto {
  @ApiProperty({
    type: 'array',
    minItems: 1,
    maxItems: MAX_EVENTOS_POR_LOTE,
    items: { oneOf: MODELOS_EVENTO.map((m) => ({ $ref: getSchemaPath(m) })) },
    description:
      'Lote mixto, procesado en orden. Cada evento va en su propia transacción: uno ' +
      'inválido o que falla se rechaza solo y los demás se guardan.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_EVENTOS_POR_LOTE)
  @IsObject({ each: true })
  eventos!: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// respuesta
// ---------------------------------------------------------------------------

export class RechazoDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '1043',
    description: 'El id del evento, o nulo si el evento no traía un id válido.',
  })
  id!: string | null;

  @ApiProperty({ example: 1, description: 'Posición del evento en el lote (desde 0).' })
  indice!: number;

  @ApiProperty({ example: 'datos.total debe ser un importe decimal en texto (p. ej. "125.50")' })
  motivo!: string;

  @ApiProperty({
    description:
      '`false`: el evento es inválido o no cabe en la base y reenviarlo igual va a fallar ' +
      'igual; el agente NO debe reintentarlo en bucle. `true`: falla transitoria (base ' +
      'caída, timeout, choque con otro lote en vuelo); reenviarlo más tarde es seguro, ' +
      'porque la ingesta es idempotente.',
  })
  reintentable!: boolean;
}

export class ResultadoIngestaDto {
  @ApiProperty({
    type: [String],
    description: 'Ids de los eventos guardados (o que ya estaban guardados idénticos).',
  })
  procesados!: string[];

  @ApiProperty({ type: [RechazoDto] })
  rechazados!: RechazoDto[];
}
