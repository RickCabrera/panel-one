import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, Length, Matches } from 'class-validator';

/**
 * Contratos del panel de finanzas (F2-126): compras leídas de SR, gastos capturados en el panel y
 * el estado de resultados simple. Dinero siempre en TEXTO con 2 decimales (Decimal en el código),
 * porcentajes con 1. Todo lo de SR está en docs/esquema-sr.md §10 "Compras, gastos y utilidad".
 */

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const DOC_DIA =
  'Día `YYYY-MM-DD` en la zona de CADA sucursal: [desde 00:00, hasta+1 00:00) locales. Máximo 366 días.';
/** Monto capturado: hasta 10 enteros y 2 decimales, sin signo (> 0 lo verifica el servicio). */
export const MONTO = /^\d{1,10}(\.\d{1,2})?$/;

export const MOTIVOS_SIN_CALCULO = ['sin_catalogo_productos', 'sin_recetas'] as const;

// ---------------------------------------------------------------------------
// consultas
// ---------------------------------------------------------------------------

export class AlcanceQueryDto {
  @ApiProperty({ format: 'uuid', description: 'Fuera del alcance del usuario = 404.' })
  @IsUUID('all')
  empresaId!: string;
}

export class RangoQueryDto extends AlcanceQueryDto {
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

  @ApiProperty({ example: '2026-09-30', description: DOC_DIA })
  @Matches(DIA, { message: 'hasta debe ser YYYY-MM-DD' })
  hasta!: string;
}

export class ComprasQueryDto extends RangoQueryDto {
  @ApiPropertyOptional({
    maxLength: 64,
    description: 'El `origenSrId` de un proveedor. Exige `sucursalId` (si no, 400).',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  proveedorOrigenSrId?: string;
}

export class GastosQueryDto extends RangoQueryDto {
  @ApiPropertyOptional({ format: 'uuid', description: 'Sólo los de esa categoría de la empresa.' })
  @IsOptional()
  @IsUUID('all')
  categoriaId?: string;

  @ApiPropertyOptional({
    description: 'true = incluye los anulados (marcados). Por defecto, no.',
    default: false,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  incluirAnulados?: boolean;
}

// ---------------------------------------------------------------------------
// GET /finanzas/compras
// ---------------------------------------------------------------------------

export class SucursalComprasDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({
    description:
      'Compras que el agente ha mandado de esta sucursal, en total (cualquier fecha). 0 = el ' +
      'lector (F2-241) nunca mandó compras: un periodo vacío no significa "no se compró".',
  })
  comprasRecibidas!: number;
}

export class ProveedorComprasDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Nulo = la compra no trae proveedor.' })
  proveedorOrigenSrId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nombre del espejo `proveedores_catalogo`; nulo = sin catálogo o sin proveedor.',
  })
  proveedor!: string | null;

  @ApiProperty({ description: 'Compras NO canceladas del periodo.' })
  compras!: number;

  @ApiProperty({ example: '1250.00', description: 'Σ total de esas compras, sin IVA.' })
  total!: string;
}

export class CompraResumenDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  folio!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'Instante UTC; se muestra en la zona de la sucursal.',
  })
  fecha!: string;

  @ApiProperty({ type: String, nullable: true })
  proveedorOrigenSrId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nulo = sin catálogo o sin proveedor.',
  })
  proveedor!: string | null;

  @ApiProperty({ type: String, nullable: true })
  almacenOrigenSrId!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Nulo = sin catálogo o sin almacén.' })
  almacen!: string | null;

  @ApiProperty({ example: '1250.00', description: 'Σ importes de sus partidas, sin IVA.' })
  total!: string;

  @ApiProperty()
  partidas!: number;

  @ApiProperty({ description: 'Cancelada en SR: se muestra marcada y NO suma.' })
  cancelada!: boolean;
}

export class ComprasDto {
  @ApiProperty({ type: [SucursalComprasDto] })
  sucursales!: SucursalComprasDto[];

  @ApiProperty({ type: [ProveedorComprasDto], description: 'Total desc.' })
  porProveedor!: ProveedorComprasDto[];

  @ApiProperty({
    type: [CompraResumenDto],
    description: 'Las compras del periodo (canceladas incluidas, marcadas), más recientes primero.',
  })
  compras!: CompraResumenDto[];

  @ApiProperty({ description: 'Compras del periodo antes del tope (canceladas incluidas).' })
  totalCompras!: number;

  @ApiProperty({
    description: 'true = hubo más de 2000 compras: la lista (y su CSV) va recortada.',
  })
  truncado!: boolean;

  @ApiProperty({ example: '48000.00', description: 'Σ total de las NO canceladas del periodo.' })
  total!: string;
}

export class PartidaCompraVistaDto {
  @ApiProperty()
  renglon!: number;

  @ApiProperty()
  insumoOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Nulo = sin catálogo.' })
  insumo!: string | null;

  @ApiProperty({ type: String, nullable: true })
  unidad!: string | null;

  @ApiProperty({ example: '12.500' })
  cantidad!: string;

  @ApiProperty({ example: '85.40', description: 'Sin IVA.' })
  costoUnitario!: string;

  @ApiProperty({ example: '1067.50' })
  importe!: string;
}

export class CompraDetalleDto extends CompraResumenDto {
  @ApiProperty()
  sucursal!: string;

  @ApiProperty({ type: [PartidaCompraVistaDto] })
  detalle!: PartidaCompraVistaDto[];
}

// ---------------------------------------------------------------------------
// categorías y gastos
// ---------------------------------------------------------------------------

export class CategoriaGastoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ description: 'Inactiva = no admite gastos nuevos; los viejos se siguen viendo.' })
  activa!: boolean;
}

export class CategoriasGastoDto {
  @ApiProperty({ type: [CategoriaGastoDto], description: 'Por nombre.' })
  categorias!: CategoriaGastoDto[];
}

export class CrearCategoriaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({
    minLength: 1,
    maxLength: 60,
    description: 'Único en la empresa sin distinguir mayúsculas.',
  })
  @IsString()
  @Matches(/\S/, { message: 'nombre no puede ir vacío' })
  @Length(1, 60)
  nombre!: string;
}

export class CambiarCategoriaDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  empresaId!: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 60 })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'nombre no puede ir vacío' })
  @Length(1, 60)
  nombre?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  activa?: boolean;
}

export class CrearGastoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({ format: 'uuid', description: 'De otra empresa = 404.' })
  @IsUUID('all')
  sucursalId!: string;

  @ApiProperty({ format: 'uuid', description: 'De otra empresa = 404; inactiva = 400.' })
  @IsUUID('all')
  categoriaId!: string;

  @ApiProperty({
    example: '2026-09-10',
    description:
      'Día CONTABLE `YYYY-MM-DD` de la sucursal (no un instante). Posterior a hoy en la zona de la ' +
      'sucursal = 400.',
  })
  @Matches(DIA, { message: 'dia debe ser YYYY-MM-DD' })
  dia!: string;

  @ApiProperty({ minLength: 1, maxLength: 200 })
  @IsString()
  @Matches(/\S/, { message: 'concepto no puede ir vacío' })
  @Length(1, 200)
  concepto!: string;

  @ApiProperty({
    pattern: MONTO.source,
    example: '8500.00',
    description: 'Monto SIN IVA acreditable, > 0, texto con hasta 2 decimales.',
  })
  @IsString()
  @Matches(MONTO, { message: 'monto debe ser un importe positivo con hasta 2 decimales' })
  monto!: string;
}

export class EditarGastoDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  empresaId!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID('all')
  categoriaId?: string;

  @ApiPropertyOptional({ example: '2026-09-10' })
  @IsOptional()
  @Matches(DIA, { message: 'dia debe ser YYYY-MM-DD' })
  dia?: string;

  @ApiPropertyOptional({ minLength: 1, maxLength: 200 })
  @IsOptional()
  @IsString()
  @Matches(/\S/, { message: 'concepto no puede ir vacío' })
  @Length(1, 200)
  concepto?: string;

  @ApiPropertyOptional({ pattern: MONTO.source })
  @IsOptional()
  @IsString()
  @Matches(MONTO, { message: 'monto debe ser un importe positivo con hasta 2 decimales' })
  monto?: string;
}

export class GastoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty({ example: '2026-09-10', description: 'Día contable local de la sucursal.' })
  dia!: string;

  @ApiProperty({ format: 'uuid' })
  categoriaId!: string;

  @ApiProperty()
  categoria!: string;

  @ApiProperty()
  concepto!: string;

  @ApiProperty({ example: '8500.00', description: 'Sin IVA acreditable.' })
  monto!: string;

  @ApiProperty({ description: 'Anulado: se muestra marcado y NO suma.' })
  anulado!: boolean;
}

export class GastoCategoriaTotalDto {
  @ApiProperty({ format: 'uuid' })
  categoriaId!: string;

  @ApiProperty()
  categoria!: string;

  @ApiProperty({ example: '45000.00' })
  monto!: string;
}

export class GastosDto {
  @ApiProperty({ type: [GastoDto], description: 'Por día desc. Tope 2000 (ver `truncado`).' })
  gastos!: GastoDto[];

  @ApiProperty({ description: 'true = hubo más de 2000: la lista va recortada (los totales no).' })
  truncado!: boolean;

  @ApiProperty({ example: '120000.00', description: 'Σ de los NO anulados del periodo.' })
  total!: string;

  @ApiProperty({ type: [GastoCategoriaTotalDto], description: 'Monto desc. Sin anulados.' })
  porCategoria!: GastoCategoriaTotalDto[];
}

export class GastoCreadoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;
}

// ---------------------------------------------------------------------------
// GET /finanzas/estado-resultados
// ---------------------------------------------------------------------------

export class CostoVendidoDto {
  @ApiProperty({
    type: String,
    nullable: true,
    example: '31000.00',
    description:
      'Costo de lo vendido = importe del consumo TEÓRICO (F2-125), sin IVA. Nulo = no se pudo ' +
      'calcular (ver `motivo` / `sucursalesSinCalculo`), nunca un 0 inventado.',
  })
  importe!: string | null;

  @ApiProperty({
    description:
      'false = falta costo de algo: insumos con teórico sin costo, o productos vendidos que no se ' +
      'pudieron explotar. La utilidad sale SOBRESTIMADA.',
  })
  completo!: boolean;

  @ApiProperty({ description: 'Insumos con consumo teórico y sin costo de referencia.' })
  insumosSinCosto!: number;

  @ApiProperty({ description: 'Productos vendidos sin receta, sin catálogo o con nombre ambiguo.' })
  productosSinCosto!: number;

  @ApiProperty({
    example: '1800.00',
    description:
      'Importe de las PARTIDAS de esos productos: CON IVA y ANTES del descuento de la cuenta. Sólo ' +
      'indica cuánto de lo vendido quedó sin costo; no se resta ni se compara con la venta neta.',
  })
  ventaSinCosto!: string;
}

export class EstadoResultadosBaseDto {
  @ApiProperty({ description: 'Cuentas no canceladas cerradas en el periodo.' })
  cuentas!: number;

  @ApiProperty({
    example: '116000.00',
    description: 'Σ `cheques.total` (con IVA): la misma venta de Inicio y Comparativos.',
  })
  venta!: string;

  @ApiProperty({
    example: '100000.00',
    description:
      'Σ `cheques.subtotal`: venta SIN IVA. SUPUESTO no validado: neto de descuento y sin propina ' +
      '(esquema-sr §2).',
  })
  ventaNeta!: string;

  @ApiProperty({ type: CostoVendidoDto })
  costo!: CostoVendidoDto;

  @ApiProperty({ example: '40000.00', description: 'Σ gastos NO anulados con día en el periodo.' })
  gastos!: string;

  @ApiProperty({
    example: '35000.00',
    description:
      'Σ compras NO canceladas del periodo. INFORMATIVO: no entra a la utilidad (el costo ya es el ' +
      'consumo).',
  })
  compras!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '69000.00',
    description: 'Venta neta − costo.',
  })
  utilidadBruta!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '29000.00',
    description: 'Utilidad bruta − gastos.',
  })
  utilidadOperacion!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '69.0',
    description: '% sobre la venta neta.',
  })
  margenBruto!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '29.0',
    description: '% sobre la venta neta.',
  })
  margenOperacion!: string | null;

  @ApiProperty({
    description:
      'true = el costo está incompleto: la utilidad real es MENOR o igual a la mostrada.',
  })
  utilidadSobrestimada!: boolean;

  @ApiProperty({
    description:
      'true = sin cuentas en el periodo: la utilidad de operación es −gastos. Si la sucursal no ' +
      'reportó, esa cifra no es real.',
  })
  sinVentas!: boolean;
}

export class EstadoResultadosSucursalDto extends EstadoResultadosBaseDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({
    enum: MOTIVOS_SIN_CALCULO,
    nullable: true,
    description: 'Por qué el costo es nulo con ventas: sin catálogo de productos o sin recetas.',
  })
  motivo!: (typeof MOTIVOS_SIN_CALCULO)[number] | null;
}

export class EstadoResultadosTotalDto extends EstadoResultadosBaseDto {
  @ApiProperty({
    type: [String],
    description: 'Sucursales con ventas y sin costo calculable: por ellas el total es nulo.',
  })
  sucursalesSinCalculo!: string[];
}

export class EstadoResultadosDto {
  @ApiProperty({ type: [EstadoResultadosSucursalDto] })
  sucursales!: EstadoResultadosSucursalDto[];

  @ApiProperty({ type: EstadoResultadosTotalDto })
  total!: EstadoResultadosTotalDto;

  @ApiProperty({ type: [GastoCategoriaTotalDto], description: 'Gastos del periodo por categoría.' })
  gastosPorCategoria!: GastoCategoriaTotalDto[];
}
