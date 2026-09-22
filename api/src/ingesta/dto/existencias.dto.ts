import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsObject, IsString, Length, Matches } from 'class-validator';

import { CANTIDAD, DINERO, ISO_CON_ZONA } from '../normalizar';

/**
 * Contrato de la ingesta de existencias (F2-121): `POST /ingesta/existencias`, la FOTO
 * COMPLETA de UN almacén de la sucursal de la API key.
 *
 * El ValidationPipe global valida SÓLO el sobre (todo o nada: un sobre inválido = 400 sin
 * escribir). Cada registro se valida aparte en el servicio: uno inválido se rechaza solo, y si
 * su insumo se puede identificar su fila se queda como estaba (ni se actualiza ni se borra).
 * Ningún registro lleva `sucursalId` ni `empresaId`: el tenant sale de la API key.
 *
 * Nada de esto se ha visto en una instalación real de SoftRestaurant (docs/esquema-sr.md §10:
 * supuestos, no hallazgos).
 */

/**
 * DECISION PROVISIONAL (nocturno): tope de registros de UNA foto. Un almacén con más insumos
 * no cabe en una petición; si pasa en una instalación real, F2-241 pide paginar (cambio de
 * contrato). esquema-sr.md §10.
 */
export const MAX_REGISTROS_EXISTENCIAS = 5000;

const MENSAJE_FECHA = '$property debe ser ISO-8601 con zona (Z u offset ±hh:mm)';

export class RegistroExistenciaDto {
  @ApiProperty({
    example: 'I001',
    description:
      'El `origenSrId` del insumo en el catálogo `insumos` de esta sucursal (1–64). Sin FK: el ' +
      'catálogo puede llegar después. Repetido dentro de la foto = se rechazan todas sus apariciones.',
  })
  @IsString()
  @Length(1, 64)
  insumoOrigenSrId!: string;

  @ApiProperty({
    pattern: CANTIDAD.source,
    example: '12.500',
    description:
      'Existencia en la unidad del insumo, texto decimal NUMERIC(12,3) (hasta 9 enteros y 3 ' +
      'decimales; no se redondea). Puede ser 0 o negativa: el lector manda TODAS las filas del ' +
      'almacén, también las agotadas (una que falta sale del panel).',
  })
  @IsString()
  @Matches(CANTIDAD, { message: '$property debe ser una cantidad decimal en texto' })
  cantidad!: string;

  @ApiProperty({
    pattern: DINERO.source,
    example: '85.40',
    description:
      'Costo promedio por unidad EN ESTE ALMACÉN, sin IVA supuesto (esquema-sr §10). Regla de ' +
      'los importes de `/ingesta/eventos`: hasta 10 enteros y 4 decimales, se redondea a 2 mitad ' +
      'lejos de cero. El valor (cantidad × costo, a 2 decimales) lo calcula el API: si no cabe en ' +
      'NUMERIC(12,2) se rechaza el registro.',
  })
  @IsString()
  @Matches(DINERO, { message: '$property debe ser un importe decimal en texto' })
  costoPromedio!: string;
}

export class FotoExistenciasDto {
  @ApiProperty({
    example: 'ALM-GEN',
    description:
      'El `origenSrId` del almacén en el catálogo `almacenes` de esta sucursal (1–64). Sin FK.',
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
      'El instante en que se LEYÓ la foto en el POS (reloj del agente), ISO-8601 con zona. Una ' +
      'foto más vieja que la última aplicada de ese almacén se ignora (`aplicado=false`); con el ' +
      'MISMO instante, gana la que llega después. Más de 5 min en el futuro = 400.',
  })
  @IsString()
  @Matches(ISO_CON_ZONA, { message: MENSAJE_FECHA })
  capturadoAt!: string;

  @ApiProperty({
    type: [RegistroExistenciaDto],
    maxItems: MAX_REGISTROS_EXISTENCIAS,
    description:
      'TODAS las existencias del almacén (0 a 5000). Lo que ya estaba y no viene se BORRA ' +
      '(salvo que algún rechazo no tenga insumo identificable: entonces no se borra nada). ' +
      'Vacío = el almacén no tiene nada.',
  })
  @IsArray()
  @ArrayMaxSize(MAX_REGISTROS_EXISTENCIAS)
  @IsObject({ each: true })
  registros!: Record<string, unknown>[];
}

export class RechazoExistenciaDto {
  @ApiProperty({ example: 3, description: 'Posición del registro en la foto (desde 0).' })
  indice!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'El `insumoOrigenSrId` si era válido; nulo si no.',
  })
  insumoOrigenSrId!: string | null;

  @ApiProperty({
    example: 'registros.3.cantidad: cantidad debe ser una cantidad decimal en texto',
    description: 'Ruta y regla. NUNCA repite el valor.',
  })
  motivo!: string;

  @ApiProperty({ description: 'Siempre false: reenviarlo igual va a fallar igual.' })
  reintentable!: boolean;
}

export class ResultadoExistenciasDto {
  @ApiProperty({
    description:
      'false = la foto es más vieja que la última aplicada de ese almacén: no se escribió nada.',
  })
  aplicado!: boolean;

  @ApiProperty({ description: 'Registros en la foto.' })
  recibidos!: number;

  @ApiProperty({ description: 'Filas nuevas.' })
  creados!: number;

  @ApiProperty({ description: 'Filas cuya cantidad, costo o valor cambió.' })
  actualizados!: number;

  @ApiProperty({ description: 'Filas iguales: no se tocaron.' })
  sinCambios!: number;

  @ApiProperty({ description: 'Filas del almacén que ya no vienen en la foto: se borraron.' })
  borrados!: number;

  @ApiProperty({
    description:
      'Rechazados cuya fila ya existía: se conserva tal cual (ni se actualiza ni se borra).',
  })
  conservados!: number;

  @ApiProperty({
    description:
      'true = algún rechazo no tenía insumo identificable, así que esta foto NO borró ausentes.',
  })
  ausentesConservados!: boolean;

  @ApiProperty({ type: [RechazoExistenciaDto] })
  rechazados!: RechazoExistenciaDto[];
}
