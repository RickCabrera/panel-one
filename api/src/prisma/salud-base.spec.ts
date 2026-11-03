import type { PrismaService } from './prisma.service';
import { SaludBaseService } from './salud-base';

// F1-002: la pregunta de `GET /health` a la base. Contesta, truena o se cuelga: las
// tres salidas con un cliente falso, porque "colgada" no se puede provocar a voluntad
// contra un Postgres real sin tumbarlo.
describe('SaludBaseService', () => {
  function servicio(queryRaw: () => Promise<unknown>): SaludBaseService {
    return new SaludBaseService({ $queryRaw: queryRaw } as unknown as PrismaService);
  }

  it('la base contesta → true', async () => {
    await expect(servicio(() => Promise.resolve([{ '?column?': 1 }])).responde()).resolves.toBe(
      true,
    );
  });

  it('la consulta truena (conexión rechazada) → false, sin propagar el error', async () => {
    const error = new Error("Can't reach database server at `postgres:5432`");
    await expect(servicio(() => Promise.reject(error)).responde()).resolves.toBe(false);
  });

  it('la consulta no contesta dentro del tope → false al vencer, no espera para siempre', async () => {
    const colgada = () => new Promise<never>(() => undefined);
    const inicio = Date.now();
    await expect(servicio(colgada).responde(50)).resolves.toBe(false);
    expect(Date.now() - inicio).toBeLessThan(1_000);
  });

  it('una respuesta lenta pero dentro del tope cuenta como viva', async () => {
    const lenta = () => new Promise((resolver) => setTimeout(() => resolver([]), 20));
    await expect(servicio(lenta).responde(500)).resolves.toBe(true);
  });
});
