import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@monitor.local', maxLength: 254 })
  // Se normaliza ANTES de validar (el ValidationPipe transforma y luego valida):
  // "  Admin@X.com " es el mismo usuario que "admin@x.com". El servicio vuelve a
  // normalizar por si alguien lo llama sin pasar por aquí.
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @ApiProperty({ minLength: 1, maxLength: 256, format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  password!: string;
}
