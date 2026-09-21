import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { FormaPago } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { MAX_DIAS_RANGO } from '../../scope/consulta-ventas';
import {
  LIMITE_TOP_DEFAULT,
  LIMITE_TOP_MAX,
  type FormasPago,
  type OrdenTop,
  type ProductoTop,
  type Resumen,
  type VentaHora,
} from '../agregados-ventas.service';
import type { PagoTicket, PaginaTickets, PartidaTicket, Ticket } from '../tickets.service';

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const DOC_DIA =
  'Día LOCAL de cada sucursal (`YYYY-MM-DD`), inclusivo. El corte de "hoy" se hace en la ' +
  `zona de la sucursal, no en la del servidor. Rango máximo: ${MAX_DIAS_RANGO} días.`;

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
}
