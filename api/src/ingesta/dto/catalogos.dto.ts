import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { CatalogoSr } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { DINERO, ISO_CON_ZONA } from '../normalizar';

/**
 * Contrato de la ingesta de catálogos (F2-230): `POST /ingesta/catalogos` (una página),
 * `POST /ingesta/catalogos/cierre` y `GET /ingesta/catalogos/solicitud`.
 *
 * El ValidationPipe global valida SÓLO el sobre. Cada registro se valida aparte en el
 * servicio con la clase de su catálogo: uno inválido se rechaza solo y los demás se
 * guardan (como los eventos de `/ingesta/eventos`). Ningún registro lleva
 * `sucursalId` ni `empresaId`: el tenant sale de la API key.
 *
 * Nada de esto se ha visto en una instalación real de SoftRestaurant (docs/esquema-sr.md
 * §6–§8 siguen pendientes). Los largos y lo obligatorio son DECISION PROVISIONAL
 * (nocturno): ver §13.
 */

export const MAX_REGISTROS_POR_PAGINA = 1000;
/** Cuánto puede venir adelantado el `capturadoAt` del agente respecto a nuestro reloj. */
export const TOLERANCIA_FUTURO_MS = 5 * 60 * 1000;

const DOC_FECHA_SINC = {
  type: String,
  format: 'date-time',
  pattern: ISO_CON_ZONA.source,
  example: '2026-09-22T03:00:00.000Z',
  description:
    'El instante en que EMPEZÓ la lectura de este catálogo en el POS (reloj del agente), ISO-8601 ' +
    'con zona. TODAS las páginas de una sincronización y su cierre llevan el MISMO valor. Más de ' +
    '5 min en el futuro respecto al reloj del API = 400.',
} as const;

const DOC_SINC = {
  format: 'uuid',
  description:
    'Id de la sincronización, generado por el agente. Todas sus páginas y su cierre lo repiten. ' +
    'Una sincronización sin cierre es INCREMENTAL: actualiza lo que trae y no da de baja nada. ' +
    'El agente NO intercala dos sincronizaciones del mismo catálogo (una incremental espera al ' +
    'cierre de la completa en curso): si lo hace, el cierre de la completa puede no cuadrar nunca.',
} as const;

const MENSAJE_FECHA = '$property debe ser ISO-8601 con zona (Z u offset ±hh:mm)';

// ---------------------------------------------------------------------------
// registros (validados uno por uno en el servicio)
// ---------------------------------------------------------------------------

export class RegistroCatalogoDto {
  @ApiProperty({
    example: 'P001',
    description:
      'Llave ESTABLE del registro dentro del POS de esta sucursal (1–64). Única por sucursal y ' +
      'catálogo: la idempotencia va por aquí. Repetida dentro de una página = se rechazan todas sus ' +
      'apariciones.',
  })
  @IsString()
  @Length(1, 64)
  origenSrId!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'P001',
    description:
      'La clave VISIBLE (la que ve el usuario del POS). Puede ser distinta de `origenSrId`.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  clave?: string | null;

  @ApiProperty({ example: 'Chilaquiles verdes', description: '1–200 caracteres.' })
  @IsString()
  @Length(1, 200)
  nombre!: string;

  @ApiPropertyOptional({
    type: Boolean,
    nullable: true,
    description:
      'Estado propio del POS (false = dado de baja o suspendido en SR). Ausente o nulo = el POS ' +
      'no lo reporta. Distinto de desaparecer de una sincronización completa.',
  })
  @IsOptional()
  @IsBoolean()
  activoPos?: boolean | null;
}

export class RegistroProductoDto extends RegistroCatalogoDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'G01',
    description: 'El `origenSrId` de su grupo. Sin FK: el grupo puede llegar después.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  grupoOrigenSrId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    pattern: DINERO.source,
    example: '89.00',
    description:
      'Precio de venta en ESTA sucursal (F2-145), texto decimal con la regla de los importes de ' +
      '`/ingesta/eventos`: hasta 10 enteros y 4 decimales, se redondea a 2 mitad lejos de cero. ' +
      'Lo que al redondear no cabe en NUMERIC(12,2) rechaza el registro. Ausente o nulo = el POS no ' +
      'lo reporta, y se GUARDA nulo (también en una página incremental): el agente manda siempre el ' +
      'precio que lee. Se guarda tal como lo da el POS; no se sabe si trae IVA (esquema-sr §6).',
  })
  @IsOptional()
  @IsString()
  @Matches(DINERO, { message: '$property debe ser un importe decimal en texto' })
  precio?: string | null;
}

export class RegistroClienteDto extends RegistroCatalogoDto {
  @ApiPropertyOptional({ type: String, nullable: true, description: 'Dato personal. Hasta 40.' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  telefono?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Dato personal, tal como lo guarda el POS (no se valida el formato). Hasta 200.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  correo?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'Dato personal, tal como lo guarda el POS (no se valida el formato). Hasta 13.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(13)
  rfc?: string | null;
}

export const MODELOS_REGISTRO = [
  RegistroCatalogoDto,
  RegistroProductoDto,
  RegistroClienteDto,
] as const;

// ---------------------------------------------------------------------------
// sobres
// ---------------------------------------------------------------------------

export class PaginaCatalogoDto {
  @ApiProperty({ enum: CatalogoSr, enumName: 'CatalogoSr' })
  @IsEnum(CatalogoSr)
  catalogo!: CatalogoSr;

  @ApiProperty(DOC_SINC)
  @IsUUID('all')
  sincronizacionId!: string;

  @ApiProperty(DOC_FECHA_SINC)
  @IsString()
  @Matches(ISO_CON_ZONA, { message: MENSAJE_FECHA })
  capturadoAt!: string;

  @ApiProperty({
    type: 'array',
    minItems: 1,
    maxItems: MAX_REGISTROS_POR_PAGINA,
    items: {
      oneOf: MODELOS_REGISTRO.map((m) => ({ $ref: getSchemaPath(m) })),
    },
    description:
      '`RegistroProductoDto` para productos, `RegistroClienteDto` para clientes y ' +
      '`RegistroCatalogoDto` para grupos, meseros, áreas y canales. Cada registro se valida ' +
      'aparte: uno inválido se rechaza solo y los demás se guardan.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REGISTROS_POR_PAGINA)
  @IsObject({ each: true })
  registros!: Record<string, unknown>[];
}

export class CierreCatalogoDto {
  @ApiProperty({ enum: CatalogoSr, enumName: 'CatalogoSr' })
  @IsEnum(CatalogoSr)
  catalogo!: CatalogoSr;

  @ApiProperty(DOC_SINC)
  @IsUUID('all')
  sincronizacionId!: string;

  @ApiProperty(DOC_FECHA_SINC)
  @IsString()
  @Matches(ISO_CON_ZONA, { message: MENSAJE_FECHA })
  capturadoAt!: string;

  @ApiProperty({
    minimum: 0,
    maximum: 10_000_000,
    description:
      'Cuántos registros leyó el agente en el POS en esta sincronización completa. 0 = el ' +
      'catálogo está vacío en el POS y se da de baja todo lo que había.',
  })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  total!: number;

  @ApiProperty({
    minimum: 0,
    description:
      'La suma de `rechazadosSinFila` de las respuestas de sus páginas: los registros que el API ' +
      'rechazó y no quedaron en ninguna fila. Mayor que `total` = 400.',
  })
  @IsInt()
  @Min(0)
  @Max(10_000_000)
  rechazados!: number;
}

// ---------------------------------------------------------------------------
// respuestas
// ---------------------------------------------------------------------------

export class RechazoRegistroDto {
  @ApiProperty({ example: 3, description: 'Posición del registro en la página (desde 0).' })
  indice!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'El `origenSrId` si era válido; nulo si no.',
  })
  origenSrId!: string | null;

  @ApiProperty({
    example: 'registros.3.nombre: nombre must be longer than or equal to 1 characters',
    description: 'Ruta y regla. NUNCA repite el valor (los clientes traen datos personales).',
  })
  motivo!: string;

  @ApiProperty({ description: 'Siempre false: reenviarlo igual va a fallar igual.' })
  reintentable!: boolean;
}

export class ResultadoPaginaDto {
  @ApiProperty({ enum: CatalogoSr, enumName: 'CatalogoSr' })
  catalogo!: CatalogoSr;

  @ApiProperty({ description: 'Registros en la página.' })
  recibidos!: number;

  @ApiProperty({ description: 'Filas nuevas.' })
  creados!: number;

  @ApiProperty({ description: 'Filas cuyo contenido cambió o que se reactivaron.' })
  actualizados!: number;

  @ApiProperty({
    description:
      'Filas con el mismo contenido (a lo más se movió su `vistoAt`; no su `updatedAt`).',
  })
  sinCambios!: number;

  @ApiProperty({
    description:
      'Registros ignorados porque una sincronización más nueva ya los trajo (o ya cerró). Un ' +
      'número alto seguido suele ser el reloj del agente corrido hacia atrás.',
  })
  obsoletos!: number;

  @ApiProperty({
    description:
      'Registros rechazados cuya fila ya existía: se marcan vistos (no se dan de baja por un dato ' +
      'malo) sin tocar su contenido.',
  })
  vistos!: number;

  @ApiProperty({
    description:
      'Rechazados que no quedaron en ninguna fila. El agente los suma y los manda en el ' +
      '`rechazados` del cierre.',
  })
  rechazadosSinFila!: number;

  @ApiProperty({ type: [RechazoRegistroDto] })
  rechazados!: RechazoRegistroDto[];
}

export class ResultadoCierreDto {
  @ApiProperty({
    description:
      'false = el cierre es más viejo que la última sincronización completa aplicada y se ' +
      'ignoró. Un reenvío del último cierre aplicado responde true sin escribir.',
  })
  aplicado!: boolean;

  @ApiProperty({ description: 'Filas que este cierre dio de baja (`activo=false`).' })
  desactivados!: number;

  @ApiProperty({ description: 'Filas activas del catálogo en la sucursal después del cierre.' })
  activos!: number;
}

export class SolicitudAgenteDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Cuándo pidió un admin sincronizar todo (reloj del API, UTC). Nulo = nunca.',
  })
  solicitadaAt!: string | null;

  @ApiProperty({
    description:
      'true = hay una solicitud y algún catálogo no ha RECIBIDO un cierre después de ella. Se ' +
      'compara con la hora de recepción del cierre (reloj del API): un cierre tomado antes de la ' +
      'solicitud pero recibido después la da por atendida.',
  })
  pendiente!: boolean;
}
