import type { RolUsuario } from '@prisma/client';
import type { Request } from 'express';

import type { EmpresaScope } from '../scope/empresa-scope';

/** Lo que el access token dice del usuario. Sin datos personales: sólo id, rol y empresa. */
export interface UsuarioToken {
  id: string;
  rol: RolUsuario;
  empresaId: string | null;
}

/** El request después del `JwtAuthGuard`: usuario y scope ya resueltos. */
export interface RequestAutenticado extends Request {
  usuario?: UsuarioToken;
  empresaScope?: EmpresaScope;
}
