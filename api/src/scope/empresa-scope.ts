import { RolUsuario } from '@prisma/client';

/**
 * Qué empresas puede ver quien hace el request. Se construye SÓLO a partir del
 * usuario autenticado (lo pone el `JwtAuthGuard` en el request), nunca de un
 * parámetro que mande el cliente.
 */
export type EmpresaScope =
  { readonly tipo: 'global' } | { readonly tipo: 'empresa'; readonly empresaId: string };

export function scopeDeUsuario(usuario: {
  rol: RolUsuario;
  empresaId: string | null;
}): EmpresaScope {
  if (usuario.rol === RolUsuario.admin_global) {
    return { tipo: 'global' };
  }
  if (!usuario.empresaId) {
    // No debería pasar (lo impide el CHECK usuarios_rol_empresa_chk), pero si
    // pasa, el usuario NO se degrada a "ve todo": se rechaza.
    throw new Error(`Usuario con rol ${usuario.rol} sin empresa: no se puede construir su scope.`);
  }
  return { tipo: 'empresa', empresaId: usuario.empresaId };
}

/**
 * El scope de un agente: la empresa de SU sucursal, resuelta por el
 * `AgentAuthGuard` desde la API key. El agente nunca manda el tenant.
 *
 * Ojo F1-031: esto acota a la EMPRESA, no a la sucursal. Si la ingesta necesita
 * que un agente sólo vea su sucursal, el filtro por `sucursalId` se decide allá.
 */
export function scopeDeAgente(agente: { empresaId: string }): EmpresaScope {
  return { tipo: 'empresa', empresaId: agente.empresaId };
}
