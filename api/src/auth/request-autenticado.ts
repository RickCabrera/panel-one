import type { RolUsuario } from '@prisma/client';
import type { Request } from 'express';

import type { EmpresaScope } from '../scope/empresa-scope';

/** Lo que el access token dice del usuario. Sin datos personales: sólo id, rol y empresa. */
export interface UsuarioToken {
  id: string;
  rol: RolUsuario;
  empresaId: string | null;
}

/**
 * Lo que la API key dice del agente (F1-012): la sucursal de la key y su
 * empresa, leídas de la base. Nunca de algo que mande el agente.
 */
export interface AgenteAutenticado {
  sucursalId: string;
  empresaId: string;
}

/**
 * El request después de los guards: usuario y scope (`JwtAuthGuard`) en las
 * rutas de usuario, o el agente (`AgentAuthGuard`) en las rutas de agente.
 */
export interface RequestAutenticado extends Request {
  usuario?: UsuarioToken;
  empresaScope?: EmpresaScope;
  agente?: AgenteAutenticado;
}
