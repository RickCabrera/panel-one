import { Prisma, RolUsuario } from '@prisma/client';

import type { EmpresaScope } from './empresa-scope';
import { encontradoOr404, whereScoped } from './scope.helper';

/**
 * Las ALTAS de la administración (F1-060), con scope. Es parte del helper
 * obligatorio, no un atajo: sólo `ScopedPrismaService.admin(scope)` (y su variante en una
 * transacción, `altaEnTransaccion`, del alta guiada de F2-147) construye
 * esta clase y le pasa el cliente; nadie más lo consigue.
 *
 * `para(scope)` sigue sin `create`: aquí hay tres altas explícitas y nada
 * genérico. Reglas que aplica cada una, sin que el caller las recuerde:
 * - La empresa de lo que se crea sale de un id VERIFICADO con scope: una
 *   empresa fuera de alcance es 404, idéntico a una que no existe.
 * - Crear una empresa, o un admin_global, exige scope global. Para un scope de
 *   empresa eso es un error de programación (el servicio ya respondió 403
 *   antes), así que truena en vez de responder: defensa en profundidad.
 * - Los datos del caller son campos sueltos y tipados; no llevan id, empresa ni
 *   sucursal que se puedan colar.
 * - Las ediciones NO pasan por aquí: van por `para(scope).X.updateMany`, que ya
 *   exige un where que acote y no deja tocar identidad ni pertenencia.
 */

/** Lo que el helper necesita del cliente crudo. Tipo de Prisma, no `PrismaClient`. */
export type ClienteAdmin = Pick<Prisma.TransactionClient, 'empresa' | 'sucursal' | 'usuario'>;

export const SELECT_EMPRESA = { id: true, nombre: true, activo: true } as const;
export const SELECT_SUCURSAL = {
  id: true,
  empresaId: true,
  nombre: true,
  zonaHoraria: true,
  activo: true,
} as const;
/** Sin `passwordHash` ni `versionSesion`: nunca salen de la API. */
export const SELECT_USUARIO = {
  id: true,
  email: true,
  nombre: true,
  rol: true,
  empresaId: true,
  activo: true,
} as const;

export type EmpresaCreada = Prisma.EmpresaGetPayload<{ select: typeof SELECT_EMPRESA }>;
export type SucursalCreada = Prisma.SucursalGetPayload<{ select: typeof SELECT_SUCURSAL }>;
export type UsuarioCreado = Prisma.UsuarioGetPayload<{ select: typeof SELECT_USUARIO }>;

export interface DatosUsuarioNuevo {
  email: string;
  nombre: string;
  rol: RolUsuario;
  passwordHash: string;
}

function exigir(nombre: string, valor: unknown): string {
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new Error(`Escritura admin: ${nombre} vacío o ausente.`);
  }
  return valor;
}

export class EscrituraAdmin {
  readonly #cliente: ClienteAdmin;
  readonly #scope: EmpresaScope;

  constructor(cliente: ClienteAdmin, scope: EmpresaScope) {
    this.#cliente = cliente;
    this.#scope = scope;
  }

  /** Alta de empresa: sólo con scope global. */
  async crearEmpresa(nombre: string): Promise<EmpresaCreada> {
    this.#exigirGlobal('crear una empresa');
    return this.#cliente.empresa.create({
      data: { nombre: exigir('nombre', nombre) },
      select: SELECT_EMPRESA,
    });
  }

  /** Alta de sucursal en una empresa del alcance (fuera de él = 404). */
  async crearSucursal(
    empresaId: string,
    datos: { nombre: string; zonaHoraria: string; apiKeyHash?: string },
  ): Promise<SucursalCreada> {
    const empresa = await this.#empresaEnAlcance(empresaId);
    return this.#cliente.sucursal.create({
      data: {
        empresaId: empresa,
        nombre: exigir('nombre', datos.nombre),
        zonaHoraria: exigir('zonaHoraria', datos.zonaHoraria),
        // F2-147: el alta guiada nace con su key (sólo el HASH; la key en claro nunca llega aquí).
        ...(datos.apiKeyHash === undefined
          ? {}
          : { apiKeyHash: exigir('apiKeyHash', datos.apiKeyHash) }),
      },
      select: SELECT_SUCURSAL,
    });
  }

  /**
   * Alta de usuario. Un admin_global va sin empresa y sólo lo crea un scope
   * global; cualquier otro rol va en una empresa del alcance (fuera = 404).
   */
  async crearUsuario(empresaId: string | null, datos: DatosUsuarioNuevo): Promise<UsuarioCreado> {
    let empresa: string | null;
    if (datos.rol === RolUsuario.admin_global) {
      this.#exigirGlobal('crear un admin_global');
      if (empresaId !== null) {
        throw new Error('Escritura admin: un admin_global no lleva empresa.');
      }
      empresa = null;
    } else {
      empresa = await this.#empresaEnAlcance(empresaId);
    }
    return this.#cliente.usuario.create({
      data: {
        email: exigir('email', datos.email),
        nombre: exigir('nombre', datos.nombre),
        rol: datos.rol,
        passwordHash: exigir('passwordHash', datos.passwordHash),
        empresaId: empresa,
      },
      select: SELECT_USUARIO,
    });
  }

  #exigirGlobal(que: string): void {
    if (this.#scope.tipo !== 'global') {
      throw new Error(`Escritura admin: ${que} exige scope global.`);
    }
  }

  /** El id de la empresa, sólo si está en el alcance. Si no, 404. */
  async #empresaEnAlcance(empresaId: string | null): Promise<string> {
    const id = exigir('empresaId', empresaId);
    const empresa = encontradoOr404(
      await this.#cliente.empresa.findFirst({
        where: whereScoped(this.#scope, 'Empresa', { id }),
        select: { id: true },
      }),
    );
    return empresa.id;
  }
}
