import { Module } from '@nestjs/common';

import { AgentesModule } from './agentes/agentes.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { RelojModule } from './comun/reloj';
import { IngestaModule } from './ingesta/ingesta.module';
import { MesasModule } from './mesas/mesas.module';
import { OrganizacionModule } from './organizacion/organizacion.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScopeModule } from './scope/scope.module';
import { VentasModule } from './ventas/ventas.module';

@Module({
  imports: [
    PrismaModule,
    RelojModule,
    ScopeModule,
    AuthModule,
    AgentesModule,
    IngestaModule,
    VentasModule,
    MesasModule,
    OrganizacionModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
