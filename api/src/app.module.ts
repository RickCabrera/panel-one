import { Module } from '@nestjs/common';

import { AdaptadoresModule } from './adaptadores/adaptadores.module';
import { AdministracionModule } from './administracion/administracion.module';
import { AgentesModule } from './agentes/agentes.module';
import { AlertasModule } from './alertas/alertas.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CatalogosModule } from './catalogos/catalogos.module';
import { InventarioModule } from './inventario/inventario.module';
import { AuditoriaModule } from './comun/auditoria';
import { RelojModule } from './comun/reloj';
import { IngestaModule } from './ingesta/ingesta.module';
import { MesasModule } from './mesas/mesas.module';
import { OrganizacionModule } from './organizacion/organizacion.module';
import { PrismaModule } from './prisma/prisma.module';
import { ReportesModule } from './reportes/reportes.module';
import { ScopeModule } from './scope/scope.module';
import { SistemaModule } from './sistema/sistema.module';
import { VentasModule } from './ventas/ventas.module';

@Module({
  imports: [
    PrismaModule,
    RelojModule,
    AuditoriaModule,
    AdaptadoresModule,
    ScopeModule,
    AuthModule,
    AgentesModule,
    IngestaModule,
    VentasModule,
    MesasModule,
    OrganizacionModule,
    AdministracionModule,
    SistemaModule,
    AlertasModule,
    ReportesModule,
    CatalogosModule,
    InventarioModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
