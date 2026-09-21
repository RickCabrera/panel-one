import { Module } from '@nestjs/common';

import { AgentesModule } from './agentes/agentes.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { IngestaModule } from './ingesta/ingesta.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScopeModule } from './scope/scope.module';
import { VentasModule } from './ventas/ventas.module';

@Module({
  imports: [PrismaModule, ScopeModule, AuthModule, AgentesModule, IngestaModule, VentasModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
