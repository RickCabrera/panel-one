import { ApiProperty } from '@nestjs/swagger';

/**
 * Lo que la SPA necesita saber del servidor ANTES del login. Sólo esto: ni qué
 * implementación corre detrás de cada puerto, ni versión, ni datos de empresa.
 */
export class SistemaDto {
  @ApiProperty({
    description:
      '`true` con `MODO_DEMO=1`: los datos son de ejemplo y la interfaz lo marca en todas ' +
      'las vistas y en el título de la pestaña.',
    example: false,
  })
  modoDemo!: boolean;
}
