import { ApiProperty } from '@nestjs/swagger';

/**
 * La señal de vida de la instancia (F1-002): la leen el healthcheck de Docker y los
 * monitores de UptimeRobot (F1-004). Sólo dos estados; ni versión, ni el error de la
 * base, ni nada que le sirva a quien la consulta desde fuera.
 */
export class SaludDto {
  @ApiProperty({
    enum: ['ok', 'error'],
    description: '`ok` si la API y su base responden; `error` si la base no contestó.',
    example: 'ok',
  })
  status!: 'ok' | 'error';

  @ApiProperty({
    enum: ['ok', 'error'],
    description: '`ok` si la base contestó `SELECT 1` en menos de 3 s.',
    example: 'ok',
  })
  db!: 'ok' | 'error';
}
