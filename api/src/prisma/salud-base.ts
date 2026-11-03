import { Injectable } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * Cuánto espera `GET /health` a la base antes de darla por caída (F1-002). Corto a
 * propósito: el healthcheck de Docker y UptimeRobot (F1-004) preguntan seguido, y una
 * base que tarda más que esto en contestar `SELECT 1` ya es una base con problemas.
 */
export const TIMEOUT_SALUD_BASE_MS = 3_000;

/**
 * La única pregunta que `GET /health` le hace a la base: ¿contesta? Vive en
 * `src/prisma/` porque usa el cliente crudo (la allowlist de `eslint.config.mjs` ya
 * cubre esta carpeta) y no lee ninguna tabla: sin datos de negocio, no hay scope que
 * aplicar.
 */
@Injectable()
export class SaludBaseService {
  constructor(private readonly prisma: PrismaService) {}

  /** `true` si la base contestó `SELECT 1` dentro del tope; `false` si falló o tardó. */
  async responde(timeoutMs: number = TIMEOUT_SALUD_BASE_MS): Promise<boolean> {
    let temporizador: NodeJS.Timeout | undefined;
    const tope = new Promise<false>((resolver) => {
      temporizador = setTimeout(() => resolver(false), timeoutMs);
    });
    const consulta = this.prisma.$queryRaw`SELECT 1`.then(
      () => true,
      () => false,
    );
    try {
      return await Promise.race([consulta, tope]);
    } finally {
      clearTimeout(temporizador);
    }
  }
}
