import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TipoPolizaInventario } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateNested,
} from 'class-validator';

import { CANTIDAD, DINERO, ISO_CON_ZONA } from '../normalizar';

/**
 * Contrato de la ingesta de movimientos de inventario (F2-122): `POST /ingesta/movimientos`,
 * un LOTE de pólizas (documentos) de la sucursal de la API key, cada una con TODAS sus partidas.
 *
 * El ValidationPipe global valida SÓLO el sobre (todo o nada: un sobre inválido = 400 sin
 * escribir). Cada póliza se valida aparte en el servicio: una inválida se rechaza sola, y una
 * partida inválida rechaza SU póliza entera (una póliza a medias sería un hueco en el kardex).
 * Nada lleva `sucursalId` ni `empresaId`: el tenant sale de la API key.
 *
 * Nada de esto se ha visto en una instalación real de SoftRestaurant (docs/esquema-sr.md §10:
 * supuestos, no hallazgos).
 */

/**
 * DECISION PROVISIONAL (nocturno): topes de UN lote. 200 pólizas y 5000 partidas EN TOTAL (una
 * póliza más grande no cabe: si pasa en una instalación real es cambio de contrato). El tope de
 * partidas es del lote, no de la póliza: 5000 partidas caben con holgura en el body de 5 MB y en
 * el `statement_timeout`. El lector (F2-241) parte los lotes por partidas, no sólo por pólizas.
 */
export const MAX_POLIZAS_LOTE = 200;
export const MAX_PARTIDAS_LOTE = 5000;

export const TIPOS_POLIZA = Object.values(TipoPolizaInventario);

const MENSAJE_FECHA = '$property debe ser ISO-8601 con zona (Z u offset ±hh:mm)';

export class PartidaMovimientoDto {
  @ApiProperty({
    example: 'I001',
    description:
      'El `origenSrId` del insumo en el catálogo `insumos` de esta sucursal (1–64). Sin FK: el ' +
      'catálogo puede llegar después. Puede repetirse dentro de la póliza (dos renglones).',
  })
  @IsString()
  @Length(1, 64)
  insumoOrigenSrId!: string;

  @ApiProperty({
    pattern: CANTIDAD.source,
    example: '-2.500',
    description:
      'Cantidad CON SIGNO en la unidad del insumo (+ entra al almacén, − sale), texto decimal ' +
      'NUMERIC(12,3) (no se redondea). Puede ser 0.',
  })
  @IsString()
  @Matches(CANTIDAD, { message: '$property debe ser una cantidad decimal en texto' })
  cantidad!: string;

  @ApiProperty({
    pattern: DINERO.source,
    example: '85.40',
    description:
      'Costo por unidad del movimiento, sin IVA supuesto (esquema-sr §10). Regla de los importes ' +
      'de `/ingesta/eventos`: hasta 10 enteros y 4 decimales, se redondea a 2 mitad lejos de ' +
      'cero. El importe (cantidad × costo, a 2 decimales, con signo) lo calcula el API.',
  })
  @IsString()
  @Matches(DINERO, { message: '$property debe ser un importe decimal en texto' })
  costoUnitario!: string;
}

export class PolizaMovimientosDto {
  @ApiProperty({
    example: '48213',
    description:
      'Identidad de la póliza en SR (1–64). Llave de la idempotencia junto con la sucursal de la ' +
      'API key. Repetida dentro del lote = se rechazan todas sus apariciones.',
  })
  @IsString()
  @Length(1, 64)
  origenSrId!: string;

  @ApiProperty({ example: 'POL-0042', description: 'Folio visible del documento (1–64).' })
  @IsString()
  @Length(1, 64)
  folio!: string;

  @ApiProperty({
    enum: TIPOS_POLIZA,
    enumName: 'TipoPolizaInventario',
    description:
      'Tipo NUESTRO: el lector traduce el de SR (esquema-sr §10). Lo que no sepa traducir = `otro`.',
  })
  @IsIn(TIPOS_POLIZA)
  tipo!: TipoPolizaInventario;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'E',
    description: 'El código de tipo CRUDO de SR (1–64), para validar la traducción (F2-192).',
  })
  @IsOptional()
  @IsString()
  @Length(1, 64)
  tipoSr?: string | null;

  @ApiProperty({
    example: 'ALM-GEN',
    description: 'El `origenSrId` del almacén de la póliza (1–64). Un almacén por póliza. Sin FK.',
  })
  @IsString()
  @Length(1, 64)
  almacenOrigenSrId!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    pattern: ISO_CON_ZONA.source,
    example: '2026-09-22T15:30:00.000Z',
    description:
      'Fecha y hora del movimiento en el POS, ISO-8601 con zona. Más de 5 min en el futuro = se ' +
      'rechaza la póliza.',
  })
  @IsString()
  @Matches(ISO_CON_ZONA, { message: MENSAJE_FECHA })
  fecha!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: 'OC-0042',
    description: 'Documento que la originó (compra, traspaso, conteo), 1–120; nulo si no hay.',
  })
  @IsOptional()
  @IsString()
  @Length(1, 120)
  referencia!: string | null;

  @ApiProperty({
    description:
      'true = la póliza se canceló en SR (o ya no existe): se muestra marcada y NO suma al kardex. ' +
      'El panel nunca borra una póliza: para anularla se reenvía cancelada.',
  })
  @IsBoolean()
  cancelada!: boolean;

  @ApiProperty({
    type: [PartidaMovimientoDto],
    description:
      'TODAS las partidas de la póliza, en su orden (el renglón es la posición). Una partida ' +
      'inválida rechaza la póliza entera. Reenviar la póliza con otras partidas las REEMPLAZA.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_PARTIDAS_LOTE)
  @ValidateNested({ each: true })
  @Type(() => PartidaMovimientoDto)
  partidas!: PartidaMovimientoDto[];
}

export class LoteMovimientosDto {
  @ApiProperty({
    type: String,
    format: 'date-time',
    pattern: ISO_CON_ZONA.source,
    example: '2026-09-22T15:30:00.000Z',
    description:
      'El instante en que se LEYÓ el lote en el POS (reloj del agente), ISO-8601 con zona. Una ' +
      'póliza guardada con una lectura más nueva no se toca (`obsoletas`): un lote viejo ' +
      'reintentado no revierte una corrección. Con el MISMO instante, gana el que llega después. ' +
      'Más de 5 min en el futuro = 400.',
  })
  @IsString()
  @Matches(ISO_CON_ZONA, { message: MENSAJE_FECHA })
  leidoAt!: string;

  @ApiProperty({
    type: [PolizaMovimientosDto],
    minItems: 1,
    maxItems: MAX_POLIZAS_LOTE,
    description: `1 a ${MAX_POLIZAS_LOTE} pólizas, con ${MAX_PARTIDAS_LOTE} partidas a lo más EN TOTAL (si no, 400).`,
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_POLIZAS_LOTE)
  @IsObject({ each: true })
  polizas!: Record<string, unknown>[];
}

export class RechazoPolizaDto {
  @ApiProperty({ example: 3, description: 'Posición de la póliza en el lote (desde 0).' })
  indice!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'El `origenSrId` si era válido; nulo si no.',
  })
  origenSrId!: string | null;

  @ApiProperty({
    example: 'polizas.3.partidas.1.cantidad: cantidad debe ser una cantidad decimal en texto',
    description: 'Ruta y regla. NUNCA repite el valor.',
  })
  motivo!: string;

  @ApiProperty({ description: 'Siempre false: reenviarla igual va a fallar igual.' })
  reintentable!: boolean;
}

export class ResultadoMovimientosDto {
  @ApiProperty({ description: 'Pólizas en el lote.' })
  recibidas!: number;

  @ApiProperty({ description: 'Pólizas nuevas.' })
  creadas!: number;

  @ApiProperty({
    description: 'Pólizas que cambiaron: su cabecera y sus partidas se reescribieron.',
  })
  actualizadas!: number;

  @ApiProperty({ description: 'Pólizas iguales a lo guardado: no se tocaron.' })
  sinCambios!: number;

  @ApiProperty({
    description:
      'Pólizas cuya versión guardada se leyó DESPUÉS de este lote: no se tocaron (no es error).',
  })
  obsoletas!: number;

  @ApiProperty({ type: [RechazoPolizaDto] })
  rechazadas!: RechazoPolizaDto[];
}
