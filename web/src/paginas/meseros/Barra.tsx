import type { ReactNode } from 'react';

/**
 * UI-05: el ranking de meseros con barras. Debajo del importe de cada fila, una barra delgada
 * proporcional al mejor de SU sucursal (el lugar también es dentro de la sucursal). Decorativa:
 * la cifra va escrita encima y la tabla es la fuente accesible.
 *
 * La proporción se saca en `bigint` (milésimas) y sólo se convierte a número para el ancho.
 */
export function BarraRelativa({
  parte,
  maximo,
  children,
}: {
  parte: bigint | null;
  maximo: bigint;
  children: ReactNode;
}) {
  const milesimas = parte === null || maximo <= 0n || parte <= 0n ? 0n : (parte * 1000n) / maximo;
  const ancho = Number(milesimas > 1000n ? 1000n : milesimas) / 10;
  return (
    <span className="inline-flex flex-col items-end gap-1">
      <span>{children}</span>
      <span aria-hidden="true" className="block h-1.5 w-24 overflow-hidden rounded-full bg-realce">
        {ancho > 0 && (
          <span
            className="block h-full rounded-full bg-serie-1"
            style={{ width: `${Math.max(ancho, 3)}%` }}
          />
        )}
      </span>
    </span>
  );
}

/**
 * El lugar en el ranking como insignia: el primero de cada sucursal en arena sobre morado (la
 * marca), los demás en el realce. El texto es el mismo de siempre ("1", "1 de 4").
 */
export function Lugar({ primero, children }: { primero: boolean; children: ReactNode }) {
  return (
    <span
      className={`inline-flex min-w-7 items-center justify-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums ${
        primero ? 'bg-lateral text-arena' : 'bg-realce text-tinta-medio'
      }`}
    >
      {children}
    </span>
  );
}
