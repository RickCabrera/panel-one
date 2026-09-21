import { Module } from '@nestjs/common';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { ScopeModule } from './scope/scope.module';

@Module({
  imports: [PrismaModule, ScopeModule, AuthModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
