import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsObject, IsString, MaxLength, ValidateNested } from 'class-validator';

import { LARGO_MAXIMO_ENDPOINT } from '../../adaptadores/push/endpoint';
import type { PreferenciasPush } from '../../scope/escritura-push';
import {
  TIPOS_NOTIFICACION,
  type NotificacionesVista,
  type ResultadoEnvio,
  type TipoNotificacion,
} from '../notificaciones.service';

export class PreferenciasPushDto implements PreferenciasPush {
  @ApiProperty({ description: 'Mesa abierta más del umbral de la empresa (default 60 min).' })
  @IsBoolean()
  mesaAbierta!: boolean;

  @ApiProperty({
    description: 'Sucursal sin reportar más del umbral de la empresa (default 10 min).',
  })
  @IsBoolean()
  sucursalSinReporte!: boolean;

  @ApiProperty({
    description: 'Saldo de folios del PAC bajo el umbral. Sólo admin_global; otro rol = 400.',
  })
  @IsBoolean()
  foliosBajo!: boolean;

  @ApiProperty({
    description:
      'Resumen de cierre del día: la venta de ayer, a las 07:00 de la zona de la empresa.',
  })
  @IsBoolean()
  cierreDia!: boolean;
}

export class LlavesSuscripcionDto {
  @ApiProperty({ description: 'Llave pública ECDH P-256 del navegador (base64url, 65 bytes).' })
  @IsString()
  @MaxLength(200)
  p256dh!: string;

  @ApiProperty({ description: 'Secreto de autenticación del navegador (base64url, 16 bytes).' })
  @IsString()
  @MaxLength(100)
  auth!: string;
}

/** Lo que entrega `PushSubscription.toJSON()` en el navegador. */
export class RegistrarDispositivoDto {
  @ApiProperty({
    description:
      'URL del servicio de push del navegador. https, puerto 443, sin usuario ni IP, y de un ' +
      'servicio conocido (FCM, Mozilla, WNS, Apple, o `PUSH_HOSTS_PERMITIDOS`).',
    maxLength: LARGO_MAXIMO_ENDPOINT,
  })
  @IsString()
  @MaxLength(LARGO_MAXIMO_ENDPOINT)
  endpoint!: string;

  @ApiProperty({ type: LlavesSuscripcionDto })
  // Sin esto, un cuerpo sin `keys` pasa la validación y truena adentro (500).
  @IsObject()
  @ValidateNested()
  @Type(() => LlavesSuscripcionDto)
  keys!: LlavesSuscripcionDto;
}

export class QuitarDispositivoDto {
  @ApiProperty({ maxLength: LARGO_MAXIMO_ENDPOINT })
  @IsString()
  @MaxLength(LARGO_MAXIMO_ENDPOINT)
  endpoint!: string;
}

export class NotificacionesDto implements NotificacionesVista {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Llave pública VAPID (base64url) para `pushManager.subscribe`. Null: el servidor no tiene ' +
      'notificaciones configuradas.',
  })
  clavePublica!: string | null;

  @ApiProperty({ type: PreferenciasPushDto, description: 'Sin guardar: todas en false.' })
  preferencias!: PreferenciasPushDto;

  @ApiProperty({
    enum: TIPOS_NOTIFICACION,
    enumName: 'TipoNotificacion',
    isArray: true,
    description: 'Los tipos que el rol del usuario puede activar.',
  })
  disponibles!: TipoNotificacion[];

  @ApiProperty({ description: 'Navegadores registrados del usuario.' })
  dispositivos!: number;
}

export class ResultadoPruebaDto implements ResultadoEnvio {
  @ApiProperty({ description: 'Navegadores a los que el servicio de push aceptó el envío.' })
  entregados!: number;

  @ApiProperty({
    description: 'Navegadores dados de baja: suscripción caducada o de una sesión que ya terminó.',
  })
  descartados!: number;

  @ApiProperty({ description: 'Envíos que el servicio de push rechazó por otra causa.' })
  fallidos!: number;
}
