import { randomUUID } from 'node:crypto';

import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';
import { RolUsuario, type Empresa, type Usuario } from '@prisma/client';

import { ACCESS_TTL_SEGUNDOS } from '../config/auth.config';
// Único servicio de auth en la allowlist de PrismaService: el login busca por
// email ANTES de saber quién es el usuario, así que no hay scope que aplicar; el
// refresh y el cambio de contraseña propio (F1-060) leen y escriben SÓLO la fila
// del usuario del token, por su id. Nada de datos de negocio pasa por aquí.
import { PrismaService } from '../prisma/prisma.service';
import { ARGON2_OPCIONES } from './argon2';
import type { SesionDto, UsuarioActualDto } from './dto/sesion.dto';
import { TokensService } from './tokens.service';

export interface SesionEmitida {
  sesion: SesionDto;
  refreshToken: string;
}

type UsuarioConEmpresa = Usuario & { empresa: Empresa | null };

/** El mismo mensaje para toda falla de login: no se distingue qué falló. */
function credencialesInvalidas(): UnauthorizedException {
  return new UnauthorizedException('Credenciales inválidas');
}

export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

@Injectable()
export class AuthService {
  /**
   * Hash argon2 de una contraseña aleatoria que nadie conoce. Cuando el email
   * no existe se verifica contra él: el login tarda lo mismo exista o no el
   * usuario, y por tiempo tampoco se enumeran emails.
   */
  private hashRelleno?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokensService,
  ) {}

  async login(email: string, password: string): Promise<SesionEmitida> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { email: normalizarEmail(email) },
      include: { empresa: true },
    });
    const hashGuardado = usuario?.passwordHash ?? (await this.obtenerHashRelleno());
    const coincide = await verify(hashGuardado, password).catch(() => false);
    if (!usuario || !coincide || !puedeEntrar(usuario)) {
      throw credencialesInvalidas();
    }
    return this.emitir(usuario);
  }

  /**
   * Refresh: el usuario se RELEE de la base. Un usuario desactivado (o cuya
   * empresa se desactivó) no obtiene un access token nuevo, y el rol/empresa del
   * token nuevo son los actuales, no los del login.
   */
  async refrescar(refreshToken: string | undefined): Promise<SesionEmitida> {
    if (!refreshToken) {
      throw new UnauthorizedException('No autenticado');
    }
    const { usuarioId, version } = await this.tokens.verificarRefresh(refreshToken);
    const usuario = await this.usuarioVigente(usuarioId);
    // Un refresh emitido antes de un cambio/reset de contraseña o de una
    // desactivación (F1-060) ya no sirve.
    if (usuario.versionSesion !== version) {
      throw new UnauthorizedException('No autenticado');
    }
    return this.emitir(usuario);
  }

  /**
   * Cambio de contraseña del propio usuario (F1-060). Lo relee vigente (uno ya
   * desactivado, con un access token todavía válido, recibe 401) y verifica la
   * actual. Hash nuevo e incremento de `versionSesion` van en UNA sentencia, y la
   * sesión nueva se emite con la versión que devolvió esa sentencia: los refresh
   * anteriores (otros navegadores) dejan de servir y éste sigue dentro.
   *
   * Contraseña actual incorrecta es 400, no 401: el 401 significa "sin sesión"
   * para el cliente, y ésta sí la tiene.
   */
  async cambiarPassword(usuarioId: string, actual: string, nueva: string): Promise<SesionEmitida> {
    const usuario = await this.usuarioVigente(usuarioId);
    const coincide = await verify(usuario.passwordHash, actual).catch(() => false);
    if (!coincide) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }
    const actualizado = await this.prisma.usuario.update({
      where: { id: usuario.id },
      data: {
        passwordHash: await hash(nueva, ARGON2_OPCIONES),
        versionSesion: { increment: 1 },
      },
      include: { empresa: true },
    });
    return this.emitir(actualizado);
  }

  async usuarioActual(usuarioId: string): Promise<UsuarioActualDto> {
    return aDto(await this.usuarioVigente(usuarioId));
  }

  private async usuarioVigente(usuarioId: string): Promise<UsuarioConEmpresa> {
    const usuario = await this.prisma.usuario.findUnique({
      where: { id: usuarioId },
      include: { empresa: true },
    });
    if (!usuario || !puedeEntrar(usuario)) {
      throw new UnauthorizedException('No autenticado');
    }
    return usuario;
  }

  private async emitir(usuario: UsuarioConEmpresa): Promise<SesionEmitida> {
    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.firmarAccess({
        id: usuario.id,
        rol: usuario.rol,
        empresaId: usuario.empresaId,
      }),
      this.tokens.firmarRefresh(usuario.id, usuario.versionSesion),
    ]);
    return {
      sesion: { accessToken, expiresIn: ACCESS_TTL_SEGUNDOS, usuario: aDto(usuario) },
      refreshToken,
    };
  }

  private obtenerHashRelleno(): Promise<string> {
    this.hashRelleno ??= hash(randomUUID(), ARGON2_OPCIONES);
    return this.hashRelleno;
  }
}

/** Usuario activo, y si pertenece a una empresa, que la empresa también lo esté. */
function puedeEntrar(usuario: UsuarioConEmpresa): boolean {
  if (!usuario.activo) {
    return false;
  }
  if (usuario.rol === RolUsuario.admin_global) {
    return usuario.empresaId === null;
  }
  return usuario.empresa !== null && usuario.empresa.activo;
}

function aDto(usuario: Usuario): UsuarioActualDto {
  return {
    id: usuario.id,
    email: usuario.email,
    nombre: usuario.nombre,
    rol: usuario.rol,
    empresaId: usuario.empresaId,
  };
}
