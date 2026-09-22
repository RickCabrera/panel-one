import type { ReactNode } from 'react';

import { useAlcance } from '../filtros/alcance';

/**
 * Cascarón común de las vistas. Muestra el alcance activo; el contenido real de
 * cada vista llega en su tarea (F1-041, 042, 043, 050, 060).
 */
export function Vista({ titulo, children }: { titulo: string; children?: ReactNode }) {
  const { empresa, sucursal, sucursalId } = useAlcance();
  const nombreSucursal = sucursal?.nombre ?? (sucursalId ? '…' : 'Todas las sucursales');

  return (
    <section className="p-4 md:p-6">
      <h1 className="text-xl font-semibold">{titulo}</h1>
      <p className="mt-1 truncate text-sm text-tinta-suave" data-testid="alcance">
        {empresa ? `${empresa.nombre} · ${nombreSucursal}` : 'Cargando alcance…'}
      </p>
      <div className="mt-6">{children}</div>
    </section>
  );
}
