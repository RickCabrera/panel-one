import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBase64, IsString, IsUUID, Length, Matches, MaxLength } from 'class-validator';

/**
 * Contratos de los datos fiscales de una empresa (F2-100). Del CSD sólo viaja de regreso METADATA:
 * ninguna respuesta lleva el `.cer`, el `.key` ni la contraseña. Fechas en UTC (ISO 8601).
 */

/** Tope de cada archivo del CSD, en bytes YA decodificados (un CSD real pesa 1–2 KB). */
export const MAX_BYTES_ARCHIVO_CSD = 16 * 1024;
/** El mismo tope medido sobre el base64 que llega (4 caracteres por cada 3 bytes). */
export const MAX_BASE64_ARCHIVO_CSD = Math.ceil(MAX_BYTES_ARCHIVO_CSD / 3) * 4;

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const mayusculas = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLocaleUpperCase('es-MX') : value;

export class PerfilFiscalQueryDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Fuera del alcance del usuario o inexistente = 404.',
  })
  @IsUUID('all')
  empresaId!: string;
}

export class GuardarPerfilFiscalDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({
    example: 'EKU9003173C9',
    description:
      'RFC del emisor: 12 caracteres (persona moral) o 13 (física). Se guarda sin espacios y en ' +
      'mayúsculas. Cambiarlo con un CSD cargado QUITA el CSD (era de otro RFC).',
  })
  @Transform(mayusculas)
  @IsString()
  @Matches(/^([A-ZÑ&]{3}|[A-ZÑ&]{4})\d{6}[A-Z0-9]{3}$/, {
    message: 'rfc no tiene el formato del SAT (12 caracteres persona moral, 13 persona física)',
  })
  rfc!: string;

  @ApiProperty({
    maxLength: 254,
    description:
      'Como aparece en la Constancia de Situación Fiscal (CFDI 4.0: sin "S.A. de C.V.").',
  })
  @Transform(recortar)
  @IsString()
  @Length(1, 254, { message: 'razonSocial debe tener entre 1 y 254 caracteres' })
  razonSocial!: string;

  @ApiProperty({
    example: '601',
    description: 'c_RegimenFiscal, compatible con el tipo de persona.',
  })
  @IsString()
  @Matches(/^\d{3}$/, { message: 'regimenFiscal debe ser una clave de 3 dígitos del SAT' })
  regimenFiscal!: string;

  @ApiProperty({ example: '06700', description: 'Código postal del domicilio fiscal (5 dígitos).' })
  @Transform(recortar)
  @IsString()
  @Matches(/^\d{5}$/, { message: 'cp debe tener 5 dígitos' })
  cp!: string;

  @ApiProperty({
    example: 'A',
    maxLength: 25,
    description: 'Serie de los CFDI (1–25 letras o números).',
  })
  @Transform(mayusculas)
  @IsString()
  @Matches(/^[A-Z0-9]{1,25}$/, { message: 'serie debe tener de 1 a 25 letras o números' })
  serie!: string;
}

export class CargarCsdDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({
    format: 'byte',
    maxLength: MAX_BASE64_ARCHIVO_CSD,
    description: `El \`.cer\` en base64 (DER o PEM). Máximo ${MAX_BYTES_ARCHIVO_CSD / 1024} KB.`,
  })
  @IsString()
  @MaxLength(MAX_BASE64_ARCHIVO_CSD, { message: 'certificado pesa más de 16 KB: no es un .cer' })
  @IsBase64(undefined, { message: 'certificado debe ir en base64' })
  certificado!: string;

  @ApiProperty({
    format: 'byte',
    maxLength: MAX_BASE64_ARCHIVO_CSD,
    description:
      `El \`.key\` en base64 (PKCS#8 cifrado, DER). Máximo ${MAX_BYTES_ARCHIVO_CSD / 1024} KB. ` +
      'Viaja al PAC y NUNCA se guarda ni se loguea.',
  })
  @IsString()
  @MaxLength(MAX_BASE64_ARCHIVO_CSD, { message: 'llavePrivada pesa más de 16 KB: no es un .key' })
  @IsBase64(undefined, { message: 'llavePrivada debe ir en base64' })
  llavePrivada!: string;

  @ApiProperty({
    format: 'password',
    maxLength: 256,
    description: 'Contraseña de la llave privada. Viaja al PAC y NUNCA se guarda ni se loguea.',
  })
  @IsString()
  @MaxLength(256, { message: 'contrasena demasiado larga' })
  contrasena!: string;
}

// ---------------------------------------------------------------------------
// respuestas
// ---------------------------------------------------------------------------

export class CsdDto {
  @ApiProperty({ example: '30001000000500003416', description: 'Número de certificado.' })
  noCertificado!: string;

  @ApiProperty({ description: 'RFC del titular según el certificado.' })
  rfc!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  vigenteDesde!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'Fin de la vigencia (UTC). La vista calcula los días restantes y la alerta.',
  })
  vigenteHasta!: string;

  @ApiProperty({ type: String, format: 'date-time', description: 'Cuándo se cargó en el panel.' })
  cargadoAt!: string;
}

export class PerfilFiscalDto {
  @ApiProperty()
  rfc!: string;

  @ApiProperty()
  razonSocial!: string;

  @ApiProperty()
  regimenFiscal!: string;

  @ApiProperty()
  cp!: string;

  @ApiProperty()
  serie!: string;

  @ApiProperty({ description: 'Último folio emitido con la serie (lo avanza la emisión, F2-104).' })
  folioActual!: number;

  @ApiProperty()
  activo!: boolean;

  @ApiProperty({ description: 'El emisor está dado de alta en el PAC (hay CSD registrado).' })
  emisorRegistrado!: boolean;

  @ApiProperty({ type: CsdDto, nullable: true, description: 'Null = sin CSD cargado.' })
  csd!: CsdDto | null;

  @ApiProperty({ type: String, format: 'date-time' })
  actualizadoAt!: string;
}

export class RespuestaPerfilFiscalDto {
  @ApiProperty({
    type: PerfilFiscalDto,
    nullable: true,
    description: 'Null = la empresa todavía no tiene datos fiscales.',
  })
  perfil!: PerfilFiscalDto | null;

  @ApiProperty({
    description:
      'true = el servidor corre con el PAC SIMULADO (`PAC_IMPL=falso`): el CSD se valida aquí ' +
      'pero no se registra ante ningún PAC ni el SAT.',
  })
  pacSimulado!: boolean;
}

export class GuardarPerfilRespuestaDto extends RespuestaPerfilFiscalDto {
  @ApiProperty({ description: 'true = cambió el RFC y se quitó el CSD que estaba cargado.' })
  csdQuitado!: boolean;
}

export class RegimenFiscalDto {
  @ApiProperty({ example: '601' })
  clave!: string;

  @ApiProperty()
  descripcion!: string;

  @ApiProperty({ description: 'Aplica a persona física (RFC de 13).' })
  fisica!: boolean;

  @ApiProperty({ description: 'Aplica a persona moral (RFC de 12).' })
  moral!: boolean;
}
