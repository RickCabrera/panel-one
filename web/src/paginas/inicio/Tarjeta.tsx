import type { ReactNode } from 'react';

import { ErrorApi } from '../../api/cliente';

export function Tarjeta({
  titulo,
  children,
  className = '',
}: {
  titulo: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      aria-label={titulo}
      className={`min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className}`}
    >
      <h2 className="text-sm font-medium text-slate-600">{titulo}</h2>
      <div className="mt-2">{children}</div>
    </section>
  );
}

/** Placeholder mientras carga: bloques grises del tamaño aproximado del contenido. */
export function Esqueleto({ lineas = 2, grafica = false }: { lineas?: number; grafica?: boolean }) {
  return (
    <div aria-busy="true" aria-label="Cargando" data-testid="esqueleto" className="animate-pulse">
      <div className="h-8 w-40 rounded bg-slate-200" />
      {Array.from({ length: lineas }, (_, i) => (
        <div key={i} className="mt-2 h-4 w-28 rounded bg-slate-200" />
      ))}
      {grafica && <div className="mt-4 h-48 w-full rounded bg-slate-100" />}
    </div>
  );
}

export function Vacio({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-slate-500">{children}</p>;
}

export function ErrorTarjeta({ error }: { error: unknown }) {
  const detalle = error instanceof ErrorApi ? error.message : 'Error inesperado.';
  return (
    <p role="alert" className="py-6 text-center text-sm text-red-700">
      No se pudo cargar este dato. {detalle}
    </p>
  );
}

/** Estado de una consulta de TanStack en su forma mínima. */
interface EstadoConsulta<T> {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: T | undefined;
}

/**
 * Pinta skeleton, error o el contenido. Si una de las consultas falla, esa tarjeta
 * muestra el error y las demás siguen: una tarjeta rota no tumba el panel.
 */
export function SegunEstado<T>({
  consulta,
  esqueleto,
  children,
}: {
  consulta: EstadoConsulta<T>;
  esqueleto: ReactNode;
  children: (datos: T) => ReactNode;
}) {
  if (consulta.isError) return <ErrorTarjeta error={consulta.error} />;
  if (consulta.isPending || consulta.data === undefined) return <>{esqueleto}</>;
  return <>{children(consulta.data)}</>;
}
