import type { ReactNode } from 'react';

import { useAlcance } from '../filtros/alcance';

/**
 * Cascarón común de las vistas: el título (en la display de la marca, UI-05), el alcance
 * activo y, a la derecha del título, las acciones de la vista (refrescar, exportar...).
 */
export function Vista({
  titulo,
  children,
  acciones,
}: {
  titulo: string;
  children?: ReactNode;
  /** UI-05: botones y estado de la vista, en el renglón del título (debajo en el celular). */
  acciones?: ReactNode;
}) {
  const { empresa, sucursal, sucursalId } = useAlcance();
  const nombreSucursal = sucursal?.nombre ?? (sucursalId ? '…' : 'Todas las sucursales');

  return (
    <section className="px-4 py-4 md:px-6 md:py-6 xl:px-8">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-[1.75rem] leading-tight text-tinta md:text-3xl">{titulo}</h1>
          <p className="mt-1 truncate text-sm text-tinta-suave" data-testid="alcance">
            {empresa ? `${empresa.nombre} · ${nombreSucursal}` : 'Cargando alcance…'}
          </p>
        </div>
        {acciones && (
          <div className="flex min-w-0 flex-wrap items-center gap-2 sm:justify-end">{acciones}</div>
        )}
      </div>
      <div className="mt-5">{children}</div>
    </section>
  );
}
