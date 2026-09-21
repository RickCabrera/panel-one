import type { DatosScoped } from './scoped-prisma.service';
import { encontradoOr404 } from './scope.helper';

/**
 * Verifica que la empresa pedida, y la sucursal si viene, estén en el alcance
 * del usuario: 404 si no, idéntico a "no existe". La sucursal tiene que ser DE
 * ESA empresa: ni admin_global puede mezclar la empresa A con una sucursal de B.
 *
 * La usan los agregados (F1-032), los tickets y las mesas abiertas (F1-033).
 * Se lee con `datos` (ya con scope), así que el filtro de tenant va en el WHERE.
 */
export async function verificarAlcance(
  datos: DatosScoped,
  empresaId: string,
  sucursalId?: string,
): Promise<void> {
  encontradoOr404(
    await datos.empresa.findFirst({ where: { id: empresaId }, select: { id: true } }),
  );
  if (sucursalId !== undefined) {
    encontradoOr404(
      await datos.sucursal.findFirst({
        where: { id: sucursalId, empresaId },
        select: { id: true },
      }),
    );
  }
}
