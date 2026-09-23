import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

import { CANTIDAD, DINERO, ISO_CON_ZONA } from '../normalizar';

/**
 * Contrato de la ingesta de compras (F2-126): `POST /ingesta/compras`, un LOTE de documentos de
 * compra a proveedor de la sucursal de la API key, cada uno con TODAS sus partidas.
 *
 * Mismas reglas que las pólizas de F2-122: el ValidationPipe global valida SÓLO el sobre (todo o
 * nada: un sobre inválido = 400 sin escribir); cada compra se valida aparte en el servicio (una
 * inválida se rechaza sola, y una partida inválida rechaza SU compra entera). Nada lleva
 * `sucursalId` ni `empresaId`: el tenant sale de la API key.
 *
 * Nada de esto se ha visto en una instalación real de SoftRestaurant (docs/esquema-sr.md §10
 * "Compras, gastos y utilidad": supuestos, no hallazgos).
 */

/**
 * DECISION PROVISIONAL (nocturno): topes de UN lote, los de F2-122. 200 compras y 5000 partidas
 * EN TOTAL. El lector (F2-241) parte los lotes por partidas, no sólo por compras.
 */
export const MAX_COMPRAS_LOTE = 200;
export const MAX_PARTIDAS_COMPRAS_LOTE = 5000;

const MENSAJE_FECHA = '$property debe ser ISO-8601 con zona (Z u offset ±hh:mm)';

export class PartidaCompraDto {
  @ApiProperty({
    example: 'I001',
    description:
      'El `origenSrId` del insumo en el catálogo `insumos` de esta sucursal (1–64). Sin FK: el ' +
      'catálogo puede llegar después. Puede repetirse dentro de la compra (dos renglones).',
  })
  @IsString()
  @Length(1, 64)
  insumoOrigenSrId!: string;

  @ApiProperty({
    pattern: CANTIDAD.source,
    example: '12.500',
    description:
      'Cantidad comprada en la unidad del insumo, MAYOR QUE 0, texto decimal NUMERIC(12,3) (no se ' +
      'redondea). Una devolución no viaja como partida negativa: SR la cancela o la registra ' +
      'aparte (supuesto, esquema-sr §10).',
  })
  @IsString()
  @Matches(CANTIDAD, { message: '$property debe ser una cantidad decimal en texto' })
  cantidad!: string;

  @ApiProperty({
    pattern: DINERO.source,
    example: '85.40',
    description:
      'Costo por unidad SIN IVA (supuesto, esquema-sr §10), ≥ 0. Hasta 10 enteros y 4 decimales, ' +
      'se redondea a 2 mitad lejos de cero. El importe (cantidad × costo, a 2 decimales) lo ' +
      'calcula el API.',
  })
  @IsString()
  @Matches(DINERO, { message: '$property debe ser un importe decimal en texto' })
  costoUnitario!: string;
}

export class CompraDto {
  @ApiProperty({
    example: '9120',
    description:
      'Identidad de la compra en SR (1–64). Llave de la idempotencia junto con la sucursal de la ' +
      'API key. Repetida dentro del lote = se rechazan todas sus apariciones.',
  })
  @IsString()
  @Length(1, 64)
  origenSrId!: string;

  @ApiProperty({ example: 'OC-0042', description: 'Folio visible del documento (1–64).' })
  @IsString()
  @Length(1, 64)
  folio!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'PR01',
    description:
      'El `origenSrId` del proveedor en `proveedores_catalogo` de esta sucursal (1–64), o nulo si ' +
      'SR no lo registra. Sin FK: sin catálogo se muestra "sin catálogo".',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  proveedorOrigenSrId!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'ALM-GEN',
    description: 'El `origenSrId` del almacén que recibió (1–64), o nulo. Sin FK.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  almacenOrigenSrId!: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    pattern: ISO_CON_ZONA.source,
    example: '2026-09-22T16:00:00.000Z',
    description:
      'Fecha y hora de la compra en el POS, ISO-8601 con zona. Más de 5 min en el futuro = se ' +
      'rechaza la compra. El día en el panel es el de la zona de la sucursal.',
  })
  @IsString()
  @Matches(ISO_CON_ZONA, { message: MENSAJE_FECHA })
  fecha!: string;

  @ApiProperty({
    description:
      'true = la compra se canceló en SR (o ya no existe): se muestra marcada y NO suma. El panel ' +
      'nunca borra una compra: para anularla se reenvía cancelada.',
  })
  @IsBoolean()
  cancelada!: boolean;

  @ApiProperty({
    type: [PartidaCompraDto],
    description:
      'TODAS las partidas de la compra, en su orden (el renglón es la posición). Una partida ' +
      'inválida rechaza la compra entera. Reenviarla con otras partidas las REEMPLAZA.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_PARTIDAS_COMPRAS_LOTE)
  @ValidateNested({ each: true })
  @Type(() => PartidaCompraDto)
  partidas!: PartidaCompraDto[];
}

export class LoteComprasDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    pattern: ISO_CON_ZONA.source,
    example: '2026-09-22T15:30:00.000Z',
    description:
      'El instante en que se LEYÓ el lote en el POS (reloj del agente), ISO-8601 con zona. Una ' +
      'compra guardada con una lectura más nueva no se toca (`obsoletas`). Con el MISMO instante, ' +
      'gana el que llega después. Más de 5 min en el futuro = 400.',
  })
  @IsString()
  @Matches(ISO_CON_ZONA, { message: MENSAJE_FECHA })
  leidoAt!: string;

  @ApiProperty({
    type: [CompraDto],
    minItems: 1,
    maxItems: MAX_COMPRAS_LOTE,
    description: `1 a ${MAX_COMPRAS_LOTE} compras, con ${MAX_PARTIDAS_COMPRAS_LOTE} partidas a lo más EN TOTAL (si no, 400).`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_COMPRAS_LOTE)
  @IsObject({ each: true })
  compras!: Record<string, unknown>[];
}

export class RechazoCompraDto {
  @ApiProperty({ example: 3, description: 'Posición de la compra en el lote (desde 0).' })
  indice!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'El `origenSrId` si era válido; nulo si no.',
  })
  origenSrId!: string | null;

  @ApiProperty({
    example: 'compras.3.partidas.1.cantidad: debe ser mayor que 0',
    description: 'Ruta y regla. NUNCA repite el valor.',
  })
  motivo!: string;

  @ApiProperty({ description: 'Siempre false: reenviarla igual va a fallar igual.' })
  reintentable!: boolean;
}

export class ResultadoComprasDto {
  @ApiProperty({ description: 'Compras en el lote.' })
  recibidas!: number;

  @ApiProperty({ description: 'Compras nuevas.' })
  creadas!: number;

  @ApiProperty({
    description: 'Compras que cambiaron: su cabecera y sus partidas se reescribieron.',
  })
  actualizadas!: number;

  @ApiProperty({ description: 'Compras iguales a lo guardado: no se tocaron.' })
  sinCambios!: number;

  @ApiProperty({
    description:
      'Compras cuya versión guardada se leyó DESPUÉS de este lote: no se tocaron (no es error).',
  })
  obsoletas!: number;

  @ApiProperty({ type: [RechazoCompraDto] })
  rechazadas!: RechazoCompraDto[];
}
