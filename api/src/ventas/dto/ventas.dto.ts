import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FormaPago } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { ISO_CON_ZONA } from '../../comun/fechas';
import { MAX_DIAS_RANGO } from '../../scope/consulta-ventas';
import {
  LIMITE_TOP_DEFAULT,
  LIMITE_TOP_MAX,
  type FormasPago,
  type OrdenTop,
  type ProductoTop,
  type Resumen,
  type VentaDia,
  type VentaHora,
  type VentaSucursal,
} from '../agregados-ventas.service';
import type {
  CeldaHoraDia,
  ProductoAnalisis,
  VentaHoraDia,
  VentaMesa,
  VentaMesero,
  VentaPorMesa,
  VentaPorProducto,
} from '../analisis.service';
import {
  CANCELADAS,
  DIRECCIONES,
  IMPORTE_FILTRO,
  ORDENES_TICKETS,
  type Canceladas,
  type Direccion,
  type OrdenTickets,
  type PagoTicket,
  type PaginaTickets,
  type PartidaTicket,
  type Ticket,
} from '../tickets.service';

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const DOC_DIA =
  'Día LOCAL de cada sucursal (`YYYY-MM-DD`), inclusivo. El corte de "hoy" se hace en la ' +
  `zona de la sucursal, no en la del servidor. Rango máximo: ${MAX_DIAS_RANGO} días.`;

const DOC_ALTURA =
  'Corte "a la misma altura" (F2-220), para comparar contra un periodo anterior hasta la ' +
  'misma hora. Un INSTANTE ISO-8601 con zona obligatoria (sin zona, 400). Sólo afecta al ' +
  'ÚLTIMO día del rango (`hasta`): de ese día entra únicamente lo ocurrido ANTES de la hora ' +
  'local que marca el instante en la zona de CADA sucursal (corte exclusivo: una cuenta ' +
  'cerrada justo a esa hora no entra). Los días anteriores van completos. Con sucursales en ' +
  'zonas distintas, cada una se corta en su propia hora local del mismo instante (sólo la ' +
  'hora, no la fecha: en la hora en que el día local de una sucursal no es el de quien pide, ' +
  'su corte no corresponde a "hoy"; supuesto provisional). Los ' +
  'cancelados se ubican por su cierre o, sin cierre, por su apertura. Si ese día la hora ' +
  'local no existe (el reloj se adelanta) se lee con el offset de ANTES del salto (02:30 que ' +
  'no existe = 03:30 del horario nuevo); si pasa dos veces (el reloj se atrasa), con el de ' +
  'DESPUÉS (la segunda vez). Lo resuelve Postgres y lo fija un e2e. Sin él, el último día va ' +
  'completo.';

/** El filtro común de /ventas/*. El servicio lo vuelve a validar (`validarFiltro`). */
export class FiltroVentasQueryDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Empresa a consultar. Fuera del alcance del usuario = 404.',
  })
  @IsUUID('all')
  empresaId!: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Acota a una sucursal de esa empresa. Sin él, todas. Una sucursal de otra empresa = 404.',
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

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    pattern: ISO_CON_ZONA.source,
    example: '2026-09-21T20:30:00.000Z',
    description: DOC_ALTURA,
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_CON_ZONA, { message: '$property debe ser ISO-8601 con zona (Z u offset ±hh:mm)' })
  @IsISO8601({ strict: true, strictSeparator: true })
  alturaAl?: string;
}

export class TopProductosQueryDto extends FiltroVentasQueryDto {
  @ApiPropertyOptional({ enum: ['importe', 'cantidad'], default: 'importe' })
  @IsOptional()
  @IsIn(['importe', 'cantidad'])
  por?: OrdenTop;

  @ApiPropertyOptional({ minimum: 1, maximum: LIMITE_TOP_MAX, default: LIMITE_TOP_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(LIMITE_TOP_MAX)
  limite?: number;
}

export const POR_PAGINA_DEFAULT = 50;
export const POR_PAGINA_MAX = 100;
/** Más allá de esto el OFFSET ya no es navegación, es un escaneo inútil. */
export const PAGINA_MAX = 10_000;
export const LARGO_MAX_FOLIO = 40;
export const LARGO_MAX_TEXTO_FILTRO = 80;

export class TicketsQueryDto extends FiltroVentasQueryDto {
  @ApiPropertyOptional({ minimum: 1, maximum: PAGINA_MAX, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(PAGINA_MAX)
  pagina?: number;

  @ApiPropertyOptional({ minimum: 1, maximum: POR_PAGINA_MAX, default: POR_PAGINA_DEFAULT })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(POR_PAGINA_MAX)
  porPagina?: number;

  @ApiPropertyOptional({
    maxLength: LARGO_MAX_FOLIO,
    description:
      'Búsqueda por PREFIJO del folio, literal (`%` y `_` no son comodines). Busca dentro del ' +
      'rango de fechas, no en todo el histórico.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(LARGO_MAX_FOLIO)
  folio?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    pattern: ISO_CON_ZONA.source,
    example: '2026-09-21T19:42:10.123Z',
    description:
      'Corte por RECEPCIÓN (F2-203): sólo cuentan los tickets que ya habían llegado a la base ' +
      'en ese instante; lo que llegue después no entra. Sin él, no se filtra por recepción. ' +
      'ISO-8601 con zona obligatoria (sin zona, 400). Para bajar un filtro completo por páginas, ' +
      'pide una primera sin él y manda en TODAS (la 1 incluida) el `corte` que devolvió: así un ' +
      'cheque que llega a media descarga no mueve el total. ' +
      'Un ticket ya recibido que cambia (se cancela, cambia de fecha) SÍ puede moverlo.',
  })
  @IsOptional()
  @IsString()
  @Matches(ISO_CON_ZONA, { message: '$property debe ser ISO-8601 con zona (Z u offset ±hh:mm)' })
  @IsISO8601({ strict: true, strictSeparator: true })
  corte?: string;

  // --- Filtros y orden de F2-222 ------------------------------------------------------------

  @ApiPropertyOptional({
    maxLength: LARGO_MAX_TEXTO_FILTRO,
    description:
      'Igualdad EXACTA con el mesero del cheque (sensible a mayúsculas; "Ana" no trae a "Ana ' +
      'María"). Las cuentas sin mesero no se pueden pedir con este filtro.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(LARGO_MAX_TEXTO_FILTRO)
  mesero?: string;

  @ApiPropertyOptional({
    maxLength: LARGO_MAX_FOLIO,
    description:
      'Igualdad EXACTA con la mesa del cheque. Las cuentas sin mesa no se pueden pedir con este filtro.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(LARGO_MAX_FOLIO)
  mesa?: string;

  @ApiPropertyOptional({
    enum: FormaPago,
    enumName: 'FormaPago',
    description:
      'El ticket tiene AL MENOS un pago de esa forma, derivada con el catálogo de la empresa (un ' +
      'texto sin catálogo cuenta como `otro`): el mismo criterio que `pagos[].forma`. Un ticket ' +
      'pagado con dos formas aparece con cualquiera de las dos.',
  })
  @IsOptional()
  @IsIn(Object.values(FormaPago))
  forma?: FormaPago;

  @ApiPropertyOptional({
    type: String,
    example: '100.00',
    pattern: IMPORTE_FILTRO.source,
    description: 'Total del ticket MAYOR O IGUAL a esto. Pesos en texto, hasta 2 decimales.',
  })
  @IsOptional()
  @IsString()
  @Matches(IMPORTE_FILTRO, { message: '$property debe ser un importe con hasta 2 decimales' })
  importeMin?: string;

  @ApiPropertyOptional({
    type: String,
    example: '500.00',
    pattern: IMPORTE_FILTRO.source,
    description:
      'Total del ticket MENOR O IGUAL a esto. Pesos en texto, hasta 2 decimales. Menor que ' +
      '`importeMin` = 400.',
  })
  @IsOptional()
  @IsString()
  @Matches(IMPORTE_FILTRO, { message: '$property debe ser un importe con hasta 2 decimales' })
  importeMax?: string;

  @ApiPropertyOptional({
    enum: CANCELADAS,
    default: 'incluir',
    description:
      '`incluir`: todos (los cancelados con su flag); `excluir`: sin cancelados; `solo`: sólo cancelados.',
  })
  @IsOptional()
  @IsIn(CANCELADAS)
  canceladas?: Canceladas;

  @ApiPropertyOptional({
    maxLength: LARGO_MAX_TEXTO_FILTRO,
    description:
      'El ticket tiene al menos una partida cuyo producto CONTIENE este texto, sin distinguir ' +
      'mayúsculas y literal (`%` y `_` no son comodines). NO ignora acentos: "jamon" no ' +
      'encuentra "Jamón". Incluye a los cancelados.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(LARGO_MAX_TEXTO_FILTRO)
  producto?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'F2-232: sólo las cuentas de ESE cliente (el `id` de `/catalogos/clientes`, nunca su nombre: ' +
      'ningún dato personal en la URL). El cliente es de UNA sucursal (espejo por sucursal): con ' +
      '`sucursalId` de otra sucursal el resultado es vacío. Un id que no existe o no es de la ' +
      'empresa pedida = 404.',
  })
  @IsOptional()
  @IsUUID('all')
  clienteId?: string;

  @ApiPropertyOptional({
    enum: ORDENES_TICKETS,
    default: 'momento',
    description:
      'Columna de orden. `momento` = cierre (o apertura de un cancelado sin cierre); `folio` ordena ' +
      'por largo y luego por texto ("999" antes de "1000"); `duracion` = cierre − apertura. Los ' +
      'textos se comparan byte a byte (collation `ucs_basic`). Los nulos van siempre al final.',
  })
  @IsOptional()
  @IsIn(ORDENES_TICKETS)
  orden?: OrdenTickets;

  @ApiPropertyOptional({ enum: DIRECCIONES, default: 'desc' })
  @IsOptional()
  @IsIn(DIRECCIONES)
  dir?: Direccion;
}

// ---------------------------------------------------------------------------
// Respuestas. Cada clase `implements` la interfaz del servicio: si una diverge,
// tsc truena.
// ---------------------------------------------------------------------------

const DINERO = { type: String, example: '1234.50', description: 'Pesos, 2 decimales, en texto.' };
const CANTIDAD = { type: String, example: '2.000', description: '3 decimales, en texto.' };

class DescuentosDto {
  @ApiProperty(DINERO)
  monto!: string;

  @ApiProperty({ description: 'Cuentas con descuento distinto de cero.' })
  cuentas!: number;
}

class ComensalesDto {
  @ApiProperty()
  total!: number;

  @ApiProperty({ description: 'Cuentas que traían comensales (SR puede no reportarlos).' })
  cuentasConDato!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Venta de las cuentas con comensales / comensales. Null sin comensales.',
  })
  promedioPorComensal!: string | null;
}

class CanceladosDto {
  @ApiProperty()
  cuentas!: number;
}

export class ResumenDto implements Resumen {
  @ApiProperty({ ...DINERO, description: 'Σ total de las cuentas no canceladas, sin recalcular.' })
  venta!: string;

  @ApiProperty({ description: 'Cuentas no canceladas cerradas en el rango.' })
  cuentas!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'venta / cuentas. Null sin cuentas: un promedio sin divisor es null.',
  })
  ticketPromedio!: string | null;

  @ApiProperty(DINERO)
  subtotal!: string;

  @ApiProperty(DINERO)
  impuestos!: string;

  @ApiProperty(DINERO)
  propina!: string;

  @ApiProperty({ type: DescuentosDto })
  descuentos!: DescuentosDto;

  @ApiProperty({
    type: String,
    nullable: true,
    enum: [null],
    description: 'Siempre null: el modelo aún no distingue una cortesía (esquema-sr.md §2).',
  })
  cortesias!: null;

  @ApiProperty({ type: ComensalesDto })
  comensales!: ComensalesDto;

  @ApiProperty({ type: CanceladosDto, description: 'Cancelados del rango; no suman a la venta.' })
  cancelados!: CanceladosDto;
}

export class VentaHoraDto implements VentaHora {
  @ApiProperty({ minimum: 0, maximum: 23, description: 'Hora local de cierre en la sucursal.' })
  hora!: number;

  @ApiProperty(DINERO)
  venta!: string;

  @ApiProperty()
  cuentas!: number;
}

export class VentaDiaDto implements VentaDia {
  @ApiProperty({
    example: '2026-09-01',
    description:
      'Día LOCAL de cierre (`YYYY-MM-DD`). Con varias sucursales en zonas distintas, cada ' +
      'cuenta cae en el día de SU zona: el 1 de septiembre de CDMX y el de Tijuana van en la ' +
      'misma fila, igual que en `/ventas/resumen`.',
  })
  dia!: string;

  @ApiProperty(DINERO)
  venta!: string;

  @ApiProperty()
  cuentas!: number;
}

export class VentaSucursalDto implements VentaSucursal {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ ...DINERO, description: 'Σ total de las cuentas no canceladas de la sucursal.' })
  venta!: string;

  @ApiProperty({ description: 'Cuentas no canceladas cerradas en el rango.' })
  cuentas!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'venta / cuentas. Null si la sucursal no tuvo cuentas en el rango.',
  })
  ticketPromedio!: string | null;

  @ApiProperty({ description: 'Σ comensales (las cuentas sin el dato cuentan 0).' })
  comensales!: number;
}

class MontoFormaDto {
  @ApiProperty({ enum: FormaPago, enumName: 'FormaPago' })
  forma!: FormaPago;

  @ApiProperty(DINERO)
  monto!: string;
}

class SinCatalogoDto {
  @ApiProperty({ description: 'Texto de la forma de pago tal como viene de SR.' })
  formaRaw!: string;

  @ApiProperty(DINERO)
  monto!: string;
}

export class FormasPagoDto implements FormasPago {
  @ApiProperty({
    type: [MontoFormaDto],
    description: 'Las cuatro formas del ENUM, siempre y en este orden. Incluye `otro`.',
  })
  formas!: MontoFormaDto[];

  @ApiProperty({
    type: [SinCatalogoDto],
    description: 'Formas de SR sin entrada en el catálogo de la empresa (ya sumadas en `otro`).',
  })
  sinCatalogo!: SinCatalogoDto[];
}

export class ProductoTopDto implements ProductoTop {
  @ApiProperty({ description: 'Nombre del producto (se agrupa por nombre).' })
  producto!: string;

  @ApiProperty({
    ...DINERO,
    description: 'Σ total de las partidas, ANTES del descuento del cheque: no cuadra con la venta.',
  })
  importe!: string;

  @ApiProperty(CANTIDAD)
  cantidad!: string;
}

class ModificadorDto {
  @ApiProperty()
  nombre!: string;

  @ApiProperty({ ...DINERO, description: 'Incluidos los de $0.00.' })
  precio!: string;
}

export class PartidaTicketDto implements PartidaTicket {
  @ApiProperty()
  producto!: string;

  @ApiProperty({ type: String, nullable: true })
  categoria!: string | null;

  @ApiProperty(CANTIDAD)
  cantidad!: string;

  @ApiProperty(DINERO)
  precioUnit!: string;

  @ApiProperty(DINERO)
  total!: string;

  @ApiProperty({
    type: [ModificadorDto],
    description: 'Tal como los guardó la ingesta (esquema-sr.md §13: `{ nombre, precio }`).',
  })
  modificadores!: unknown[];
}

export class PagoTicketDto implements PagoTicket {
  @ApiProperty({ description: 'Texto de SR.' })
  formaRaw!: string;

  @ApiProperty({
    enum: FormaPago,
    enumName: 'FormaPago',
    description: 'Derivada AL LEER con el catálogo de la empresa; sin entrada = `otro`.',
  })
  forma!: FormaPago;

  @ApiProperty(DINERO)
  monto!: string;
}

export class TicketDto implements Ticket {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  folio!: string;

  @ApiProperty({ type: String, nullable: true })
  mesa!: string | null;

  @ApiProperty({ type: String, nullable: true })
  mesero!: string | null;

  @ApiProperty({ type: Number, nullable: true, description: 'Null = SR no lo reportó.' })
  comensales!: number | null;

  @ApiProperty({ format: 'date-time', description: 'UTC.' })
  abiertoAt!: string;

  @ApiProperty({ type: String, format: 'date-time', nullable: true, description: 'UTC.' })
  cerradoAt!: string | null;

  @ApiProperty({
    description:
      'Los cancelados se listan (con este flag) pero NO suman a la venta: no los sumes en un ' +
      'total ni en un export.',
  })
  cancelado!: boolean;

  @ApiProperty(DINERO)
  subtotal!: string;

  @ApiProperty(DINERO)
  impuestos!: string;

  @ApiProperty(DINERO)
  descuentos!: string;

  @ApiProperty(DINERO)
  propina!: string;

  @ApiProperty(DINERO)
  total!: string;

  @ApiProperty({ type: [PartidaTicketDto], description: 'En el orden del POS.' })
  partidas!: PartidaTicketDto[];

  @ApiProperty({ type: [PagoTicketDto] })
  pagos!: PagoTicketDto[];
}

export class PaginaTicketsDto implements PaginaTickets {
  @ApiProperty({
    type: [TicketDto],
    description:
      'Del más reciente al más viejo (por cierre; los cancelados sin cierre, por apertura). ' +
      'Vacío si la página pasa del final.',
  })
  items!: TicketDto[];

  @ApiProperty({ description: 'Tickets del filtro completo, no de esta página.' })
  total!: number;

  @ApiProperty()
  pagina!: number;

  @ApiProperty()
  porPagina!: number;

  @ApiProperty({
    format: 'date-time',
    example: '2026-09-21T19:41:40.123Z',
    description:
      'Con `corte` pedido, ese mismo (y la página quedó filtrada por él). Sin él, uno SUGERIDO: ' +
      '"ahora − 30 s" del reloj de la base; esta página no se filtró. Mándalo tal cual en todas ' +
      'las páginas de una descarga.',
  })
  corte!: string;
}

// ---------------------------------------------------------------------------
// Análisis (F2-221)
// ---------------------------------------------------------------------------

class CanceladosMeseroDto {
  @ApiProperty({ description: 'Cuentas canceladas del rango. No suman a ninguna venta.' })
  cuentas!: number;

  @ApiProperty({
    ...DINERO,
    description:
      'Σ total de esas cuentas tal como llegó del POS (supuesto: SR conserva el importe ' +
      'original de un cancelado).',
  })
  monto!: string;
}

export class VentaMeseroDto implements VentaMesero {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Texto del POS. Null = la cuenta no trae mesero. Se agrupa por (sucursal, texto): el ' +
      'mismo nombre en dos sucursales son dos filas.',
  })
  mesero!: string | null;

  @ApiProperty({ ...DINERO, description: 'Σ total de sus cuentas no canceladas.' })
  venta!: string;

  @ApiProperty({ description: 'Cuentas no canceladas cerradas en el rango.' })
  cuentas!: number;

  @ApiProperty({ type: String, nullable: true, description: 'venta / cuentas; null sin cuentas.' })
  ticketPromedio!: string | null;

  @ApiProperty({ description: 'Σ comensales (las cuentas sin el dato cuentan 0).' })
  comensales!: number;

  @ApiProperty({ description: 'Cuentas que sí traían comensales.' })
  cuentasConComensales!: number;

  @ApiProperty(DINERO)
  propina!: string;

  @ApiProperty({ type: DescuentosDto })
  descuentos!: DescuentosDto;

  @ApiProperty({ type: CanceladosMeseroDto })
  cancelados!: CanceladosMeseroDto;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '52.5',
    description:
      'F2-231: minutos promedio de sus cuentas (cierre − apertura), 1 decimal. Una duración ' +
      'negativa no entra. Null sin duraciones válidas.',
  })
  minutosPromedio!: string | null;

  @ApiProperty({ description: 'F2-231: cuentas que entran a `minutosPromedio`.' })
  cuentasConDuracion!: number;
}

class ProductoAnalisisDto implements ProductoAnalisis {
  @ApiProperty()
  producto!: string;

  @ApiProperty({ ...DINERO, description: 'Σ partidas.total (antes del descuento de la cuenta).' })
  importe!: string;

  @ApiProperty(CANTIDAD)
  cantidad!: string;
}

export class VentaPorProductoDto implements VentaPorProducto {
  @ApiProperty({ ...DINERO, description: 'Σ total de las cuentas: la venta de /ventas/resumen.' })
  venta!: string;

  @ApiProperty()
  cuentas!: number;

  @ApiProperty({
    type: [ProductoAnalisisDto],
    description: 'TODOS los productos vendidos, por importe desc y nombre (sin límite).',
  })
  productos!: ProductoAnalisisDto[];

  @ApiProperty({
    ...DINERO,
    description:
      'venta − Σ importe: lo que el total de las cuentas no reparte entre sus partidas ' +
      '(descuentos, impuestos si las partidas no los traen, y otros ajustes). Σ importe + ' +
      'diferenciaCuentas = venta, exacto. Supuesto provisional: no se prorratea.',
  })
  diferenciaCuentas!: string;
}

class CeldaHoraDiaDto implements CeldaHoraDia {
  @ApiProperty({ minimum: 1, maximum: 7, description: 'ISO: 1 = lunes … 7 = domingo (local).' })
  diaSemana!: number;

  @ApiProperty({ minimum: 0, maximum: 23, description: 'Hora LOCAL de cierre.' })
  hora!: number;

  @ApiProperty(DINERO)
  venta!: string;

  @ApiProperty({
    description: '0 = sin ventas en esa celda (distinto de venta "0.00" con cuentas).',
  })
  cuentas!: number;
}

class DiasEnRangoDto {
  @ApiProperty({ minimum: 1, maximum: 7 })
  diaSemana!: number;

  @ApiProperty({ description: 'Veces que ese día de la semana cae en desde..hasta (0 = no está).' })
  dias!: number;
}

export class VentaHoraDiaDto implements VentaHoraDia {
  @ApiProperty({
    type: [CeldaHoraDiaDto],
    description: 'Siempre 168 celdas, lunes..domingo × 0..23. Σ = /ventas/resumen.',
  })
  celdas!: CeldaHoraDiaDto[];

  @ApiProperty({ type: [DiasEnRangoDto], description: 'Siempre 7 filas, lunes..domingo.' })
  diasEnRango!: DiasEnRangoDto[];
}

class VentaMesaDto implements VentaMesa {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({ description: 'Texto del POS. Se agrupa por (sucursal, mesa).' })
  mesa!: string;

  @ApiProperty()
  cuentas!: number;

  @ApiProperty(DINERO)
  venta!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '52.5',
    description: 'Minutos promedio (cierre − apertura), 1 decimal; null sin duraciones válidas.',
  })
  minutosPromedio!: string | null;

  @ApiProperty()
  cuentasConDuracion!: number;
}

class SinMesaDto {
  @ApiProperty()
  cuentas!: number;

  @ApiProperty(DINERO)
  venta!: string;
}

class GlobalMesasDto {
  @ApiProperty({ ...DINERO, description: 'Σ venta de las filas + sinMesa = /ventas/resumen.' })
  venta!: string;

  @ApiProperty()
  cuentas!: number;

  @ApiProperty({ type: String, nullable: true, example: '48.3' })
  minutosPromedio!: string | null;

  @ApiProperty()
  cuentasConDuracion!: number;

  @ApiProperty({ description: 'Cuentas con cierre antes que la apertura: fuera del promedio.' })
  duracionesInvalidas!: number;

  @ApiProperty({ description: 'Mesas distintas (sucursal, mesa) con al menos una cuenta.' })
  mesas!: number;

  @ApiProperty()
  cuentasConMesa!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '3.25',
    description: 'Rotación: cuentasConMesa / mesas, 2 decimales; null sin mesas.',
  })
  rotacion!: string | null;
}

export class VentaPorMesaDto implements VentaPorMesa {
  @ApiProperty({ type: [VentaMesaDto] })
  filas!: VentaMesaDto[];

  @ApiProperty({ type: SinMesaDto, description: 'Cuentas sin mesa: no entran a la rotación.' })
  sinMesa!: SinMesaDto;

  @ApiProperty({ type: GlobalMesasDto })
  global!: GlobalMesasDto;
}
