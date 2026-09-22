import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { urlConTimeout } from './url-timeout';

/**
 * Cliente crudo de Prisma, SIN scope de empresa. Sólo lo pueden importar los
 * archivos de la allowlist de `no-restricted-imports` en `eslint.config.mjs`:
 * todo acceso a datos de negocio pasa por `ScopedPrismaService`.
 *
 * Cada conexión abre con `statement_timeout` (ver `url-timeout.ts`, F2-203).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const url = process.env.DATABASE_URL;
    super(url ? { datasources: { db: { url: urlConTimeout(url) } } } : undefined);
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
