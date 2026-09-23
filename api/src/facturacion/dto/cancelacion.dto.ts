import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsUUID } from 'class-validator';

import type { MotivoCancelacion } from '../../adaptadores/timbrado/puerto';
import { MOTIVOS_CANCELACION } from '../cancelacion';

/** Contratos de la cancelación de CFDI (F2-109). */

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CancelarCfdiDto {
  @ApiProperty({
    enum: MOTIVOS_CANCELACION,
    description:
      'c_MotivoCancelacion del SAT: 01 con errores CON relación (exige el sustituto), 02 con errores ' +
      'sin relación, 03 no se llevó a cabo la operación, 04 operación nominativa relacionada en una ' +
      'factura global (sólo para una global). Una global no se cancela con 01.',
  })
  @IsIn(MOTIVOS_CANCELACION, { message: 'El motivo de cancelación debe ser 01, 02, 03 o 04.' })
  motivo!: MotivoCancelacion;

  @ApiProperty({
    required: false,
    nullable: true,
    format: 'uuid',
    description:
      'Obligatorio con motivo 01 (400 si falta): el folio fiscal del SUSTITUTO de esta factura, el ' +
      'que emitió la refacturación con relación 04. Uno que no sea ese es 409.',
  })
  @IsOptional()
  @Transform(recortar)
  @IsUUID('all', { message: 'El folio fiscal del sustituto no es un UUID válido.' })
  uuidSustitucion?: string | null;
}

export class ResultadoCancelacionDto {
  @ApiProperty({ format: 'uuid' })
  cfdiId!: string;

  @ApiProperty({ description: 'Folio fiscal (UUID) de la factura cancelada.' })
  uuid!: string;

  @ApiProperty({ enum: MOTIVOS_CANCELACION })
  motivo!: MotivoCancelacion;

  @ApiProperty({
    enum: ['cancelado', 'en_proceso'],
    description:
      '`en_proceso`: el SAT espera la respuesta del receptor (acepta, rechaza, o a las 72 h procede). ' +
      'Mientras tanto la factura sigue VIGENTE y sigue contando en lo facturado.',
  })
  estado!: 'cancelado' | 'en_proceso';

  @ApiProperty({ type: String, nullable: true })
  mensaje!: string | null;
}

export class ConsultaCancelacionDto {
  @ApiProperty({ format: 'uuid' })
  cfdiId!: string;

  @ApiProperty({
    enum: ['solicitando', 'en_proceso', 'aceptada', 'rechazada', 'no_procedio'],
    description:
      'En qué quedó la solicitud tras consultar al PAC: `aceptada` = la factura quedó cancelada; ' +
      '`rechazada` = el receptor la rechazó (sigue vigente, se puede volver a pedir); ' +
      '`no_procedio` = el PAC nunca la registró (sigue vigente); `solicitando`/`en_proceso` = sin ' +
      'cambio todavía.',
  })
  estado!: 'solicitando' | 'en_proceso' | 'aceptada' | 'rechazada' | 'no_procedio';

  @ApiProperty({ type: String, nullable: true })
  mensaje!: string | null;
}
