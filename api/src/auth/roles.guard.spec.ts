import { ForbiddenException, NotFoundException, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolUsuario } from '@prisma/client';

import { Roles } from './decoradores';
import { SoloInterno } from './mvp';
import { RolesGuard } from './roles.guard';

// Unitario del `RolesGuard` con `@SoloInterno()` (MVP, auth/mvp.ts), sin base: el e2e de las
// rutas reales vive en mvp.e2e.spec.ts.

class Controlador {
  @SoloInterno()
  cerrada() {}

  @SoloInterno()
  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  cerradaConRoles() {}

  @Roles(RolUsuario.admin_global, RolUsuario.admin_empresa)
  soloRoles() {}

  abierta() {}
}

@SoloInterno()
class ControladorCerrado {
  cualquiera() {}
}

const ctx = (
  clase: abstract new () => object,
  metodo: string,
  rol?: RolUsuario,
): ExecutionContext =>
  ({
    getHandler: () => (clase.prototype as Record<string, unknown>)[metodo],
    getClass: () => clase,
    switchToHttp: () => ({
      getRequest: () => (rol ? { usuario: { id: 'u', rol, empresaId: null } } : {}),
    }),
  }) as unknown as ExecutionContext;

describe('RolesGuard · @SoloInterno (interruptor prendido)', () => {
  const guard = new RolesGuard(new Reflector());

  it.each([RolUsuario.admin_empresa, RolUsuario.visor])('%s: 404, nunca 403', (rol) => {
    expect(() => guard.canActivate(ctx(Controlador, 'cerrada', rol))).toThrow(NotFoundException);
    expect(() => guard.canActivate(ctx(ControladorCerrado, 'cualquiera', rol))).toThrow(
      NotFoundException,
    );
  });

  it('el cierre va antes que @Roles: admin_empresa no recibe un 403 que confirme la ruta', () => {
    expect(() => guard.canActivate(ctx(Controlador, 'cerradaConRoles', RolUsuario.visor))).toThrow(
      NotFoundException,
    );
    expect(() =>
      guard.canActivate(ctx(Controlador, 'cerradaConRoles', RolUsuario.admin_empresa)),
    ).toThrow(NotFoundException);
  });

  it('admin_global pasa', () => {
    expect(guard.canActivate(ctx(Controlador, 'cerrada', RolUsuario.admin_global))).toBe(true);
    expect(guard.canActivate(ctx(ControladorCerrado, 'cualquiera', RolUsuario.admin_global))).toBe(
      true,
    );
    expect(guard.canActivate(ctx(Controlador, 'cerradaConRoles', RolUsuario.admin_global))).toBe(
      true,
    );
  });

  it('sin @SoloInterno todo sigue igual: @Roles da 403 y lo abierto pasa', () => {
    expect(() => guard.canActivate(ctx(Controlador, 'soloRoles', RolUsuario.visor))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(ctx(Controlador, 'abierta', RolUsuario.visor))).toBe(true);
  });
});

describe('RolesGuard · @SoloInterno con el interruptor apagado', () => {
  it('no cierra nada: el visor pasa y @Roles sigue mandando', () => {
    jest.isolateModules(() => {
      jest.doMock('./mvp', () => ({
        ...jest.requireActual<typeof import('./mvp')>('./mvp'),
        OCULTAR_A_CLIENTES: false,
      }));
      // Módulos aislados: las clases de excepción son otra copia, por eso se compara el mensaje.
      const { RolesGuard: GuardApagado } =
        jest.requireActual<typeof import('./roles.guard')>('./roles.guard');
      const guard = new GuardApagado(new Reflector());
      expect(guard.canActivate(ctx(Controlador, 'cerrada', RolUsuario.visor))).toBe(true);
      expect(() =>
        guard.canActivate(ctx(Controlador, 'cerradaConRoles', RolUsuario.visor)),
      ).toThrow('Rol insuficiente');
    });
  });
});
