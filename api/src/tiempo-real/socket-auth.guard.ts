import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { WsException } from '@nestjs/websockets';

import { sesionVigente } from './sesion-socket';
import { NO_AUTENTICADO } from './textos';

/**
 * Guard de CADA mensaje del socket (F2-142). Los `APP_GUARD` globales (`JwtAuthGuard`,
 * `RolesGuard`) NO corren en los `@SubscribeMessage` de un gateway: se comprobó en el e2e (un
 * `suscribir` sin sesión llegaba al handler). Por eso el gateway lleva éste con `@UseGuards`.
 *
 * No hay cabeceras en un mensaje: el token se verificó en el handshake y su sesión vive en
 * `socket.data`. Se exige esa sesión y que el token no haya vencido; si falta, el cliente recibe
 * `exception { status: 'error', message: 'No autenticado' }` y el handler no corre.
 */
@Injectable()
export class SocketAuthGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const cliente = ctx.switchToWs().getClient<{ data?: unknown }>();
    if (sesionVigente(cliente.data, Date.now()) === null) {
      throw new WsException(NO_AUTENTICADO);
    }
    return true;
  }
}
