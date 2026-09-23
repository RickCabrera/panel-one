import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';

import { UsuarioDto } from '../../administracion/dto/administracion.dto';
import { EsZonaIana } from '../../administracion/zona-horaria';
import { PASSWORD_MAX, PASSWORD_MIN } from '../../auth/dto/password.dto';
import { EmpresaDto, SucursalDto } from '../../organizacion/dto/organizacion.dto';

const NOMBRE_MAX = 120;
/** Tope de sucursales por alta guiada: un grupo más grande se da de alta en varias vueltas. */
export const SUCURSALES_MAX_ALTA = 20;

const Recortar = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));
const Minusculas = () =>
  Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );

// --- Alta guiada (F2-147) -----------------------------------------------------------

export class SucursalAltaDto {
  @ApiProperty({ minLength: 1, maxLength: NOMBRE_MAX })
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre!: string;

  @ApiProperty({
    example: 'America/Mexico_City',
    description: 'Zona IANA (la que corta "hoy" de la sucursal). Un offset es 400.',
  })
  @EsZonaIana()
  zonaHoraria!: string;
}

export class AdministradorAltaDto {
  @ApiProperty({ minLength: 1, maxLength: NOMBRE_MAX })
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre!: string;

  @ApiProperty({ maxLength: 254, description: 'Se guarda en minúsculas. Duplicado = 409.' })
  @Minusculas()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({
    minLength: PASSWORD_MIN,
    maxLength: PASSWORD_MAX,
    format: 'password',
    description: 'Contraseña inicial. No vuelve en la respuesta: la tiene quien la mandó.',
  })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class AltaGuiadaDto {
  @ApiProperty({ minLength: 1, maxLength: NOMBRE_MAX, description: 'Nombre de la empresa.' })
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre!: string;

  @ApiProperty({
    type: [SucursalAltaDto],
    minItems: 1,
    maxItems: SUCURSALES_MAX_ALTA,
    description:
      'Nacen activas y CON su API key. Dos nombres iguales (sin distinguir mayúsculas ni ' +
      'espacios de más) son 400.',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(SUCURSALES_MAX_ALTA)
  @ValidateNested({ each: true })
  @Type(() => SucursalAltaDto)
  sucursales!: SucursalAltaDto[];

  @ApiPropertyOptional({
    type: AdministradorAltaDto,
    description: 'El primer admin_empresa. Opcional: se puede crear después en Usuarios.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => AdministradorAltaDto)
  administrador?: AdministradorAltaDto;
}

export class SucursalConKeyDto extends SucursalDto {
  @ApiProperty({
    description:
      'API key del agente, EN CLARO y UNA sola vez (empieza con `msr_`). En la base ' +
      'queda su hash; si se pierde, se rota desde Administración.',
  })
  apiKey!: string;
}

export class AltaGuiadaRespuestaDto {
  @ApiProperty({ type: EmpresaDto })
  empresa!: EmpresaDto;

  @ApiProperty({ type: [SucursalConKeyDto] })
  sucursales!: SucursalConKeyDto[];

  @ApiProperty({ type: UsuarioDto, nullable: true })
  administrador!: UsuarioDto | null;
}

// --- Checklist de arranque (F2-147) --------------------------------------------------

export const CLAVES_PASO = ['sucursales', 'llaves', 'agente', 'ventas', 'usuario'] as const;
export type ClavePaso = (typeof CLAVES_PASO)[number];

export class SucursalPendienteDto {
  @ApiProperty({ format: 'uuid' })
  sucursalId!: string;

  @ApiProperty()
  nombre!: string;
}

export class PasoArranqueDto {
  @ApiProperty({ enum: CLAVES_PASO, enumName: 'ClavePasoArranque' })
  clave!: ClavePaso;

  @ApiProperty()
  titulo!: string;

  @ApiProperty()
  hecho!: boolean;

  @ApiProperty({ description: 'Qué falta, o por qué está hecho, en español.' })
  detalle!: string;

  @ApiProperty({
    type: [SucursalPendienteDto],
    description: 'Las sucursales activas a las que les falta este paso (vacío si no aplica).',
  })
  pendientes!: SucursalPendienteDto[];
}

export class ArranqueDto {
  @ApiProperty({ format: 'uuid' })
  empresaId!: string;

  @ApiProperty({ description: 'Todos los pasos hechos: la tarjeta de arranque ya no se muestra.' })
  completo!: boolean;

  @ApiProperty({ type: [PasoArranqueDto] })
  pasos!: PasoArranqueDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Dónde se descarga el instalador del agente (`AGENTE_URL_DESCARGA`). Nulo si el ' +
      'servidor no lo tiene configurado: el instalador lo entrega soporte.',
  })
  descargaAgente!: string | null;
}

// --- Contacto de la landing (F2-147) -------------------------------------------------

export class ContactoDto {
  @ApiProperty({ minLength: 1, maxLength: NOMBRE_MAX })
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre!: string;

  @ApiProperty({ maxLength: 254 })
  @Minusculas()
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiPropertyOptional({ maxLength: 30 })
  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(30)
  telefono?: string;

  @ApiPropertyOptional({ maxLength: NOMBRE_MAX, description: 'Nombre del restaurante o grupo.' })
  @IsOptional()
  @Recortar()
  @IsString()
  @MaxLength(NOMBRE_MAX)
  negocio?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 500, description: 'Cuántas sucursales tiene.' })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  sucursales?: number;

  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  mensaje!: string;

  @ApiPropertyOptional({
    maxLength: 200,
    description:
      'Trampa para bots: el formulario lo esconde. Si llega con algo, se responde 202 igual y ' +
      'no se manda nada.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  sitio?: string;
}

export class ContactoRecibidoDto {
  @ApiProperty({ example: true })
  recibido!: boolean;
}
