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

  @ApiProperty({
    enum: [
      'naranja',
      'morado',
      'azul_electrico',
      'verde_azulado',
      'ambar_dorado',
      'magenta',
      'rojo',
    ],
    nullable: true,
    description:
      'Membresías: el color de interfaz que eligió la plataforma para TODOS los clientes ' +
      '(Plataforma › Ajustes). Nulo = el del build (`VITE_COLOR_ACENTO`).',
  })
  colorAcento!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'INST-02: de dónde se baja el instalador de un clic del agente (`AGENTE_URL_DESCARGA`, ' +
      'https). Es la misma para todos los clientes. Nulo = no está configurada y la interfaz ' +
      'dice que lo pidan a soporte.',
    example: 'https://github.com/RickCabrera/panel-one/releases/download/instalador/Instalar-YoControlo.zip',
  })
  descargaAgente!: string | null;
}
