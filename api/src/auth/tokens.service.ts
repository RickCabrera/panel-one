import { randomUUID } from 'node:crypto';

import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RolUsuario } from '@prisma/client';

import {
  ACCESS_TTL_SEGUNDOS,
  AUTH_CONFIG,
  REFRESH_TTL_SEGUNDOS,
  type AuthConfig,
} from '../config/auth.config';
import type { UsuarioToken } from './request-autenticado';

const ALGORITMO = 'HS256' as const;
const ROLES_VALIDOS: ReadonlySet<string> = new Set(Object.values(RolUsuario));
/** El `sid` va a una columna UUID: otra cosa haría tronar la consulta (500), no un 401. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Claims = Record<string, unknown> & { sub: string };

/**
 * Firma y verifica los dos tokens. Cada uno con su secreto y su `typ`: un
 * refresh no vale como access ni al revés, aunque alguien los intercambie.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  firmarAccess(usuario: UsuarioToken): Promise<string> {
    return this.jwt.signAsync(
      { rol: usuario.rol, empresaId: usuario.empresaId, typ: 'access' },
      {
        subject: usuario.id,
        secret: this.config.accessSecret,
        expiresIn: ACCESS_TTL_SEGUNDOS,
        algorithm: ALGORITMO,
      },
    );
  }

  /**
   * `version` es la `versionSesion` del usuario al emitir (F1-060): el refresh
   * la compara con la base y un token de una versión anterior ya no sirve.
   * `sesionId` es la fila de `sesiones_usuario` (F1-093, claim `sid`): se
   * conserva al rotar y el logout la revoca.
   */
  firmarRefresh(usuarioId: string, version: number, sesionId: string): Promise<string> {
    return this.jwt.signAsync(
      { typ: 'refresh', ver: version, sid: sesionId },
      {
        subject: usuarioId,
        // `jti` aleatorio: dos refresh emitidos en el mismo segundo son distintos,
        // así que rotar la cookie siempre la cambia.
        jwtid: randomUUID(),
        secret: this.config.refreshSecret,
        expiresIn: REFRESH_TTL_SEGUNDOS,
        algorithm: ALGORITMO,
      },
    );
  }

  async verificarAccess(token: string): Promise<UsuarioToken> {
    return (await this.verificarAccessConVencimiento(token)).usuario;
  }

  /**
   * Como `verificarAccess`, más CUÁNDO vence el token (ms epoch, del claim `exp`). Lo usa el
   * socket del tiempo real (F2-142): un access válido al conectar no deja el socket abierto
   * más allá de su vida. Un token sin `exp` numérico se rechaza (todos los nuestros lo traen).
   */
  async verificarAccessConVencimiento(
    token: string,
  ): Promise<{ usuario: UsuarioToken; venceEnMs: number }> {
    const { sub, rol, empresaId, exp } = await this.verificar(
      token,
      this.config.accessSecret,
      'access',
    );
    if (typeof exp !== 'number' || !Number.isFinite(exp)) {
      throw new UnauthorizedException('No autenticado');
    }
    if (
      typeof rol !== 'string' ||
      !ROLES_VALIDOS.has(rol) ||
      !(empresaId === null || typeof empresaId === 'string')
    ) {
      throw new UnauthorizedException('No autenticado');
    }
    return { usuario: { id: sub, rol: rol as RolUsuario, empresaId }, venceEnMs: exp * 1000 };
  }

  /**
   * Devuelve el id del usuario, la versión de sesión y la sesión (`sid`) del
   * refresh token. Un token emitido antes de F1-060 no trae `ver`: vale como
   * versión 0, la inicial de todo usuario. Un `ver` que no es entero no
   * negativo se rechaza.
   *
   * Sin `sid` (emitido antes de F1-093) se RECHAZA: ese token no tiene fila que
   * el logout pueda revocar, y aceptarlo dejaría una sesión imposible de
   * cerrar. Al desplegar, todos vuelven a hacer login una vez.
   */
  async verificarRefresh(
    token: string,
  ): Promise<{ usuarioId: string; version: number; sesionId: string }> {
    const claims = await this.verificar(token, this.config.refreshSecret, 'refresh');
    const version = 'ver' in claims ? claims.ver : 0;
    if (typeof version !== 'number' || !Number.isInteger(version) || version < 0) {
      throw new UnauthorizedException('No autenticado');
    }
    const sesionId = claims.sid;
    if (typeof sesionId !== 'string' || !UUID.test(sesionId)) {
      throw new UnauthorizedException('No autenticado');
    }
    return { usuarioId: claims.sub, version, sesionId };
  }

  private async verificar(
    token: string,
    secret: string,
    typ: 'access' | 'refresh',
  ): Promise<Claims> {
    let claims: Record<string, unknown>;
    try {
      // Algoritmo fijado: un token con `alg: none` u otro algoritmo no pasa.
      claims = await this.jwt.verifyAsync<Record<string, unknown>>(token, {
        secret,
        algorithms: [ALGORITMO],
      });
    } catch {
      throw new UnauthorizedException('No autenticado');
    }
    if (claims.typ !== typ || typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new UnauthorizedException('No autenticado');
    }
    return claims as Claims;
  }
}
