import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';
import { SaludBaseService } from './salud-base';

@Global()
@Module({
  providers: [PrismaService, SaludBaseService],
  exports: [PrismaService, SaludBaseService],
})
export class PrismaModule {}
