import { Logger, NotFoundException, UseGuards } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { TokensService } from '../auth/tokens.service';
import { verificarAlcance } from '../scope/alcance';
import { scopeDeUsuario } from '../scope/empresa-scope';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import { AvisosTiempoReal, type AvisoIngesta, type CambiosIngesta } from './avisos';
import { sesionVigente, type DatosSocket } from './sesion-socket';
import { SocketAuthGuard } from './socket-auth.guard';
import { leerSuscripcion, salaDe, type RespuestaSuscripcion } from './suscripcion';
import { NO_AUTENTICADO } from './textos';

/** Ruta del socket en la API. Tras el proxy (Vite/Caddy) el navegador la ve bajo `/api`. */
export const RUTA_SOCKET = '/socket.io';
/** `setTimeout` no acepta más de 2^31−1 ms (≈24.8 días); un access vive 15 min. */
const MAXIMO_TIMER_MS = 2 ** 31 - 1;

/**
 * El tiempo real del monitor de mesas (F2-142). El socket AVISA, no transporta datos: al llegar
 * un lote de ingesta con snapshot o cheques, emite `ingesta { sucursalId, mesas, cheques }` a
 * quien esté suscrito a esa empresa o sucursal, y el panel vuelve a pedir `GET /mesas/abiertas`
 * (con su scope). Contrato completo en `docs/tiempo-real.md`.
 *
 * Mismo origen que la API, sin CORS (`cors: false`), como el resto: el navegador llega por el
 * proxy de `/api`.
 *
 * Los guards globales de HTTP no llegan aquí: cada mensaje pasa por `SocketAuthGuard`.
 */
@UseGuards(SocketAuthGuard)
@WebSocketGateway({ path: RUTA_SOCKET, cors: false, serveClient: false })
export class TiempoRealGateway
  extends AvisosTiempoReal
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly log = new Logger(TiempoRealGateway.name);

  @WebSocketServer()
  private readonly server?: Server;

  constructor(
    private readonly tokens: TokensService,
    private readonly datos: ScopedPrismaService,
  ) {
    super();
  }

  /**
   * Handshake: el access token va en `auth.token` (nunca en la query string, que queda en
   * logs). Sin token, inválido, vencido o un refresh en su lugar → `connect_error` con
   * "No autenticado" y el socket no se abre.
   */
  afterInit(server: Server): void {
    server.use((socket, siguiente) => {
      this.autenticar(socket).then(
        () => siguiente(),
        () => siguiente(new Error(NO_AUTENTICADO)),
      );
    });
  }

  private async autenticar(socket: Socket): Promise<void> {
    const auth = socket.handshake.auth as Record<string, unknown> | undefined;
    const token = auth?.token;
    if (typeof token !== 'string' || token.length === 0) {
      throw new Error(NO_AUTENTICADO);
    }
    const { usuario, venceEnMs } = await this.tokens.verificarAccessConVencimiento(token);
    const datos = socket.data as DatosSocket;
    datos.sesion = { usuario, scope: scopeDeUsuario(usuario), venceEnMs };
    datos.pedido = 0;
  }

  /** Corta el socket cuando vence su token: el cliente reconecta con el renovado. */
  handleConnection(socket: Socket): void {
    const datos = socket.data as DatosSocket;
    const sesion = sesionVigente(datos, Date.now());
    if (sesion === null) {
      socket.disconnect(true);
      return;
    }
    const espera = Math.min(Math.max(0, sesion.venceEnMs - Date.now()), MAXIMO_TIMER_MS);
    datos.corte = setTimeout(() => socket.disconnect(true), espera);
    datos.corte.unref?.();
  }

  /** Limpia el timer del vencimiento: ningún timer se queda colgado de un socket muerto. */
  handleDisconnect(socket: Socket): void {
    const datos = socket.data as DatosSocket;
    if (datos.corte !== undefined) {
      clearTimeout(datos.corte);
      datos.corte = undefined;
    }
  }

  /**
   * Cambia la suscripción del socket al alcance pedido (uno a la vez: el del filtro actual).
   * Pasa por `verificarAlcance` con el scope del token: fuera de alcance es "No encontrado",
   * igual para "no existe" y "no es tuya" (el 404, nunca un 403).
   */
  @SubscribeMessage('suscribir')
  async suscribir(
    @ConnectedSocket() socket: Socket,
    @MessageBody() cuerpo: unknown,
  ): Promise<RespuestaSuscripcion> {
    const datos = socket.data as DatosSocket;
    const pedido = (datos.pedido ?? 0) + 1;
    datos.pedido = pedido;
    const sesion = sesionVigente(datos, Date.now());
    if (sesion === null) {
      // El guard ya lo filtró; esto sólo cubre que el token venza entre el guard y aquí.
      return { ok: false, error: 'No encontrado' };
    }
    const alcance = await leerSuscripcion(cuerpo);
    if (alcance === null) {
      return { ok: false, error: 'Parámetros inválidos' };
    }
    try {
      await verificarAlcance(this.datos.para(sesion.scope), alcance.empresaId, alcance.sucursalId);
    } catch (err) {
      if (err instanceof NotFoundException) return { ok: false, error: 'No encontrado' };
      throw err;
    }
    // Otro `suscribir` salió después y ya manda él.
    if (datos.pedido !== pedido) return { ok: false, error: 'Reemplazada' };
    for (const sala of [...socket.rooms]) {
      if (sala !== socket.id) await socket.leave(sala);
    }
    await socket.join(salaDe(alcance.empresaId, alcance.sucursalId));
    return { ok: true };
  }

  /** Nunca lanza: el aviso es un extra, la ingesta ya quedó guardada. */
  avisarIngesta(empresaId: string, sucursalId: string, cambios: CambiosIngesta): void {
    if (!this.server) return;
    const aviso: AvisoIngesta = { sucursalId, mesas: cambios.mesas, cheques: cambios.cheques };
    try {
      // socket.io no repite el evento a un socket que esté en las dos salas.
      this.server.to([salaDe(empresaId), salaDe(empresaId, sucursalId)]).emit('ingesta', aviso);
    } catch (err) {
      const motivo = err instanceof Error ? err.message : String(err);
      this.log.error(`No se avisó la ingesta de la sucursal ${sucursalId}: ${motivo}`);
    }
  }
}
