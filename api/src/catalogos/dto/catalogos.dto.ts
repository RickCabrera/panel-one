import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CatalogoSr } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Lectura de los catálogos espejo para el panel (F2-230) y lo que el panel escribe:
 * la metadata propia de un producto y la solicitud de sincronización. Toda fecha va en
 * UTC (ISO-8601); pasarla a la zona de la sucursal es cosa del web.
 */

export const ESTADOS_FILTRO = ['activos', 'inactivos', 'todos'] as const;
export type EstadoFiltro = (typeof ESTADOS_FILTRO)[number];

/** Existencias (no dinero): hasta 9 enteros y 3 decimales, sin signo. */
export const CANTIDAD_NO_NEGATIVA = /^\d{1,9}(\.\d{1,3})?$/;

export class CatalogoQueryDto {
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

  @ApiPropertyOptional({
    enum: ESTADOS_FILTRO,
    default: 'todos',
    description:
      '`activos`: los que vio la última sincronización completa. `inactivos`: los que ' +
      'desaparecieron del POS (nunca se borran).',
  })
  @IsOptional()
  @IsIn(ESTADOS_FILTRO)
  estado?: EstadoFiltro;

  @ApiPropertyOptional({
    maxLength: 100,
    description: 'Busca en nombre, clave y origenSrId (sin distinguir mayúsculas).',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10000, default: 1, description: 'Página de 50.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  pagina?: number;
}

export class EmpresaQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;
}

export class GuardarMetadataDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({ type: String, nullable: true, maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descripcion!: string | null;

  @ApiProperty({ type: String, nullable: true, maxLength: 500, description: 'URL https.' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  @IsUrl({ protocols: ['https'], require_protocol: true })
  fotoUrl!: string | null;

  @ApiProperty({ type: [String], maxItems: 20, description: 'Hasta 20, de 1 a 40 caracteres.' })
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Length(1, 40, { each: true })
  etiquetas!: string[];

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: CANTIDAD_NO_NEGATIVA.source,
    example: '2.5',
    description: 'Existencia mínima, texto decimal sin signo (hasta 3 decimales).',
  })
  @IsOptional()
  @IsString()
  @Matches(CANTIDAD_NO_NEGATIVA, { message: '$property debe ser una cantidad decimal sin signo' })
  minimo!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    pattern: CANTIDAD_NO_NEGATIVA.source,
    description: 'Existencia máxima. Menor que el mínimo = 400.',
  })
  @IsOptional()
  @IsString()
  @Matches(CANTIDAD_NO_NEGATIVA, { message: '$property debe ser una cantidad decimal sin signo' })
  maximo!: string | null;
}

export class MenuQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Una sucursal de esa empresa (con una sola no hay precios que comparar). Sin él, todas. ' +
      'De otra empresa = 404.',
  })
  @IsOptional()
  @IsUUID('all')
  sucursalId?: string;
}

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const DOC_DIA =
  'Día LOCAL de cada sucursal, inclusivo (YYYY-MM-DD). El corte es el de /ventas/*: cada cuenta ' +
  'cae en el día de SU zona horaria.';

/** El periodo de /ventas/* sin `alturaAl` (aquí no hay comparativo "a la misma altura"). */
export class SinCatalogoQueryDto extends MenuQueryDto {
  @ApiProperty({ example: '2026-09-01', description: DOC_DIA })
  @Matches(DIA, { message: 'desde debe ser YYYY-MM-DD' })
  desde!: string;

  @ApiProperty({ example: '2026-09-20', description: DOC_DIA })
  @Matches(DIA, { message: 'hasta debe ser YYYY-MM-DD' })
  hasta!: string;
}

export class ForzarSincronizacionDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({ format: 'uuid', description: 'Una sucursal de esa empresa. Si no, 404.' })
  @IsUUID('all')
  sucursalId!: string;
}

// ---------------------------------------------------------------------------
// respuestas
// ---------------------------------------------------------------------------

export class FilaCatalogoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty({ description: 'Nombre de la sucursal.' })
  sucursal!: string;

  @ApiProperty({ description: 'Llave del registro en el POS de esa sucursal.' })
  origenSrId!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Clave visible en el POS.' })
  clave!: string | null;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({
    description: 'Lo vio la última sincronización completa. false = desapareció del POS.',
  })
  activo!: boolean;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: 'Estado propio del POS (false = baja en SR). Nulo = el POS no lo reporta.',
  })
  activoPos!: boolean | null;

  @ApiProperty({ format: 'date-time', description: 'Última vez que el agente lo mandó (UTC).' })
  vistoAt!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Último cambio de contenido o de `activo` (UTC).',
  })
  updatedAt!: string;
}

export class FilaProductoDto extends FilaCatalogoDto {
  @ApiProperty({ type: String, nullable: true })
  grupoOrigenSrId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nombre del grupo en la misma sucursal; nulo si no hay grupo o aún no llegó.',
  })
  grupo!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '89.00',
    description:
      'Precio en ESA sucursal, tal como lo reporta el POS (texto a 2 decimales; no se sabe si trae ' +
      'IVA). Nulo = el POS no lo reporta.',
  })
  precio!: string | null;

  @ApiProperty({ description: 'Tiene metadata propia (foto, descripción, etiquetas, mín/máx).' })
  tieneMetadata!: boolean;
}

export class FilaClienteDto extends FilaCatalogoDto {
  @ApiProperty({ type: String, nullable: true, description: 'Dato personal.' })
  telefono!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Dato personal.' })
  correo!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Dato personal.' })
  rfc!: string | null;
}

class PaginaBaseDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  pagina!: number;

  @ApiProperty({ example: 50 })
  porPagina!: number;
}

export class PaginaCatalogoLecturaDto extends PaginaBaseDto {
  @ApiProperty({ type: [FilaCatalogoDto] })
  filas!: FilaCatalogoDto[];
}

export class PaginaProductosDto extends PaginaBaseDto {
  @ApiProperty({ type: [FilaProductoDto] })
  filas!: FilaProductoDto[];
}

export class PaginaClientesDto extends PaginaBaseDto {
  @ApiProperty({ type: [FilaClienteDto] })
  filas!: FilaClienteDto[];
}

export class MetadataProductoDto {
  @ApiProperty({ type: String, nullable: true })
  descripcion!: string | null;

  @ApiProperty({ type: String, nullable: true })
  fotoUrl!: string | null;

  @ApiProperty({ type: [String] })
  etiquetas!: string[];

  @ApiProperty({ type: String, nullable: true, example: '2.500', description: 'Texto decimal.' })
  minimo!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Texto decimal.' })
  maximo!: string | null;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}

export class DetalleProductoDto extends FilaProductoDto {
  @ApiProperty({
    type: MetadataProductoDto,
    nullable: true,
    description:
      'Metadata PROPIA (nuestra, no del POS). Vive aparte: ninguna sincronización la toca. ' +
      'Es por sucursal (cuelga del producto espejo de ESA sucursal).',
  })
  metadata!: MetadataProductoDto | null;
}

export class EstadoCatalogoDto {
  @ApiProperty({ enum: CatalogoSr, enumName: 'CatalogoSr' })
  catalogo!: CatalogoSr;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Inicio de la última sincronización COMPLETA aplicada (reloj del agente, UTC). Nulo = nunca.',
  })
  ultimaCompletaAt!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Cuándo recibió el API ese cierre (UTC).',
  })
  recibidaAt!: string | null;

  @ApiProperty({ type: Number, nullable: true })
  total!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  rechazados!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  desactivados!: number | null;
}

export class SolicitudPanelDto {
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  solicitadaAt!: string | null;

  @ApiProperty({
    description:
      'Algún catálogo no ha recibido un cierre después de la solicitud (el agente aún no termina).',
  })
  pendiente!: boolean;
}

export class SincronizacionSucursalDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({ type: [EstadoCatalogoDto], description: 'Siempre los seis, en orden fijo.' })
  catalogos!: EstadoCatalogoDto[];

  @ApiProperty({ type: SolicitudPanelDto })
  solicitud!: SolicitudPanelDto;
}

// ---------------------------------------------------------------------------
// orquestador de menú (F2-145)
// ---------------------------------------------------------------------------

export class SucursalMenuDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description:
      'Inicio de la última sincronización COMPLETA del catálogo de productos (UTC). Nulo = nunca: ' +
      'la sucursal no tiene catálogo que mostrar ni que comparar.',
  })
  sincronizadoAt!: string | null;

  @ApiProperty({ description: 'Productos activos de esa sucursal en el menú.' })
  productos!: number;
}

export class PrecioSucursalDto {
  @ApiProperty({ format: 'uuid', description: 'La fila del espejo (para su ficha y metadata).' })
  productoId!: string;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  origenSrId!: string;

  @ApiProperty({ description: 'El nombre en ESA sucursal (puede diferir entre sucursales).' })
  nombre!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '95.00',
    description: 'Nulo = el POS no lo reporta.',
  })
  precio!: string | null;

  @ApiProperty({
    description:
      'false = el POS lo reporta dado de baja: se muestra y no cuenta para la discrepancia.',
  })
  vigente!: boolean;

  @ApiProperty()
  tieneMetadata!: boolean;
}

export class ProductoMenuDto {
  @ApiProperty({ description: 'Llave del cruce entre sucursales (`c:<clave>` o `n:<nombre>`).' })
  llave!: string;

  @ApiProperty({
    enum: ['clave', 'nombre'],
    description:
      'Con qué se reconoció el mismo producto en las sucursales: la clave visible del POS o, sin ' +
      'clave, el nombre. Supuesto no validado en SR (esquema-sr §6).',
  })
  criterio!: 'clave' | 'nombre';

  @ApiProperty({ type: String, nullable: true })
  clave!: string | null;

  @ApiProperty({ description: 'El de la primera sucursal (por nombre).' })
  nombre!: string;

  @ApiProperty({ type: String, nullable: true, description: 'El grupo de la primera sucursal.' })
  grupo!: string | null;

  @ApiProperty({ description: 'Las sucursales lo tienen en grupos distintos.' })
  gruposDistintos!: boolean;

  @ApiProperty({ description: 'Dos filas de la MISMA sucursal comparten la llave.' })
  duplicadoEnSucursal!: boolean;

  @ApiProperty({
    description:
      'Entre las filas vigentes con precio hay más de un precio distinto (comparación decimal exacta).',
  })
  discrepancia!: boolean;

  @ApiProperty({ type: String, nullable: true })
  precioMin!: string | null;

  @ApiProperty({ type: String, nullable: true })
  precioMax!: string | null;

  @ApiProperty({ type: [PrecioSucursalDto], description: 'En el orden de `sucursales`.' })
  precios!: PrecioSucursalDto[];
}

export class CategoriaMenuDto {
  @ApiProperty({ type: String, nullable: true, description: 'Nulo = sin grupo (va al final).' })
  grupo!: string | null;

  @ApiProperty({ type: [ProductoMenuDto] })
  productos!: ProductoMenuDto[];
}

export class MenuDto {
  @ApiProperty({ type: [SucursalMenuDto], description: 'Por nombre: el orden de las columnas.' })
  sucursales!: SucursalMenuDto[];

  @ApiProperty({
    type: [CategoriaMenuDto],
    description: 'Por nombre de grupo; sin grupo al final.',
  })
  categorias!: CategoriaMenuDto[];

  @ApiProperty({ description: 'Productos distintos (ya cruzados entre sucursales).' })
  productos!: number;

  @ApiProperty({ description: 'Productos con precio distinto entre sucursales.' })
  discrepancias!: number;

  @ApiProperty({
    description:
      'true = había más de 5000 filas activas y el menú sólo trae las primeras (por sucursal y ' +
      'origenSrId): las cifras no están completas.',
  })
  truncado!: boolean;
}

export class VendidoSinCatalogoDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({
    description: 'El nombre tal como llegó en el ticket (de sus variantes, la de más importe).',
  })
  producto!: string;

  @ApiProperty({
    description: 'Escrituras distintas (mayúsculas, espacios) que se juntaron en este renglón.',
  })
  variantes!: number;

  @ApiProperty({ description: 'Partidas vendidas en el periodo.' })
  partidas!: number;

  @ApiProperty({ example: '3.000', description: 'Σ cantidad, texto a 3 decimales.' })
  cantidad!: string;

  @ApiProperty({
    example: '267.00',
    description: 'Σ total de las partidas (antes del descuento de la cuenta), texto a 2 decimales.',
  })
  importe!: string;
}

export class SucursalSinCatalogoDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;
}

export class VendidosSinCatalogoDto {
  @ApiProperty({ type: [VendidoSinCatalogoDto], description: 'Por importe, de mayor a menor.' })
  filas!: VendidoSinCatalogoDto[];

  @ApiProperty({ description: 'Renglones antes del tope.' })
  total!: number;

  @ApiProperty({ description: 'true = hay más de 500 renglones y sólo vienen los primeros.' })
  truncado!: boolean;

  @ApiProperty({
    type: [SucursalSinCatalogoDto],
    description:
      'Sucursales del alcance SIN una sincronización completa del catálogo de productos: sus ventas ' +
      'no se cruzan (contra un catálogo ausente o parcial todo saldría "sin catálogo").',
  })
  sucursalesSinCatalogo!: SucursalSinCatalogoDto[];
}

// ---------------------------------------------------------------------------
// Meseros (F2-231)
// ---------------------------------------------------------------------------

export const CRUCES_MESERO = [
  'catalogo',
  'sin-catalogo',
  'ambiguo',
  'sin-sincronizar',
  'catalogo-incompleto',
  'sin-mesero',
] as const;

const DINERO_TXT = { type: String, example: '1234.50', description: 'Texto a 2 decimales.' };
const DINERO_NULO = { ...DINERO_TXT, nullable: true };

/** El periodo de Meseros: el mismo de `sin-catalogo` (sin `alturaAl`). */
export class RendimientoMeserosQueryDto extends SinCatalogoQueryDto {}

export class MeseroLigadoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, nullable: true })
  clave!: string | null;

  @ApiProperty({ description: 'Nombre en el espejo del POS.' })
  nombre!: string;

  @ApiProperty({ description: 'false = ya no aparece en la última sincronización completa.' })
  activo!: boolean;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description: 'Estado en el POS: false = dado de baja; null = el POS no lo reporta.',
  })
  activoPos!: boolean | null;

  @ApiProperty({ format: 'date-time', description: 'Última sincronización que lo vio (UTC).' })
  vistoAt!: string;
}

export class MeseroSinVentasDto extends MeseroLigadoDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;
}

class ImporteConteoDto {
  @ApiProperty(DINERO_TXT)
  monto!: string;

  @ApiProperty()
  cuentas!: number;
}

class CanceladosConteoDto {
  @ApiProperty({ description: 'Cuentas canceladas: NO suman a la venta.' })
  cuentas!: number;

  @ApiProperty({ ...DINERO_TXT, description: 'Σ total de las canceladas, tal como llegó.' })
  monto!: string;
}

export class FilaRendimientoMeseroDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nombre del espejo si se ligó; si no, el texto del POS. Null = "Sin mesero".',
  })
  mesero!: string | null;

  @ApiProperty({
    type: [String],
    description:
      'Textos del POS sumados en esta fila. Más de uno cuando difieren sólo en espacios o ' +
      'mayúsculas y ligan con el mismo mesero del espejo.',
  })
  textosPos!: string[];

  @ApiProperty({
    enum: CRUCES_MESERO,
    description:
      'Cómo se ligó con el espejo por (sucursal, nombre normalizado): `ambiguo` = el espejo trae ' +
      'ese nombre más de una vez; `sin-sincronizar` = la sucursal no ha mandado su catálogo; ' +
      '`catalogo-incompleto` = la lectura del espejo se truncó.',
  })
  cruce!: (typeof CRUCES_MESERO)[number];

  @ApiProperty({ type: MeseroLigadoDto, nullable: true })
  catalogo!: MeseroLigadoDto | null;

  @ApiProperty({ ...DINERO_TXT, description: 'Σ total de sus cuentas no canceladas.' })
  venta!: string;

  @ApiProperty()
  cuentas!: number;

  @ApiProperty(DINERO_NULO)
  ticketPromedio!: string | null;

  @ApiProperty()
  comensales!: number;

  @ApiProperty()
  cuentasConComensales!: number;

  @ApiProperty(DINERO_TXT)
  propina!: string;

  @ApiProperty({
    type: ImporteConteoDto,
    description: 'Descuentos: importe y cuentas con descuento.',
  })
  descuentos!: ImporteConteoDto;

  @ApiProperty({ type: CanceladosConteoDto })
  cancelados!: CanceladosConteoDto;

  @ApiProperty({ type: String, nullable: true, example: '48.5' })
  minutosPromedio!: string | null;

  @ApiProperty()
  cuentasConDuracion!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'Posición por venta en SU sucursal (empate = misma posición). Null = "Sin mesero" o sólo ' +
      'cancelaciones.',
  })
  posicion!: number | null;
}

export class PromedioSucursalDto {
  @ApiProperty({ ...DINERO_NULO, description: 'Σ venta de los meseros del ranking / n.' })
  ventaPorMesero!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Σ cuentas del ranking / n, 1 decimal.',
  })
  cuentasPorMesero!: string | null;

  @ApiProperty(DINERO_NULO)
  propinaPorMesero!: string | null;

  @ApiProperty({ type: String, nullable: true, description: '1 decimal.' })
  comensalesPorMesero!: string | null;

  @ApiProperty({
    ...DINERO_NULO,
    description: 'Venta de la sucursal / TODAS sus cuentas (también las sin mesero).',
  })
  ticketPromedio!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Minutos de TODA la sucursal: Σ segundos / Σ cuentas con duración.',
  })
  minutosPromedio!: string | null;
}

export class SucursalRendimientoDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({ description: 'Tiene una sincronización completa del catálogo de meseros.' })
  catalogoSincronizado!: boolean;

  @ApiProperty({ description: 'n: meseros con nombre y al menos una cuenta en el periodo.' })
  meserosEnRanking!: number;

  @ApiProperty(DINERO_TXT)
  venta!: string;

  @ApiProperty()
  cuentas!: number;

  @ApiProperty({ type: PromedioSucursalDto })
  promedio!: PromedioSucursalDto;
}

export class RendimientoMeserosDto {
  @ApiProperty({ ...DINERO_TXT, description: 'Σ venta de `filas` = /ventas/resumen del filtro.' })
  venta!: string;

  @ApiProperty()
  cuentas!: number;

  @ApiProperty({ type: ImporteConteoDto })
  descuentos!: ImporteConteoDto;

  @ApiProperty({ type: CanceladosConteoDto })
  cancelados!: CanceladosConteoDto;

  @ApiProperty({
    description: 'true = el espejo pasó de 2000 filas: el cruce y `sinVentas` están incompletos.',
  })
  catalogoTruncado!: boolean;

  @ApiProperty({ type: [SucursalRendimientoDto], description: 'Por nombre.' })
  sucursales!: SucursalRendimientoDto[];

  @ApiProperty({
    type: [FilaRendimientoMeseroDto],
    description:
      'Por sucursal; dentro, por posición, luego los de sólo cancelaciones y "Sin mesero" al final.',
  })
  filas!: FilaRendimientoMeseroDto[];

  @ApiProperty({
    type: [MeseroSinVentasDto],
    description: 'Meseros del espejo (de baja o no) sin cuentas ni cancelaciones en el periodo.',
  })
  sinVentas!: MeseroSinVentasDto[];
}

// --- Clientes (F2-232) ---------------------------------------------------------------------

export class ResumenClientesQueryDto extends SinCatalogoQueryDto {
  @ApiPropertyOptional({
    maxLength: 100,
    description:
      'Busca en nombre, clave e id del POS (sin distinguir mayúsculas, literal). Se aplica en ' +
      'el servidor sobre la lista ya armada: no llega a ninguna consulta ni a ningún log.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  q?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 10000, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  pagina?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, default: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  porPagina?: number;

  @ApiPropertyOptional({
    enum: ['true', 'false'],
    default: 'false',
    description:
      '`true` agrega teléfono, correo y RFC a cada fila. Sólo para el export que el usuario pidió ' +
      'con datos de contacto; sin él las tres llaves no vienen.',
  })
  @IsOptional()
  @IsIn(['true', 'false'])
  contacto?: 'true' | 'false';
}

export class FichaClienteQueryDto extends EmpresaQueryDto {
  @ApiProperty({ example: '2026-09-01', description: DOC_DIA })
  @Matches(DIA, { message: 'desde debe ser YYYY-MM-DD' })
  desde!: string;

  @ApiProperty({ example: '2026-09-20', description: DOC_DIA })
  @Matches(DIA, { message: 'hasta debe ser YYYY-MM-DD' })
  hasta!: string;
}

export class CifrasClienteDto {
  @ApiProperty({
    description:
      'Cuentas NO canceladas cerradas en el periodo con este cliente: las mismas que devuelve ' +
      '/ventas/tickets con `clienteId` y `canceladas=excluir`.',
  })
  visitas!: number;

  @ApiProperty({ ...DINERO_TXT, description: 'Σ total de sus visitas (sin las canceladas).' })
  venta!: string;

  @ApiProperty({
    ...DINERO_NULO,
    description: 'venta / visitas, a 2 decimales mitad lejos de cero. Null = sin visitas.',
  })
  ticketPromedio!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Cierre de su última visita del periodo (UTC). Null = sin visitas.',
  })
  ultimaVisita!: string | null;

  @ApiProperty({ type: CanceladosConteoDto })
  canceladas!: CanceladosConteoDto;
}

export class FilaResumenClienteDto extends CifrasClienteDto {
  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Id del espejo (para la ficha y el filtro de Tickets). Null = no hay ficha.',
  })
  id!: string | null;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({
    enum: ['ficha', 'sin-ficha', 'sin-sincronizar'],
    description:
      '`ficha`: está en el espejo de su sucursal. `sin-ficha`: las cuentas traen ese id y el ' +
      'espejo (sincronizado) no lo tiene. `sin-sincronizar`: las cuentas traen ese id y la ' +
      'sucursal no ha mandado su catálogo de clientes: no se puede afirmar que no está.',
  })
  cruce!: 'ficha' | 'sin-ficha' | 'sin-sincronizar';

  @ApiProperty({ description: 'Id del cliente en el POS de su sucursal (no es un dato personal).' })
  origenSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  clave!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Null si no hay ficha.' })
  nombre!: string | null;

  @ApiProperty({
    type: Boolean,
    nullable: true,
    description:
      'false = ya no vino en la última sincronización completa (sólo aparece si tuvo visitas o ' +
      'canceladas en el periodo). Null si no hay ficha.',
  })
  activo!: boolean | null;

  @ApiProperty({ type: Boolean, nullable: true })
  activoPos!: boolean | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Sólo con `contacto=true`.' })
  telefono?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Sólo con `contacto=true`.' })
  correo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Sólo con `contacto=true`.' })
  rfc?: string | null;
}

export class SucursalClientesDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({
    enum: ['sin-sincronizar', 'vacio', 'con-clientes'],
    description:
      '`sin-sincronizar`: nunca llegó una sincronización completa de clientes. `vacio`: la ' +
      'última llegó sin clientes activos (el POS no los usa, o el agente leyó cero).',
  })
  catalogo!: 'sin-sincronizar' | 'vacio' | 'con-clientes';

  @ApiProperty()
  clientesActivos!: number;

  @ApiProperty({ description: 'Cuentas NO canceladas del periodo, con y sin cliente.' })
  cuentas!: number;

  @ApiProperty({ description: 'De `cuentas`, las que traen cliente.' })
  cuentasConCliente!: number;
}

export class ResumenClientesDto {
  @ApiProperty({ description: 'false = ningún espejo con clientes y ninguna cuenta con cliente.' })
  usaClientes!: boolean;

  @ApiProperty({
    description:
      'true = el espejo pasó de 5000 clientes vigentes: faltan clientes SIN visitas en la lista. ' +
      'Los que tienen visitas siempre se ligan.',
  })
  catalogoTruncado!: boolean;

  @ApiProperty()
  cuentas!: number;

  @ApiProperty()
  cuentasConCliente!: number;

  @ApiProperty({ ...DINERO_TXT, description: 'Σ venta de las cuentas con cliente.' })
  ventaConCliente!: string;

  @ApiProperty({ type: [SucursalClientesDto], description: 'Por nombre.' })
  sucursales!: SucursalClientesDto[];

  @ApiProperty({
    type: [FilaResumenClienteDto],
    description: 'Visitas desc, venta desc, nombre (los sin ficha al final).',
  })
  filas!: FilaResumenClienteDto[];

  @ApiProperty({ description: 'Filas que pasan `q`, antes de paginar.' })
  total!: number;

  @ApiProperty()
  pagina!: number;

  @ApiProperty()
  porPagina!: number;
}

export class ClienteFichaDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty()
  origenSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  clave!: string | null;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Tal como lo guarda el POS.' })
  telefono!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Tal como lo guarda el POS.' })
  correo!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Tal como lo guarda el POS.' })
  rfc!: string | null;

  @ApiProperty()
  activo!: boolean;

  @ApiProperty({ type: Boolean, nullable: true })
  activoPos!: boolean | null;

  @ApiProperty({ format: 'date-time' })
  vistoAt!: string;
}

export class ProductoClienteDto {
  @ApiProperty()
  producto!: string;

  @ApiProperty({ example: '3.000', description: 'Σ cantidad en sus visitas (3 decimales).' })
  cantidad!: string;

  @ApiProperty({ ...DINERO_TXT, description: 'Σ importe de esas partidas.' })
  importe!: string;

  @ApiProperty({ description: 'Visitas en que lo pidió.' })
  cuentas!: number;
}

export class FichaClienteDto {
  @ApiProperty({ type: ClienteFichaDto })
  cliente!: ClienteFichaDto;

  @ApiProperty({ type: CifrasClienteDto, description: 'Del periodo, en SU sucursal.' })
  periodo!: CifrasClienteDto;

  @ApiProperty({
    type: [ProductoClienteDto],
    description: 'Hasta 10, por cantidad desc, importe desc, nombre (de sus visitas).',
  })
  productos!: ProductoClienteDto[];
}
