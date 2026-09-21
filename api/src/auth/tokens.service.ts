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

  firmarRefresh(usuarioId: string): Promise<string> {
    return this.jwt.signAsync(
      { typ: 'refresh' },
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
    const { sub, rol, empresaId } = await this.verificar(token, this.config.accessSecret, 'access');
    if (
      typeof rol !== 'string' ||
      !ROLES_VALIDOS.has(rol) ||
      !(empresaId === null || typeof empresaId === 'string')
    ) {
      throw new UnauthorizedException('No autenticado');
    }
    return { id: sub, rol: rol as RolUsuario, empresaId };
  }

  /** Devuelve el id del usuario del refresh token. */
  async verificarRefresh(token: string): Promise<string> {
    const claims = await this.verificar(token, this.config.refreshSecret, 'refresh');
    return claims.sub;
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
