import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsObject,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

import { ISO_CON_ZONA } from '../normalizar';

/**
 * Contrato de la ingesta de recetas (F2-125): `POST /ingesta/recetas`, un LOTE de recetas de la
 * sucursal de la API key. Cada receta es la explosión COMPLETA de UN producto: cuánto de cada
 * insumo consume UNA unidad vendida.
 *
 * El ValidationPipe global valida SÓLO el sobre (todo o nada: un sobre inválido = 400 sin
 * escribir). Cada receta se valida aparte en el servicio: una inválida se rechaza sola, y un
 * renglón inválido rechaza SU receta entera (una receta a medias daría un teórico falso). Nada
 * lleva `sucursalId` ni `empresaId`: el tenant sale de la API key.
 *
 * Nada de esto se ha visto en una instalación real de SoftRestaurant (docs/esquema-sr.md §10
 * "Recetas" y §13: supuestos, no hallazgos).
 */

/**
 * DECISION PROVISIONAL (nocturno): topes de UN lote, 500 recetas y 5000 renglones EN TOTAL (como
 * los movimientos de F2-122: caben en el body de 5 MB y en el `statement_timeout`). El lector
 * (F2-241) parte los lotes por renglones, no sólo por recetas.
 */
export const MAX_RECETAS_LOTE = 500;
export const MAX_RENGLONES_LOTE = 5000;

/**
 * Cantidad de receta: NUMERIC(12,4), hasta 8 enteros y 4 decimales, SIN signo. No se redondea:
 * más decimales se rechazan. DECISION PROVISIONAL (nocturno): 4 decimales y no 3 (los de las demás
 * cantidades, §13) porque una pizca (0.0005 kg) no cabe en 3. esquema-sr.md §10.
 */
export const CANTIDAD_RECETA = /^\d{1,8}(\.\d{1,4})?$/;

const MENSAJE_FECHA = '$property debe ser ISO-8601 con zona (Z u offset ±hh:mm)';

export class RenglonRecetaDto {
  @ApiProperty({
    example: 'I001',
    description:
      'El `origenSrId` del insumo en el catálogo `insumos` de esta sucursal (1–64). Sin FK: el ' +
      'catálogo puede llegar después. Puede repetirse dentro de la receta (el cálculo los suma).',
  })
  @IsString()
  @Length(1, 64)
  insumoOrigenSrId!: string;

  @ApiProperty({
    pattern: CANTIDAD_RECETA.source,
    example: '0.1500',
    description:
      'Cuánto del insumo consume UNA unidad vendida del producto, en la UNIDAD DEL INSUMO del ' +
      'catálogo. Texto decimal NUMERIC(12,4): hasta 8 enteros y 4 decimales, sin signo. No se ' +
      'redondea: más decimales rechazan la receta. Puede ser 0.',
  })
  @IsString()
  @Matches(CANTIDAD_RECETA, { message: '$property debe ser una cantidad de receta en texto' })
  cantidad!: string;
}

export class RecetaDto {
  @ApiProperty({
    example: 'P001',
    description:
      'El `origenSrId` del producto en el catálogo `productos` de esta sucursal (1–64). Llave de ' +
      'la idempotencia junto con la sucursal de la API key. Sin FK. Repetido dentro del lote = se ' +
      'rechazan todas sus apariciones.',
  })
  @IsString()
  @Length(1, 64)
  productoOrigenSrId!: string;

  @ApiProperty({
    type: [RenglonRecetaDto],
    description:
      'TODOS los renglones de la receta. El orden no importa (el API los ordena por insumo y ' +
      'cantidad). Reenviarla con otros renglones los REEMPLAZA. Vacío = SR dice que el producto ya ' +
      'no tiene receta (se muestra "sin receta"). Un renglón inválido rechaza la receta entera.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_RENGLONES_LOTE)
  @ValidateNested({ each: true })
  @Type(() => RenglonRecetaDto)
  renglones!: RenglonRecetaDto[];
}

export class LoteRecetasDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    pattern: ISO_CON_ZONA.source,
    example: '2026-09-22T15:30:00.000Z',
    description:
      'El instante en que se LEYÓ el lote en el POS (reloj del agente), ISO-8601 con zona. Una ' +
      'receta guardada con una lectura más nueva no se toca (`obsoletas`). Con el MISMO instante, ' +
      'gana el que llega después. Más de 5 min en el futuro = 400.',
  })
  @IsString()
  @Matches(ISO_CON_ZONA, { message: MENSAJE_FECHA })
  leidoAt!: string;

  @ApiProperty({
    type: [RecetaDto],
    minItems: 1,
    maxItems: MAX_RECETAS_LOTE,
    description:
      `1 a ${MAX_RECETAS_LOTE} recetas, con ${MAX_RENGLONES_LOTE} renglones a lo más EN TOTAL ` +
      '(si no, 400). El lote NO es una foto: una receta que no viene NO se borra (el lector manda ' +
      'vacía la que SR ya no tenga).',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_RECETAS_LOTE)
  @IsObject({ each: true })
  recetas!: Record<string, unknown>[];
}

export class RechazoRecetaDto {
  @ApiProperty({ example: 3, description: 'Posición de la receta en el lote (desde 0).' })
  indice!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'El `productoOrigenSrId` si era válido; nulo si no.',
  })
  productoOrigenSrId!: string | null;

  @ApiProperty({
    example: 'recetas.3.renglones.1.cantidad: cantidad debe ser una cantidad de receta en texto',
    description: 'Ruta y regla. NUNCA repite el valor.',
  })
  motivo!: string;

  @ApiProperty({ description: 'Siempre false: reenviarla igual va a fallar igual.' })
  reintentable!: boolean;
}

export class ResultadoRecetasDto {
  @ApiProperty({ description: 'Recetas en el lote.' })
  recibidas!: number;

  @ApiProperty({ description: 'Recetas nuevas.' })
  creadas!: number;

  @ApiProperty({ description: 'Recetas que cambiaron: sus renglones se reescribieron.' })
  actualizadas!: number;

  @ApiProperty({ description: 'Recetas iguales a lo guardado: no se tocaron.' })
  sinCambios!: number;

  @ApiProperty({
    description:
      'Recetas cuya versión guardada se leyó DESPUÉS de este lote: no se tocaron (no es error).',
  })
  obsoletas!: number;

  @ApiProperty({ type: [RechazoRecetaDto] })
  rechazadas!: RechazoRecetaDto[];
}
