import { Module } from '@nestjs/common';

import { EmpresasController, SucursalesController } from './organizacion.controller';
import { OrganizacionService } from './organizacion.service';

/** Lectura de empresas y sucursales para el selector del panel (F1-033). */
@Module({
  controllers: [EmpresasController, SucursalesController],
  providers: [OrganizacionService],
})
export class OrganizacionModule {}
