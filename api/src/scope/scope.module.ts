import { Global, Module } from '@nestjs/common';

import { ScopedPrismaService } from './scoped-prisma.service';

@Global()
@Module({
  providers: [ScopedPrismaService],
  exports: [ScopedPrismaService],
})
export class ScopeModule {}
