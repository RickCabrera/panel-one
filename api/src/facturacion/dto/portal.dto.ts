import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBase64,
  IsBoolean,
  IsDefined,
  IsObject,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';

import { ESTADOS_PUBLICOS, type EstadoPublico } from '../codigo';
import { MAX_BYTES_LOGO } from '../portal';
import { TicketCodigoDto } from './codigo.dto';
import { RegimenFiscalDto } from './facturacion.dto';

/**
 * Contratos del portal público de autofactura (F2-103) y de su configuración por sucursal.
 * Fechas en UTC (ISO 8601); dinero como texto con 2 decimales. Lo público nunca lleva folio,
 * mesa, mesero, partidas ni ids internos.
 */


/** El logo medido sobre el base64 que llega (4 caracteres por cada 3 bytes). */
export const MAX_BASE64_LOGO = Math.ceil(MAX_BYTES_LOGO / 3) * 4;

const recortar = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

// ---------------------------------------------------------------------------
// Público
// ---------------------------------------------------------------------------

export class PortalPublicoDto {
  @ApiProperty({ example: 'demo-centro' })
  slug!: string;

  @ApiProperty({ example: 'Sucursal Centro', description: 'Nombre de la sucursal.' })
  sucursal!: string;

  @ApiProperty({ example: '#0f766e', description: 'Color de la marca, `#rrggbb`.' })
  color!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    example: '/facturacion/portal/demo-centro/logo',
    description:
      'Ruta del logo en ESTE api (relativa a su base). Null = la sucursal no tiene logo.',
  })
  logoUrl!: string | null;

  @ApiProperty({
    description:
      'Si hoy se puede emitir una factura desde este portal: la empresa tiene perfil fiscal ' +
      'activo con CSD registrado y vigente (F2-104). Si es `false`, el portal deja consultar el ' +
      'código pero no pide datos fiscales.',
  })
  emisionDisponible!: boolean;
}

export class DesgloseTicketDto {
  @ApiProperty({ example: '271.98', description: 'Subtotal del ticket, 2 decimales.' })
  subtotal!: string;

  @ApiProperty({ example: '43.52', description: 'Impuestos del ticket, 2 decimales.' })
  impuestos!: string;
}

export class TicketPortalDto extends TicketCodigoDto {
  @ApiProperty({
    type: DesgloseTicketDto,
    nullable: true,
    description:
      'Subtotal e impuestos, SÓLO si suman exactamente el total. Si no cuadran (descuentos, ' +
      'propina u otro criterio del POS), `null` y el portal muestra sólo el total.',
  })
  desglose!: DesgloseTicketDto | null;
}

export class ConsultaCodigoPortalDto {
  @ApiProperty({ example: '7JQRECP3U', description: 'El código normalizado (mayúsculas).' })
  codigo!: string;

  @ApiProperty({ enum: ESTADOS_PUBLICOS })
  estado!: EstadoPublico;

  @ApiProperty({ description: 'Mensaje en español para mostrar tal cual. Sin datos del ticket.' })
  mensaje!: string;

  @ApiProperty({
    type: TicketPortalDto,
    nullable: true,
    description: 'SÓLO con `estado = pendiente`; en cualquier otro estado es `null`.',
  })
  ticket!: TicketPortalDto | null;
}

export class UsoCfdiDto {
  @ApiProperty({ example: 'G03' })
  clave!: string;

  @ApiProperty({ example: 'Gastos en general' })
  descripcion!: string;

  @ApiProperty()
  fisica!: boolean;

  @ApiProperty()
  moral!: boolean;

  @ApiProperty({
    type: [String],
    example: ['601', '612', '626'],
    description: 'Regímenes fiscales del receptor con que el SAT acepta este uso.',
  })
  regimenes!: string[];
}

export class CatalogosSatDto {
  @ApiProperty({ type: RegimenFiscalDto, isArray: true })
  regimenesFiscales!: RegimenFiscalDto[];

  @ApiProperty({ type: UsoCfdiDto, isArray: true })
  usosCfdi!: UsoCfdiDto[];
}

export class ReceptorPortalDto {
  @ApiProperty({ example: 'EKU9003173C9', description: 'Se normaliza a mayúsculas.' })
  @Transform(recortar)
  @IsString()
  @MaxLength(300)
  rfc!: string;

  @ApiProperty({
    example: 'ESCUELA KEMPER URGATE',
    description: 'Como aparece en la constancia de situación fiscal (sin "S.A. de C.V.").',
  })
  @Transform(recortar)
  @IsString()
  @MaxLength(300)
  razonSocial!: string;

  @ApiProperty({ example: '601', description: 'c_RegimenFiscal que aplique al tipo de persona.' })
  @IsString()
  @MaxLength(300)
  regimenFiscal!: string;

  @ApiProperty({ example: '42501', description: 'CP del domicilio fiscal del receptor.' })
  @Transform(recortar)
  @IsString()
  @MaxLength(300)
  cp!: string;

  @ApiProperty({ example: 'G03', description: 'c_UsoCFDI que aplique al régimen.' })
  @IsString()
  @MaxLength(300)
  usoCfdi!: string;

  @ApiProperty({ example: 'facturas@ejemplo.mx' })
  @Transform(recortar)
  @IsString()
  @MaxLength(300)
  email!: string;
}

export class SolicitarFacturaDto {
  @ApiProperty({ example: '7JQRECP3U', description: 'Acepta minúsculas y espacios alrededor.' })
  @IsString()
  @MaxLength(40)
  codigo!: string;

  @ApiProperty({ type: ReceptorPortalDto })
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => ReceptorPortalDto)
  receptor!: ReceptorPortalDto;
}

export class DescargasFacturaDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Enlace de descarga FIRMADO y temporal (1 h) del XML (F2-105). Null si el archivo no se pudo ' +
      'guardar: entonces sólo llega por correo.',
  })
  xml!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Como `xml`, para el PDF.',
  })
  pdf!: string | null;
}

export class FacturaPortalDto {
  @ApiProperty({ example: '5FB2822E-396D-4725-8521-CDC4BDD20CCF' })
  uuid!: string;

  @ApiProperty({ example: 'A-1024' })
  serieFolio!: string;

  @ApiProperty({ example: '315.50' })
  total!: string;

  @ApiProperty({ example: 'facturas@ejemplo.mx', description: 'Adonde se enviará (F2-105).' })
  email!: string;

  @ApiProperty({ type: DescargasFacturaDto })
  descargas!: DescargasFacturaDto;
}

export class CamposReceptorDto {
  @ApiProperty({ required: false })
  rfc?: string;
  @ApiProperty({ required: false })
  razonSocial?: string;
  @ApiProperty({ required: false })
  regimenFiscal?: string;
  @ApiProperty({ required: false })
  cp?: string;
  @ApiProperty({ required: false })
  usoCfdi?: string;
  @ApiProperty({ required: false })
  email?: string;
}

export class ErrorReceptorDto {
  @ApiProperty({ example: 400 })
  statusCode!: number;

  @ApiProperty({ type: [String], description: 'Los mismos mensajes de `campos`, en lista.' })
  message!: string[];

  @ApiProperty({ example: 'Bad Request' })
  error!: string;

  @ApiProperty({
    type: CamposReceptorDto,
    description: 'Un mensaje en español por cada campo con error (sólo los que fallan).',
  })
  campos!: CamposReceptorDto;
}

export class ErrorEstadoCodigoDto {
  @ApiProperty({ example: 409 })
  statusCode!: number;

  @ApiProperty({ example: 'Este ticket ya fue facturado.' })
  message!: string;

  @ApiProperty({ example: 'Conflict' })
  error!: string;

  @ApiProperty({ enum: ESTADOS_PUBLICOS, description: 'Nunca `pendiente`.' })
  estado!: EstadoPublico;
}

// ---------------------------------------------------------------------------
// Administración
// ---------------------------------------------------------------------------

export class PortalesQueryDto {
  @ApiProperty({ format: 'uuid', description: 'La empresa (tiene que estar en tu alcance).' })
  @IsUUID('all')
  empresaId!: string;
}

export class PortalAdminDto {
  @ApiProperty({ example: 'demo-centro' })
  slug!: string;

  @ApiProperty({ example: '#0f766e' })
  color!: string;

  @ApiProperty({ description: 'Un portal inactivo responde 404 en todas sus rutas públicas.' })
  activo!: boolean;

  @ApiProperty()
  tieneLogo!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  actualizadoAt!: string;
}

export class SucursalPortalDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty({ example: 'Sucursal Centro' })
  sucursal!: string;

  @ApiProperty({ description: 'Una sucursal dada de baja no muestra su portal aunque exista.' })
  sucursalActiva!: boolean;

  @ApiProperty({ type: PortalAdminDto, nullable: true, description: 'Null = sin portal todavía.' })
  portal!: PortalAdminDto | null;
}

export class GuardarPortalDto {
  @ApiProperty({
    example: 'demo-centro',
    description:
      '3 a 40: minúsculas, números y guiones entre palabras. Único entre TODOS los portales.',
  })
  @Transform(recortar)
  @IsString()
  @MaxLength(60)
  slug!: string;

  @ApiProperty({ example: '#0f766e', description: '`#rrggbb`; se guarda en minúsculas.' })
  @IsString()
  @MaxLength(20)
  color!: string;

  @ApiProperty()
  @IsBoolean()
  activo!: boolean;
}

export class LogoPortalDto {
  @ApiProperty({
    description: `El archivo en base64: PNG, JPEG o WebP de hasta ${MAX_BYTES_LOGO / 1024} KB. SVG no.`,
  })
  @IsString()
  @MaxLength(MAX_BASE64_LOGO)
  @IsBase64()
  contenidoBase64!: string;
}
