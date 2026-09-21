import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/** Largo de toda contraseña NUEVA (alta, reset y cambio propio, F1-060). */
export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 128;

export class CambiarPasswordDto {
  @ApiProperty({ minLength: 1, maxLength: 256, format: 'password' })
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  actual!: string;

  @ApiProperty({ minLength: PASSWORD_MIN, maxLength: PASSWORD_MAX, format: 'password' })
  @IsString()
  @MinLength(PASSWORD_MIN)
  @MaxLength(PASSWORD_MAX)
  nueva!: string;
}
