import { ApiProperty } from '@nestjs/swagger';
import { RolUsuario } from '@prisma/client';

export class UsuarioActualDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'admin@monitor.local' })
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
}

export class SesionDto {
  @ApiProperty({ description: 'Access token JWT. Va en `Authorization: Bearer <token>`.' })
  accessToken!: string;

  @ApiProperty({ example: 900, description: 'Vida del access token, en segundos.' })
  expiresIn!: number;

  @ApiProperty({ type: UsuarioActualDto })
  usuario!: UsuarioActualDto;
}

/** Cuerpo de todo error de la API (el formato por defecto de Nest). */
export class ErrorDto {
  @ApiProperty({ example: 401 })
  statusCode!: number;

  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
    example: 'Credenciales inválidas',
  })
  message!: string | string[];

  @ApiProperty({ required: false, example: 'Unauthorized' })
  error?: string;
}
