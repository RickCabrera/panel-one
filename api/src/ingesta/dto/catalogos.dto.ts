import { ApiProperty, ApiPropertyOptional, getSchemaPath } from '@nestjs/swagger';
import { CatalogoSr } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
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
 * §6–§9: supuestos, no hallazgos). Los largos y lo obligatorio son DECISION PROVISIONAL
 * (nocturno): ver §13.
 */

export const MAX_REGISTROS_POR_PAGINA = 1000;

/**
 * El catálogo de formas de pago de SR (PAG-01). Viaja por el mismo sobre de página y cierre que
 * los once de `CatalogoSr`, pero NO es un catálogo espejo por sucursal: llena el catálogo POR
 * EMPRESA `formas_pago_catalogo` (ver `formas-pago.ts`). Por eso no está en el enum de Prisma
 * `CatalogoSr` ni entra al forzado manual (`catalogos.ts#CATALOGOS`).
 */
export const CATALOGO_FORMAS_PAGO = 'formas_pago';

/** Lo que acepta el campo `catalogo` del sobre: los once espejos y `formas_pago`. */
export const CATALOGOS_INGESTA = [...Object.values(CatalogoSr), CATALOGO_FORMAS_PAGO] as const;
export type CatalogoIngesta = CatalogoSr | typeof CATALOGO_FORMAS_PAGO;

const DOC_CATALOGO = {
  enum: CATALOGOS_INGESTA,
  enumName: 'CatalogoIngesta',
  description:
    'Uno de los once catálogos espejo (`CatalogoSr`), o `formas_pago` (PAG-01): el catálogo ' +
    '`dbo.formasdepago` de SR, que llena el catálogo de formas de pago de la EMPRESA.',
} as const;
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

/**
 * Un insumo del inventario (F2-120). DECISION PROVISIONAL (nocturno): un insumo tiene UN grupo
 * y UNA unidad, por su `origenSrId` y sin FK (pueden llegar después); no lleva costo (el costo
 * con que se valúa viaja con las existencias, F2-121; en SR es por insumo y empresa, no por
 * almacén, F2-241). Nada de esto se ha visto en SR: docs/esquema-sr.md §9-§10.
 */
export class RegistroInsumoDto extends RegistroCatalogoDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'GI01',
    description:
      'El `origenSrId` de su grupo de insumo, en esta sucursal. Sin FK: puede llegar después. ' +
      'Ausente o nulo se GUARDA nulo, también en una página incremental: el agente manda siempre ' +
      'el que lee.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  grupoOrigenSrId?: string | null;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'KG',
    description:
      'El `origenSrId` de su unidad, en esta sucursal. Sin FK. Ausente o nulo se GUARDA nulo, ' +
      'también en una página incremental.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  unidadOrigenSrId?: string | null;
}

/**
 * Una forma de pago de `dbo.formasdepago` de SR (PAG-01, catálogo `formas_pago`). Llena el
 * catálogo de la EMPRESA `formas_pago_catalogo` por (empresa, `nombre`): ver `formas-pago.ts`.
 */
export class RegistroFormaPagoDto {
  @ApiProperty({
    example: 'EF',
    description:
      'El `idformadepago` de SR (1–64). Sólo para el log: la llave del catálogo es `nombre`.',
  })
  @IsString()
  @Length(1, 64)
  origenSrId!: string;

  @ApiProperty({
    example: 'EFECTIVO',
    description:
      'El texto con que la ingesta de cheques guarda `forma_raw` de los pagos (1–200): ' +
      '`formasdepago.descripcion` sin espacios a los lados, o el `idformadepago` si la ' +
      'descripción viene vacía. Match EXACTO con `forma_raw`: no se normaliza nada más.',
  })
  @IsString()
  @Length(1, 200)
  nombre!: string;

  @ApiPropertyOptional({
    type: 'integer',
    nullable: true,
    minimum: 1,
    maximum: 4,
    example: 1,
    description:
      '`formasdepago.tipo` de SR: 1 efectivo, 2 tarjeta, 3 vales, 4 otros. Nulo o ausente = la ' +
      'instalación no tiene la columna (o trae otro valor): la forma NO se clasifica y sigue ' +
      'contando como `otro` y saliendo en `sinCatalogo`. Cualquier otra cosa que no sea un ' +
      'entero 1–4 o nulo = 400 para la página entera (el agente nunca la manda).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(4)
  tipo?: number | null;
}

export const MODELOS_REGISTRO = [
  RegistroCatalogoDto,
  RegistroProductoDto,
  RegistroClienteDto,
  RegistroInsumoDto,
  RegistroFormaPagoDto,
] as const;

// ---------------------------------------------------------------------------
// sobres
// ---------------------------------------------------------------------------

export class PaginaCatalogoDto {
  @ApiProperty(DOC_CATALOGO)
  @IsIn(CATALOGOS_INGESTA)
  catalogo!: CatalogoIngesta;

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
      '`RegistroProductoDto` para productos, `RegistroClienteDto` para clientes, ' +
      '`RegistroInsumoDto` para insumos (F2-120), `RegistroFormaPagoDto` para formas_pago ' +
      '(PAG-01) y `RegistroCatalogoDto` para grupos, meseros, áreas, canales, unidades, ' +
      'grupos_insumo, almacenes y proveedores. Cada registro se valida aparte: uno inválido (o con ' +
      'un campo que su catálogo no tiene) se rechaza solo y los demás se guardan. Única excepción: ' +
      'un `tipo` de formas_pago que no sea entero 1–4 o nulo es 400 para la página entera.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_REGISTROS_POR_PAGINA)
  @IsObject({ each: true })
  registros!: Record<string, unknown>[];
}

export class CierreCatalogoDto {
  @ApiProperty(DOC_CATALOGO)
  @IsIn(CATALOGOS_INGESTA)
  catalogo!: CatalogoIngesta;

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
  @ApiProperty(DOC_CATALOGO)
  catalogo!: CatalogoIngesta;

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

  @ApiPropertyOptional({
    description:
      'Sólo formas_pago (PAG-01). Textos que ya tienen una fila `manual` en el catálogo de la ' +
      'empresa: la sincronización nunca la pisa (cuentan también en `sinCambios`).',
  })
  manuales?: number;

  @ApiPropertyOptional({
    description:
      'Sólo formas_pago (PAG-01). Textos que se dejaron como estaban porque su clasificación choca: ' +
      'otra sucursal de la empresa ya lo dio de alta con otra forma, o el mismo POS trae ese texto ' +
      'dos veces con tipos distintos. No se elige al azar; el API lo registra en su log.',
  })
  conflictos?: number;

  @ApiPropertyOptional({
    description:
      'Sólo formas_pago (PAG-01). Textos sin `tipo` (la columna no existe en esa instalación): no ' +
      'se clasifican y siguen saliendo en `sinCatalogo`.',
  })
  sinTipo?: number;
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
