import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { Prisma, RolUsuario } from '@prisma/client';

import { ARGON2_OPCIONES } from '../auth/argon2';
import { Auditoria, type Actor } from '../comun/auditoria';
import { verificarAlcance } from '../scope/alcance';
import type { EmpresaScope } from '../scope/empresa-scope';
import {
  SELECT_EMPRESA,
  SELECT_SUCURSAL,
  SELECT_USUARIO,
  type EmpresaCreada,
  type SucursalCreada,
  type UsuarioCreado,
} from '../scope/escritura-admin';
import { encontradoOr404 } from '../scope/scope.helper';
import { ScopedPrismaService } from '../scope/scoped-prisma.service';
import type {
  CrearSucursalDto,
  CrearUsuarioDto,
  EditarEmpresaDto,
  EditarSucursalDto,
  EditarUsuarioDto,
} from './dto/administracion.dto';

/** Quien hace el cambio, con su scope: los dos salen del access token. */
export interface Quien {
  actor: Actor;
  scope: EmpresaScope;
}

/** Los campos de un PATCH que sí vinieron. Un PATCH sin ninguno es 400. */
function camposPresentes<T extends object>(dto: T): (keyof T & string)[] {
  const campos = (Object.keys(dto) as (keyof T & string)[]).filter((c) => dto[c] !== undefined);
  if (campos.length === 0) {
    throw new BadRequestException('No hay nada que cambiar');
  }
  return campos;
}

function emailDuplicado(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Administración de empresas, sucursales y usuarios (F1-060). Todo por el
 * helper de scope: las altas por `admin(scope)`, las ediciones por
 * `para(scope).X.updateMany` y las lecturas por `para(scope)`. Algo de otra
 * empresa es 404, idéntico a que no exista.
 *
 * Las reglas de ROL (quién puede crear un admin_global, qué rol se puede
 * asignar) se deciden aquí, ANTES de escribir, y son 403/400: dependen de lo que
 * pide el actor, no de que un recurso ajeno exista. Cada cambio que se escribió
 * deja su línea de auditoría.
 */
@Injectable()
export class AdministracionService {
  constructor(
    private readonly datos: ScopedPrismaService,
    private readonly auditoria: Auditoria,
  ) {}

  // --- Empresas -----------------------------------------------------------------------

  async crearEmpresa({ actor, scope }: Quien, nombre: string): Promise<EmpresaCreada> {
    const empresa = await this.datos.admin(scope).crearEmpresa(nombre);
    this.auditoria.registrar(actor, {
      accion: 'empresa.crear',
      recurso: 'empresa',
      recursoId: empresa.id,
      empresaId: empresa.id,
    });
    return empresa;
  }

  async editarEmpresa(
    { actor, scope }: Quien,
    id: string,
    dto: EditarEmpresaDto,
  ): Promise<EmpresaCreada> {
    const campos = camposPresentes(dto);
    const datos = this.datos.para(scope);
    const { count } = await datos.empresa.updateMany({
      where: { id },
      data: { nombre: dto.nombre, activo: dto.activo },
    });
    encontradoOr404(count === 1 ? count : null);
    this.auditoria.registrar(actor, {
      accion: 'empresa.editar',
      recurso: 'empresa',
      recursoId: id,
      empresaId: id,
      campos,
    });
    return encontradoOr404(
      await datos.empresa.findFirst({ where: { id }, select: SELECT_EMPRESA }),
    );
  }

  // --- Sucursales ---------------------------------------------------------------------

  async crearSucursal({ actor, scope }: Quien, dto: CrearSucursalDto): Promise<SucursalCreada> {
    const sucursal = await this.datos.admin(scope).crearSucursal(dto.empresaId, {
      nombre: dto.nombre,
      zonaHoraria: dto.zonaHoraria,
    });
    this.auditoria.registrar(actor, {
      accion: 'sucursal.crear',
      recurso: 'sucursal',
      recursoId: sucursal.id,
      empresaId: sucursal.empresaId,
    });
    return sucursal;
  }

  async editarSucursal(
    { actor, scope }: Quien,
    id: string,
    dto: EditarSucursalDto,
  ): Promise<SucursalCreada> {
    const campos = camposPresentes(dto);
    const datos = this.datos.para(scope);
    const { count } = await datos.sucursal.updateMany({
      where: { id },
      data: { nombre: dto.nombre, zonaHoraria: dto.zonaHoraria, activo: dto.activo },
    });
    encontradoOr404(count === 1 ? count : null);
    const sucursal = encontradoOr404(
      await datos.sucursal.findFirst({ where: { id }, select: SELECT_SUCURSAL }),
    );
    this.auditoria.registrar(actor, {
      accion: 'sucursal.editar',
      recurso: 'sucursal',
      recursoId: id,
      empresaId: sucursal.empresaId,
      campos,
    });
    return sucursal;
  }

  // --- Usuarios -----------------------------------------------------------------------

  /** Usuarios en alcance, sin hash. Con `empresaId` ajena o inexistente: 404. */
  async usuarios(scope: EmpresaScope, empresaId?: string): Promise<UsuarioCreado[]> {
    const datos = this.datos.para(scope);
    if (empresaId !== undefined) {
      await verificarAlcance(datos, empresaId);
    }
    return datos.usuario.findMany({
      where: empresaId === undefined ? {} : { empresaId },
      select: SELECT_USUARIO,
      orderBy: [{ nombre: 'asc' }, { id: 'asc' }],
    });
  }

  async crearUsuario({ actor, scope }: Quien, dto: CrearUsuarioDto): Promise<UsuarioCreado> {
    const empresaId = dto.empresaId ?? null;
    if (dto.rol === RolUsuario.admin_global) {
      if (scope.tipo !== 'global') {
        throw new ForbiddenException('Sólo un administrador global crea administradores globales');
      }
      if (empresaId !== null) {
        throw new BadRequestException('Un admin_global no lleva empresaId');
      }
    } else if (empresaId === null) {
      throw new BadRequestException('empresaId es obligatorio para este rol');
    }

    let usuario: UsuarioCreado;
    try {
      usuario = await this.datos.admin(scope).crearUsuario(empresaId, {
        email: dto.email,
        nombre: dto.nombre,
        rol: dto.rol,
        passwordHash: await hash(dto.password, ARGON2_OPCIONES),
      });
    } catch (error) {
      if (emailDuplicado(error)) {
        throw new ConflictException('Ese email ya está en uso');
      }
      throw error;
    }
    this.auditoria.registrar(actor, {
      accion: 'usuario.crear',
      recurso: 'usuario',
      recursoId: usuario.id,
      empresaId: usuario.empresaId,
    });
    return usuario;
  }

  async editarUsuario(
    { actor, scope }: Quien,
    id: string,
    dto: EditarUsuarioDto,
  ): Promise<UsuarioCreado> {
    const campos = camposPresentes(dto);
    const datos = this.datos.para(scope);
    // Primero el destino, CON scope: uno de otra empresa (o un admin_global para
    // un admin_empresa) es 404 antes de evaluar ninguna regla de rol, para que
    // ningún 400/403 revele que existe.
    const destino = encontradoOr404(
      await datos.usuario.findFirst({ where: { id }, select: { rol: true } }),
    );
    const cambiaRol = dto.rol !== undefined && dto.rol !== destino.rol;

    if (id === actor.id && (cambiaRol || dto.activo === false)) {
      throw new BadRequestException('No puedes cambiarte el rol ni darte de baja a ti mismo');
    }
    if (cambiaRol && dto.rol === RolUsuario.admin_global) {
      if (scope.tipo !== 'global') {
        throw new ForbiddenException('Sólo un administrador global asigna ese rol');
      }
      throw new BadRequestException('Un usuario de empresa no se convierte en admin_global');
    }
    if (cambiaRol && destino.rol === RolUsuario.admin_global) {
      throw new BadRequestException('Un admin_global no cambia de rol');
    }

    const { count } = await datos.usuario.updateMany({
      where: { id },
      data: {
        nombre: dto.nombre,
        rol: dto.rol,
        activo: dto.activo,
        // Dar de baja corta también sus refresh tokens (F1-060).
        ...(dto.activo === false ? { versionSesion: { increment: 1 } } : {}),
      },
    });
    encontradoOr404(count === 1 ? count : null);
    const usuario = encontradoOr404(
      await datos.usuario.findFirst({ where: { id }, select: SELECT_USUARIO }),
    );
    this.auditoria.registrar(actor, {
      accion: 'usuario.editar',
      recurso: 'usuario',
      recursoId: id,
      empresaId: usuario.empresaId,
      campos,
    });
    return usuario;
  }

  /**
   * Reset de contraseña por un admin. Hash nuevo e incremento de
   * `versionSesion` en la misma sentencia: los refresh del usuario dejan de
   * servir en ese instante.
   */
  async resetPassword({ actor, scope }: Quien, id: string, password: string): Promise<void> {
    const datos = this.datos.para(scope);
    const passwordHash = await hash(password, ARGON2_OPCIONES);
    const { count } = await datos.usuario.updateMany({
      where: { id },
      data: { passwordHash, versionSesion: { increment: 1 } },
    });
    encontradoOr404(count === 1 ? count : null);
    const { empresaId } = encontradoOr404(
      await datos.usuario.findFirst({ where: { id }, select: { empresaId: true } }),
    );
    this.auditoria.registrar(actor, {
      accion: 'usuario.reset_password',
      recurso: 'usuario',
      recursoId: id,
      empresaId,
    });
  }
}
