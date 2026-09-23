import { Module } from '@nestjs/common';

import { AdaptadoresModule } from './adaptadores/adaptadores.module';
import { AdministracionModule } from './administracion/administracion.module';
import { AgentesModule } from './agentes/agentes.module';
import { AlertasModule } from './alertas/alertas.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CatalogosModule } from './catalogos/catalogos.module';
import { FacturacionModule } from './facturacion/facturacion.module';
import { FinanzasModule } from './finanzas/finanzas.module';
import { InventarioModule } from './inventario/inventario.module';
import { AuditoriaModule } from './comun/auditoria';
import { RelojModule } from './comun/reloj';
import { IngestaModule } from './ingesta/ingesta.module';
import { MesasModule } from './mesas/mesas.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { OrganizacionModule } from './organizacion/organizacion.module';
import { PrismaModule } from './prisma/prisma.module';
import { NotificacionesModule } from './notificaciones/notificaciones.module';
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
    OnboardingModule,
    SistemaModule,
    AlertasModule,
    ReportesModule,
    NotificacionesModule,
    CatalogosModule,
    InventarioModule,
    FinanzasModule,
    FacturacionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
