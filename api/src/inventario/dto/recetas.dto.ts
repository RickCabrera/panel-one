import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID, Matches } from 'class-validator';

const DIA = /^\d{4}-\d{2}-\d{2}$/;
const DOC_DIA =
  'Día `YYYY-MM-DD` en la zona de CADA sucursal: [desde 00:00, hasta+1 00:00) locales. Máximo 366 días.';

export const MOTIVOS_APARTE = ['sin_receta', 'sin_catalogo', 'ambiguo'] as const;

// ---------------------------------------------------------------------------
// consultas
// ---------------------------------------------------------------------------

export class RecetasQueryDto {
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
}

export class ConsumoTeoricoQueryDto extends RecetasQueryDto {
  @ApiProperty({ example: '2026-09-01', description: DOC_DIA })
  @Matches(DIA, { message: 'desde debe ser YYYY-MM-DD' })
  desde!: string;

  @ApiProperty({ example: '2026-09-20', description: DOC_DIA })
  @Matches(DIA, { message: 'hasta debe ser YYYY-MM-DD' })
  hasta!: string;
}

// ---------------------------------------------------------------------------
// GET /inventario/recetas
// ---------------------------------------------------------------------------

export class SucursalRecetasDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({
    description:
      'Recetas que el agente ha mandado de esta sucursal (con o sin renglones). 0 = el lector ' +
      '(F2-241) nunca mandó recetas: no hay teórico.',
  })
  recetasRecibidas!: number;

  @ApiProperty({
    description:
      'false = el catálogo de productos de esta sucursal nunca cerró una sincronización completa: ' +
      'lo vendido no se puede cruzar con recetas (no se reporta todo como "sin catálogo").',
  })
  catalogoProductos!: boolean;
}

export class RenglonRecetaVistaDto {
  @ApiProperty()
  insumoOrigenSrId!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Nombre del insumo en el espejo de SU sucursal; nulo si no está (p. ej. un elaborado).',
  })
  insumo!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Nombre de la unidad del insumo.' })
  unidad!: string | null;

  @ApiProperty({
    example: '0.1500',
    description: 'Por UNA unidad vendida, en la unidad del insumo.',
  })
  cantidad!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '85.40',
    description:
      'Costo por unidad del insumo en la sucursal, sin IVA: promedio ponderado de la última foto ' +
      'de existencias (almacenes con cantidad > 0). Nulo = sin existencia leída.',
  })
  costo!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'round(cantidad × costo, 2); nulo sin costo.',
  })
  importe!: string | null;
}

export class ProductoRecetaDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  productoOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true })
  clave!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Nulo = hay receta pero el producto no está en el espejo de productos.',
  })
  nombre!: string | null;

  @ApiProperty({
    description:
      'true = el producto está en el espejo, vigente (lo vio la última sincronización y el POS no ' +
      'lo reporta de baja). false = de baja, o no está en el espejo.',
  })
  vigente!: boolean;

  @ApiProperty({ description: 'false = receta de un producto que el espejo no tiene.' })
  enCatalogo!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Precio de venta en esa sucursal tal como lo reporta el POS (puede traer IVA, §6).',
  })
  precio!: string | null;

  @ApiProperty({
    description:
      'false = sin receta: SR no la mandó, o la mandó vacía. Un producto sin receta no truena el ' +
      'consumo teórico: sale aparte.',
  })
  conReceta!: boolean;

  @ApiProperty({ type: [RenglonRecetaVistaDto], description: 'Ordenados por insumo y cantidad.' })
  renglones!: RenglonRecetaVistaDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Σ importes de los renglones con costo (sin IVA). Nulo sin receta.',
  })
  costo!: string | null;

  @ApiProperty({ description: 'true = algún renglón no tiene costo: `costo` se queda corto.' })
  costoIncompleto!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'costo / precio × 100 a 1 decimal. OJO: costo SIN IVA contra un precio que puede traerlo. ' +
      'Nulo sin receta, sin precio o con costo incompleto.',
  })
  porcentajePrecio!: string | null;
}

export class RecetasDto {
  @ApiProperty({ type: [SucursalRecetasDto] })
  sucursales!: SucursalRecetasDto[];

  @ApiProperty({
    type: [ProductoRecetaDto],
    description:
      'Todos los productos del espejo (vigentes y de baja, con la marca `vigente`) con su receta o ' +
      'sin ella, más las recetas de productos que el espejo no tiene. Orden: sucursal, con receta ' +
      'primero, nombre.',
  })
  productos!: ProductoRecetaDto[];

  @ApiProperty({ description: 'Filas totales antes del tope.' })
  total!: number;

  @ApiProperty({ description: 'true = se cortó en el tope (5000).' })
  truncado!: boolean;
}

// ---------------------------------------------------------------------------
// GET /inventario/consumo-teorico
// ---------------------------------------------------------------------------

export class SucursalConsumoDto extends SucursalRecetasDto {
  @ApiProperty({
    description: 'Pólizas de inventario recibidas alguna vez. 0 = no hay real (nulo).',
  })
  polizasRecibidas!: number;

  @ApiProperty({
    description:
      'true = hay catálogo de productos y recetas: lo vendido se explotó. false = no se calculó ' +
      'nada de esta sucursal (ver `catalogoProductos` y `recetasRecibidas`).',
  })
  calculada!: boolean;

  @ApiProperty({ description: 'Productos vendidos en el periodo que se explotaron con su receta.' })
  productosExplotados!: number;
}

export class FilaConsumoDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  insumoOrigenSrId!: string;

  @ApiProperty({ type: String, nullable: true, description: 'Nulo = no está en el espejo.' })
  insumo!: string | null;

  @ApiProperty({ type: String, nullable: true })
  unidad!: string | null;

  @ApiProperty({
    example: '12.345',
    description: 'Σ vendido × receta, a 3 decimales (mitad lejos de cero).',
  })
  teorico!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'consumo + merma + ajuste (salidas en positivo). Nulo = la sucursal nunca mandó pólizas.',
  })
  real!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Salidas por pólizas de consumo.' })
  consumo!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'Salidas por pólizas de merma.' })
  merma!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Salidas por ajustes; negativo = el ajuste fue a favor (resta al real).',
  })
  ajuste!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'real − teórico. Positivo = salió más de lo que explican las ventas (faltante).',
  })
  variacion!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'variación / teórico × 100 a 1 decimal. Nulo con teórico 0 o sin real.',
  })
  porcentaje!: string | null;

  @ApiProperty({
    description:
      'Teórico 0 con salidas reales: ningún producto vendido lo explica (p. ej. desechables).',
  })
  sinTeorico!: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Costo por unidad (sin IVA): el de las salidas del periodo; si no hubo, el de la última foto ' +
      'de existencias; nulo si ninguno.',
  })
  costo!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'round(teórico × costo, 2).' })
  importeTeorico!: string | null;

  @ApiProperty({ type: String, nullable: true, description: 'round(variación × costo, 2).' })
  importeVariacion!: string | null;
}

export class VendidoAparteDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  sucursal!: string;

  @ApiProperty({ description: 'Texto vendido (la escritura de más importe si hubo varias).' })
  producto!: string;

  @ApiProperty({
    enum: MOTIVOS_APARTE,
    description:
      '`sin_receta` = el producto no tiene receta (o vacía); `sin_catalogo` = el nombre vendido no ' +
      'está en el espejo de productos; `ambiguo` = varios productos de la sucursal se llaman igual.',
  })
  motivo!: (typeof MOTIVOS_APARTE)[number];

  @ApiProperty({ type: String, nullable: true })
  productoOrigenSrId!: string | null;

  @ApiProperty()
  partidas!: number;

  @ApiProperty({ example: '12.000' })
  cantidad!: string;

  @ApiProperty({ example: '1250.00', description: 'Σ partidas.total (antes del descuento).' })
  importe!: string;
}

export class ConsumoTeoricoDto {
  @ApiProperty({ type: [SucursalConsumoDto] })
  sucursales!: SucursalConsumoDto[];

  @ApiProperty({
    type: [FilaConsumoDto],
    description:
      'Una fila por (sucursal, insumo) con teórico o salidas en el periodo, en orden de ranking: ' +
      'importe de variación desc (sin importe al final), |%| desc.',
  })
  filas!: FilaConsumoDto[];

  @ApiProperty({
    type: [VendidoAparteDto],
    description: 'Lo vendido que no se pudo explotar. No detiene el cálculo del resto.',
  })
  aparte!: VendidoAparteDto[];
}
