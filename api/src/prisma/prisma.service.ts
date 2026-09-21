import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Cliente crudo de Prisma, SIN scope de empresa. Sólo lo pueden importar los
 * archivos de la allowlist de `no-restricted-imports` en `eslint.config.mjs`:
 * todo acceso a datos de negocio pasa por `ScopedPrismaService`.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
