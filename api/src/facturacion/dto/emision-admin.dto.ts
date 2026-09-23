import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { CamposReceptorDto, DescargasFacturaDto } from './portal.dto';

/**
 * Contratos de las emisiones que pide un administrador (F2-107): factura sin ticket y
 * refacturación. Dinero como texto con 2 decimales, nunca número.
 */

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export const FORMAS_PAGO_MANUAL = ['efectivo', 'tarjeta', 'transferencia'] as const;

export class ReceptorAdminDto {
  @ApiProperty({ example: 'EKU9003173C9', description: 'Se normaliza a mayúsculas.' })
  @Transform(recortar)
  @IsString()
  @MaxLength(300)
  rfc!: string;

  @ApiProperty({
    example: 'ESCUELA KEMPER URGATE',
    description: 'Como aparece en la constancia de situación fiscal.',
  })
  @Transform(recortar)
  @IsString()
  @MaxLength(300)
  razonSocial!: string;

  @ApiProperty({ example: '601' })
  @IsString()
  @MaxLength(300)
  regimenFiscal!: string;

  @ApiProperty({ example: '42501' })
  @Transform(recortar)
  @IsString()
  @MaxLength(300)
  cp!: string;

  @ApiProperty({ example: 'G03' })
  @IsString()
  @MaxLength(300)
  usoCfdi!: string;

  @ApiProperty({
    type: String,
    required: false,
    nullable: true,
    example: 'facturas@ejemplo.mx',
    description: 'Opcional: sin correo la factura no se envía (se descarga del tablero).',
  })
  @IsOptional()
  @Transform(recortar)
  @IsString()
  @MaxLength(300)
  email?: string | null;
}

export class FacturaManualDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({ format: 'uuid', description: 'La sucursal que expide (lugar de expedición).' })
  @IsUUID('all')
  sucursalId!: string;

  @ApiProperty({
    format: 'uuid',
    description:
      'Llave de idempotencia de ESTA captura (la genera el formulario). Repetirla nunca emite ' +
      'dos veces: responde 409 con el CFDI que ya salió de ella.',
  })
  @IsUUID('all')
  solicitudId!: string;

  @ApiProperty({
    example: '1234.50',
    description: 'Total en pesos (IVA incluido), texto con hasta 2 decimales, > 0 y < 1,000,000.',
  })
  @IsString()
  @MaxLength(20)
  total!: string;

  @ApiProperty({ enum: FORMAS_PAGO_MANUAL })
  @IsIn(FORMAS_PAGO_MANUAL)
  formaPago!: (typeof FORMAS_PAGO_MANUAL)[number];

  @ApiProperty({ type: ReceptorAdminDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ReceptorAdminDto)
  receptor!: ReceptorAdminDto;
}

export class RefacturarDto {
  @ApiProperty({
    type: ReceptorAdminDto,
    description:
      'Los datos CORREGIDOS del receptor para el sustituto. Si el sustituto ya existe (reintento ' +
      'de la cancelación) se validan pero no se usan.',
  })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ReceptorAdminDto)
  receptor!: ReceptorAdminDto;
}

export class FacturaEmitidaAdminDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: '5FB2822E-396D-4725-8521-CDC4BDD20CCF' })
  uuid!: string;

  @ApiProperty({ example: 'A-1024' })
  serieFolio!: string;

  @ApiProperty({ example: '1234.50' })
  total!: string;

  @ApiProperty({ enum: ['ticket', 'manual'] })
  origen!: 'ticket' | 'manual';

  @ApiProperty({ type: String, nullable: true, description: 'Adonde se envió; null = sin correo.' })
  email!: string | null;

  @ApiProperty({ type: DescargasFacturaDto })
  descargas!: DescargasFacturaDto;
}

export class CfdiAnteriorDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  uuid!: string;

  @ApiProperty({
    enum: ['vigente', 'cancelado'],
    description: '`vigente` mientras la cancelación siga pendiente.',
  })
  estado!: 'vigente' | 'cancelado';
}

export class CfdiSustitutoDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  uuid!: string;

  @ApiProperty({ example: 'A-1025' })
  serieFolio!: string;

  @ApiProperty({ example: '315.50' })
  total!: string;
}

export class ResultadoRefacturacionDto {
  @ApiProperty({ type: CfdiAnteriorDto })
  anterior!: CfdiAnteriorDto;

  @ApiProperty({ type: CfdiSustitutoDto, description: 'El sustituto, con relación 04.' })
  nuevo!: CfdiSustitutoDto;

  @ApiProperty({
    enum: ['cancelado', 'pendiente'],
    description:
      '`pendiente`: el sustituto ya se emitió pero el PAC no confirmó la cancelación 01 del ' +
      'anterior. Repetir la petición reintenta SÓLO la cancelación.',
  })
  cancelacion!: 'cancelado' | 'pendiente';

  @ApiProperty({ type: String, nullable: true })
  mensaje!: string | null;
}

export class CamposFacturaAdminDto extends CamposReceptorDto {
  @ApiProperty({ required: false })
  total?: string;
}

export class ErrorFacturaAdminDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ type: [String], description: 'Los mismos mensajes de `campos`, en lista.' })
  message!: string[];

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiProperty({
    type: CamposFacturaAdminDto,
    description: 'Un mensaje en español por cada campo con error (sólo los que fallan).',
  })
  campos!: CamposFacturaAdminDto;
}

export class ErrorCapturaRepetidaDto {
  @ApiProperty({ example: 409 })
  statusCode!: number;

  @ApiProperty()
  message!: string;

  @ApiProperty({ example: 'Conflict' })
  error!: string;

  @ApiProperty({
    format: 'uuid',
    required: false,
    description: 'El CFDI que ya salió de esta `solicitudId` (sólo en ese caso).',
  })
  cfdiId?: string;

  @ApiProperty({ enum: ['timbrando', 'vigente', 'cancelado'], required: false })
  estado?: 'timbrando' | 'vigente' | 'cancelado';
}
