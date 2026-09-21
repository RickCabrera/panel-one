import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';

import { PASSWORD_MAX, PASSWORD_MIN } from '../../auth/dto/password.dto';
import type { UsuarioCreado } from '../../scope/escritura-admin';
import { EsZonaIana } from '../zona-horaria';

const NOMBRE_MAX = 120;

/** Recorta espacios antes de validar: "  Centro " es "Centro", y "   " queda vacío. */
const Recortar = () =>
  Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value));

/**
 * En un PATCH el campo puede faltar, pero NO venir `null`: `@IsOptional()`
 * dejaría pasar un null a una columna NOT NULL (500). Así un null es 400.
 */
const SiViene = () => ValidateIf((_objeto: object, valor: unknown) => valor !== undefined);

// --- Empresas -----------------------------------------------------------------------

export class CrearEmpresaDto {
  @ApiProperty({ minLength: 1, maxLength: NOMBRE_MAX })
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre!: string;
}

export class EditarEmpresaDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: NOMBRE_MAX })
  @SiViene()
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre?: string;

  @ApiPropertyOptional({
    description:
      '`false` da de baja la empresa: sus usuarios ya no pueden entrar ni refrescar y los ' +
      'agentes de sus sucursales reciben 401. Sus sucursales y usuarios no se tocan.',
  })
  @SiViene()
  @IsBoolean()
  activo?: boolean;
}

// --- Sucursales ---------------------------------------------------------------------

const DESC_ZONA =
  'Zona IANA de la lista de Node (p. ej. `America/Mexico_City`). Un offset como `-06:00` es 400.';

export class CrearSucursalDto {
  @ApiProperty({
    format: 'uuid',
    description: 'Empresa de la sucursal. Fuera de tu alcance = 404.',
  })
  @IsUUID('all')
  empresaId!: string;

  @ApiProperty({ minLength: 1, maxLength: NOMBRE_MAX })
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre!: string;

  @ApiProperty({ example: 'America/Mexico_City', description: DESC_ZONA })
  @EsZonaIana()
  zonaHoraria!: string;
}

export class EditarSucursalDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: NOMBRE_MAX })
  @SiViene()
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre?: string;

  @ApiPropertyOptional({
    example: 'America/Mexico_City',
    description:
      `${DESC_ZONA} OJO: los agregados cortan "el día" con la zona ACTUAL de la sucursal, ` +
      'así que cambiarla reclasifica también las ventas pasadas en los reportes por día.',
  })
  @SiViene()
  @EsZonaIana()
  zonaHoraria?: string;

  @ApiPropertyOptional({
    description: '`false` da de baja la sucursal: su agente recibe 401 desde el siguiente envío.',
  })
  @SiViene()
  @IsBoolean()
  activo?: boolean;
}

// --- Usuarios -----------------------------------------------------------------------

export class UsuariosQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Sólo los usuarios de esta empresa. Fuera de tu alcance = 404.',
  })
  @IsOptional()
  @IsUUID('all')
  empresaId?: string;
}

export class UsuarioDto implements UsuarioCreado {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty()
  email!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ enum: RolUsuario, enumName: 'RolUsuario' })
  rol!: RolUsuario;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Nulo sólo para admin_global.',
  })
  empresaId!: string | null;

  @ApiProperty()
  activo!: boolean;
}

export class CrearUsuarioDto {
  @ApiProperty({ maxLength: 254, description: 'Se guarda en minúsculas. Duplicado = 409.' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 1, maxLength: NOMBRE_MAX })
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre!: string;

  @ApiProperty({
    enum: RolUsuario,
    enumName: 'RolUsuario',
    description: 'Sólo un admin_global crea admin_global (admin_empresa = 403).',
  })
  @IsEnum(RolUsuario)
  rol!: RolUsuario;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Obligatoria salvo para admin_global, que no lleva (400 si viene). Fuera de tu alcance = 404.',
  })
  @IsOptional()
  @IsUUID('all')
  empresaId?: string | null;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX, format: 'password' })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}

export class EditarUsuarioDto {
  @ApiPropertyOptional({ minLength: 1, maxLength: NOMBRE_MAX })
  @SiViene()
  @Recortar()
  @IsString()
  @MinLength(1)
  @MaxLength(NOMBRE_MAX)
  nombre?: string;

  @ApiPropertyOptional({
    enum: RolUsuario,
    enumName: 'RolUsuario',
    description:
      'Sólo entre admin_empresa y visor. `admin_global` = 403 para admin_empresa y 400 para ' +
      'admin_global; cambiarle el rol a un admin_global = 400; cambiarte el rol a ti = 400.',
  })
  @SiViene()
  @IsEnum(RolUsuario)
  rol?: RolUsuario;

  @ApiPropertyOptional({
    description:
      '`false` lo da de baja: no puede entrar y sus refresh tokens dejan de servir (su access ' +
      'token vigente, hasta 15 min). Darte de baja a ti = 400.',
  })
  @SiViene()
  @IsBoolean()
  activo?: boolean;
}

export class ResetPasswordDto {
  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX, format: 'password' })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  password!: string;
}
