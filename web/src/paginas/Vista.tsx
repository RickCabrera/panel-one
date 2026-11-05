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
    <section className="px-4 py-4 md:px-6 md:py-5">
      <h1 className="text-2xl font-semibold text-tinta">{titulo}</h1>
      <p className="mt-0.5 truncate text-sm text-tinta-suave" data-testid="alcance">
        {empresa ? `${empresa.nombre} · ${nombreSucursal}` : 'Cargando alcance…'}
      </p>
      <div className="mt-4">{children}</div>
    </section>
  );
}
