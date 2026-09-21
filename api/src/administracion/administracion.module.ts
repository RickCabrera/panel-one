import { Module } from '@nestjs/common';

import {
  EmpresasAdminController,
  SucursalesAdminController,
  UsuariosAdminController,
} from './administracion.controller';
import { AdministracionService } from './administracion.service';

/**
 * Administración (F1-060): altas y ediciones de empresas, sucursales y usuarios,
 * y reset de contraseña. La rotación de API key sigue en AgentesModule (F1-012)
 * y el cambio de contraseña propio en AuthModule (`/cuenta/password`).
 */
@Module({
  controllers: [EmpresasAdminController, SucursalesAdminController, UsuariosAdminController],
  providers: [AdministracionService],
})
export class AdministracionModule {}
